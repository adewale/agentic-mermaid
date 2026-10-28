import { expect, test } from 'bun:test'
import { minifyBrowserRuntime } from '../../scripts/build/runtime-minify.ts'
import { poolStandaloneRuntimeStrings } from '../../scripts/build/standalone-string-pool.ts'

test('browser module compression preserves observable calls, getters, coercion and inline-script safety', async () => {
  const source = `/*! @license runtime-minify-contract */
    export let count = 0;
    export function increment() { return ++count; }
    export function arity(first, second, third) { return this.label + first; }
    export function defaults(first, second = 2, third) { return [first + second + third, arguments.length]; }
    export function readUnused(object) { object.value; }
    export const payload = '</script><script>untrusted</script>';
    export function inspect() {
      const events = [];
      const object = { get value() {
        events.push('get');
        return { [Symbol.toPrimitive](hint) { events.push(hint); return 7; } };
      } };
      object.value;
      const value = +object.value;
      let error;
      try { events.push('throw'); throw new Error('retained diagnostic'); }
      catch (failure) { error = failure.message; }
      const sparse = [, undefined];
      return { events, value, error, holes: [Object.hasOwn(sparse, 0), Object.hasOwn(sparse, 1)],
        negativeZero: Object.is(-0, -0), notANumber: Number.isNaN(0 / 0) };
    }
  `
  const compressed = await minifyBrowserRuntime(source)
  expect(compressed).toContain('@license runtime-minify-contract')
  expect(compressed).not.toMatch(/<\/script/i)
  const module = await import(`data:text/javascript;base64,${Buffer.from(compressed).toString('base64')}`) as {
    count: number
    increment(): number
    arity: ((this: { label: string }, first: number, second?: number, third?: number) => string)
    defaults(first: number, second: number | undefined, third: number): [number, number]
    readUnused(object: { readonly value: unknown }): void
    payload: string
    inspect(): unknown
  }
  expect(module.arity.length).toBe(3)
  expect(module.arity.call({ label: 'owner:' }, 7)).toBe('owner:7')
  expect(module.defaults.length).toBe(1)
  expect(module.defaults(1, undefined, 3)).toEqual([6, 3])
  let externalGetterReads = 0
  module.readUnused({ get value() { externalGetterReads++; return 1 } })
  expect(externalGetterReads).toBe(1)
  expect(module.payload).toBe('</script><script>untrusted</script>')
  expect(module.inspect()).toEqual({
    events: ['get', 'get', 'number', 'throw'], value: 7, error: 'retained diagnostic',
    holes: [false, true], negativeZero: true, notANumber: true,
  })
  expect(module.count).toBe(0)
  expect(module.increment()).toBe(1)
  expect(module.count).toBe(1)
})

test('standalone string pooling preserves function serialization, defaults, directives, Unicode and object keys', async () => {
  const value = '🧭 Mermaid labels & entity text preserve their exact display values. '.repeat(3)
  // Use the same safe token spelling the preceding inline-script compressor emits.
  const literal = JSON.stringify(value + '</script>').replace(/</g, '\\u003c')
  const repeated = Array.from({ length: 24 }, () => literal).join(',')
  const source = `/*! @license standalone-pool-contract */
    'use strict';
    const $S0 = 'owner';
    globalThis.__amPoolFixture = {
      leadingUnicode: '🪄 café', values: [${repeated}],
      standalone: function standalone($S1) { 'use strict'; return { values: [${repeated}], receiver: this, argument: $S1 }; },
      defaults: function defaults(first = ${literal}) { return [first, ${repeated}]; },
      outer: function outer() { return function inner() { return [${repeated}]; }; },
      concise: () => [${repeated}],
      klass: class Example { field = [${repeated}]; method() { return [${repeated}]; } },
      keys: function keys() {
        const object = { ${literal}: 7, [${literal} + 'computed']: 8, '__proto__': { inherited: 9 } };
        const { ${literal}: captured } = object;
        return { captured, computed: object[${literal} + 'computed'], inherited: Object.getPrototypeOf(object).inherited,
          values: [${repeated}], owner: $S0 };
      },
      deleted: function deleted() { return [delete ${literal}, delete (${literal}), ${repeated}]; },
    };
  `
  const result = poolStandaloneRuntimeStrings(source)
  expect(result.beforeBytes - result.afterBytes).toBeGreaterThanOrEqual(1024)
  expect(result.pooledStrings).toBeGreaterThan(0)
  expect(result.code).toContain('@license standalone-pool-contract')
  expect(result.code).not.toMatch(/<\/script/i)
  type Fixture = { leadingUnicode: string; values: string[]; standalone: (this: unknown, argument: number) => unknown;
    defaults(first?: string): string[]; outer(): () => string[]; concise(): string[]; keys(): unknown; deleted(): unknown;
    klass: new () => { field: string[]; method(): string[] } }
  const global = globalThis as unknown as { __amPoolFixture?: Fixture }
  const evaluate = async (code: string): Promise<Fixture> => {
    await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
    return global.__amPoolFixture!
  }
  const recreate = <T extends (...args: never[]) => unknown>(fn: T): T => new Function(`return (${fn.toString()})`)() as T
  try {
    const before = await evaluate(source), after = await evaluate(result.code)
    expect(after.leadingUnicode).toBe(before.leadingUnicode)
    expect(after.values).toEqual(before.values)
    expect(after.standalone.length).toBe(1)
    expect(after.standalone.call(undefined, 7)).toEqual(before.standalone.call(undefined, 7))
    expect(recreate(after.standalone).call(undefined, 7)).toEqual(before.standalone.call(undefined, 7))
    expect(after.defaults.length).toBe(0)
    expect(after.defaults()).toEqual(before.defaults())
    expect(recreate(after.defaults)()).toEqual(before.defaults())
    expect(recreate(after.outer())()).toEqual(before.outer()())
    expect(recreate(recreate(after.outer))()()).toEqual(before.outer()())
    expect(after.concise.toString()).toBe(before.concise.toString())
    const RecreatedClass = new Function(`return (${after.klass.toString()})`)() as Fixture['klass']
    expect(new RecreatedClass().field).toEqual(new before.klass().field)
    expect(new RecreatedClass().method()).toEqual(new before.klass().method())
    expect(after.keys()).toEqual(before.keys())
    expect(after.deleted()).toEqual(before.deleted())
  } finally { delete global.__amPoolFixture }
})

test('standalone pooling refuses eval, open modules and malformed code, and preserves deep expressions', async () => {
  const value = JSON.stringify('A long diagnostic string whose exact value remains unchanged. '.repeat(3))
  const repeated = Array.from({ length: 24 }, () => value).join(',')
  for (const source of [
    `globalThis.result = [${repeated}]; eval('result');`,
    `globalThis.result = [${repeated}]; ((eval))('result');`,
    `import './dependency.js'; globalThis.result = [${repeated}];`,
    `globalThis.result = [${repeated}]; import('./dependency.js');`,
    `export const result = [${repeated}];`,
    `function kernel() { 'use asm'; return [${repeated}]; }`,
    `#!/usr/bin/env bun\nglobalThis.result = [${repeated}];`,
    `globalThis.result = [${repeated};`,
  ]) expect(poolStandaloneRuntimeStrings(source).code).toBe(source)
  const small = 'globalThis.result = ["same", "same"];'
  expect(poolStandaloneRuntimeStrings(small).code).toBe(small)
  const deep = `globalThis.__amPoolDeep = (${Array.from({ length: 5000 }, () => '0').join(',')},[${repeated}]);`
  const result = poolStandaloneRuntimeStrings(deep)
  expect(result.beforeBytes - result.afterBytes).toBeGreaterThanOrEqual(1024)
  await import(`data:text/javascript;base64,${Buffer.from(result.code).toString('base64')}`)
  const global = globalThis as unknown as { __amPoolDeep?: string[] }
  expect(global.__amPoolDeep).toEqual(Array.from({ length: 24 }, () => JSON.parse(value)))
  delete global.__amPoolDeep
})
