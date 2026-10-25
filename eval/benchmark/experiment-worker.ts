import './ci-policy-enforce.ts'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { MICRO_WORKLOADS } from './micro-bench-cases.ts'
import { releaseBenchCases } from './release-bench-cases.ts'
import { missingSvgLabels, renderAgentEdit, agentEditCase } from './release-bench-fidelity.ts'
import { allocationProbe, median } from './bench-stats.ts'
interface Job { out: string; samples: number; warmup: number; warmupMs?: number; gcMode?: 'natural' | 'checkpoint'; broad: boolean; allocation: boolean; png: boolean }
const job = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Job
const gcMode = job.gcMode ?? 'checkpoint'
if (gcMode !== 'natural' && gcMode !== 'checkpoint') throw Error('Invalid gcMode')
if (gcMode === 'natural' && job.allocation) throw Error('Natural GC timing cannot use allocation probes')
const canCollect = Boolean(process.versions.bun) || typeof (globalThis as { gc?: () => void }).gc === 'function'
const memoryCheckpoint = gcMode === 'checkpoint' && canCollect ? 'forced' : 'uncollected'
const started = performance.now()
const api = await import('../../src/index.ts')
const agent = await import('../../src/agent/index.ts')
const importMs = performance.now() - started
const collect = () => {
  if (gcMode === 'natural') return
  if (process.versions.bun) Bun.gc(true); else (globalThis as { gc?: () => void }).gc?.()
}
collect(); const loadedMemory = process.memoryUsage()
const allocate = job.allocation ? await allocationProbe() : undefined
interface Case { id: string; output: 'svg' | 'terminal' | 'agent' | 'receipt' | 'png'; source: string; labels?: readonly string[]; options?: Parameters<typeof api.renderMermaidSVG>[1] }
const cases: Case[] = Object.entries(MICRO_WORKLOADS).map(([id, source]) => ({ id, source, output: 'svg' }))
const extras = releaseBenchCases().filter(c => job.broad ? !['flowchart', 'sequence', 'class', 'er', 'state', 'c4'].includes(c.family) : c.family === 'gantt' || c.family === 'sankey')
cases.push(...extras.map(c => ({ id: c.id, source: c.source, labels: c.expectedSvgLabels, output: 'svg' as const })))
if (job.broad) cases.push({ id: 'gantt:weekly-dependency-routing', output: 'svg', options: { gantt: { dependencyArrows: true } },
  source: ['gantt', 'dateFormat YYYY-MM-DD', 'excludes weekends', ...Array.from({ length: 80 }, (_, i) =>
    `Task ${i} :t${i}, ${i === 0 ? '2020-01-01' : `after t${Math.floor((i - 1) / 3)}`}, ${200 + i % 7}d`)].join('\n') })
for (const id of ['flow5', 'tree50', 'mesh50', 'seq20'] as const) cases.push({ id: `terminal:${id}`, source: MICRO_WORKLOADS[id], output: 'terminal' })
cases.push({ id: 'agent:edit-loop', source: agentEditCase.source, labels: agentEditCase.expectedSvgLabels, output: 'agent' },
  { id: 'receipt:flow5', source: MICRO_WORKLOADS.flow5, output: 'receipt' })
if (job.png) cases.push({ id: 'png:flow5', source: MICRO_WORKLOADS.flow5, output: 'png' })
const rows = []
for (const input of cases) {
  const render = async (): Promise<string | Uint8Array> => {
    if (input.output === 'terminal') return api.renderMermaidASCII(input.source, { colorMode: 'none' })
    if (input.output === 'agent') return renderAgentEdit(agent, input.source)
    if (input.output === 'receipt') return JSON.stringify(api.renderMermaidSVGWithReceipt(input.source))
    if (input.output === 'png') return agent.renderMermaidPNG(input.source)
    return api.renderMermaidSVG(input.source, input.options)
  }
  const consume = (value: string | Uint8Array): number => typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength
  try {
    let t = performance.now(); let first: string | Uint8Array | undefined = await render(); const bytes = consume(first); const firstMs = performance.now() - t
    if (!bytes) throw Error('Empty output')
    if (input.output === 'svg' || input.output === 'agent') {
      if (typeof first !== 'string' || !first.includes('<svg')) throw Error('No SVG')
      const missing = missingSvgLabels(first as string, input.labels); if (missing.length) throw Error(`Lost labels: ${missing.join(',')}`)
    }
    // Fingerprint complete output outside timing; don't retain every output in
    // the memory checkpoint or mistake two missing PNG witnesses for equality.
    const witness = createHash('sha256').update(first).digest('hex')
    first = undefined
    const warmStart = performance.now()
    for (let i = 0; i < job.warmup || performance.now() - warmStart < (job.warmupMs ?? 0); i++) consume(await render())
    const samplesMs = []
    for (let i = 0; i < job.samples; i++) { t = performance.now(); consume(await render()); samplesMs.push(performance.now() - t) }
    let allocationBytes: number | undefined
    if (allocate) allocationBytes = await allocate(async () => { consume(await render()) })
    collect(); const memory = process.memoryUsage()
    rows.push({ id: input.id, output: input.output, ok: true, firstMs, samplesMs, medianMs: median(samplesMs), bytes, allocationBytes, memoryCheckpoint, memory, witness })
  } catch (error) { rows.push({ id: input.id, output: input.output, ok: false, error: String(error) }) }
}
collect()
writeFileSync(job.out, JSON.stringify({ runtime: process.versions, features: process.env.AGENTIC_MERMAID_EXPERIMENTS ?? '', elkCache: process.env.AGENTIC_MERMAID_ELK_CACHE,
  gcMode, memoryCheckpoint, importMs, loadedMemory, finalMemory: process.memoryUsage(), cpuUsage: process.cpuUsage(), maxRssKiB: process.resourceUsage().maxRSS, rows }, null, 2))
