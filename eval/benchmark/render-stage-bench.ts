// Diagnostic phase costs complement packed end-to-end release measurements.
// Layout includes parse/projection/certification; ELK is a nested subset.
import { writeFileSync } from 'node:fs'
import { renderMermaidSVGWithReceipt } from '../../src/index.ts'
import { clearElkLayoutCache } from '../../src/elk-instance.ts'
import { withRenderStageObserver, type RenderStageSample } from '../../src/render-stages.ts'
import { officialCorpusInventory } from '../shared/official-fences.ts'

const rounds = Number(process.argv[2] ?? 3)
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Provide a positive round count')
const inputs = officialCorpusInventory().occurrences
const samples: Array<{ id: string; round: number; ok: boolean; totalMs: number; stages: RenderStageSample[]; error?: string }> = []
for (const input of inputs) { try { renderMermaidSVGWithReceipt(input.source) } catch {} }
for (let round = 1; round <= rounds; round++) {
  for (const input of inputs) {
    const stages: RenderStageSample[] = []
    // The corpus repeats sources; time ELK rather than a cached result.
    clearElkLayoutCache()
    const start = performance.now()
    let error: string | undefined
    try { withRenderStageObserver(sample => stages.push(sample), () => renderMermaidSVGWithReceipt(input.source)) }
    catch (value) { error = String(value) }
    samples.push({ id: input.id, round, ok: error === undefined, totalMs: performance.now() - start, stages, ...(error ? { error } : {}) })
  }
}
const output = { diagnostic: true, runtime: process.versions, rounds, layoutIncludesElk: true, samples }
if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(output)}\n`)
const totals: Record<string, number> = {}
for (const sample of samples.filter(sample => sample.ok)) {
  totals.total = (totals.total ?? 0) + sample.totalMs
  for (const { stage, ms } of sample.stages) totals[stage] = (totals[stage] ?? 0) + ms
}
console.log(JSON.stringify({ successfulCalls: samples.filter(sample => sample.ok).length, totalsMs: totals, layoutIncludesElk: true }, null, 2))
