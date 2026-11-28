// ============================================================================
// quality:report — what is wrong with our real diagrams today.
//
// Lays out every real diagram (docs corpus + fixtures from user issues) on this
// checkout and lists each one with a reader-visible defect: a layout error, a
// lost certification, unrelated routes that touch or share a run, a run along
// a node's border, a terminal shaft too short for its arrowhead, an arrow end
// at a corner, or a caption conflict. Start improvement work here, not from
// generated graphs.
//
//   bun run quality:report [--all] [--json out.json]
// ============================================================================

import { writeFileSync } from 'node:fs'
import { layoutMermaidWithReceipt } from '../../src/agent/index.ts'
import { realDiagrams } from './real-diagrams.ts'
import { FINDINGS, findingCount, score, type Score } from './score.ts'

interface Row { id: string; url?: string; error?: string; uncertified?: string; score?: Score }

const rows: Row[] = []
for (const diagram of await realDiagrams()) {
  try {
    const { layout, receipt } = layoutMermaidWithReceipt(diagram.source)
    const certification = receipt?.layoutCertification
    const geometry = certification && 'geometry' in certification ? certification.geometry : undefined
    rows.push({ id: diagram.id, url: diagram.url, score: score(layout),
      ...(geometry ? { uncertified: [...new Set(geometry.violations.map(v => v.kind))].join(', ') } : {}) })
  } catch (error) {
    rows.push({ id: diagram.id, url: diagram.url, error: String((error as Error)?.message ?? error).split('\n')[0]!.slice(0, 140) })
  }
}

const json = process.argv.indexOf('--json')
if (json > 0) writeFileSync(process.argv[json + 1]!, JSON.stringify(rows, null, 2))

const flagged = rows.filter(row => row.error || row.uncertified || (row.score && findingCount(row.score) > 0))
const shown = process.argv.includes('--all') ? rows : flagged
console.log(`Real diagrams: ${rows.length} (${rows.filter(r => r.url).length} from user issues). With a finding: ${flagged.length}.\n`)
console.log(`| diagram | ${FINDINGS.join(' | ')} | crossings | note |`)
console.log(`|---|${FINDINGS.map(() => '---:').join('|')}|---:|---|`)
for (const row of shown) {
  const s = row.score
  console.log(`| ${row.id} | ${FINDINGS.map(key => s ? s[key] || '' : '').join(' | ')} | ${s?.crossings ?? ''} | ${row.error ? `error: ${row.error}` : row.uncertified ? `uncertified: ${row.uncertified}` : row.url ?? ''} |`)
}
const totals = Object.fromEntries(FINDINGS.map(key => [key, rows.reduce((sum, row) => sum + (row.score?.[key] ?? 0), 0)]))
console.log(`\nTotals: ${FINDINGS.map(key => `${key} ${totals[key]}`).join(', ')}; errors ${rows.filter(r => r.error).length}; uncertified ${rows.filter(r => r.uncertified).length}`)
