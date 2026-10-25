import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'

const marker = '\u0001entry-startup\u0001'
const errorDetails = error => ({ name: error?.name ?? 'Error', code: error?.code ?? null, message: String(error?.message ?? error) })

/** A backend/driver fault is never evidence that a negative source was rejected. */
export function classifyParserThrow(error, adapter, PeleError) {
  const detail = errorDetails(error)
  let grammar = false, unsupported = false
  if (!(error instanceof TypeError || error instanceof ReferenceError || error instanceof RangeError)) {
    if (adapter === 'pele') {
      grammar = typeof PeleError === 'function' && error instanceof PeleError && ['syntax', 'semantic'].includes(error.code)
      unsupported = typeof PeleError === 'function' && error instanceof PeleError && error.code === 'unsupported-diagram'
    } else if (adapter === 'mermaid') {
      unsupported = error?.name === 'UnknownDiagramError'
      grammar = /^(?:Parse error on line|Lexical error on line|Parsing failed:)/.test(detail.message)
    }
  }
  return { publicAccepted: grammar || unsupported ? false : null, accepted: grammar || unsupported ? false : null, syntaxRejected: grammar, unsupported, preserved: false, actualType: null, unavailable: grammar || unsupported ? null : `Public parser exception did not establish grammar rejection: ${detail.name}: ${detail.message}`, error: detail }
}

export function classifyParserReturn(value, adapter) {
  const base = { publicAccepted: true, accepted: true, syntaxRejected: false, unsupported: false, preserved: false, actualType: null, unavailable: null, error: null }
  if (adapter === 'agentic') {
    if (value?.ok === true && value.value?.body?.kind === 'preserved') return { ...base, accepted: null, preserved: true, unsupported: true, actualType: value.value.kind, preservationReason: 'Public preservation envelope is not native grammar admission' }
    if (value?.ok === true && typeof value.value?.kind === 'string') return { ...base, actualType: value.value.kind }
    if (value?.ok === false && Array.isArray(value.error) && value.error.length) {
      const error = { name: 'PublicParseErrorResult', code: value.error.map(error => error.code).join(','), message: value.error.map(error => error.message).join('; '), errors: value.error }
      if (value.error.every(error => typeof error.code === 'string' && /(?:PARSE_ERROR|PARSE_FAILED|SYNTAX_ERROR|INVALID_FRONTMATTER|CONFIG_REJECTED)$/.test(error.code))) return { ...base, publicAccepted: false, accepted: false, syntaxRejected: true, error }
      return { ...base, publicAccepted: null, accepted: null, unavailable: 'Public error result is outside the reviewed grammar-rejection contract', error }
    }
  } else if (adapter === 'mermaid') {
    if (value === false) return { ...base, publicAccepted: false, accepted: false, syntaxRejected: true }
    if (typeof value?.diagramType === 'string') return { ...base, actualType: value.diagramType }
  } else if (adapter === 'pele' && typeof value?.type === 'string') return { ...base, actualType: value.mermaidType ?? value.type }
  return { ...base, publicAccepted: null, accepted: null, unavailable: 'Public parser returned an unrecognized result/error envelope' }
}

function consume(value) {
  const json = JSON.stringify(value, (_key, item) => item instanceof Map ? [...item] : item instanceof Set ? [...item] : typeof item === 'bigint' ? String(item) : item)
  if (typeof json !== 'string') throw Error('Public parser return could not be completely JSON-consumed')
  return Buffer.from(json)
}

export async function runParserWorker(job) {
  assertBenchmarkExecutionAllowed()
  const timed = job.mode !== 'functional'
  const began = timed ? performance.now() : 0
  const snapshots = {}
  const snapshot = name => { if (job.mode === 'resource') snapshots[name] = process.memoryUsage() }
  const emit = value => process.stdout.write(marker + JSON.stringify(value) + '\n')
  if (job.mode === 'resource' && typeof globalThis.gc !== 'function') throw Error('Fresh resource worker requires --expose-gc')
  if (job.mode === 'resource') globalThis.gc()
  snapshot('beforeImport')
  const target = job.target
  const pkgFile = join(target.root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  if (pkg.name !== target.packageName || pkg.version !== target.version) throw Error('Parser target package/version differs from admitted artifact')
  const entry = fileURLToPath(import.meta.resolve(target.specifier, pathToFileURL(pkgFile).href))
  if (realpathSync(entry) !== realpathSync(target.entry)) throw Error('Actual public parser export differs from admitted entry')
  let dom
  if (target.adapter === 'mermaid') {
    const require = createRequire(join(target.referenceRoot, 'package.json'))
    const { JSDOM } = require('jsdom')
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  }
  const api = await import(pathToFileURL(entry).href)
  const receiver = target.adapter === 'mermaid' ? api.default : api
  if (target.adapter === 'mermaid') receiver.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' })
  const parse = target.adapter === 'agentic' ? receiver.parseRegisteredMermaid : receiver.parse
  if (typeof parse !== 'function') throw Error('Admitted public parser method is unavailable')
  snapshot('apiReady')
  if (timed) emit({ phase: 'api-ready', readyMs: performance.now() - began, entry, hostAdapter: target.hostAdapter })
  async function call(source) {
    let value, failure
    const started = timed ? performance.now() : 0
    try { value = await parse.call(receiver, source) } catch (error) { failure = error }
    const publicApiMs = timed ? performance.now() - started : undefined
    const observed = failure ? classifyParserThrow(failure, target.adapter, receiver.PeleError) : classifyParserReturn(value, target.adapter)
    let consumed
    try { consumed = consume(failure ? errorDetails(failure) : value) } catch (error) { observed.accepted = null; observed.publicAccepted = null; observed.unavailable = 'Parser result consumption failed: ' + String(error); observed.syntaxRejected = false; consumed = consume(errorDetails(error)) }
    return { value, consumed, observed, publicApiMs }
  }
  const results = []
  try {
    for (const input of job.cases) {
      const prelude = []
      for (const prior of input.prelude ?? []) {
        const previous = await call(prior.source)
        prelude.push({ expectedAccepted: prior.accept, ...previous.observed })
      }
      const current = await call(input.source)
      globalThis.__parserBaselineHeld = current
      snapshot('afterConsumed')
      const outputBytes = current.consumed.length
      if (timed) emit({ phase: 'first-consumed', publicApiMs: current.publicApiMs, bytes: outputBytes })
      if (job.mode === 'resource') {
        globalThis.gc()
        snapshot('outputHeldAfterGc')
      }
      if (job.consumedFile) writeFileSync(job.consumedFile, current.consumed)
      const actual = current.observed
      current.value = undefined
      current.consumed = undefined
      globalThis.__parserBaselineHeld = undefined
      if (job.mode === 'resource') {
        globalThis.gc()
        snapshot('afterReleaseAfterGc')
      }
      // Expected-value checks run after resource snapshots; never inside an API clock.
      const expectedTypeMatches = actual.accepted === true && input.expectedTypes.includes(actual.actualType)
      const preludeMatches = prelude.every(row => row.accepted === row.expectedAccepted && !row.unavailable)
      const matched = input.expectedAccepted ? actual.accepted === true && expectedTypeMatches : actual.publicAccepted === false && (actual.syntaxRejected || actual.unsupported)
      const status = actual.preserved || input.expectedAccepted && actual.unsupported ? 'unsupported' : actual.unavailable || !preludeMatches ? 'blocked' : matched ? 'passed' : 'failed'
      const scopeNote = target.adapter === 'agentic' && !input.expectedAccepted && actual.publicAccepted === true && !actual.preserved ? 'Native-parse acceptance divergence from this strict negative criterion; Agentic deliberately reads generously. Separate verify warnings are not invoked or timed here; this does not by itself establish a product parser bug.' : null
      results.push({ uniqueId: input.uniqueId, ...actual, expectedTypeMatches, preludeMatches, expectedAccepted: input.expectedAccepted, outputBytes, publicApiMs: current.publicApiMs, status, scopeNote, prelude })
    }
    const result = { protocol: 'node-public-parser-baseline-v1', target, mode: job.mode, results, snapshots, gcAvailable: typeof globalThis.gc === 'function', runtime: { executable: process.execPath, versions: process.versions }, scope: 'Whole public syntax-admission workflow; Agentic rich typed/source model, Pele parser model and Mermaid validation/type output have unequal return scopes. Mermaid includes its required jsdom setup; not a bare-Node or full-AST-equivalence claim.' }
    writeFileSync(job.resultFile, JSON.stringify(result, null, 2) + '\n')
    return result
  } finally { dom?.window.close() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runParserWorker(JSON.parse(readFileSync(process.argv[2], 'utf8'))) }
  catch (error) { process.stdout.write(marker + JSON.stringify({ phase: 'failed', error: errorDetails(error) }) + '\n'); process.exitCode = 1 }
}
