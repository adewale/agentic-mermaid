/** Installed-package probes in a fresh Node/Bun process; helpers do not import product source. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertInvocationReceipt } from './invocation-receipt.ts'
import { qualifyStyleOutput, type StyleDisplayPlan, styleDisplayTransforms } from './style-qualification.ts'
import type { BenchmarkObservation, UnifiedWorkload } from './types.ts'

interface Job {
  root: string
  entry: string
  qualifier: string
  exportName: string
  workloads: UnifiedWorkload[]
  full: boolean
  out: string
  round: number
}
type Api = Record<string, any>
interface Call {
  name: string
  format: string
  run: (input: any) => unknown
  receipt?: boolean
  parsedOnly?: boolean
  sourceOnly?: boolean
  meta?: boolean
  actions?: boolean
  displayTransforms?: StyleDisplayPlan
}
const job = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Job,
  rows: BenchmarkObservation[] = [],
  encode = new TextEncoder()
let outputQualifier: ((w: UnifiedWorkload, value: unknown, format: string) => { ok: boolean; findings: string[]; scope: string }) | undefined
const base = (w: UnifiedWorkload, call: string, format: string, mode: string): BenchmarkObservation => ({
  suite: 'invocation',
  surface: `library:${job.exportName}`,
  runtime: process.versions.bun ? `bun:${process.versions.bun}` : `node:${process.versions.node}`,
  family: w.family,
  caseId: w.id,
  operation: call,
  format,
  mode,
  status: 'passed',
  metrics: { round: job.round, artifactRoot: job.root, explicitLabelExpectations: w.expectedLabels?.length ?? 0 },
})
function consumed(value: any, call?: Call) {
  if (call?.receipt) assertInvocationReceipt(value?.receipt, call.format)
  if (call?.meta && (!Array.isArray(value?.regions) || !Array.isArray(value?.actions) || !Array.isArray(value?.warnings))) throw Error('Metadata-bearing renderer returned no region/action/warning arrays')
  if (call?.actions && (!value?.actionSurface || !Array.isArray(value.actionSurface.actions) || !Array.isArray(value.actionSurface.regions))) throw Error('Action-bearing renderer returned no action surface')
  const artifact = value?.svg ?? value?.text ?? value?.png ?? value?.ascii ?? value?.output ?? value?.layout ?? value
  const text = artifact instanceof Uint8Array ? artifact : encode.encode(typeof artifact === 'string' ? artifact : JSON.stringify(artifact, jsonSafe))
  const receipt = value?.receipt ? encode.encode(JSON.stringify(value.receipt, jsonSafe)) : undefined
  let sidecar: Uint8Array | undefined
  if (value && typeof value === 'object' && !(value instanceof Uint8Array) && artifact !== value) {
    const { svg: _, text: __, png: ___, ascii: ____, output: _____, layout: ______, receipt: _______, ...meta } = value
    if (Object.keys(meta).length) sidecar = encode.encode(JSON.stringify(meta, jsonSafe))
  }
  ;(globalThis as any).__unifiedInvocationSink = [text, receipt, sidecar]
  return { artifact, bytes: text.byteLength + (receipt?.byteLength ?? 0) + (sidecar?.byteLength ?? 0), value }
}
function jsonSafe(_key: string, value: any) {
  return value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value
}
function qualify(w: UnifiedWorkload, artifact: unknown, format: string, call?: Call) {
  if (!outputQualifier) throw Error('Independent qualifier unavailable')
  return call?.displayTransforms ? qualifyStyleOutput(w, artifact, format, call.displayTransforms, outputQualifier).findings : outputQualifier(w, artifact, format).findings
}
function changedSource(source: string, n: number) {
  const title = `accTitle: Invocation metadata ${n}`
  if (/^\s*accTitle\s*:/im.test(source)) return source.replace(/^\s*accTitle\s*:.*$/im, title)
  const lines = source.split('\n')
  let header = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex(line => line.trim() === '---')
    if (end >= 0) header = end + 2
  }
  while (header < lines.length && (!lines[header]!.trim() || lines[header]!.trim().startsWith('%%'))) header++
  lines.splice(header + 1, 0, title)
  return lines.join('\n')
}
function exportPath(key: string) {
  const pkg = JSON.parse(readFileSync(join(job.root, 'package.json'), 'utf8'))
  const pick = (v: any): string | undefined => (typeof v === 'string' ? v : v && typeof v === 'object' ? pick(v.import ?? v.default) : undefined)
  const relative = pick(pkg.exports?.[key])
  return relative ? join(job.root, relative) : undefined
}
try {
  const before = performance.now(),
    api = (await import(pathToFileURL(job.entry).href)) as Api,
    importMs = performance.now() - before
  rows.push({ ...base(job.workloads[0]!, 'import', 'module', 'fresh-process'), family: '*', caseId: 'package-import', samplesMs: [importMs], metrics: { round: job.round, workerElapsedAfterImportMs: performance.now(), scope: 'target package import; OS/filesystem caches shared; helper qualifier is loaded afterwards' } })
  outputQualifier = (await import(pathToFileURL(job.qualifier).href)).qualifyOutput
  const calls: Call[] = [],
    add = (name: string, format: string, run: (input: any) => unknown, extra: Partial<Call> = {}) => calls.push({ name, format, run, ...extra })
  if (typeof api.renderMermaidSVG === 'function') add('renderMermaidSVG', 'svg', s => api.renderMermaidSVG(s))
  if (typeof api.renderMermaidSVGAsync === 'function') add('renderMermaidSVGAsync', 'svg', s => api.renderMermaidSVGAsync(s))
  if (typeof api.renderMermaidSVGWithReceipt === 'function') add('renderMermaidSVGWithReceipt', 'svg', s => api.renderMermaidSVGWithReceipt(s), { receipt: true })
  if (typeof api.renderMermaidASCII === 'function') for (const useAscii of [true, false]) add(`renderMermaidASCII:${useAscii ? 'ascii' : 'unicode'}`, useAscii ? 'ascii' : 'unicode', s => api.renderMermaidASCII(s, { useAscii, colorMode: 'none' }))
  if (typeof api.renderMermaidASCIIWithReceipt === 'function') for (const useAscii of [true, false]) add(`renderMermaidASCIIWithReceipt:${useAscii ? 'ascii' : 'unicode'}`, useAscii ? 'ascii' : 'unicode', s => api.renderMermaidASCIIWithReceipt(s, { useAscii, colorMode: 'none' }), { receipt: true })
  if (typeof api.renderMermaidASCIIWithMeta === 'function') for (const useAscii of [true, false]) add(`renderMermaidASCIIWithMeta:${useAscii ? 'ascii' : 'unicode'}`, useAscii ? 'ascii' : 'unicode', s => api.renderMermaidASCIIWithMeta(s, { useAscii, colorMode: 'none' }), { meta: true })
  if (typeof api.renderMermaidPNG === 'function') add('renderMermaidPNG', 'png', s => api.renderMermaidPNG(s, { scale: 1 }))
  if (typeof api.renderMermaidPNGWithReceipt === 'function') add('renderMermaidPNGWithReceipt', 'png', s => api.renderMermaidPNGWithReceipt(s, { scale: 1 }), { receipt: true })
  if (typeof api.layoutMermaidWithReceipt === 'function') add('layoutMermaidWithReceipt', 'layout', s => api.layoutMermaidWithReceipt(s), { receipt: true })
  if (typeof api.layoutMermaid === 'function') add('layoutMermaid', 'layout', s => api.layoutMermaid(s), { parsedOnly: true })
  if (typeof api.renderMermaidWithActions === 'function')
    for (const format of ['svg', 'png', 'ascii', 'unicode']) add(`renderMermaidWithActions:${format}`, format, s => api.renderMermaidWithActions(s, { format, options: format === 'png' ? { scale: 1 } : format === 'ascii' || format === 'unicode' ? { colorMode: 'none' } : {} }), { actions: true })
  if (typeof api.createMermaidRenderer === 'function') {
    const renderer = api.createMermaidRenderer()
    for (const receipt of [false, true]) {
      const method = receipt ? 'renderMermaidSVGWithReceipt' : 'renderMermaidSVG'
      if (typeof renderer[method] === 'function') add(`factory.${method}`, 'svg', s => renderer[method](s), { receipt })
    }
  }
  if (typeof api.createMermaidPNGRenderer === 'function') {
    const renderer = api.createMermaidPNGRenderer()
    for (const receipt of [false, true]) {
      const method = receipt ? 'renderMermaidPNGWithReceipt' : 'renderMermaidPNG'
      if (typeof renderer[method] === 'function') add(`factory.${method}`, 'png', s => renderer[method](s, { scale: 1 }), { receipt })
    }
  }
  if (job.exportName === './svg/styles') {
    const styles = typeof api.knownStyleDescriptors === 'function' ? api.knownStyleDescriptors() : []
    rows.push({ ...base(job.workloads[0]!, 'knownStyleDescriptors', 'json', 'discovery'), family: '*', caseId: 'styles', bytes: encode.encode(JSON.stringify(styles)).length, status: styles.length ? 'passed' : 'failed' })
    const entry = exportPath('./svg'),
      svg = entry ? await import(pathToFileURL(entry).href) : undefined,
      looks = styles.filter((d: any) => d.kind === 'look'),
      selected = job.full ? looks : looks.filter((d: any) => !d.isDefault).slice(0, 1)
    for (const style of selected) if (svg) add(`registered-style:${style.inputName}`, 'svg', s => svg.renderMermaidSVG(s, { style: style.inputName, seed: 3 }), { sourceOnly: true, displayTransforms: styleDisplayTransforms([style.spec ?? api.getStyle?.(style.inputName)]) })
    const palette = styles.find((d: any) => d.kind === 'palette'),
      look = looks.find((d: any) => !d.isDefault)
    if (svg && palette && look)
      add('registered-style:look-palette-stack', 'svg', s => svg.renderMermaidSVG(s, { style: [look.inputName, palette.inputName], seed: 3 }), { sourceOnly: true, displayTransforms: styleDisplayTransforms([look.spec ?? api.getStyle?.(look.inputName), palette.spec ?? api.getStyle?.(palette.inputName)]) })
  }
  let firstArtifact = true
  const runCall = async (w: UnifiedWorkload, call: Call, inputKind: 'source' | 'parsed', mode: string) => {
    const row = base(w, call.name, call.format, `${mode}:${inputKind}`)
    if (call.displayTransforms) {
      row.metrics = { ...row.metrics, qualificationScope: call.displayTransforms.scope, displayTransforms: call.displayTransforms.transforms.join(','), expectedDisplaySource: 'public descriptor.spec.roles; declared transforms projected before timing', roleCorrespondence: 'unmeasured; owning style tests are separate' }
      if (call.displayTransforms.blockedReason) {
        rows.push({ ...row, status: 'blocked', detail: call.displayTransforms.blockedReason })
        return
      }
    }
    try {
      const parse = (source: string) => {
        const parsed = api.parseRegisteredMermaid(source)
        if (!parsed.ok) throw Error('Parsed invocation preparation failed: ' + JSON.stringify(parsed.error))
        return parsed.value
      }
      const input = inputKind === 'parsed' ? parse(w.source) : w.source,
        start = performance.now(),
        initial = consumed(await call.run(input), call),
        initialMs = performance.now() - start,
        findings = qualify(w, initial.artifact, call.format, call)
      if (firstArtifact) {
        row.metrics = { ...row.metrics, workerStartupThroughHelperAndFirstArtifactMs: performance.now(), startupScope: 'worker uptime includes job decoding, qualifier import and adapter discovery; not a pristine package-only cold metric' }
        firstArtifact = false
      }
      if (mode === 'first-input') row.samplesMs = [initialMs]
      else {
        let count = 0,
          begin = performance.now()
        do {
          consumed(await call.run(input), call)
          count++
        } while (count < 2 || (job.full && performance.now() - begin < 35))
        const per = (performance.now() - begin) / count,
          iterations = job.full ? Math.max(1, Math.min(16, Math.ceil(5 / Math.max(0.01, per)))) : 1
        const changed = mode === 'warm-metadata-changed' ? Array.from({ length: iterations * 3 }, (_, i) => (inputKind === 'parsed' ? parse(changedSource(w.source, i)) : changedSource(w.source, i))) : undefined
        row.samplesMs = []
        for (let sample = 0; sample < 3; sample++) {
          begin = performance.now()
          let last: any
          for (let i = 0; i < iterations; i++) last = consumed(await call.run(changed?.[sample * iterations + i] ?? input), call)
          row.samplesMs.push((performance.now() - begin) / iterations)
          findings.push(...qualify(w, last.artifact, call.format, call))
        }
        row.metrics = { ...row.metrics, iterations, sampleKind: 'per-call means; output validation after sample', changedInputScope: changed ? 'accessibility-title metadata; structural mutation is measured by family suite' : null }
      }
      if (call.meta) row.metrics = { ...row.metrics, regions: initial.value.regions.length, actions: initial.value.actions.length, warnings: initial.value.warnings.length }
      if (call.actions) row.metrics = { ...row.metrics, regions: initial.value.actionSurface.regions.length, actions: initial.value.actionSurface.actions.length }
      row.bytes = initial.bytes
      row.findings = [...new Set(findings)]
      row.status = findings.length ? 'failed' : 'passed'
    } catch (e) {
      row.status = 'failed'
      row.detail = String(e)
    }
    rows.push(row)
  }
  for (const w of job.workloads) {
    const parsedCapable = typeof api.parseRegisteredMermaid === 'function' && !job.exportName.startsWith('./svg')
    for (const call of calls)
      for (const inputKind of call.parsedOnly ? (parsedCapable ? (['parsed'] as const) : []) : call.sourceOnly || !parsedCapable ? (['source'] as const) : (['source', 'parsed'] as const))
        for (const mode of job.full ? ['first-input', 'warm-repeat', 'warm-metadata-changed'] : ['first-input', 'warm-repeat']) await runCall(w, call, inputKind, mode)
    if (typeof api.parseRegisteredMermaid === 'function') {
      const start = performance.now(),
        parsed = api.parseRegisteredMermaid(w.source),
        materialized = consumed(parsed)
      rows.push({ ...base(w, 'parseRegisteredMermaid', 'ir', 'source'), status: parsed.ok && parsed.value?.kind === w.family ? 'passed' : 'failed', samplesMs: [performance.now() - start], bytes: materialized.bytes, detail: parsed.ok ? undefined : JSON.stringify(parsed.error) })
      if (parsed.ok && typeof api.serializeMermaid === 'function') {
        const start = performance.now(),
          source = api.serializeMermaid(parsed.value),
          again = api.parseRegisteredMermaid(source)
        rows.push({ ...base(w, 'serializeMermaid', 'source', 'parsed-input'), status: again.ok && again.value.kind === w.family ? 'passed' : 'failed', samplesMs: [performance.now() - start], bytes: encode.encode(source).length })
      }
      if (parsed.ok && typeof api.verifyMermaid === 'function') {
        const start = performance.now(),
          verified = api.verifyMermaid(parsed.value)
        rows.push({
          ...base(w, 'verifyMermaid', 'json', 'parsed-input'),
          samplesMs: [performance.now() - start],
          bytes: consumed(verified).bytes,
          status: verified && Array.isArray(verified.warnings) ? 'passed' : 'failed',
          metrics: { round: job.round, verificationOk: !!verified?.ok, warningCount: verified?.warnings?.length ?? 0 },
        })
      }
    }
  }
  if (typeof api.renderMermaidWithActions === 'function') {
    const witness: UnifiedWorkload = {
      id: 'invocation:inert-action',
      family: 'flowchart',
      source: 'flowchart LR\nAPI[API] --> DB[Database]\nclick API href "https://example.com/invocation"',
      features: ['action-metadata', 'inert-link-target'],
      provenance: 'authored invocation action witness; same public action contract as agent-render-actions owning tests',
      expectedLabels: ['API', 'Database'],
    }
    for (const format of ['svg', 'png', 'ascii', 'unicode']) {
      const call: Call = { name: `renderMermaidWithActions:${format}:nonempty-action`, format, actions: true, run: s => api.renderMermaidWithActions(s, { format, options: format === 'png' ? { scale: 1 } : format === 'ascii' || format === 'unicode' ? { colorMode: 'none' } : {} }) },
        row = base(witness, call.name, format, 'authored-action')
      try {
        const start = performance.now(),
          value = consumed(await call.run(witness.source), call),
          action = value.value.actionSurface.actions.find((a: any) => a.target === 'API' && a.href === 'https://example.com/invocation')
        row.samplesMs = [performance.now() - start]
        row.bytes = value.bytes
        row.findings = qualify(witness, value.artifact, format)
        if (!action || action.executable !== false || action.region?.id !== 'node:API') row.findings.push('Inert action did not retain requested href, target and owned region')
        row.status = row.findings.length ? 'failed' : 'passed'
      } catch (e) {
        row.status = 'failed'
        row.detail = String(e)
      }
      rows.push(row)
    }
  }
  // Two authored structural-growth sessions exercise visible/layout changes and revisits.
  // This is bounded stateful coverage, not a claim that every family or cache limit is stressed.
  if (typeof api.renderMermaidSVG === 'function') {
    const persistent = typeof api.createMermaidRenderer === 'function' ? api.createMermaidRenderer() : api
    const render = persistent.renderMermaidSVGWithReceipt ?? persistent.renderMermaidSVG
    const receipt = typeof persistent.renderMermaidSVGWithReceipt === 'function'
    for (const family of ['flowchart', 'state'] as const) {
      const sources = Array.from({ length: 8 }, (_, count) =>
        family === 'flowchart'
          ? 'flowchart LR\nRoot[InvocationRoot]' + Array.from({ length: count + 1 }, (_, index) => `\nRoot --> N${index}[InvocationGrowth${index}]`).join('')
          : 'stateDiagram-v2\n[*] --> Root\nstate "InvocationRoot" as Root' + Array.from({ length: count + 1 }, (_, index) => `\nstate "InvocationGrowth${index}" as N${index}\nRoot --> N${index}`).join(''),
      )
      for (const [index, source] of [...sources, sources[0]!].entries()) {
        const last = index === sources.length,
          count = last ? 0 : index
        const witness: UnifiedWorkload = {
          id: `invocation:structural-session:${family}:${index}`,
          family,
          source,
          features: ['structural-growth', 'visible-label-change', ...(last ? ['revisit'] : [])],
          provenance: 'independently authored bounded 8-step structural session',
          expectedLabels: ['InvocationRoot', ...Array.from({ length: count + 1 }, (_, n) => `InvocationGrowth${n}`)],
        }
        const call: Call = { name: 'persistent-structural-session', format: 'svg', receipt, run: s => render.call(persistent, s) }
        await runCall(witness, call, 'source', 'first-input')
        await runCall(witness, call, 'source', 'warm-repeat')
      }
    }
  }
  if (job.full && job.exportName === '.' && typeof api.renderMermaidSVG === 'function') {
    const persistent = typeof api.createMermaidRenderer === 'function' ? api.createMermaidRenderer() : api
    const receipt = typeof persistent.renderMermaidSVGWithReceipt === 'function',
      render = receipt ? persistent.renderMermaidSVGWithReceipt : persistent.renderMermaidSVG
    const configured = Number(process.env.UNIFIED_SESSION_COUNT ?? 1000),
      count = Number.isInteger(configured) && configured >= 2 && configured <= 100_000 ? configured : 1000
    const sources = Array.from({ length: count }, (_, index) => `flowchart LR\nN${index}[SessionVisible${index}] --> T${index}[SessionEnd${index}]`)
    const row = base({ ...job.workloads[0]!, family: 'flowchart', id: 'invocation:working-set-pressure' }, 'persistent-working-set-pressure', 'svg', 'distinct-inputs-and-first-last-revisit')
    const beforeMemory = process.memoryUsage(),
      cpu = process.cpuUsage(),
      sessionStart = performance.now()
    let apiMs = 0,
      bytes = 0
    try {
      for (const index of [...Array.from({ length: count }, (_, n) => n), 0, count - 1]) {
        const source = sources[index]!,
          start = performance.now()
        const value = consumed(await render.call(persistent, source), { name: 'working-set', format: 'svg', receipt, run: render })
        apiMs += performance.now() - start
        bytes += value.bytes
        const witness: UnifiedWorkload = { id: `working-set:${index}`, family: 'flowchart', source, features: ['working-set-pressure'], provenance: 'independently authored distinct IDs and visible labels', expectedLabels: [`SessionVisible${index}`, `SessionEnd${index}`] }
        const findings = qualify(witness, value.artifact, 'svg')
        if (findings.length) throw Error(`Working-set artifact ${index}: ` + findings.join('; '))
      }
      row.samplesMs = [apiMs]
      row.bytes = bytes
    } catch (error) {
      row.status = 'failed'
      row.detail = String(error)
    }
    const afterMemory = process.memoryUsage(),
      usedCpu = process.cpuUsage(cpu)
    row.metrics = {
      round: job.round,
      distinctInputs: count,
      revisits: 2,
      apiTotalMs: apiMs,
      sessionWallMs: performance.now() - sessionStart,
      cpuUserUs: usedCpu.user,
      cpuSystemUs: usedCpu.system,
      rssBeforeBytes: beforeMemory.rss,
      rssAfterBytes: afterMemory.rss,
      heapBeforeBytes: beforeMemory.heapUsed,
      heapAfterBytes: afterMemory.heapUsed,
      clock: 'sum of consumed renderer calls; qualification and memory checkpoints outside API clock; CPU/session clock includes qualification',
      scope: 'bounded working-set pressure; no private cache eviction telemetry or leak proof',
    }
    rows.push(row)
  }
  if (calls.length === 0 && job.exportName !== './svg/styles') rows.push({ ...base(job.workloads[0]!, 'public-entry', 'module', 'discovery'), family: '*', caseId: 'entry-capabilities', status: 'not-applicable', detail: 'No renderer exposed by this entry; registration/discovery contracts remain in owning suites.' })
  if (process.versions.bun) Bun.gc(true)
  else globalThis.gc?.()
  rows.push({
    ...base(job.workloads[0]!, 'memory-checkpoint', 'memory', 'after-portfolio'),
    family: '*',
    caseId: 'process-memory',
    metrics: { round: job.round, rssBytes: process.memoryUsage().rss, heapUsedBytes: process.memoryUsage().heapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, scope: 'after all enrolled operations; includes harness/qualification; forced GC, not allocation or leak proof' },
  })
  writeFileSync(
    job.out,
    JSON.stringify(
      {
        rows,
        importMs,
        runtime: process.versions.bun ? `bun:${process.versions.bun}` : `node:${process.versions.node}`,
        nodeCompatibility: process.versions.node,
        publicFunctionExports: Object.keys(api)
          .filter(name => typeof api[name] === 'function')
          .sort(),
        exercisedOperations: [...new Set(rows.map(row => row.operation))].sort(),
        exportWitnessScope: 'Missing direct operation witnesses do not establish never-called APIs: helpers may run during preparation. Owning functionality suites remain separate.',
      },
      null,
      2,
    ),
  )
} catch (e) {
  writeFileSync(job.out, JSON.stringify({ rows, error: String(e) }, null, 2))
  process.exitCode = 1
}
