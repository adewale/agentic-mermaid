// Mine mermaid-js source docs for the original twelve-family docs corpus.
// Output: eval/mermaid-docs-corpus/corpus.json — a curated set
// of (family, source) pairs we can run through parse → verify → round-trip.
// Newer registered families are covered by the companion corpora named in the
// README; claiming this historical corpus alone is exhaustive would hide its
// large family imbalance and later enrollment boundary.
//
// Run with: bun run eval/mermaid-docs-corpus/build-corpus.ts <path-to-mermaid-clone>
//
// Default clone path: /tmp/mermaid. Override via argv.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

export const UPSTREAM_REPOSITORY = 'https://github.com/mermaid-js/mermaid'
export const UPSTREAM_REVISION = 'a2d9686451df7c4644a3eeca20535bbd4c5776b0'

const FILE_TO_FAMILY: Record<string, string> = {
  'flowchart.md': 'flowchart',
  'stateDiagram.md': 'state',
  'sequenceDiagram.md': 'sequence',
  'classDiagram.md': 'class',
  'entityRelationshipDiagram.md': 'er',
  'timeline.md': 'timeline',
  'userJourney.md': 'journey',
  'xyChart.md': 'xychart',
  'architecture.md': 'architecture',
  // QUAL-1/BUILD-22: pie + quadrant are included in the committed corpus
  // after a real mermaid-js/mermaid docs regen on 2026-06-16.
  'pie.md': 'pie',
  'quadrantChart.md': 'quadrant',
  'gantt.md': 'gantt',
}

const FENCE_RE = /```mermaid(?:-example)?\n([\s\S]*?)\n```/g

export interface CorpusEntry {
  family: string
  source: string
  origin: string
  index: number
}

function checkoutRevision(mermaidRepo: string): string {
  try {
    return execFileSync('git', ['-C', mermaidRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error(`cannot read upstream git revision from ${mermaidRepo}`)
  }
}

export function buildCorpus(mermaidRepo: string): CorpusEntry[] {
  const syntaxDir = join(mermaidRepo, 'packages/mermaid/src/docs/syntax')
  const out: CorpusEntry[] = []
  for (const [file, family] of Object.entries(FILE_TO_FAMILY)) {
    const path = join(syntaxDir, file)
    if (!existsSync(path)) { console.warn(`missing: ${path}`); continue }
    const md = readFileSync(path, 'utf8')
    let i = 0
    for (const m of md.matchAll(FENCE_RE)) {
      const source = m[1]!.trim()
      if (!source) continue
      // Skip examples that aren't actually parseable diagrams (e.g., comment-only)
      if (source.split('\n').length < 2) continue
      out.push({ family, source, origin: `syntax/${file}`, index: i++ })
    }
  }
  return out
}

if (import.meta.main) {
  const repo = process.argv[2] ?? '/tmp/mermaid'
  if (!existsSync(repo)) {
    console.error(`mermaid clone not found at ${repo}.`)
    console.error('Clone with: git clone --depth 1 https://github.com/mermaid-js/mermaid /tmp/mermaid')
    process.exit(1)
  }
  const revision = checkoutRevision(repo)
  if (revision !== UPSTREAM_REVISION) {
    console.error(`wrong Mermaid revision: expected ${UPSTREAM_REVISION}, got ${revision}`)
    console.error(`Run: git -C ${repo} checkout ${UPSTREAM_REVISION}`)
    process.exit(1)
  }
  const corpus = buildCorpus(repo)
  const out = join(import.meta.dir, 'corpus.json')
  writeFileSync(out, JSON.stringify(corpus, null, 2))
  const byFamily: Record<string, number> = {}
  for (const e of corpus) byFamily[e.family] = (byFamily[e.family] || 0) + 1
  writeFileSync(join(import.meta.dir, 'provenance.json'), JSON.stringify({
    schemaVersion: 1,
    upstream: { repository: UPSTREAM_REPOSITORY, revision },
    scope: 'Original twelve-family Mermaid syntax-document corpus; not the complete registered-family inventory.',
    entries: corpus.length,
    familyCounts: Object.fromEntries(Object.entries(byFamily).sort()),
    companions: [
      'eval/mermaid-upstream-suite-bench',
      'eval/mindmap-gitgraph-content-corpus',
      'eval/mermaid-radar-bench',
      'eval/mermaid-doc-showcase',
    ],
  }, null, 2) + '\n')
  console.log(`Wrote ${corpus.length} examples to ${out}`)
  for (const [f, n] of Object.entries(byFamily).sort()) console.log(`  ${f}: ${n}`)
}
