import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyPeleParseFailure, executeUpstreamSpecs, publicDatabaseView } from './upstream-test-assertions.mjs'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'

assertBenchmarkExecutionAllowed()
const started = performance.now()
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
let parse, initialized, artifact
const message = error => String(error?.message ?? error).slice(0, 5000)
try {
  if (job.engine === 'mermaid') {
    const require = createRequire(resolve(job.artifactRoot, 'package.json'))
    const entry = require.resolve('mermaid'), manifest = JSON.parse(readFileSync(require.resolve('mermaid/package.json'), 'utf8'))
    artifact = { root: job.artifactRoot, name: manifest.name, version: manifest.version, entry, entrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), scope: 'Entry receipt; retained-suite wrapper separately binds full installed dependency closure' }
    const { JSDOM } = require('jsdom'), dom = new JSDOM('<!doctype html><html><body></body></html>')
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'SVGElement', 'Element', 'Node', 'Option']) Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
    const { default: mermaid } = await import(pathToFileURL(require.resolve('mermaid')).href)
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' })
    parse = async (source, family, project = true) => {
      let accepted, error, firstMs
      const clock = performance.now()
      try { accepted = await mermaid.parse(source) !== false } catch (caught) { if (caught instanceof TypeError || caught instanceof ReferenceError) return { unavailable: `Unexpected public parser exception: ${message(caught)}` }; error = message(caught); accepted = false }
      firstMs = performance.now() - clock
      const timing = { publicApiMs: firstMs, calls: 1, boundary: 'await mermaid.parse(source), including rejection; single process, uncalibrated diagnostic; DB acquisition/assertions excluded' }
      if (!accepted) return { accepted: false, error, timing }
      if (!project) return { accepted: true, timing }
      try {
        const diagram = await mermaid.mermaidAPI.getDiagramFromText(source)
        const db = diagram.db
        const view = family === 'mindmap' ? { root: structuredClone(db.getMindmap()) } : Object.fromEntries(['getCommits', 'getBranches', 'getBranchesAsObjArray', 'getCurrentBranch', 'getHead', 'getDirection', 'getAccTitle', 'getAccDescription'].filter(name => typeof db[name] === 'function').map(name => { const observed = structuredClone(db[name]()); return [name, () => structuredClone(observed)] }))
        return { accepted: true, view: publicDatabaseView('mermaid', view, family), timing: { ...timing, projectionApiCalls: 1, projectionBoundary: 'additional mermaidAPI.getDiagramFromText acquisition, outside public parse clock' } }
      } catch (caught) { return { accepted: true, unavailable: `Public DB projection unavailable: ${message(caught)}`, timing } }
    }
  } else {
    const entry = resolve(job.artifactRoot, job.engine === 'agentic' ? 'dist/agent-core.js' : 'dist/pele.js'), manifest = JSON.parse(readFileSync(resolve(job.artifactRoot, 'package.json'), 'utf8'))
    artifact = { root: job.artifactRoot, name: manifest.name, version: manifest.version, entry, entrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), scope: 'Entry receipt; retained-suite wrapper separately binds full installed dependency closure' }
    const api = await import(pathToFileURL(entry).href)
    const method = job.engine === 'agentic' ? api.parseRegisteredMermaid : api.parse
    if (typeof method !== 'function') throw new Error('Actual artifact has no requested public parser')
    parse = async (source, family, project = true) => {
      let result, error, errorCode
      const clock = performance.now()
      try { result = method(source); if (result?.then) result = await result } catch (caught) {
        if (job.engine !== 'pele') return { unavailable: `Unexpected public parser exception: ${message(caught)}` }
        const failure = classifyPeleParseFailure(caught, api.PeleError)
        if (failure.unavailable) return failure
        error = failure.error
        errorCode = failure.errorCode
      }
      const timing = { publicApiMs: performance.now() - clock, calls: 1, boundary: `${job.engine === 'agentic' ? 'parseRegisteredMermaid' : 'parse'}(source), including rejection; single process, uncalibrated diagnostic; projection/assertions excluded` }
      if (error) return { accepted: false, error, errorCode, timing }
      if (job.engine === 'agentic' && !result.ok) return { accepted: false, error: result.error.map(entry => entry.message).join('; '), timing }
      if (!project) return { accepted: true, timing }
      const model = job.engine === 'agentic' ? result.value.body : result
      if (!model || job.engine === 'agentic' && model.kind !== family) return { accepted: true, unavailable: 'Public parser did not expose the requested native model', timing }
      try { return { accepted: true, view: publicDatabaseView(job.engine, model, family), timing } } catch (caught) { return { accepted: true, unavailable: `Public model projection unavailable: ${message(caught)}`, timing } }
    }
  }
  initialized = performance.now()
  const files = job.files.map(file => ({ ...file, text: readFileSync(file.path, 'utf8') }))
  const result = await executeUpstreamSpecs(files, parse)
  const assertionWorkflowMs = performance.now() - initialized
  const replay = []
  for (const input of job.replaySources ?? []) {
    const observed = await parse(input.source, input.family, false)
    replay.push({ id: input.id, family: input.family, accepted: observed.accepted ?? null, error: observed.error ?? null, errorCode: observed.errorCode ?? null, unavailable: observed.unavailable ?? null, timing: observed.timing ?? null })
  }
  writeFileSync(job.output, JSON.stringify({ engine: job.engine, invocationId: job.invocationId, artifact, ...result, replay, workflow: { workerWallMs: performance.now() - started, initializationMs: initialized - started, assertionWorkflowMs, boundary: 'worker-body time excludes Node/static harness imports, includes target import, public preparation, DB projection, facade replays, original assertions and optional literal replay; parent full-process wall includes startup; neither is original upstream-runner time or an engine speed rank' } }, null, 2))
} catch (error) {
  writeFileSync(job.output, JSON.stringify({ engine: job.engine, invocationId: job.invocationId, blocked: message(error), workflow: { workerWallMs: performance.now() - started } }, null, 2))
  process.exitCode = 2
}
