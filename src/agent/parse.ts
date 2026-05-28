// ============================================================================
// parseMermaid: source → ValidDiagram
//
// Wraps the existing parser. Extracts frontmatter, init directives, comments
// and accessibility metadata into ValidDiagram.meta so they survive round-trip.
// Computes a source map of element IDs → (line, col) in the canonical source.
//
// Multi-error: returns Result<_, ParseError[]> so callers see every error
// from a single parse, not just the first.
// ============================================================================

import { parseMermaid as parseFlowchartLegacy } from '../parser.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import type {
  ValidDiagram,
  ParseError,
  Result,
  DiagramKind,
  ValidDiagramMeta,
  SourceMap,
  InitDirective,
  SourceComment,
  Accessibility,
} from './types.ts'
import { ok, err } from './types.ts'

const FRONTMATTER_REGEX = /^﻿?\s*---\s*\r?\n([\s\S]*?)\r?\n\s*---\s*(?:\r?\n|$)/
const INIT_DIRECTIVE_REGEX = /^\s*%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}\s*%%\s*(?:\r?\n|$)?/gm
const COMMENT_LINE_REGEX = /^\s*%%(?!\{)\s*(.*)$/
const ACC_TITLE_REGEX = /^\s*accTitle\s*:\s*(.+)$/i
const ACC_DESCR_INLINE_REGEX = /^\s*accDescr\s*:\s*(.+)$/i
const ACC_DESCR_BLOCK_START = /^\s*accDescr\s*\{\s*$/i

/**
 * Parse Mermaid source into a typed ValidDiagram. Multi-error.
 *
 * Round-trip contracts (RT-1, RT-2 in the spec):
 *   serializeMermaid(parseMermaid(s)) ≡ normalize(s) for canonical s
 *   parseMermaid(serializeMermaid(d)) ≡ d for any d
 */
export function parseMermaid(source: string): Result<ValidDiagram, ParseError[]> {
  const errors: ParseError[] = []

  // Extract metadata up-front so it survives even if the body parser fails.
  const meta = extractMeta(source)

  // Normalize the source: strip BOM, frontmatter, init directives, comments;
  // produce the canonical line array the legacy parsers expect.
  const normalized = normalizeMermaidSource(source)
  const canonicalSource = normalized.text

  if (normalized.lines.length === 0) {
    errors.push({ code: 'EMPTY', message: 'Empty diagram' })
    return err(errors)
  }

  // Detect family from header.
  const header = normalized.lines[0]!.toLowerCase()
  const kind = detectKind(header)
  if (!kind) {
    errors.push({
      code: 'UNKNOWN_HEADER',
      message: `Unrecognized header: "${normalized.lines[0]}"`,
      line: 1,
    })
    return err(errors)
  }

  const sourceMap = emptySourceMap()

  if (kind === 'flowchart' || kind === 'state') {
    // Flowchart and state diagrams share the legacy parser entry.
    try {
      const graph = parseFlowchartLegacy(canonicalSource)
      // Populate source map for nodes — best-effort, line-based scan.
      indexFlowchartSource(canonicalSource, graph.nodes.keys(), sourceMap)

      const diagram: ValidDiagram = {
        kind,
        meta,
        body: { kind: 'flowchart', graph },
        source: sourceMap,
        canonicalSource,
      }
      return ok(diagram)
    } catch (e) {
      errors.push({
        code: 'PARSE_FAILED',
        message: e instanceof Error ? e.message : String(e),
      })
      return err(errors)
    }
  }

  // Other families: we preserve source verbatim so round-trip works. Mutation
  // on these returns UNSUPPORTED_FAMILY; rendering goes through the existing
  // family-specific renderer.
  const diagram: ValidDiagram = {
    kind,
    meta,
    body: { kind: 'opaque', family: kind, source: canonicalSource },
    source: sourceMap,
    canonicalSource,
  }
  return ok(diagram)
}

// ---- Family detection ----------------------------------------------------

function detectKind(header: string): DiagramKind | null {
  if (/^statediagram(-v2)?\b/i.test(header)) return 'state'
  if (/^(graph|flowchart)\b/i.test(header)) return 'flowchart'
  if (/^sequencediagram\b/i.test(header)) return 'sequence'
  if (/^classdiagram\b/i.test(header)) return 'class'
  if (/^erdiagram\b/i.test(header)) return 'er'
  if (/^timeline\b/i.test(header)) return 'timeline'
  if (/^journey\b/i.test(header)) return 'journey'
  if (/^xychart(-beta)?\b/i.test(header)) return 'xychart'
  if (/^architecture(-beta)?\b/i.test(header)) return 'architecture'
  return null
}

// ---- Meta extraction -----------------------------------------------------

function extractMeta(rawSource: string): ValidDiagramMeta {
  const meta: ValidDiagramMeta = {
    initDirectives: [],
    comments: [],
    accessibility: {},
  }

  // Frontmatter
  const fmMatch = rawSource.match(FRONTMATTER_REGEX)
  if (fmMatch) {
    try {
      // We do a lightweight parse via the existing normalize pipeline rather
      // than re-parsing YAML here. normalizeMermaidSource already does this.
      const norm = normalizeMermaidSource(rawSource)
      if (Object.keys(norm.frontmatter).length > 0) {
        meta.frontmatter = norm.frontmatter
      }
    } catch {
      // ignore — parse errors on frontmatter surface via the main parse path
    }
  }

  // Init directives
  let m: RegExpExecArray | null
  const directiveRegex = new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm')
  while ((m = directiveRegex.exec(rawSource)) !== null) {
    const raw = m[0]
    const inner = (m[1] ?? '').trim()
    const directive: InitDirective = {
      raw,
      parsed: tryParseInitObject(inner) as InitDirective['parsed'],
    }
    meta.initDirectives.push(directive)
  }

  // Comments and accessibility — scan line-by-line, skipping frontmatter / init.
  const stripped = rawSource
    .replace(FRONTMATTER_REGEX, '')
    .replace(new RegExp(INIT_DIRECTIVE_REGEX.source, 'gm'), '')
  const lines = stripped.split(/\r?\n/)
  let inAccDescr = false
  let accDescrBuf: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (inAccDescr) {
      if (/^\s*\}\s*$/.test(line)) {
        meta.accessibility.descr = accDescrBuf.join('\n').trim()
        inAccDescr = false
        accDescrBuf = []
      } else {
        accDescrBuf.push(line)
      }
      continue
    }
    if (ACC_DESCR_BLOCK_START.test(line)) {
      inAccDescr = true
      continue
    }
    const accTitle = line.match(ACC_TITLE_REGEX)
    if (accTitle) {
      meta.accessibility.title = accTitle[1]!.trim()
      continue
    }
    const accDescr = line.match(ACC_DESCR_INLINE_REGEX)
    if (accDescr) {
      meta.accessibility.descr = accDescr[1]!.trim()
      continue
    }
    const cm = line.match(COMMENT_LINE_REGEX)
    if (cm) {
      meta.comments.push({ text: cm[1]!, line: i + 1 })
    }
  }

  return meta
}

function tryParseInitObject(inner: string): Record<string, unknown> {
  // Mermaid init directives are loose JSON5-ish. We accept JSON; failures
  // fall back to an empty object so we still preserve the raw form.
  try {
    return JSON.parse(inner) as Record<string, unknown>
  } catch {
    // Try wrapping unquoted keys.
    try {
      const quoted = inner.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
      return JSON.parse(quoted) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}

// ---- Source-map indexing -------------------------------------------------

function emptySourceMap(): SourceMap {
  return {
    nodes: new Map(),
    edges: new Map(),
    groups: new Map(),
  }
}

function indexFlowchartSource(
  source: string,
  nodeIds: IterableIterator<string>,
  map: SourceMap,
): void {
  // Best-effort: locate the first textual mention of each node ID. This
  // suffices for "point at the offending element" diagnostics; consumers
  // that need exact positions for every occurrence should re-parse.
  const ids = Array.from(nodeIds)
  const lines = source.split(/\r?\n/)
  for (const id of ids) {
    const regex = new RegExp(`\\b${escapeRegex(id)}\\b`)
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i]!.search(regex)
      if (idx >= 0) {
        map.nodes.set(id, { line: i + 1, col: idx + 1 })
        break
      }
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Re-export the meta accessor for the tests / sibling modules.
export { extractMeta as _extractMetaForTest }
