import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'

export class ProjectionUnavailable extends Error {}
export class TargetParseRejection extends Error {}
/** Backend absence and resource limits do not validate invalid Mermaid syntax. */
export function classifyPeleParseFailure(error, PeleError) {
  if (typeof PeleError === 'function' && error instanceof PeleError && ['syntax', 'semantic'].includes(error.code)) return { accepted: false, error: String(error.message), errorCode: error.code }
  return { unavailable: `Public parser did not establish a syntax/semantic rejection (${error?.code ?? error?.name ?? 'unknown'}): ${error?.message ?? error}`, errorCode: error?.code ?? null }
}
class PrepareSource extends Error {}
const arraySubset = Symbol('arraySubset')
const shapes = ['default', 'rounded', 'rect', 'circle', 'cloud', 'bang', 'hexagon']
const commitTypes = ['NORMAL', 'REVERSE', 'HIGHLIGHT', 'MERGE', 'CHERRY_PICK']
const plain = value => Array.isArray(value) ? Array.from(value, plain) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)])) : value

/** Project observed public model facts, never the expected assertion values. */
export function publicDatabaseView(engine, model, family) {
  if (family === 'mindmap') {
    if (engine !== 'agentic') return { getMindmap: () => model.root ?? model.nodes?.find(node => node.isRoot) }
    const visit = node => ({ nodeId: node.id, descr: node.label, type: shapes.indexOf(node.shape), children: node.children.map(visit), ...(node.icon ? { icon: node.icon } : {}), ...(node.className ? { class: node.className } : {}) })
    return { getMindmap: () => visit(model.root) }
  }
  if (engine === 'mermaid') return model
  if (engine === 'pele') return {
    getCommits: () => model.commits,
    getBranches: () => model.branches,
    getBranchesAsObjArray: () => model.lanes.map(name => ({ name })),
    getCurrentBranch: () => model.currentBranch,
    getHead: () => model.head,
    getDirection: () => model.direction,
    getAccTitle: () => model.accTitle ?? '',
    getAccDescription: () => model.accDescr ?? '',
  }
  const commits = new Map(model.commits.map(commit => [commit.id, { ...commit, seq: commit.sequence, type: commitTypes.indexOf(commit.type), ...(commit.customType ? { customType: commitTypes.indexOf(commit.customType) } : {}), message: commit.message ?? '' }]))
  let branch = model.mainBranchName
  for (const statement of model.statements) if (statement.kind === 'branch') branch = statement.name; else if (statement.kind === 'checkout') branch = statement.branch
  return {
    getCommits: () => commits,
    getBranches: () => new Map(model.branches.map(entry => [entry.name, entry.head ?? null])),
    getBranchesAsObjArray: () => [...model.branches].sort((a, b) => a.order - b.order).map(entry => ({ name: entry.name })),
    getCurrentBranch: () => branch,
    getHead: () => commits.get(model.branches.find(entry => entry.name === branch)?.head),
    getDirection: () => model.direction,
    getAccTitle: () => model.accessibilityTitle ?? '',
    getAccDescription: () => model.accessibilityDescription ?? '',
  }
}

/** Execute the original callbacks. Adapter exceptions cannot satisfy negatives.
 * Async public parser results are prepared before the synchronous DB facade is
 * replayed; neither preparation nor assertions are an API latency benchmark. */
export async function executeUpstreamSpecs(files, parse) {
  const tests = [], groups = [], rows = [], publicSources = []
  let state, prepared = new Map()
  const unavailable = reason => { state?.unavailable.push(reason); throw new ProjectionUnavailable(reason) }
  const db = new Proxy({}, { get(_target, name) {
    if (name === 'clear') return () => { if (state) state.view = undefined }
    if (name === 'nodeType') return Object.fromEntries(['DEFAULT', 'ROUNDED_RECT', 'RECT', 'CIRCLE', 'CLOUD', 'BANG', 'HEXAGON'].map((key, index) => [key, index]))
    if (name === 'getConfig') return unavailable('Private Mermaid configuration DB accessor is outside the public-model adapter')
    if (name === 'prettyPrint') return () => { state.diagnostics.push('Upstream prettyPrint diagnostic is not an asserted public contract') }
    if (typeof state?.view?.[name] === 'function') return state.view[name]
    return unavailable(`Public model cannot project upstream DB method ${String(name)}`)
  } })
  const parser = { yy: db, parse(source) {
    state.requests++
    state.sources.add(source)
    if (!prepared.has(source)) { state.pending.add(source); throw new PrepareSource('Public result requires preparation') }
    const result = prepared.get(source)
    if (result.unavailable) return unavailable(result.unavailable)
    if (!result.accepted) {
      state.rejections++
      const error = new TargetParseRejection(result.error)
      if (state.family === 'gitgraph') return Promise.reject(error)
      throw error
    }
    state.view = result.view
    if (state.family === 'gitgraph') return Promise.resolve()
  } }
  const equal = (actual, expected) => expected?.[arraySubset] ? expected[arraySubset].every(entry => Array.isArray(actual) && actual.some(value => { try { assert.deepStrictEqual(plain(value), plain(entry)); return true } catch { return false } })) : (() => { try { assert.deepStrictEqual(plain(actual), plain(expected)); return true } catch { return false } })()
  const expectation = (actual, invert = false) => {
    const check = (passed, matcher, expected, observed = actual) => {
      state.assertions.push({ matcher, negated: invert, actual: plain(observed), expected: plain(expected), passed: invert ? !passed : passed })
      assert.ok(invert ? !passed : passed, `${invert ? 'not.' : ''}${matcher}: expected ${JSON.stringify(plain(expected))}, observed ${JSON.stringify(plain(observed))}`)
    }
    const thrown = (error, expected) => {
      if (error instanceof PrepareSource || error instanceof ProjectionUnavailable) throw error
      // Missing methods, TypeErrors and bridge bugs are not target rejections.
      if (error && !(error instanceof TargetParseRejection)) return unavailable(`Non-target exception inside expected rejection: ${error.message ?? error}`)
      const matches = !!error && (expected === undefined || typeof expected === 'string' && error.message.includes(expected) || Object.prototype.toString.call(expected) === '[object RegExp]' && expected.test(error.message))
      check(matches, 'toThrow', expected, error?.message ?? '<no target rejection>')
    }
    return {
      get not() { return expectation(actual, !invert) },
      get rejects() { return { async toThrow(expected) { let error; try { await actual } catch (caught) { error = caught } thrown(error, expected) } } },
      toBe(expected) { check(Object.is(actual, expected), 'toBe', expected) },
      toEqual(expected) { check(equal(actual, expected), 'toEqual', expected) },
      toStrictEqual(expected) { check(equal(actual, expected), 'toStrictEqual', expected) },
      toBeNull() { check(actual === null, 'toBeNull', null) },
      toBeDefined() { check(actual !== undefined, 'toBeDefined', '<defined>') },
      toHaveLength(expected) { check(actual?.length === expected, 'toHaveLength', expected) },
      toHaveProperty(expected) { check(actual != null && expected in actual, 'toHaveProperty', expected) },
      toThrow(expected) { let error; try { actual() } catch (caught) { error = caught } thrown(error, expected) },
    }
  }
  expectation.arrayContaining = entries => ({ [arraySubset]: entries })
  for (const file of files) {
    const register = (name, callback, skipped = false) => tests.push({ family: file.family, path: file.path, name, callback, skipped, hooks: groups.flatMap(group => group.hooks) })
    const it = (name, callback) => register(name, callback)
    it.skip = (name, callback) => register(name, callback, true)
    const describe = (_name, callback) => { groups.push({ hooks: [] }); callback(); groups.pop() }
    const hooks = callback => groups.at(-1).hooks.push(callback)
    const context = vm.createContext({ describe, it, test: it, beforeEach: hooks, expect: expectation, console: { log() {} }, vi: { spyOn() { return unavailable('Private upstream logger spy is outside the public API adapter') } }, exports: {}, require(id) {
      if (/mindmap\.jison$/.test(id)) return { parser }
      if (/mindmapDb\.js$/.test(id)) return { MindmapDB: class { constructor() { return db } } }
      if (/diagramAPI\.js$/.test(id)) return { setLogLevel() {} }
      if (/gitGraphAst\.js$/.test(id)) return { db }
      if (/gitGraphParser\.js$/.test(id)) return { parser }
      if (/logger\.js$/.test(id)) return { log: {} }
      throw new ProjectionUnavailable(`Unreviewed upstream import ${id}`)
    } })
    vm.runInContext(ts.transpileModule(file.text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context, { filename: file.path })
  }
  for (const test of tests) {
    if (test.skipped) { rows.push({ family: test.family, path: test.path, name: test.name, status: 'skipped-upstream', assertions: [], sources: [] }); continue }
    prepared = new Map()
    let result, replayCount = 0
    for (let attempt = 0; attempt < 100; attempt++) {
      state = { family: test.family, view: undefined, pending: new Set(), sources: new Set(), unavailable: [], diagnostics: [], assertions: [], rejections: 0, requests: 0 }
      // The yy assignment in upstream beforeEach is a private dependency-injection
      // step. Route it to the reviewed public-model facade, never a fake parser.
      Object.defineProperty(parser, 'yy', { configurable: true, get: () => db, set() {} })
      let error
      try { for (const hook of test.hooks) await hook(); await test.callback() } catch (caught) { error = caught }
      if (state.pending.size) {
        replayCount++
        for (const source of state.pending) { try { prepared.set(source, await parse(source, test.family)) } catch (caught) { prepared.set(source, { unavailable: `Public parser preparation failed: ${caught.message ?? caught}` }) } }
        continue
      }
      result = { family: test.family, path: test.path, name: test.name, status: state.unavailable.length ? 'unavailable' : error ? 'failed' : state.assertions.length ? 'passed' : 'unavailable', assertions: state.assertions, sources: [...state.sources], requestedParseCalls: state.requests, preparedParseCalls: prepared.size, preparationReplays: replayCount, targetRejections: state.rejections, unavailable: state.unavailable, diagnostics: state.diagnostics, ...(error ? { error: String(error.message ?? error) } : {}) }
      break
    }
    rows.push(result ?? { family: test.family, path: test.path, name: test.name, status: 'unavailable', error: 'Public source preparation did not converge', assertions: [], sources: [] })
    publicSources.push(...[...prepared].map(([source, value]) => ({ caseName: test.name, family: test.family, source, accepted: value.accepted ?? null, error: value.error ?? value.unavailable ?? null, errorCode: value.errorCode ?? null, timing: value.timing ?? null })))
  }
  return { callbacks: rows, publicSources }
}
