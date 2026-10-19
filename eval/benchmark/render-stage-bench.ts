// Diagnostic phase costs complement packed end-to-end release measurements.
// Times are inclusive: layout contains ELK, and Scene contains lowering and
// admission. Depth/parent metadata preserve actual nesting; do not sum them.
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
const configuration = {
  elkCache: process.env.AGENTIC_MERMAID_ELK_CACHE ?? '(default)',
  sceneAssertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS ?? '(default)',
  nodeOptions: process.env.NODE_OPTIONS ?? null,
  bunOptions: process.env.BUN_OPTIONS ?? null,
  flags: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('APL_') || key.startsWith('AM_FC_'))),
}
const output = { diagnostic: true, runtime: process.versions, rounds, configuration, timings: 'inclusive; depth and parent record nested work', samples }
if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(output)}\n`)
const totals: Record<string, number> = {}
for (const sample of samples.filter(sample => sample.ok)) {
  totals.total = (totals.total ?? 0) + sample.totalMs
  for (const { stage, ms } of sample.stages) totals[stage] = (totals[stage] ?? 0) + ms
}
console.log(JSON.stringify({ successfulCalls: samples.filter(sample => sample.ok).length, totalsMs: totals, configuration, timings: output.timings }, null, 2))
