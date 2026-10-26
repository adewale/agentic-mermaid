import assert from 'node:assert/strict'
import vm from 'node:vm'
import ts from 'typescript'

export class UpstreamCapabilityUnavailable extends Error {}
class PreparePublicSource extends Error {}
class PublicSourceRejection extends Error {}
const asymmetric = Symbol('asymmetric')
const missingCapability = Symbol('missingCapability')
const plain = value => {
  const tag = Object.prototype.toString.call(value)
  if (tag === '[object Map]') return { map: [...value].map(([key, item]) => [plain(key), plain(item)]) }
  if (tag === '[object Set]') return { set: [...value].map(plain) }
  if (tag === '[object RegExp]') return { regexp: value.source, flags: value.flags }
  if (tag === '[object Date]') return { date: Number.isNaN(value.getTime()) ? '<invalid-date>' : value.toISOString() }
  return Array.isArray(value) ? Array.from(value, plain) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : value
}
const strictPortable = value => {
  if (!value || typeof value !== 'object') return true
  const tag = Object.prototype.toString.call(value)
  if (!['[object Object]', '[object Array]', '[object Date]', '[object RegExp]', '[object Map]', '[object Set]'].includes(tag)) return false
  if (tag === '[object Object]' && Object.getPrototypeOf(value)?.constructor?.name !== 'Object') return false
  if (Array.isArray(value) && Array.from({ length: value.length }, (_, index) => index).some(index => !Object.hasOwn(value, index))) return false
  return (value instanceof Map ? [...value].flat() : value instanceof Set ? [...value] : Object.values(value)).every(strictPortable)
}
const matches = (actual, expected, subset = false) => {
  if (expected?.[asymmetric]) return expected[asymmetric](actual)
  if (subset && expected && typeof expected === 'object') return Object.entries(expected).every(([key, item]) => actual != null && key in actual && matches(actual[key], item, true))
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((item, index) => matches(actual[index], item))
  try { assert.deepStrictEqual(plain(actual), plain(expected)); return true } catch { return false }
}
const deferredUnavailable = reason => new Proxy(function () { throw new UpstreamCapabilityUnavailable(reason) }, {
  get(_target, key) { if (key === '__esModule') return true; if (key === missingCapability) return reason; if (key === 'then') return undefined; return deferredUnavailable(reason + '.' + String(key)) },
  construct() { throw new UpstreamCapabilityUnavailable(reason) },
})

/** Only registration metadata is instrumented; callback bodies and expectations
 * remain original upstream source. Expanded tables keep their declaration line. */
function transpile(file) {
  const callee = expression => ts.isIdentifier(expression) ? ['it', 'test'].includes(expression.text) : ts.isPropertyAccessExpression(expression) ? callee(expression.expression) : ts.isCallExpression(expression) ? callee(expression.expression) : false
  return ts.transpileModule(file.text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, transformers: { before: [context => source => {
    const visit = node => {
      const transformed = ts.visitEachChild(node, visit, context)
      if (!ts.isCallExpression(node) || !callee(node.expression) || !node.arguments.some(argument => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) return transformed
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      return context.factory.createCallExpression(context.factory.createIdentifier('__atDeclaration'), undefined, [context.factory.createNumericLiteral(line), context.factory.createArrowFunction(undefined, undefined, [], undefined, context.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), transformed)])
    }
    return ts.visitNode(source, visit)
  }] } }).outputText
}

/** Execute reviewed public-parser projections of original callbacks. This is
 * not a replacement for upstream's own runner; private dependencies stay gaps. */
export async function executeProjectedUpstreamFiles(files, acquire, options = {}) {
  const rows = [], fileErrors = []
  for (const file of files) {
    const callbacks = [], groups = [{ before: [], after: [], beforeAll: [], afterAll: [] }]
    let declarationLine, state, prepared = new Map(), context
    const unavailable = reason => { state?.unavailable.push(reason); throw new UpstreamCapabilityUnavailable(reason) }
    const db = new Proxy({}, { get(_target, key) {
      if (key === 'clear') return () => { if (state) { state.view = undefined; state.parsesSinceClear = 0 } }
      if (key === 'then') return undefined
      if (state?.view && state.parsesSinceClear > 1) return unavailable('Original callback observes cumulative private DB state after multiple parser invocations without clear; independent public acquisitions cannot supply that state')
      if (typeof state?.view?.[key] === 'function') return (...args) => state.view[key](...args)
      if (state?.view && key in state.view) return state.view[key]
      return deferredUnavailable(`Unprojected upstream DB capability ${file.family}.${String(key)}`)
    } })
    const parser = { get yy() { return db }, set yy(_value) {}, parse(source, alternate) {
      const text = typeof alternate === 'string' && typeof source === 'string' && !source.includes('\n') ? alternate : source
      if (typeof text !== 'string') return unavailable('Upstream parser invocation does not supply Mermaid source text')
      state.sources.add(text)
      state.parsesSinceClear++
      if (!prepared.has(text)) { state.pending.add(text); throw new PreparePublicSource() }
      const result = prepared.get(text)
      if (result.status === 'unavailable' || result.status === 'unsupported') return unavailable(result.error ?? `Public ${file.family} parser/model unavailable`)
      const asynchronous = ['gitgraph', 'architecture', 'eventmodeling', 'packet', 'radar', 'pie', 'treemap'].includes(file.family)
      if (result.status === 'rejected') {
        state.rejections++
        const error = new PublicSourceRejection(result.error ?? 'Public parser rejected source')
        return asynchronous ? Promise.reject(error) : (() => { throw error })()
      }
      state.view = result.view
      return asynchronous ? Promise.resolve() : undefined
    } }
    const expectation = (actual, negated = false, settled = false) => {
      const check = (passed, matcher, expected, value = actual) => {
        if (actual?.[missingCapability] || expected?.[missingCapability]) return unavailable(actual?.[missingCapability] ?? expected?.[missingCapability])
        const pass = negated ? !passed : passed
        state.assertions.push({ matcher, negated, passed: pass, ...(pass ? {} : { actual: plain(value), expected: plain(expected) }) })
        assert.ok(pass, `${negated ? 'not.' : ''}${matcher}: expected ${JSON.stringify(plain(expected))}, observed ${JSON.stringify(plain(value))}`)
      }
      const toThrow = expected => {
        let error
        if (actual instanceof PublicSourceRejection && settled) error = actual
        else if (!settled) { let returned; try { returned = actual() } catch (caught) { error = caught }; if (returned?.then) { returned.catch(() => {}); return unavailable('Original synchronous throw matcher received an asynchronous public parse; explicit resolves/rejects or native runner required') } }
        if (error instanceof PreparePublicSource || error instanceof UpstreamCapabilityUnavailable) throw error
        if (error && !(error instanceof PublicSourceRejection)) return unavailable(`Non-target exception cannot establish syntax rejection: ${error.message ?? error}`)
        const pass = !!error && (expected === undefined || typeof expected === 'string' && error.message.includes(expected) || Object.prototype.toString.call(expected) === '[object RegExp]' && expected.test(error.message) || typeof expected === 'function' && error instanceof expected)
        check(pass, 'toThrow', expected, error?.message ?? '<no public source rejection>')
      }
      const methods = {
        get not() { return expectation(actual, !negated, settled) },
        get resolves() { return new Proxy({}, { get(_target, key) { if (key === 'not') return new Proxy({}, { get(_target2, matcher) { return async (...args) => expectation(await actual, true, true)[matcher](...args) } }); return async (...args) => expectation(await actual, negated, true)[key](...args) } }) },
        get rejects() { return new Proxy({}, { get(_target, key) { return async (...args) => { let error; try { await (typeof actual === 'function' ? actual() : actual) } catch (caught) { error = caught }; if (!error) return check(false, 'rejects.' + String(key), args); if (!(error instanceof PublicSourceRejection)) throw error; return expectation(error, negated, true)[key](...args) } } }) },
        toBe: expected => check(Object.is(actual, expected), 'toBe', expected),
        toEqual: expected => check(matches(actual, expected), 'toEqual', expected),
        toStrictEqual: expected => { if (!strictPortable(actual) || !strictPortable(expected)) return unavailable('Private prototype/sparse-array strict equality is outside this public-model projection'); return check(matches(actual, expected), 'toStrictEqual', expected) },
        toMatchObject: expected => check(matches(actual, expected, true), 'toMatchObject', expected),
        toBeDefined: () => check(actual !== undefined, 'toBeDefined', '<defined>'),
        toBeUndefined: () => check(actual === undefined, 'toBeUndefined', undefined),
        toBeNull: () => check(actual === null, 'toBeNull', null),
        toBeTruthy: () => check(!!actual, 'toBeTruthy', true),
        toBeFalsy: () => check(!actual, 'toBeFalsy', false),
        toBeNaN: () => check(Number.isNaN(actual), 'toBeNaN', '<NaN>'),
        toHaveLength: expected => check(actual?.length === expected, 'toHaveLength', expected),
        toHaveProperty: (path, expected) => { const keys = Array.isArray(path) ? path : String(path).split('.'); let value = actual, found = true; for (const key of keys) { if (value == null || !(key in Object(value))) { found = false; break }; value = value[key] }; check(found && (expected === undefined || matches(value, expected)), 'toHaveProperty', path, value) },
        toContain: expected => check(actual?.includes?.(expected) ?? false, 'toContain', expected),
        toContainEqual: expected => check(Array.isArray(actual) && actual.some(value => matches(value, expected)), 'toContainEqual', expected),
        toMatch: expected => check(typeof expected === 'string' ? String(actual).includes(expected) : expected.test(String(actual)), 'toMatch', expected),
        toBeGreaterThan: expected => check(actual > expected, 'toBeGreaterThan', expected),
        toBeGreaterThanOrEqual: expected => check(actual >= expected, 'toBeGreaterThanOrEqual', expected),
        toBeLessThan: expected => check(actual < expected, 'toBeLessThan', expected),
        toBeLessThanOrEqual: expected => check(actual <= expected, 'toBeLessThanOrEqual', expected),
        toBeCloseTo: (expected, digits = 2) => check(Math.abs(actual - expected) < 10 ** -digits / 2, 'toBeCloseTo', expected),
        toBeInstanceOf: expected => check(actual instanceof expected, 'toBeInstanceOf', expected.name),
        toThrow, toThrowError: toThrow,
      }
      return new Proxy(methods, { get(target, key) { if (key in target) return target[key]; return () => unavailable('Unprojected assertion matcher ' + String(key)) } })
    }
    const expect = (actual, _diagnosticMessage) => expectation(actual)
    expect.arrayContaining = values => ({ [asymmetric]: actual => Array.isArray(actual) && values.every(value => actual.some(item => matches(item, value))) })
    expect.objectContaining = value => ({ [asymmetric]: actual => matches(actual, value, true) })
    expect.anything = () => ({ [asymmetric]: actual => actual != null })
    expect.any = type => ({ [asymmetric]: actual => type === String ? typeof actual === 'string' : type === Number ? typeof actual === 'number' : actual instanceof type })
    expect.stringContaining = value => ({ [asymmetric]: actual => typeof actual === 'string' && actual.includes(value) })
    const register = (name, callback, skipped = false) => callbacks.push({ family: file.family, path: file.path, name: String(name), line: declarationLine, callback, skipped: skipped || groups.some(group => group.skipped), before: groups.flatMap(group => group.before), after: [...groups].reverse().flatMap(group => group.after), beforeAll: groups.flatMap(group => group.beforeAll) })
    const makeIt = (skipped = false, table) => {
      const it = (name, callback) => {
        if (table) for (const row of table) register(name + ' [' + JSON.stringify(row) + ']', () => callback(...(Array.isArray(row) ? row : [row])), skipped)
        else register(name, callback, skipped || typeof callback !== 'function')
      }
      it.skip = makeModifier(true); it.todo = (name) => register(name, undefined, true); it.only = it; it.concurrent = it; it.sequential = it
      it.each = values => makeIt(skipped, values); it.for = values => makeIt(skipped, values)
      it.skipIf = condition => condition ? makeModifier(true) : it; it.runIf = condition => condition ? it : makeModifier(true)
      return it
    }
    const makeModifier = skipped => Object.assign((name, callback) => register(name, callback, skipped), { each: values => makeIt(skipped, values) })
    const it = makeIt()
    const describe = (name, callback) => { groups.push({ before: [], after: [], beforeAll: [], afterAll: [] }); try { callback() } finally { groups.pop() } }
    describe.skip = (_name, callback) => { groups.push({ before: [], after: [], beforeAll: [], afterAll: [], skipped: true }); try { callback() } finally { groups.pop() } }; describe.only = describe
    describe.each = values => (name, callback) => { for (const row of values) describe(name, () => callback(...(Array.isArray(row) ? row : [row]))) }
    const globals = { describe, it, test: it, expect, beforeEach: callback => groups.at(-1).before.push(callback), afterEach: callback => groups.at(-1).after.push(callback), beforeAll: callback => groups.at(-1).beforeAll.push(callback), afterAll: callback => groups.at(-1).afterAll.push(callback), vi: deferredUnavailable('Private Vitest mocking'), console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, exports: {}, __atDeclaration(line, callback) { const previous = declarationLine; declarationLine = line; try { return callback() } finally { declarationLine = previous } }, require(id) {
      if (id === 'vitest') return globals
      if (/(?:\.jison$|(?:^|\/)parser(?:[./]|$)|Parser\.[jt]s$)/i.test(id)) return { __esModule: true, default: { parser, parse: parser.parse }, parser, parse: parser.parse }
      if (/(?:Db|DB|Ast)\.[jt]s$/.test(id)) return new Proxy({ __esModule: true, default: db, db }, { get(target, key) { if (key in target) return target[key]; if (/DB$|Db$/.test(String(key))) return class { constructor() { return db } }; return deferredUnavailable('Unprojected original DB export ' + String(key)) } })
      if (/(?:config|diagramAPI)\.[jt]s$/.test(id)) return { setConfig(value) { if (Object.entries(value).some(([key, value]) => key !== 'securityLevel' || value !== 'strict')) return unavailable('Original callback requires configuration outside this default-strict parser projection') }, reset() {}, resetConfig() {} }
      return deferredUnavailable('Unprojected original import ' + id)
    } }
    context = vm.createContext(globals)
    let registrationError
    try { vm.runInContext(transpile(file), context, { filename: file.path, timeout: options.registrationTimeoutMs ?? 2000 }) } catch (error) { registrationError = String(error.message ?? error); fileErrors.push({ path: file.path, family: file.family, reason: registrationError }) }
    if (registrationError) {
      for (const callback of callbacks) rows.push({ family: file.family, path: file.path, name: callback.name, line: callback.line, status: 'unavailable', assertions: [], sources: [], reason: 'Original module registration did not complete: ' + registrationError })
      continue
    }
    for (const callback of callbacks) {
      if (callback.skipped) { rows.push({ family: file.family, path: file.path, name: callback.name, line: callback.line, status: 'skipped-upstream', assertions: [], sources: [] }); continue }
      prepared = new Map()
      let row
      for (let attempt = 0; attempt < (options.preparationLimit ?? 2000); attempt++) {
        state = { view: undefined, sources: new Set(), pending: new Set(), unavailable: [], assertions: [], rejections: 0, parsesSinceClear: 0 }
        let error
        try {
          for (const hook of [...callback.beforeAll, ...callback.before]) { context.__call = hook; await vm.runInContext('__call()', context, { timeout: options.callbackTimeoutMs ?? 2000 }) }
          context.__call = callback.callback; await vm.runInContext('__call()', context, { timeout: options.callbackTimeoutMs ?? 2000 })
          for (const hook of callback.after) { context.__call = hook; await vm.runInContext('__call()', context, { timeout: options.callbackTimeoutMs ?? 2000 }) }
        } catch (caught) { error = caught }
        if (state.pending.size) {
          for (const source of state.pending) { try { prepared.set(source, await acquire(source, file.family)) } catch (caught) { prepared.set(source, { status: 'unavailable', error: 'Public acquisition failed: ' + String(caught.message ?? caught) }) } }
          continue
        }
        const unavailableReason = state.unavailable[0] ?? (error instanceof UpstreamCapabilityUnavailable ? error.message : undefined) ?? (!state.sources.size ? 'Original callback did not request the supplied public parser; no target-specific evidence' : undefined) ?? (error && !(error instanceof assert.AssertionError || error instanceof PublicSourceRejection) ? String(error.message ?? error) : undefined)
        row = { family: file.family, path: file.path, name: callback.name, line: callback.line, status: unavailableReason ? 'unavailable' : error ? 'failed' : state.assertions.length ? 'passed' : 'unavailable', assertions: state.assertions, sources: [...state.sources], targetRejections: state.rejections, preparationReplays: attempt, ...(unavailableReason ? { reason: unavailableReason } : error ? { reason: String(error.message ?? error) } : !state.assertions.length ? { reason: 'Original callback executed no projected assertions' } : {}) }
        break
      }
      rows.push(row ?? { family: file.family, path: file.path, name: callback.name, line: callback.line, status: 'unavailable', assertions: [], sources: [], reason: 'Source preparation exceeded the declared convergence limit' })
    }
  }
  return { callbacks: rows, fileErrors, scope: 'Original callback expectations through reviewed public parser/model projections; private internals and unsupported matchers/imports remain unavailable. Not the upstream own-runner result or a performance clock.' }
}
