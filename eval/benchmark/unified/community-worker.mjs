// One fresh Node process per implementation/output/round. Qualification and
// progress I/O stay outside public API clocks. Partial results survive a crash.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), { prepared, workloads, output } = job, artifact = prepared.artifact, declaredConfig = prepared.node.benchmark, config = { ...declaredConfig, adapter: ['beautiful-source','beautiful-fork'].includes(declaredConfig.sourceAdapter) ? 'beautiful' : ['mermaid-source','mermaid-fork'].includes(declaredConfig.sourceAdapter) ? 'mermaid' : declaredConfig.adapter }
const { qualifyOutput } = await import(pathToFileURL(job.harnessRoot + '/eval/benchmark/unified/qualification.ts'))
let extraApi, diagnosticHelpers, diagnosticAdmission, diagnosticAdmissionFailed = false, publicApiAvailable = false, parserAdmission, parserAdmissionFailed = false
const start = performance.now(), rows = [], cleanups = [], jsonl = job.out + '.jsonl'
fs.writeFileSync(jsonl, '')
const req = createRequire((artifact.root ?? job.harnessRoot) + '/package.json')
const progress = message => { if (Number.isInteger(job.progressFd)) { try { fs.writeSync(job.progressFd, JSON.stringify(message) + '\n') } catch {} } }
const emit = row => { rows.push(row); fs.appendFileSync(jsonl, JSON.stringify(row) + '\n'); progress({ phase: 'result', id: row.id }) }
function valueAt(module, names) { for (const name of names) { const value = name.split('.').reduce((x, key) => x?.[key], module); if (typeof value === 'function') return value } throw Error('Public API absent: ' + names.join(', ')) }
async function renderer() {
  let module
  if (output === 'diagnostics') diagnosticHelpers = await import('./community-extra-adapters.mjs')
  if (config.adapter === 'published-extra' || config.adapter === 'extra-source') {
    const { createExtraCommunityApi } = await import('./community-extra-adapters.mjs')
    extraApi = await createExtraCommunityApi({ artifact, node: prepared.node, config, output, require: req, cleanups })
    return extraApi.invoke
  }
  if (artifact.kind === 'global') { globalThis.self ??= globalThis; await import(pathToFileURL(artifact.module)); if (typeof globalThis[artifact.global] !== 'function') throw Error('Public global API absent: ' + artifact.global); return source => globalThis[artifact.global](source) }
  if (config.adapter === 'mermaid') {
    const domRequire = createRequire(resolve(process.env.MERMAID_REFERENCE_DIR ?? resolve(job.harnessRoot, '../mermaid-reference'), 'package.json')), { JSDOM } = domRequire('jsdom'), dom = new JSDOM('<!doctype html><body>')
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
    cleanups.push(() => dom.window.close())
  }
  let entry = artifact.module
  if (config.adapter === 'beautiful' && output === 'terminal' && config.terminalSubpath) {
    const pkg = JSON.parse(fs.readFileSync(artifact.root + '/package.json', 'utf8'))
    const select = value => {
      if (typeof value === 'string') return value
      if (Array.isArray(value)) { for (const child of value) { const found = select(child); if (found) return found }; return }
      if (value && typeof value === 'object') for (const [condition, child] of Object.entries(value)) if (['node', 'node-addons', 'import', 'default'].includes(condition)) { const found = select(child); if (found) return found }
    }
    const published = select(pkg.exports?.['./' + config.terminalSubpath])
    if (!published) throw Error('Public terminal import subpath is absent: ' + config.terminalSubpath)
    entry = resolve(artifact.root, published)
  }
  module = await import(pathToFileURL(entry)); const api = module.default && typeof module.default === 'object' ? { ...module.default, ...module } : module
  switch (config.adapter) {
    case 'agentic': return output === 'svg' ? source => api.renderMermaidSVG(source) : output === 'terminal' ? source => api.renderMermaidASCII(source, { useAscii: false, colorMode: 'none' }) : output === 'png' ? source => api.renderMermaidPNG(source) : source => api.parseRegisteredMermaid(source)
    case 'beautiful': {
      if (prepared.node.id === 'dfadler/zombie-mermaid' && typeof api.registerElk === 'function') { const elk = req('elkjs/lib/elk.bundled.js'); api.registerElk(elk.default ?? elk) }
      const terminal = api
      return output === 'svg' ? source => valueAt(api, ['renderMermaidSVG','renderMermaidSync','renderMermaid'])(source) : source => valueAt(terminal, ['renderMermaidASCII','renderMermaidAscii'])(source, { useAscii: false, colorMode: 'none' })
    }
    case 'pele': return source => api.render(source).svg
    case 'ondine': return source => api.render(source).svg
    case 'mermaid-rs-wasm': return valueAt(module, ['renderSvg', 'default.renderSvg'])
    case 'merman': {
      const engine = await api.createNodeEngine(); cleanups.push(() => engine.dispose())
      if (output === 'png') return source => {
        if (!engine.runtimeCatalog.capabilities.operation_ids.includes('png')) throw Error('Unsupported PNG capability: not exposed by this native target')
        const result = engine.executeOperationSync({ operationId: 'png', source })
        if (result.media_type !== 'image/png') throw Error('PNG operation returned a different media type')
        const bytes = Buffer.from(result.data, 'base64')
        if (bytes.toString('base64') !== result.data) throw Error('PNG transport did not return canonical base64 bytes')
        return bytes
      }
      return source => engine.renderSvgSync(source)
    }
    case 'franken': await module.default({ module_or_path: fs.readFileSync(artifact.wasm) }); return output === 'parse' ? valueAt(module, ['parse', 'parseDiagram']) : source => module.renderSvg(source)
    case 'mermaid': api.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' }); if (output !== 'parse') throw Error('Node SVG needs browser geometry; the browser adapter owns this output'); return source => api.parse(source)
    // parseAsync is the published complete interface for pie/GitGraph as well.
    case 'mermaid-ast': return valueAt(module, ['parseAsync', 'parse', 'default.parseAsync', 'default.parse'])
    case 'visimer': return valueAt(module, ['parse', 'parseMermaid', 'default.parse'])
    case 'maid': return valueAt(module, ['validate', 'validateMermaid', 'default.validate'])
    default: throw Error('No Node factory for ' + config.adapter)
  }
}
const median = values => { const sorted = [...values].sort((a, b) => a - b), n = sorted.length; return n % 2 ? sorted[n >> 1] : (sorted[(n >> 1) - 1] + sorted[n >> 1]) / 2 }
const thenable = value => value && typeof value.then === 'function'
function consume(value) {
  if (typeof value === 'string') return Buffer.byteLength(value)
  if (value instanceof Uint8Array) return value.byteLength
  const seen = new WeakSet()
  return Buffer.byteLength(JSON.stringify(value, (_key, entry) => {
    if (typeof entry === 'bigint') return entry.toString()
    if (entry && typeof entry === 'object') { if (seen.has(entry)) return '<shared-or-circular>'; seen.add(entry) }
    return entry instanceof Map ? Object.fromEntries(entry) : entry instanceof Set ? [...entry] : entry
  }) ?? '')
}
function invalid(detail) { const error = new Error(detail); error.qualification = true; throw error }
function structured(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0 }
function parserReturn(value) { return config.adapter === 'mermaid' && output === 'parse' ? { publicParserReturn: { type: typeof value, value: value === undefined ? null : value }, parserAdmissionFailed } : {} }
function labelStrings(value) {
  const found = new Set(), visited = new Set(), omitted = new Set(['source', 'code', 'lines', 'canonicalSource', 'originalSource', 'rawSource', 'raw', 'sourceText'])
  const walk = item => {
    if (typeof item === 'string') { found.add(item.replace(/\s+/g, ' ').trim()); return }
    if (!item || typeof item !== 'object' || visited.has(item)) return
    visited.add(item)
    if (item instanceof Map) { for (const [key, entry] of item) { if (typeof key === 'string') found.add(key); walk(entry) } }
    else if (Array.isArray(item) || item instanceof Set) for (const entry of item) walk(entry)
    else for (const [key, entry] of Object.entries(item)) if (!omitted.has(key)) walk(entry)
  }
  walk(value); return found
}
function qualify(value, workload) {
  if (output === 'diagnostics') return diagnosticHelpers.diagnosticQualification(value, workload)
  const extraQualification = extraApi?.qualify?.(value, workload)
  if (typeof extraQualification === 'string') return extraQualification
  if (output === 'parse') {
    if (value === false || value?.ok === false || value?.success === false) invalid('Parser rejected source: ' + JSON.stringify(value))
    if (config.adapter === 'mermaid') {
      if (parserAdmissionFailed || !parserAdmission?.length) invalid('Public parser failed authored negative admission; no qualified syntax-validation rank')
      if (value !== true && value !== undefined && !(structured(value) && typeof value.diagramType === 'string' && value.diagramType)) invalid('Public parser returned no documented syntax acceptance')
      return value === undefined ? 'public-void-success-syntax-validation; both authored negatives rejected; no native-model or label-fidelity claim' : 'public-parser-syntax-acceptance; both authored negatives rejected; no native-model or label-fidelity claim'
    }
    if (!structured(value)) invalid('Parser returned no structured result')
    let model = value
    if (config.adapter === 'agentic') {
      if (value.ok !== true || !structured(value.value) || !structured(value.value.body)) invalid('Missing admitted Agentic parsed diagram')
      if (['opaque', 'preserved'].includes(value.value.body.kind)) throw Error('Unsupported structured parse: source-preservation fallback only')
      model = value.value.body
    } else if (config.adapter === 'visimer') {
      if (!value.typeInfo || value.typeInfo.capability !== 'edit') throw Error('Unsupported structured parse: header recognition without editable family model')
      model = value.flowchart ?? value.sequence ?? value.state ?? value.classGraph ?? value.er ?? value.pie ?? value.gantt ?? value.lineItems
      if (!structured(model)) throw Error('Unsupported structured parse: no family graph projection')
    } else if (config.adapter === 'franken') {
      if (!structured(value.ir) || typeof value.ir.diagram_type !== 'string') invalid('Franken returned no typed IR')
      const referencedLabels = [], visited = new Set()
      const references = item => {
        if (!item || typeof item !== 'object' || visited.has(item)) return
        visited.add(item)
        if (Array.isArray(item)) { for (const entry of item) references(entry); return }
        for (const [key, entry] of Object.entries(item)) {
          if (key === 'labels' || key === 'meta' || key.startsWith('span')) continue
          if (/label(?:_id)?$|^(?:title|text|message)$/.test(key) && Number.isInteger(entry) && typeof value.ir.labels?.[entry]?.text === 'string') referencedLabels.push(value.ir.labels[entry].text)
          else references(entry)
        }
      }
      references(value.ir)
      model = { ...value.ir, labels: undefined, meta: undefined, referencedLabels }
    } else if (config.adapter === 'mermaid-ast' && typeof value.type !== 'string') invalid('Mermaid AST has no family type')
    const seen = labelStrings(model), missing = (workload.expectedLabels ?? []).map(label => label.replace(/\s+/g, ' ').trim()).filter(label => label && !seen.has(label))
    if (missing.length) invalid('Structured parser lost declared labels (raw source/sidecars excluded): ' + missing.slice(0, 8).join(', '))
    return workload.expectedLabels?.length ? 'typed-result-and-declared-labels-without-source-echo' : 'typed-result-envelope'
  }
  const qualification = qualifyOutput(workload, value, output)
  if (!qualification.ok) invalid(qualification.findings.join('; '))
  return [qualification.scope, extraApi?.qualification].filter(Boolean).join('; ')
}
try {
  const render = await renderer(), importMs = performance.now() - start
  publicApiAvailable = true
  if (config.adapter === 'mermaid' && output === 'parse') {
    parserAdmission = []
    for (const [index, source] of ['This is deliberately not a Mermaid diagram. @@@ {{{', 'graph LR\n --> -->'].entries()) {
      let value, rejection
      try { value = render(source); if (thenable(value)) value = await value }
      catch (error) { rejection = error instanceof Error ? String(error) : JSON.stringify(error) }
      const accepted = !rejection && value !== false && value?.ok !== false && value?.success !== false
      parserAdmission.push({ id: 'parser-negative-' + (index + 1), source, expectedAccepted: false, actualAccepted: accepted, status: accepted ? 'failed' : 'passed', detail: accepted ? 'Authored invalid source was accepted' : 'Authored invalid source was rejected', rejection, returnType: typeof value, value: value === undefined ? null : value })
      fs.writeFileSync(job.out + '.parser-admission.json', JSON.stringify({ policy: 'Both authored negative controls must reject before syntax-validation ranks; API returns remain unchanged', parserAdmission }, null, 2))
      if (accepted) parserAdmissionFailed = true
    }
    extraApi = { surface: 'node:public-parse-validation', boundary: 'actual public Mermaid parse API; native return retained, syntax validation only, no private AST projection' }
    fs.writeFileSync(job.out + '.parser-admission.json', JSON.stringify({ policy: 'Both authored negative controls must reject before syntax-validation ranks; API returns remain unchanged', parserAdmission }, null, 2))
  }
  if (output === 'diagnostics') {
    diagnosticAdmission = []
    for (const [index, source] of ['This is deliberately not a Mermaid diagram. @@@ {{{', 'flowchart LR\n --> -->'].entries()) {
      let value, rejection
      try { value = render(source); if (thenable(value)) value = await value }
      catch (error) { rejection = String(error) }
      let summary
      try { summary = rejection ? undefined : diagnosticHelpers.diagnosticSummary(value) }
      catch (error) { diagnosticAdmission.push({ id: 'negative-' + (index + 1), source, expectedAccepted: false, actualAccepted: null, status: 'failed', detail: 'Diagnostic response had no valid typed findings envelope', rejection, value, qualificationError: String(error) }); fs.writeFileSync(job.out + '.diagnostic-admission.json', JSON.stringify({ diagnosticAdmission }, null, 2)); throw error }
      const accepted = rejection ? false : summary.accepted
      diagnosticAdmission.push({ id: 'negative-' + (index + 1), source, expectedAccepted: false, actualAccepted: accepted, status: accepted ? 'failed' : 'passed', detail: accepted ? 'Authored invalid source was accepted without error findings' : 'Authored invalid source was rejected', rejection, value, summary })
      fs.writeFileSync(job.out + '.diagnostic-admission.json', JSON.stringify({ policy: 'Authored negative controls before core API clocks; warnings do not substitute for rejection', diagnosticAdmission }, null, 2))
      if (!rejection && summary.accepted) diagnosticAdmissionFailed = true
    }
    fs.writeFileSync(job.out + '.diagnostic-admission.json', JSON.stringify({ policy: 'Authored negative controls before core API clocks; warnings do not substitute for rejection', diagnosticAdmission }, null, 2))
  }
  progress({ phase: 'ready', importMs })
  for (const workload of workloads) {
    progress({ phase: 'case', id: workload.id })
    let firstMs
    const firstStart = performance.now()
    try {
      let tick = performance.now(), sink = render(workload.source); if (thenable(sink)) sink = await sink
      firstMs = performance.now() - tick
      const qualification = qualify(sink, workload), bytes = consume(sink), core = workload.features.includes('core-graph-batch')
      if (core && diagnosticAdmissionFailed) {
        emit({ runtime: process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node, surface: extraApi?.surface, apiBoundary: extraApi?.boundary, id: workload.id, family: workload.family, status: 'failed', firstMs, bytes, qualification, mode: 'positive-diagnostic-with-failed-negative-admission', diagnosticAdmissionFailed: true, diagnosticAccepted: diagnosticHelpers.diagnosticSummary(sink).accepted, diagnosticStatusScope: 'positive API completion; negative-control failure withholds calibrated core rank', detail: 'Public validator accepted this positive source, but accepted an authored invalid negative without error findings; no calibrated core samples or qualified rank.' })
        continue
      }
      if (!core && (job.coverageOnce || job.coverageOnly)) {
        globalThis.__communitySink = sink
        emit({ runtime: process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node, surface: extraApi?.surface, apiBoundary: extraApi?.boundary, id: workload.id, family: workload.family, status: 'passed', firstMs, bytes, qualification, mode: 'feature-corpus-qualification', coverageOnly: true, ...parserReturn(sink), ...(output === 'diagnostics' ? { diagnosticAdmissionFailed, diagnosticsCount: diagnosticHelpers.diagnosticSummary(sink).errorCount, diagnosticAccepted: diagnosticHelpers.diagnosticSummary(sink).accepted, diagnosticStatusScope: core ? 'independently-valid-core-admission' : 'operation-completion-without-positive-feature-oracle' } : {}) })
        continue
      }
      let calls = 0; const warm = performance.now()
      do { sink = render(workload.source); if (thenable(sink)) sink = await sink; calls++ } while (core && (calls < 3 || performance.now() - warm < job.warmupMs))
      const perCall = (performance.now() - warm) / calls, iterations = core ? Math.max(1, Math.min(1024, Math.ceil(job.minSampleMs / Math.max(.001, perCall)))) : 1, samples = []
      for (let sample = 0; sample < (core ? job.samples : 3); sample++) {
        tick = performance.now()
        for (let iteration = 0; iteration < iterations; iteration++) { sink = render(workload.source); if (thenable(sink)) sink = await sink }
        samples.push((performance.now() - tick) / iterations)
      }
      qualify(sink, workload); globalThis.__communitySink = sink
      emit({ runtime: process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node, surface: extraApi?.surface, apiBoundary: extraApi?.boundary, id: workload.id, family: workload.family, status: 'passed', samplesMs: samples, medianMs: median(samples), firstMs, bytes, iterations, qualification, ...parserReturn(sink), ...(output === 'diagnostics' ? { diagnosticsCount: diagnosticHelpers.diagnosticSummary(sink).errorCount, diagnosticAccepted: diagnosticHelpers.diagnosticSummary(sink).accepted, diagnosticStatusScope: core ? 'independently-valid-core-admission' : 'operation-completion-without-positive-feature-oracle' } : {}) })
    } catch (error) { emit({ runtime: process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node, surface: extraApi?.surface, apiBoundary: extraApi?.boundary, id: workload.id, family: workload.family, status: !error.qualification && /unsupported|unknown.*diagram|invalid.*header|not.*supported|MERMAN_UNSUPPORTED/i.test(String(error)) ? 'unsupported' : 'failed', firstMs: firstMs ?? performance.now() - firstStart, detail: String(error) }) }
  }
  const memory = { rssBytes: process.memoryUsage().rss, peakRssBytes: process.resourceUsage().maxRSS * 1024 }
  for (const close of cleanups.reverse()) await close()
  fs.writeFileSync(job.out, JSON.stringify({ status: 'completed', publicApiAvailable, importMs, runtime: process.versions.bun ? 'Bun ' + process.versions.bun : 'Node ' + process.versions.node, ...memory, diagnosticAdmission, diagnosticAdmissionFailed, parserAdmission, parserAdmissionFailed, rows }))
  progress({ phase: 'done' })
} catch (error) { fs.writeFileSync(job.out, JSON.stringify({ status: 'blocked', publicApiAvailable, detail: String(error), diagnosticAdmission, diagnosticAdmissionFailed, parserAdmission, parserAdmissionFailed, rows })); process.exitCode = 1 }
