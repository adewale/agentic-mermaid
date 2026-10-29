// A fresh public consumer. Target validation is deliberately parent-owned and
// occurs after the fully-consumed milestone; no product source is imported here.
import { readFileSync, writeFileSync, writeSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const marker = '\u0001entry-startup\u0001'
const emit = value => writeSync(1, marker + JSON.stringify(value).replace(/[\u2028\u2029]/g, value => `\\u${value.charCodeAt(0).toString(16)}`) + '\n')
const resource = job.mode === 'resource' || job.mode === 'baseline'
const snapshots = {}
const snapshot = name => { if (resource) snapshots[name] = process.memoryUsage() }
const serializable = (_key, value) => value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : typeof value === 'bigint' ? value.toString() : value
function consume(value) {
  const object = value !== null && typeof value === 'object' && !(value instanceof Uint8Array)
  const keys = ['svg', 'text', 'png', 'ascii', 'output', 'layout']
  const artifactKey = object ? keys.find(key => value[key] !== undefined) : undefined
  const artifact = artifactKey ? value[artifactKey] : value
  const bytes = artifact instanceof Uint8Array ? Buffer.from(artifact) : Buffer.from(typeof artifact === 'string' ? artifact : JSON.stringify(artifact, serializable) ?? '')
  const sidecar = artifactKey ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== artifactKey)) : undefined
  const sidecarJson = sidecar && Object.keys(sidecar).length ? JSON.stringify(sidecar, serializable) : undefined
  const metadata = sidecarJson ? Buffer.from(sidecarJson) : undefined
  globalThis.__entryStartupConsumed = { value, bytes, metadata }
  return { artifact, artifactKey, bytes: bytes.byteLength + (metadata?.byteLength ?? 0), sidecarJson }
}
function availableOperations(api) {
  const operations = []
  const collect = (value, factory) => {
    const names = new Set([...Object.keys(value), ...Object.getOwnPropertyNames(Object.getPrototypeOf(value) ?? {})])
    for (const name of [...names].sort()) {
      if (typeof value[name] !== 'function') continue
      const match = /^renderMermaid(SVG|ASCII|PNG)(WithReceipt|WithMeta)?(Async)?$/.exec(name)
      if (!match) continue
      const format = match[1] === 'SVG' ? 'svg' : match[1] === 'PNG' ? 'png' : 'ascii'
      for (const output of format === 'ascii' ? ['ascii', 'unicode'] : [format]) operations.push({ id: [factory, name, output].filter(Boolean).join(':'), name, format: output, factory: factory ?? null, receipt: match[2] === 'WithReceipt', meta: match[2] === 'WithMeta' })
    }
  }
  collect(api)
  for (const name of ['createMermaidRenderer', 'createMermaidPNGRenderer']) if (typeof api[name] === 'function') collect(api[name](), name)
  if (typeof api.layoutMermaidWithReceipt === 'function') operations.push({ id: 'layoutMermaidWithReceipt:layout', name: 'layoutMermaidWithReceipt', format: 'layout', factory: null, receipt: true })
  if (job.adapter === 'pele') {
    if (typeof api.render === 'function') operations.push({ id: 'render:svg', name: 'render', format: 'svg', factory: null, receipt: false })
    if (typeof api.renderAsync === 'function') operations.push({ id: 'renderAsync:svg', name: 'renderAsync', format: 'svg', factory: null, receipt: false })
  }
  if (!operations.length) for (const name of ['knownStyleDescriptors', 'knownStyles']) if (typeof api[name] === 'function') { operations.push({ id: name + ':json', name, format: 'json', factory: null, receipt: false, discovery: true }); break }
  return operations
}
async function loadTarget() {
  const pkg = JSON.parse(readFileSync(resolve(job.root, 'package.json'), 'utf8'))
  const specifier = pkg.name + (job.exportName === '.' ? '' : job.exportName.slice(1))
  const entry = import.meta.resolve(specifier, pathToFileURL(resolve(job.root, 'package.json')).href)
  const started = performance.now()
  const api = await import(entry)
  return { api, importMs: performance.now() - started, entry }
}
async function initialize(api, operation) {
  let receiver = operation.factory ? api[operation.factory]() : api
  const companionImports = []
  if (job.adapter === 'pele' && job.registrationExport) {
    const pkg = JSON.parse(readFileSync(resolve(job.root, 'package.json'), 'utf8'))
    const publicImport = key => import(import.meta.resolve(pkg.name + key.slice(1), pathToFileURL(resolve(job.root, 'package.json')).href))
    if (job.exportName.startsWith('./diagrams/')) {
      const core = await publicImport('./core')
      core.register(api.default)
      receiver = core
      companionImports.push('./core')
    } else {
      const diagram = await publicImport(job.registrationExport)
      api.register(diagram.default)
      companionImports.push(job.registrationExport)
    }
  }
  if (job.adapter === 'pele' && job.exportName === './lazy' && operation.name === 'render') {
    if (typeof api.load !== 'function' || !await api.load('flowchart')) throw Error('Published lazy renderer cannot load flowchart')
    companionImports.push('public lazy.load(flowchart)')
  }
  if (operation.name !== null && typeof receiver[operation.name] !== 'function') throw Error('Published operation is unavailable: ' + operation.name)
  return { receiver, companionImports }
}
try {
  const began = performance.now()
  snapshot('beforeImport')
  if (job.mode === 'baseline') {
    let value = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text>Start End</text></svg>'
    snapshot('apiReady')
    let consumed = consume(value)
    snapshot('afterConsumed')
    if (typeof globalThis.gc === 'function') globalThis.gc()
    snapshot('outputHeldAfterGc')
    writeFileSync(job.resultFile, JSON.stringify({ protocol: 'entry-startup-v1', mode: job.mode, snapshots, bytes: consumed.bytes }))
    emit({ phase: 'baseline', bytes: consumed.bytes })
    value = undefined; consumed = undefined; globalThis.__entryStartupConsumed = undefined
    if (typeof globalThis.gc === 'function') globalThis.gc()
    snapshot('afterReleaseAfterGc')
    writeFileSync(job.resultFile + '.snapshots.json', JSON.stringify(snapshots))
  } else {
    const target = await loadTarget()
    if (job.mode === 'discover') {
      const operations = availableOperations(target.api)
      // Diagram-only exports expose registration objects rather than source renderers.
      if (job.adapter === 'pele' && job.exportName.startsWith('./diagrams/') && target.api.default?.type) operations.push({ id: 'registered.render:svg', name: 'render', format: 'svg', factory: null, receipt: false })
      emit({ phase: 'discovery', operations, entry: target.entry, diagramType: target.api.default?.type ?? null })
    } else {
      const initialized = await initialize(target.api, job.operation)
      const readyMs = performance.now() - began
      snapshot('apiReady')
      emit({ phase: 'api-ready', importMs: target.importMs, readyMs, entry: target.entry, companionImports: initialized.companionImports })
      const beforeCall = performance.now()
      const options = job.operation.format === 'ascii' || job.operation.format === 'unicode' ? { useAscii: job.operation.format === 'ascii', colorMode: 'none' } : job.operation.format === 'png' ? { scale: 1 } : undefined
      let value = job.operation.name === null ? { exportedNames: Object.keys(target.api).sort() } : await initialized.receiver[job.operation.name](job.operation.discovery ? undefined : job.source, options)
      const apiMs = performance.now() - beforeCall
      const beforeConsume = performance.now()
      let consumed = consume(value)
      const consumeMs = performance.now() - beforeConsume
      snapshot('afterConsumed')
      emit({ phase: 'first-consumed', importMs: target.importMs, readyMs, apiMs, consumeMs, bytes: consumed.bytes, entry: target.entry })
      let artifact = consumed.artifact instanceof Uint8Array ? { binaryBase64: Buffer.from(consumed.artifact).toString('base64') } : { artifact: consumed.artifact }
      if (typeof globalThis.gc === 'function' && resource) globalThis.gc()
      snapshot('outputHeldAfterGc')
      writeFileSync(job.resultFile, JSON.stringify({ protocol: 'entry-startup-v1', mode: job.mode, operation: job.operation, ...artifact, sidecarJson: consumed.sidecarJson ?? null, snapshots, importMs: target.importMs, readyMs, apiMs, consumeMs, bytes: consumed.bytes, entry: target.entry, companionImports: initialized.companionImports }, serializable))
      if (resource) {
        value = undefined; consumed = undefined; artifact = undefined; globalThis.__entryStartupConsumed = undefined
        if (typeof globalThis.gc === 'function') globalThis.gc()
        snapshot('afterReleaseAfterGc')
        writeFileSync(job.resultFile + '.snapshots.json', JSON.stringify(snapshots))
      }
    }
  }
} catch (error) {
  emit({ phase: 'failed', error: String(error) })
  process.exitCode = 1
}
// Let queued work drain naturally. A first artifact does not excuse a later
// rejected task, nonzero exit, or leaked handle (bounded by the parent timeout).
