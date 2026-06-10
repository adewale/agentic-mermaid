// ============================================================================
// Mermaid family-usage counter (BUILD-5 evidence step).
//
// Input:  one or more directories of markdown (and markdown-like) files.
// Output: a ranked count of the Mermaid diagram *families* referenced by
//         ```mermaid fenced code blocks.
//
// "Family" = the keyword on the first non-empty line of the fenced block
// (after stripping optional YAML frontmatter and %%{init}%% directives),
// normalized to a canonical family name. This is the same first-line signal
// the renderer's `detectDiagramTypeFromFirstLine` uses, so the ranking
// reflects what families a real corpus actually asks for.
//
// This script does NOT crawl GitHub. The honest "real corpus" run needs a
// network-fetched README corpus; see eval/family-usage/README.md for how to
// produce one. Over a local directory it is fully deterministic and offline.
//
// Usage:
//   bun run eval/family-usage/count.ts <dir> [<dir> ...]
//   bun run eval/family-usage/count.ts --json <dir>
// ============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

/** Default file extensions scanned for fenced mermaid blocks. */
const DEFAULT_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.mdown', '.mkd'])

/** A counted result: family name → number of fenced ```mermaid blocks. */
export type FamilyCounts = Record<string, number>

export interface CountResult {
  /** family → count, unsorted (insertion order). */
  counts: FamilyCounts
  /** total fenced ```mermaid blocks seen (sum of counts). */
  totalBlocks: number
  /** number of files scanned. */
  filesScanned: number
}

/**
 * Normalize the first logical line of a mermaid block to a canonical family.
 * Mirrors the renderer's first-line detection but is intentionally tolerant:
 * an unknown header is bucketed as its lowercased leading token so nothing is
 * silently dropped (the ER cardinality lesson: never drop, surface it).
 */
export function familyFromHeader(header: string): string {
  // Strip a trailing `;`-separated tail and lowercase, matching detector logic.
  const line = (header.split(';')[0] ?? '').trim().toLowerCase()
  if (line.length === 0) return 'unknown'

  if (/^architecture(-beta)?\b/.test(line)) return 'architecture'
  if (/^xychart(-beta)?\b/.test(line)) return 'xychart'
  if (/^pie\b/.test(line)) return 'pie'
  if (/^gantt\b/.test(line)) return 'gantt'
  if (/^mindmap\b/.test(line)) return 'mindmap'
  if (/^gitgraph\b/.test(line) || /^---\s*$/.test(line)) return /^gitgraph\b/.test(line) ? 'gitgraph' : 'unknown'
  if (/^timeline\b/.test(line)) return 'timeline'
  if (/^journey\b/.test(line)) return 'journey'
  if (/^sequencediagram\b/.test(line)) return 'sequence'
  if (/^classdiagram\b/.test(line)) return 'class'
  if (/^erdiagram\b/.test(line)) return 'er'
  if (/^statediagram(-v2)?\b/.test(line)) return 'state'
  if (/^(flowchart|graph)\b/.test(line)) return 'flowchart'
  if (/^quadrantchart\b/.test(line)) return 'quadrant'
  if (/^requirementdiagram\b/.test(line)) return 'requirement'
  if (/^c4(context|container|component|dynamic|deployment)\b/.test(line)) return 'c4'
  if (/^sankey(-beta)?\b/.test(line)) return 'sankey'
  if (/^block(-beta)?\b/.test(line)) return 'block'
  if (/^packet(-beta)?\b/.test(line)) return 'packet'
  if (/^kanban\b/.test(line)) return 'kanban'

  // Unknown family: bucket by leading token so it's visible, not lost.
  const token = line.match(/^[a-z0-9-]+/)?.[0] ?? 'unknown'
  return `other:${token}`
}

/**
 * Find the header (first logical line) of a fenced mermaid block body,
 * skipping a leading YAML frontmatter block and `%%`-comment / `%%{init}%%`
 * lines. Returns null if the block has no usable header.
 */
export function headerOfBlock(blockBody: string): string | null {
  const lines = blockBody.split(/\r?\n/)
  let i = 0

  // Skip a leading `--- ... ---` YAML frontmatter block.
  if (lines[i]?.trim() === '---') {
    let j = i + 1
    while (j < lines.length && lines[j]?.trim() !== '---') j++
    if (j < lines.length) i = j + 1
  }

  for (; i < lines.length; i++) {
    const t = lines[i]!.trim()
    if (t.length === 0) continue
    if (t.startsWith('%%')) continue
    return t
  }
  return null
}

const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*$/i

/**
 * Extract every fenced ```mermaid block body from a markdown string.
 * Handles ``` and ~~~ fences of length >= 3 and matching closing fences.
 */
export function extractMermaidBlocks(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/)
  const blocks: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i]!.match(FENCE_RE)
    if (!open) continue
    const fenceChar = open[2]![0]!
    const fenceLen = open[2]!.length
    const body: string[] = []
    let closed = false
    for (let j = i + 1; j < lines.length; j++) {
      const closeMatch = lines[j]!.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
      if (closeMatch && closeMatch[1]![0] === fenceChar && closeMatch[1]!.length >= fenceLen) {
        blocks.push(body.join('\n'))
        i = j
        closed = true
        break
      }
      body.push(lines[j]!)
    }
    if (!closed) {
      // Unterminated fence: still count what we captured rather than drop it.
      blocks.push(body.join('\n'))
      i = lines.length
    }
  }
  return blocks
}

/** Count families across a markdown string. Mutates and returns `counts`. */
export function countMarkdown(markdown: string, counts: FamilyCounts): number {
  let n = 0
  for (const block of extractMermaidBlocks(markdown)) {
    const header = headerOfBlock(block)
    if (header === null) continue
    const family = familyFromHeader(header)
    counts[family] = (counts[family] ?? 0) + 1
    n++
  }
  return n
}

function* walkFiles(dir: string, extensions: Set<string>): Generator<string> {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries.sort()) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walkFiles(full, extensions)
    } else if (extensions.has(extname(entry).toLowerCase())) {
      yield full
    }
  }
}

/** Count families across one or more directories of markdown files. */
export function countDirectories(
  dirs: string[],
  extensions: Set<string> = DEFAULT_EXTENSIONS,
): CountResult {
  const counts: FamilyCounts = {}
  let totalBlocks = 0
  let filesScanned = 0
  for (const dir of dirs) {
    for (const file of walkFiles(dir, extensions)) {
      filesScanned++
      let content: string
      try {
        content = readFileSync(file, 'utf-8')
      } catch {
        continue
      }
      totalBlocks += countMarkdown(content, counts)
    }
  }
  return { counts, totalBlocks, filesScanned }
}

/** Rank counts descending; ties broken alphabetically for determinism. */
export function rankCounts(counts: FamilyCounts): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function formatReport(result: CountResult): string {
  const ranked = rankCounts(result.counts)
  const lines: string[] = []
  lines.push(`Files scanned:   ${result.filesScanned}`)
  lines.push(`Mermaid blocks:  ${result.totalBlocks}`)
  lines.push('')
  lines.push('Rank  Family            Count   Share')
  lines.push('----  ----------------  ------  ------')
  ranked.forEach(([family, count], idx) => {
    const share = result.totalBlocks > 0 ? ((count / result.totalBlocks) * 100).toFixed(1) : '0.0'
    lines.push(
      `${String(idx + 1).padStart(4)}  ${family.padEnd(16)}  ${String(count).padStart(6)}  ${share.padStart(5)}%`,
    )
  })
  return lines.join('\n')
}

// ---- CLI ------------------------------------------------------------------

function main(argv: string[]): void {
  const args = argv.slice(2)
  const json = args.includes('--json')
  const dirs = args.filter(a => a !== '--json')
  if (dirs.length === 0) {
    process.stderr.write(
      'Usage: bun run eval/family-usage/count.ts [--json] <dir> [<dir> ...]\n',
    )
    process.exit(2)
  }
  const result = countDirectories(dirs)
  if (json) {
    process.stdout.write(JSON.stringify({ ...result, ranked: rankCounts(result.counts) }, null, 2) + '\n')
  } else {
    process.stdout.write(formatReport(result) + '\n')
  }
}

if (import.meta.main) {
  main(process.argv)
}
