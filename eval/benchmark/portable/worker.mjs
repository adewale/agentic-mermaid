import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { qualifyPortable } from './fidelity.ts'
import { assertBenchmarkExecutionAllowed } from './ci-policy.ts'

assertBenchmarkExecutionAllowed()

// Kept deliberately independent of Agentic source and the parent harness runtime.
const transport = process.argv[2]
const job = transport === '--ipc' ? await new Promise(resolve => process.once('message', message => { if (message?.phase !== 'job') throw Error('Invalid worker job message'); resolve(message.job) })) : transport === '--stdio' ? JSON.parse(readFileSync(0, 'utf8')) : JSON.parse(readFileSync(transport, 'utf8'))
const started = process.hrtime.bigint()
const clock = () => Number(process.hrtime.bigint()) / 1e6
const runtime = { executable: process.execPath, node: process.versions.node, platform: process.platform, arch: process.arch }
const result = { protocol: 'portable-svg-processes-v2', caseId: job.testCase.id, family: job.testCase.family, mode: job.mode, round: job.round, replica: job.replica, sample: job.sample, status: 'blocked', importMs: 0, tracks: {}, iterations: {}, outputBytes: 0, qualification: null, prelude: [], runtime }
const errorText = error => error instanceof Error ? String(error.stack ?? error) : String(error)
const thenable = value => value && typeof value.then === 'function'
function collect() { if (global.gc) { global.gc(); global.gc() } }
try {
  const module = await import(pathToFileURL(job.artifact.entry).href)
  const api = module.default && typeof module.default === 'object' ? { ...module.default, ...module } : module
  const rendering = job.artifact.adapter === 'agentic' ? api.renderMermaidSVG : job.artifact.adapter === 'beautiful' ? api.renderMermaidSVG ?? api.renderMermaidSync ?? api.renderMermaid : api.render
  if (typeof rendering !== 'function') throw Error('Declared public SVG renderer is unavailable')
  result.importMs = Number(process.hrtime.bigint() - started) / 1e6
  // Parent starts first-use calls only after every prepared process is idle.
  // Import preparation is concurrent; every measured render remains serial.
  if (job.mode === 'cold' && process.send) {
    process.send({ phase: 'ready' })
    await new Promise(resolve => process.once('message', message => { if (message?.phase !== 'start') throw Error('Invalid first-use barrier message'); resolve() }))
  }
  const invoke = async (source, options, recordWindow = false) => {
    let value, error, bytes = 0
    const invocationOptions = options === undefined ? undefined : structuredClone(options)
    const begin = clock()
    const startNs = recordWindow ? process.hrtime.bigint().toString() : undefined
    try {
      value = rendering(source, invocationOptions)
      if (thenable(value)) value = await value
      const svg = typeof value === 'string' ? value : value?.svg
      if (typeof svg !== 'string') throw Error('Public renderer did not return SVG text')
      bytes = Buffer.byteLength(svg, 'utf8')
    } catch (caught) { error = errorText(caught) }
    const elapsedMs = clock() - begin
    if (recordWindow) result.apiWindow = { startNs, endNs: process.hrtime.bigint().toString() }
    return { value, error, bytes, elapsedMs }
  }
  const testCase = job.testCase
  const admitted = []
  const inspect = async (rendered, expectedCase, source) => {
    const svg = typeof rendered.value === 'string' ? rendered.value : rendered.value?.svg
    const previous = typeof svg === 'string' && admitted.find(item => item.expected === expectedCase.expected && item.svg === svg)
    if (previous) return previous.qualification
    let model
    if (!rendered.error && typeof api.parse === 'function') { try { model = api.parse(source); if (thenable(model)) model = await model } catch {} }
    const qualification = qualifyPortable(expectedCase, { svg, model, error: rendered.error, adapter: job.artifact.adapter })
    if (qualification.checks.some(check => check.status === 'failed')) {
      result.status = 'failed'; result.error ??= 'A consumed SVG return failed its declared checks'; result.qualification = qualification
    } else if (typeof svg === 'string') {
      admitted.push({ expected: expectedCase.expected, svg, qualification })
      if (admitted.length > 4) admitted.shift()
    }
    return qualification
  }
  for (const prelude of testCase.prelude ?? []) {
    const rendered = await invoke(prelude.source, undefined)
    const actualAccepted = !rendered.error
    result.prelude.push({ source: prelude.source, expectedAccepted: prelude.accept, actualAccepted, passed: prelude.accept === actualAccepted })
  }
  let retained
  if (job.mode === 'baseline') {
    collect()
    const before = process.memoryUsage()
    collect()
    result.memory = { before, atReturn: process.memoryUsage(), afterGc: process.memoryUsage(), gcAvailable: !!global.gc }
    result.status = 'passed'
  } else if (job.mode === 'memory') {
    collect()
    const before = process.memoryUsage()
    let memoryCall = await invoke(testCase.source, testCase.renderOptions)
    const atReturn = process.memoryUsage()
    result.outputBytes = memoryCall.bytes
    if ((!memoryCall.error) !== testCase.expected.accept) { result.status = 'failed'; result.error = `Memory-measured invocation changed acceptance: ${memoryCall.error ?? 'unexpected success'}` }
    memoryCall.value = null
    memoryCall = null
    collect()
    result.memory = { before, atReturn, afterGc: process.memoryUsage(), gcAvailable: !!global.gc }
    // Qualification allocations occur after all API memory snapshots.
    retained = await invoke(testCase.source, testCase.renderOptions)
  } else if (job.mode === 'retention') {
    collect()
    result.retention = [{ calls: 0, snapshot: process.memoryUsage() }]
    for (let count = 1; count <= 1000; count++) {
      let rendered = await invoke(`${testCase.source}\n%% retention-source-${count}`, testCase.renderOptions)
      if ((!rendered.error) !== testCase.expected.accept) { result.status = 'failed'; result.error ??= `Retention invocation${count} changed acceptance: ${rendered.error ?? 'unexpected success'}` }
      rendered.value = null
      rendered = null
      if ([10, 100, 1000].includes(count)) { collect(); result.retention.push({ calls: count, snapshot: process.memoryUsage() }) }
    }
    retained = await invoke(testCase.source, testCase.renderOptions)
  } else if (job.mode === 'cold') {
    retained = await invoke(testCase.source, testCase.renderOptions, true)
    result.tracks['first-use'] = [retained.elapsedMs]
  } else {
    // Warmup and qualification never enter the recorded API clocks.
    retained = await invoke(testCase.source, testCase.renderOptions)
    await inspect(retained, testCase, testCase.source)
    for (const track of ['warm-repeat', 'warm-new-source', ...(testCase.edit ? ['warm-label-edit'] : [])]) {
      const samples = []
      const iterations = []
      let lastSource = testCase.source
      let invocation = 0
      for (let index = 0; index < job.samples; index++) {
        let elapsed = 0, calls = 0
        do {
          const edited = track === 'warm-label-edit' && invocation % 2 === 1
          const source = track === 'warm-new-source' ? `${testCase.source}\n%% portable-source-${job.round}-${invocation}` : edited ? testCase.edit.source : testCase.source
          const options = edited ? testCase.edit.renderOptions ?? testCase.renderOptions : testCase.renderOptions
          const current = await invoke(source, options)
          if ((!current.error) !== testCase.expected.accept) { result.status = 'failed'; result.error = 'Acceptance changed during the measured track' }
          const expectedCase = edited ? { ...testCase, source, expected: testCase.edit.expected, renderOptions: testCase.edit.renderOptions ?? testCase.renderOptions } : { ...testCase, source }
          await inspect(current, expectedCase, source)
          lastSource = source
          elapsed += current.elapsedMs
          calls++; invocation++
          retained = current
        } while (elapsed < (job.minSampleMs ?? 2) && calls < 256)
        samples.push(elapsed / calls)
        iterations.push(calls)
      }
      result.tracks[track] = samples
      result.iterations[track] = iterations
      // Validate the actual last return from each track, outside its clock.
      const edited = track === 'warm-label-edit' && (invocation - 1) % 2 === 1
      const expectedCase = edited ? { ...testCase, source: lastSource, expected: testCase.edit.expected, renderOptions: testCase.edit.renderOptions ?? testCase.renderOptions } : { ...testCase, source: lastSource }
      const checked = await inspect(retained, expectedCase, expectedCase.source)
      if (checked.checks.some(check => check.status === 'failed')) { result.status = 'failed'; result.error = `${track}: declared output checks failed`; result.qualification = checked }
    }
    // Ensure the edited output is checked even when an odd sample count ends on seed.
    if (testCase.edit) {
      const rendered = await invoke(testCase.edit.source, testCase.edit.renderOptions ?? testCase.renderOptions)
      let model
      if (!rendered.error && typeof api.parse === 'function') { try { model = api.parse(testCase.edit.source); if (thenable(model)) model = await model } catch {} }
      const checked = qualifyPortable({ ...testCase, source: testCase.edit.source, expected: testCase.edit.expected, renderOptions: testCase.edit.renderOptions ?? testCase.renderOptions }, { svg: typeof rendered.value === 'string' ? rendered.value : rendered.value?.svg, model, error: rendered.error, adapter: job.artifact.adapter })
      if (checked.checks.some(check => check.status === 'failed')) { result.status = 'failed'; result.error = 'Edited output failed declared checks'; result.qualification = checked }
    }
    retained = await invoke(testCase.source, testCase.renderOptions)
  }
  if (retained) {
    if (retained.error) result.error ??= retained.error
    if (job.mode !== 'memory') result.outputBytes = retained.bytes
    let model
    if (!retained.error && typeof api.parse === 'function') { try { model = api.parse(testCase.source); if (thenable(model)) model = await model } catch {} }
    const svg = typeof retained.value === 'string' ? retained.value : retained.value?.svg
    const qualification = qualifyPortable(testCase, { svg, model, error: retained.error, adapter: job.artifact.adapter })
    result.qualification ??= qualification
    if (result.status !== 'failed') result.status = qualification.checks.some(check => check.status === 'failed') || !result.prelude.every(item => item.passed) ? 'failed' : qualification.passed ? 'passed' : 'partial'
    if (job.svgFile && typeof svg === 'string') writeFileSync(job.svgFile, svg, { flag: 'wx' })
  }
} catch (error) {
  result.status = 'blocked'
  result.error = errorText(error)
}
if (result.prelude.some(item => !item.passed)) { result.status = 'failed'; result.error ??= 'A declared prelude changed acceptance' }
if (result.qualification && !result.qualification.checks.some(check => check.status === 'failed') && !job.fullEvidence) {
  result.qualification.checks = result.qualification.checks.map(check => ({ ...check, expected: null, actual: null }))
  result.qualification.unmeasuredScopes.push('Repeated passing check payloads omitted; authored expectations and representative SVG/model evidence are retained with the run. Failed checks retain their full payloads.')
}
process.exitCode = result.status === 'blocked' ? 2 : 0
if (transport === '--ipc') { process.send({ phase: 'result', result }, error => { if (error) process.exitCode = 1; if (process.connected) process.disconnect() }) }
else if (transport === '--stdio') writeFileSync(3, JSON.stringify(result) + '\n')
else writeFileSync(job.resultFile, JSON.stringify(result) + '\n', { flag: 'wx' })
