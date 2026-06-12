// ============================================================================
// Visual rubric harness (docs/design/layout-rubric.md).
//
// Renders the SIMPLE battery (every routing pattern x direction x shape) and
// the COMPLICATED set, scores each against the deterministic layout rubric,
// and emits an HTML gallery with per-diagram metrics so a human can eyeball
// what the numbers claim. Exits nonzero on any HARD violation or breached
// soft threshold — the same checks the CI test runs, plus pictures.
//
// Usage:
//   bun run eval/visual-rubric/run.ts [--out /tmp/visual-rubric]
// ============================================================================

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { renderMermaidSVG } from '../../src/index.ts'
import { assessLayout, hardViolations, type RubricResult } from '../../src/layout-rubric.ts'
import { complicatedFixtures, simpleFixtures, type RubricFixture } from './fixtures.ts'

interface ScoredFixture {
  fixture: RubricFixture
  result: RubricResult
  failures: string[]
  svg: string
}

export function scoreFixture(fixture: RubricFixture): Omit<ScoredFixture, 'svg'> {
  const graph = parseMermaid(fixture.source)
  const positioned = layoutGraphSync(graph)
  const result = assessLayout(graph, positioned)
  const failures: string[] = hardViolations(result).map(v => `[hard] ${v.metric}: ${v.detail}`)
  const m = result.metrics
  const e = fixture.expect ?? {}
  if (e.maxCrossings !== undefined && m.edgeCrossings > e.maxCrossings) {
    failures.push(`[soft] edgeCrossings ${m.edgeCrossings} > ${e.maxCrossings}`)
  }
  if (e.maxBendsPerEdge !== undefined && m.maxBendsPerEdge > e.maxBendsPerEdge) {
    failures.push(`[soft] maxBendsPerEdge ${m.maxBendsPerEdge} > ${e.maxBendsPerEdge}`)
  }
  if (e.minPortAnchoredEdgeRate !== undefined && m.portAnchoredEdgeRate < e.minPortAnchoredEdgeRate) {
    failures.push(`[soft] portAnchoredEdgeRate ${m.portAnchoredEdgeRate.toFixed(2)} < ${e.minPortAnchoredEdgeRate}`)
  }
  return { fixture, result, failures }
}

function galleryHtml(scored: ScoredFixture[], title: string): string {
  const cards = scored.map(s => {
    const m = s.result.metrics
    const status = s.failures.length === 0 ? 'pass' : 'fail'
    const failHtml = s.failures.map(f => `<li>${f}</li>`).join('')
    return `<div class="card ${status}">
      <h3>${s.fixture.id} <span class="badge">${status}</span></h3>
      <div class="svg">${s.svg}</div>
      <table><tr>
        <td>crossings ${m.edgeCrossings}</td><td>bends ${m.totalBends} (max ${m.maxBendsPerEdge})</td>
        <td>port-anchored ${(m.portAnchoredEdgeRate * 100).toFixed(0)}%</td>
        <td>port-ends ${(m.portEndpointRate * 100).toFixed(0)}%</td>
      </tr></table>
      ${failHtml ? `<ul class="failures">${failHtml}</ul>` : ''}
      <details><summary>source</summary><pre>${s.fixture.source.replace(/</g, '&lt;')}</pre></details>
    </div>`
  }).join('\n')
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: sans-serif; background: #faf7f2; margin: 20px; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 12px 0; }
  .card.fail { border-color: #c00; }
  .badge { font-size: 12px; padding: 2px 8px; border-radius: 8px; background: #2a2; color: #fff; }
  .fail .badge { background: #c00; }
  .svg svg { max-width: 100%; height: auto; }
  .failures { color: #c00; }
  table { font-size: 13px; color: #555; }
  td { padding-right: 16px; }
</style>
<h1>${title}</h1>
${cards}`
}

if (import.meta.main) {
  const outIdx = process.argv.indexOf('--out')
  const outDir = outIdx >= 0 ? process.argv[outIdx + 1]! : '/tmp/visual-rubric'
  mkdirSync(outDir, { recursive: true })

  let failed = 0
  const sections: Array<[string, RubricFixture[]]> = [
    ['simple', simpleFixtures()],
    ['complicated', complicatedFixtures()],
  ]
  const summary: Record<string, unknown>[] = []
  for (const [name, fixtures] of sections) {
    const scored: ScoredFixture[] = fixtures.map(f => {
      const s = scoreFixture(f)
      const svg = renderMermaidSVG(f.source)
      if (s.failures.length > 0) {
        failed++
        console.error(`FAIL ${f.id}`)
        for (const msg of s.failures) console.error(`  ${msg}`)
      }
      summary.push({ id: f.id, section: name, metrics: s.result.metrics, failures: s.failures })
      return { ...s, svg }
    })
    writeFileSync(join(outDir, `${name}.html`), galleryHtml(scored, `Visual rubric — ${name} (${fixtures.length} fixtures)`))
  }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`wrote ${outDir}/simple.html, complicated.html, summary.json — ${summary.length} fixtures, ${failed} failing`)
  if (failed > 0) process.exit(1)
}
