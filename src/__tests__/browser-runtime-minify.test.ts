import { expect, test } from 'bun:test'
import { minifyBrowserRuntime } from '../../scripts/build/runtime-minify.ts'

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
