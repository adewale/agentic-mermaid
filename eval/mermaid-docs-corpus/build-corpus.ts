// Mine mermaid-js source docs for example diagrams across supported docs
// families. Output: eval/mermaid-docs-corpus/corpus.json — a curated set
// of (family, source) pairs we can run through parse → verify → round-trip.
// Gantt entries were appended surgically from syntax/gantt.md on 2026-06-12
// (other families untouched); the next full regen picks gantt up via the map.
//
// Run with: bun run eval/mermaid-docs-corpus/build-corpus.ts <path-to-mermaid-clone>
//
// Default clone path: /tmp/mermaid. Override via argv.

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

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
  // QUAL-1: pie + quadrant now have RenderedLayout adapters, so the next
  // networked corpus regen should include them. The committed corpus.json
  // predates these families (it was built before the adapters landed); regen
  // requires a local mermaid clone — see eval/mermaid-docs-corpus/README.
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
  const corpus = buildCorpus(repo)
  const out = join(import.meta.dir, 'corpus.json')
  writeFileSync(out, JSON.stringify(corpus, null, 2))
  const byFamily: Record<string, number> = {}
  for (const e of corpus) byFamily[e.family] = (byFamily[e.family] || 0) + 1
  console.log(`Wrote ${corpus.length} examples to ${out}`)
  for (const [f, n] of Object.entries(byFamily).sort()) console.log(`  ${f}: ${n}`)
}
