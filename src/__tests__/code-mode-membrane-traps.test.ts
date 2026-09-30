// Characterization of the Code Mode read-only membrane (src/mcp/facade.ts):
// for every kind of proxy a sandboxed program can hold — a parsed result
// object, an array, a Map, an SDK function, a verify result and the `mermaid`
// root itself — each write trap must throw the read-only error, and the
// descriptor/prototype traps must answer as they did before the traps were
// shared across the proxy handlers.

import { expect, test } from 'bun:test'
import { executeInSandbox } from '../mcp/sandbox.ts'

const READ_ONLY = { threw: 'Code Mode SDK results are read-only; use mermaid.mutate(...) for structured edits' }

const PROBE = `
  const r = mermaid.parseRegisteredMermaid('flowchart TD\\n  A --> B')
  const flow = mermaid.asFlowchart(r.value)
  const targets = [
    ['result', r.value, 'kind'],
    ['array', flow.body.graph.edges, '0'],
    ['map', flow.body.graph.nodes, 'size'],
    ['function', mermaid.verifyMermaid, 'name'],
    ['verify', mermaid.verifyMermaid(flow), 'ok'],
    ['sdk', mermaid, 'verifyMermaid'],
  ]
  const describe = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  const attempt = run => {
    try { return { value: run() } } catch (error) { return { threw: String(error && error.message) } }
  }
  const out = {}
  for (const [name, target, key] of targets) {
    out[name] = {
      set: attempt(() => { target.probe = 1; return 'assigned' }),
      deleteProperty: attempt(() => String(delete target[key])),
      defineProperty: attempt(() => describe(Object.defineProperty(target, 'probe', { value: 1 }))),
      setPrototypeOf: attempt(() => describe(Object.setPrototypeOf(target, null))),
      preventExtensions: attempt(() => describe(Object.preventExtensions(target))),
      getOwnPropertyDescriptor: attempt(() => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)
        return descriptor ? Object.keys(descriptor).sort().join(',') + ':' + describe(descriptor.value) : 'none'
      }),
      getPrototypeOf: attempt(() => describe(Object.getPrototypeOf(target))),
    }
  }
  return out
`

test('every membrane proxy rejects writes and answers descriptor/prototype reads the same way', async () => {
  const result = await executeInSandbox(PROBE)
  expect(result.ok).toBe(true)
  const writes = { set: READ_ONLY, deleteProperty: READ_ONLY, defineProperty: READ_ONLY, setPrototypeOf: READ_ONLY, preventExtensions: READ_ONLY }
  expect(result.value).toEqual({
    result: { ...writes, getOwnPropertyDescriptor: { value: 'configurable,enumerable,value,writable:string' }, getPrototypeOf: { value: 'null' } },
    array: { ...writes, getOwnPropertyDescriptor: { value: 'configurable,enumerable,value,writable:object' }, getPrototypeOf: { value: 'null' } },
    map: { ...writes, getOwnPropertyDescriptor: { value: 'none' }, getPrototypeOf: { value: 'null' } },
    function: { ...writes, getOwnPropertyDescriptor: { value: 'configurable,enumerable,value,writable:string' }, getPrototypeOf: { value: 'null' } },
    verify: { ...writes, getOwnPropertyDescriptor: { value: 'configurable,enumerable,value,writable:boolean' }, getPrototypeOf: { value: 'null' } },
    sdk: { ...writes, getOwnPropertyDescriptor: { value: 'configurable,enumerable,value,writable:function' }, getPrototypeOf: { value: 'null' } },
  })
})
