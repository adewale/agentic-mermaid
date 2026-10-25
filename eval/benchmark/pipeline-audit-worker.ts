import './ci-policy-enforce.ts'
// Diagnostic worker: the same public renderer plus its existing stage observer.
// The parent bundles this for Node with the publication's dependency boundaries.
import { readFileSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import { renderMermaidSVG } from '../../src/index.ts'
import { withRenderStageObserver, type RenderStageSample } from '../../src/render-stages.ts'

interface Job { rounds: number; reps: number; inputs: Array<{ id: string; source: string }>; output: string; profile: string }
const job = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Job
const samples: Array<{ id: string; round: number; rep: number; totalMs: number; bytes?: number; error?: string; stages: RenderStageSample[] }> = []
for (const input of job.inputs) for (let i = 0; i < 3; i++) {
  try { renderMermaidSVG(input.source) } catch {}
}
const profiler = new Session()
profiler.connect()
await profiler.post('Profiler.enable')
await profiler.post('Profiler.setSamplingInterval', { interval: 100 })
await profiler.post('Profiler.start')
for (let round = 1; round <= job.rounds; round++) {
  const inputs = round % 2 ? job.inputs : [...job.inputs].reverse()
  for (const input of inputs) for (let rep = 0; rep < job.reps; rep++) {
    const stages: RenderStageSample[] = []
    const start = performance.now()
    let svg: string | undefined, error: string | undefined
    try { svg = withRenderStageObserver(sample => stages.push(sample), () => renderMermaidSVG(input.source)) }
    catch (value) { error = String(value) }
    samples.push({ id: input.id, round, rep, totalMs: performance.now() - start, stages,
      ...(svg === undefined ? { error } : { bytes: Buffer.byteLength(svg) }) })
  }
}
const { profile } = await profiler.post('Profiler.stop')
profiler.disconnect()
writeFileSync(job.profile, JSON.stringify(profile))
writeFileSync(job.output, JSON.stringify({ diagnostic: true, runtime: process.versions,
  cache: process.env.AGENTIC_MERMAID_ELK_CACHE, assertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS,
  layoutIncludesElk: true, samples }, null, 2))
