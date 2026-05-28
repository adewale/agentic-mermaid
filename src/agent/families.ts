// ============================================================================
// Family plugin registry.
//
// Provides a registration point so new diagram families can plug in without
// modifying core parse/serialize/verify dispatchers. The registry primarily
// powers universal source-based Tier 1 checks (LABEL_OVERFLOW for opaque
// bodies) and offers a forward path for full per-family ownership.
//
// Built-in families register themselves at import time (see ./families-builtin.ts).
// External code can call `registerFamily(plugin)` to add new kinds.
// ============================================================================

import type {
  DiagramKind, DiagramBody, ValidDiagramMeta, ParseError,
  AnyMutationOp, MutationError, LayoutWarning, VerifyOptions, Result,
} from './types.ts'

export interface ExtractedLabel {
  /** The label text, with quotes stripped. */
  text: string
  /** Best-effort target identifier (node id, participant, period, etc.). */
  target: string
}

export interface FamilyPlugin {
  /** The DiagramKind this plugin owns. */
  id: DiagramKind
  /** First-non-blank-line predicate. Lowercase, leading whitespace stripped. */
  detect: (firstLineLower: string) => boolean
  /**
   * Source-based label extractor for universal Tier 1 LABEL_OVERFLOW on opaque
   * bodies. Each plugin should extract everything an agent would consider a
   * label — node text, edge text, message text, axis names, section titles.
   * The generic fallback (extractLabelsGeneric) is used when a family doesn't
   * provide its own.
   */
  extractLabels?: (source: string) => ExtractedLabel[]
  /**
   * Optional: family-specific structured parser. If provided, parseMermaid
   * routes to this instead of the legacy in-tree branch. Returns a typed
   * body or `null` to fall back to opaque (lossless via opaqueSource).
   * (Hook is defined now for forward use; current built-in families still
   * use the legacy in-tree parsers — see families-builtin.ts comments.)
   */
  parse?: (lines: string[], opaqueSource: string, meta: ValidDiagramMeta) => Result<DiagramBody, ParseError>
  /** Optional: family-specific serializer for a structured body. */
  serialize?: (body: DiagramBody) => string
  /** Optional: family-specific structured mutation. */
  mutate?: (body: DiagramBody, op: AnyMutationOp) => Result<DiagramBody, MutationError>
  /** Optional: family-specific verify (Tier 1 + Tier 2). Returns warnings only. */
  verify?: (body: DiagramBody, opts: VerifyOptions) => LayoutWarning[]
}

const REGISTRY = new Map<DiagramKind, FamilyPlugin>()

export function registerFamily(plugin: FamilyPlugin): void {
  REGISTRY.set(plugin.id, plugin)
}

export function getFamily(kind: DiagramKind): FamilyPlugin | undefined {
  return REGISTRY.get(kind)
}

export function knownFamilies(): DiagramKind[] {
  return Array.from(REGISTRY.keys())
}

// ---- Generic label extractor ----------------------------------------------
//
// Catches the common Mermaid label idioms used across families:
//   - quoted strings: "Foo", 'Foo'
//   - bracketed text: [Foo], (Foo), {Foo}, [[Foo]], [(Foo)], [/Foo/], etc.
//   - colon-separated text: `A->>B: Foo`, `2020 : Foo`, `title Foo`
//
// Best-effort by design — used as a fallback when a family doesn't ship its
// own extractor. Over-counting (some matches are syntax, not labels) is
// acceptable because LABEL_OVERFLOW only fires on text exceeding the cap.
// ---------------------------------------------------------------------------

export function extractLabelsGeneric(source: string): ExtractedLabel[] {
  const out: ExtractedLabel[] = []
  const lines = source.split(/\r?\n/)
  let i = 0
  for (const raw of lines) {
    i++
    const line = raw.trim()
    if (!line || line.startsWith('%%')) continue
    // Quoted strings first (highest precedence — they're explicit labels).
    for (const m of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g)) {
      const text = m[1] ?? m[2] ?? ''
      if (text) out.push({ text, target: `line${i}` })
    }
    // Bracketed text (square, paren, curly — any nesting depth handled flatly).
    for (const m of line.matchAll(/[\[\(\{]+([^\[\]\(\)\{\}]+?)[\]\)\}]+/g)) {
      const text = (m[1] ?? '').trim()
      if (text && !text.match(/^[A-Za-z_][\w-]*$/)) out.push({ text, target: `line${i}` })
    }
    // Colon-separated suffix (`A->>B: text`, `2020 : text`, `title: text`).
    const colon = line.indexOf(':')
    if (colon >= 0 && colon < line.length - 1) {
      const after = line.slice(colon + 1).trim()
      // Filter: not a CSS-ish value, not another keyword
      if (after && !after.match(/^[\d.]+$/) && after.length >= 2) {
        out.push({ text: after, target: `line${i}` })
      }
    }
  }
  return out
}
