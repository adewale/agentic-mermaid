// Diagnostic worker: the same public renderer plus its existing stage observer.
// The parent bundles this for Node with the publication's dependency boundaries.
import { readFileSync, writeFileSync } from 'node:fs'
import { Session } from 'node:inspector/promises'
import { createHash } from 'node:crypto'
import { SourceMap } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../../src/index.ts'
import { PERFORMANCE_EXPERIMENTS } from '../../src/experimental-performance.ts'
import { withRenderStageObserver, type RenderStageSample } from '../../src/render-stages.ts'

interface Job { rounds: number; reps: number; inputs: Array<{ id: string; source: string }>; output: string; profile: string
  profileKind?: string; consumption: string; durationMs: number; revision: string; sourceRoot: string; replayStages: string[] }
const job = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Job
if (job.profileKind === 'cpu' || job.profileKind === 'heap' || job.profileKind === 'replay') {
  await profileInput(job)
  process.exit(0)
}
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

async function profileInput(job: Job) {
  const input = job.inputs[0]!
  const replay = (globalThis as typeof globalThis & { __amStageReplay?: { counts: Record<string, Record<string, number>>; begin(): void } }).__amStageReplay
  const counts = () => replay ? structuredClone(replay.counts) : undefined
  // Consumption belongs to the public-work window. It is classified separately
  // from rendering; receipt serialization is an explicit, independent arm.
  function runPublicRender() {
    replay?.begin()
    const artifact = job.consumption === 'receipt' ? renderMermaidSVGWithReceipt(input.source) : undefined
    const svg = artifact?.svg ?? renderMermaidSVG(input.source)
    const receipt = artifact ? JSON.stringify(artifact.receipt) : ''
    return createHash('sha256').update(Buffer.from(svg)).update(Buffer.from(receipt)).digest('hex')
  }
  const fingerprint = runPublicRender(), primingStageCounts = counts(), warmStart = performance.now()
  let warmCalls = 0
  do { runPublicRender(); warmCalls++ } while (warmCalls < 30 || performance.now() - warmStart < 500)
  const warmMs = performance.now() - warmStart
  const afterWarmupStageCounts = counts()
  if (job.profileKind === 'replay') {
    const windowStart = performance.now()
    let calls = 0, drift = false
    do { drift ||= runPublicRender() !== fingerprint; calls++ } while (performance.now() - windowStart < job.durationMs)
    const windowMs = performance.now() - windowStart
    const afterWindowStageCounts = counts()
    const windowStageCounts = afterWindowStageCounts && Object.fromEntries(Object.entries(afterWindowStageCounts).map(([group, stages]) =>
      [group, Object.fromEntries(Object.entries(stages).map(([stage, count]) => [stage, count - (afterWarmupStageCounts?.[group]?.[stage] ?? 0)]))]))
    writeFileSync(job.output, JSON.stringify({ diagnostic: true, counterfactual: true, revision: job.revision, sourceRoot: job.sourceRoot,
      runtime: process.versions, cache: process.env.AGENTIC_MERMAID_ELK_CACHE, assertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS,
      experimentFlags: process.env.AGENTIC_MERMAID_EXPERIMENTS ?? { defaults: PERFORMANCE_EXPERIMENTS },
      input, consumption: job.consumption, replayStages: job.replayStages, warmCalls, warmMs, requestedWindowMs: job.durationMs,
      windowStart, windowMs, calls, meanMs: windowMs / calls, fingerprint, drift,
      stageCounts: { priming: primingStageCounts, afterWarmup: afterWarmupStageCounts, afterWindow: afterWindowStageCounts, window: windowStageCounts },
      note: 'Fixed-source counterfactual floor only. A diagnostic build substitutes selected stage values captured on its first public call. It preserves and fingerprints complete SVG consumption, but does not establish semantic equivalence or an achievable optimization. Priming/afterWarmup/afterWindow counts are cumulative checkpoints; window counts are their direct difference. Request/layout replay changes object identities and downstream WeakMap hits; drawing replay alone may execute real drawing again through paint certification. No stage clock or CPU/heap sampler runs; stage counters and full UTF8/hash consumption remain in all replay arms, including none.' }, null, 2) + '\n')
    if (drift) throw new Error('Output fingerprint changed during stage replay')
    return
  }
  const profiler = new Session()
  profiler.connect()
  if (job.profileKind === 'cpu') {
    await profiler.post('Profiler.enable')
    await profiler.post('Profiler.setSamplingInterval', { interval: 500 })
    await profiler.post('Profiler.start')
  } else {
    await profiler.post('HeapProfiler.startSampling', { samplingInterval: 16384,
      includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  }
  const windowStart = performance.now()
  let calls = 0, drift = false
  do { drift ||= runPublicRender() !== fingerprint; calls++ } while (performance.now() - windowStart < job.durationMs)
  const windowMs = performance.now() - windowStart
  const { profile } = job.profileKind === 'cpu'
    ? await profiler.post('Profiler.stop') : await profiler.post('HeapProfiler.stopSampling')
  profiler.disconnect()
  const profileFile = job.profileKind === 'cpu' ? job.profile : job.profile.replace(/\.cpuprofile$/, '.heapprofile')
  writeFileSync(profileFile, JSON.stringify(profile))
  const attribution = summarizeProfile(profile, job.profileKind === 'cpu')
  writeFileSync(job.output, JSON.stringify({ diagnostic: true, profileKind: job.profileKind, revision: job.revision, sourceRoot: job.sourceRoot, runtime: process.versions,
    cache: process.env.AGENTIC_MERMAID_ELK_CACHE, assertions: process.env.AGENTIC_MERMAID_SCENE_ASSERTIONS,
    experimentFlags: process.env.AGENTIC_MERMAID_EXPERIMENTS ?? { defaults: PERFORMANCE_EXPERIMENTS }, input, consumption: job.consumption,
    warmCalls, warmMs, requestedWindowMs: job.durationMs, windowStart, windowMs, calls, fingerprint, drift,
    cpuIntervalUs: job.profileKind === 'cpu' ? 500 : undefined, heapIntervalBytes: job.profileKind === 'heap' ? 16384 : undefined,
    collectedObjects: job.profileKind === 'heap' ? { major: true, minor: true } : undefined, profileFile, attribution,
    note: 'Separate fresh-process source diagnostic, no stage observer. CPU is time-delta weighted; raw denominator retains inspector start/stop boundaries and GC. Workload-conditioned denominator includes only stacks beneath runPublicRender. Exclusive owners select the deepest source-bound rule; inclusive frames overlap. Heap includes collected objects and estimates V8 allocation, not exact, native, WASM, retained or peak memory. Neither profile throughput nor stage clocks are benchmark qualification.' }, null, 2) + '\n')
  if (drift) throw new Error('Output fingerprint changed during profile')
}

interface Frame { functionName: string; url: string; lineNumber: number; columnNumber: number }
interface CpuNode { id: number; callFrame: Frame; children?: number[] }
interface HeapNode { id: number; callFrame: Frame; selfSize: number; children: HeapNode[] }

function summarizeProfile(profile: unknown, cpu: boolean) {
  const sourceMap = new SourceMap(JSON.parse(readFileSync(`${fileURLToPath(import.meta.url)}.map`, 'utf8')))
  const frames = new Map<string, { frame: Frame; generated: Frame; self: number; inclusive: number }>()
  const exclusive: Record<string, number> = {}, selfById = new Map<number, number>()
  let rawTotal = 0, workloadTotal = 0
  const cpuProfile = profile as { nodes: CpuNode[]; samples: number[]; timeDeltas: number[] }
  if (cpu) for (let i = 0; i < cpuProfile.samples.length; i++) {
    const id = cpuProfile.samples[i]!, weight = cpuProfile.timeDeltas[i] ?? 0
    selfById.set(id, (selfById.get(id) ?? 0) + weight)
  }
  function mapped(frame: Frame): Frame {
    if (frame.url !== import.meta.url && frame.url !== fileURLToPath(import.meta.url)) return frame
    const entry = sourceMap.findEntry(frame.lineNumber, frame.columnNumber)
    return 'originalSource' in entry ? { ...frame, url: resolve(job.sourceRoot, 'node_modules/.cache/pipeline-audit', entry.originalSource), lineNumber: entry.originalLine, columnNumber: entry.originalColumn } : frame
  }
  function owner(frame: Frame, inherited: string): string | undefined {
    const path = frame.url.replaceAll('\\', '/'), name = frame.functionName
    if (/^(?:receiptOf|renderedSvgDigest|canonicalTextDigest)$/.test(name)) return 'receipt'
    if (/^(?:deferredRequestReceiptDigest|deferredRenderContractDigest)$/.test(name)) return 'receipt-preparation'
    if (/\/src\/render-contract\.ts$/.test(path)) return 'request'
    if (/\/src\/positioning\.ts$/.test(path) || /\/src\/svg-family-hooks\//.test(path)) return 'layout'
    if (/\/src\/elk-instance\.ts$/.test(path) || /\/elkjs\//.test(path)) return 'elk'
    if (/\/src\/layout-engine\.ts$/.test(path)) return 'layout'
    if (/\/src\/positioned-views\//.test(path)) return 'projection'
    if (/\/src\/layout\/certif|\/src\/positioned.*certif|\/src\/family-rubric\.ts$/.test(path)) return 'layout-certification'
    if (/\/src\/scene\/paint-certification\.ts$/.test(path)) return 'paint-certification'
    if (/\/src\/scene\/inspection\.ts$/.test(path)) return 'paint-inspection'
    if (/\/src\/scene\/(?:scene-validation|external-data-snapshot|backend-conformance)\.ts$/.test(path)) return 'admission'
    if (/\/src\/scene\/(?:svg|serialize|native-svg)/.test(path)) return 'serialization'
    if (/\/src\/scene\/marks\.ts$/.test(path)) return 'mark-construction'
    if (/\/src\/scene\/deferred-terminal-projection\.ts$/.test(path) && name !== 'withDeferredTerminalProjections') return 'terminal-compatibility'
    if (/\/src\/scene\/native-drawing\.ts$/.test(path)) return 'drawing'
    if (/\/src\/output-security\.ts$/.test(path)) return 'svg-security'
    if (/\/src\/svg-structure\.ts$/.test(path)) return inherited === 'svg-security' ? inherited : 'svg-scanning'
    if (/\/src\/(?:render-receipt|render-digest)/.test(path)) return 'receipt'
    if (name === 'runPublicRender') return 'consumption-and-other'
    return undefined
  }
  const nodes = cpu ? new Map(cpuProfile.nodes.map(node => [node.id, node])) : undefined
  function visit(node: CpuNode | HeapNode, inherited = 'outside-workload', inWorkload = false, stack: string[] = []): number {
    const frame = mapped(node.callFrame), active = inWorkload || frame.functionName === 'runPublicRender'
    const category = active ? owner(frame, inherited) ?? inherited : 'outside-workload'
    const weight = cpu ? selfById.get(node.id) ?? 0 : (node as HeapNode).selfSize
    rawTotal += weight
    if (active) { workloadTotal += weight; exclusive[category] = (exclusive[category] ?? 0) + weight }
    const key = JSON.stringify(frame), row = frames.get(key) ?? { frame, generated: node.callFrame, self: 0, inclusive: 0 }
    row.self += weight; frames.set(key, row)
    // A frame identity appears once per sampled stack in the aggregate. Raw
    // trees retain recursion depth and every generated source position.
    for (const ancestor of new Set([...stack, key])) frames.get(ancestor)!.inclusive += weight
    for (const child of node.children ?? []) visit(typeof child === 'number' ? nodes!.get(child)! : child, category, active, [...stack, key])
    return weight
  }
  const head = cpu ? cpuProfile.nodes.find(node => node.callFrame.functionName === '(root)')! : (profile as { head: HeapNode }).head
  visit(head)
  return { unit: cpu ? 'sampled-microseconds' : 'estimated-sampled-bytes', rawTotal, workloadTotal,
    outsideWorkload: rawTotal - workloadTotal, exclusive,
    sampleCount: cpu ? cpuProfile.samples.length : (profile as { samples: unknown[] }).samples.length,
    sourceBoundFrames: [...frames.values()].filter(row => row.frame.url.includes('/src/')).length,
    frames: [...frames.values()],
    topSelf: [...frames.values()].sort((a, b) => b.self - a.self).slice(0, 40),
    topInclusive: [...frames.values()].sort((a, b) => b.inclusive - a.inclusive).slice(0, 40),
    firstCpuDelta: cpu ? { node: cpuProfile.samples[0], microseconds: cpuProfile.timeDeltas[0] } : undefined }
}
