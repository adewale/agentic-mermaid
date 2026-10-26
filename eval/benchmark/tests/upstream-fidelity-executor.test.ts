import { expect, test } from 'bun:test'
import { executeProjectedUpstreamFiles } from '../unified/upstream-fidelity-executor.mjs'

const text = `import flow from './flowParser.ts'; import {FlowDB} from '../flowDb.js';
beforeEach(()=>{flow.parser.yy=new FlowDB();flow.parser.yy.clear()});
it('keeps endpoints',()=>{flow.parser.parse('flowchart LR\\nA-->B');const edge=flow.parser.yy.getEdges()[0];expect(edge.start).toBe('A');expect(edge.end).toBe('B')});
it('rejects invalid source',()=>{expect(()=>flow.parser.parse('flowchart ???')).toThrow('invalid')});
it('cannot silently emulate private mutations',()=>{flow.parser.yy.addVertex('invented');expect(true).toBe(true)});
it.each(['A','B'])('expanded source %s',id=>{flow.parser.parse('flowchart LR\\n'+id);expect(flow.parser.yy.getVertices().has(id)).toBe(true)});
it.skip('disabled original callback',()=>{throw Error('must not execute')});`

test('original callback projection checks actual endpoints, expands tables, and retains private/disabled outcomes', async () => {
  let calls = 0
  const acquire = async (source: string) => {
    calls++
    if (source.includes('???')) return { status: 'rejected', error: 'invalid Mermaid syntax' }
    return { status: 'accepted', view: { getEdges: () => [{ start: 'A', end: 'B' }], getVertices: () => new Map([['A', {}], ['B', {}]]) } }
  }
  const result = await executeProjectedUpstreamFiles([{ family: 'flowchart', path: '/pinned/flow.spec.js', text }], acquire)
  expect(result.callbacks.map((row: any) => row.status)).toEqual(['passed', 'passed', 'unavailable', 'passed', 'passed', 'skipped-upstream'])
  expect(result.callbacks[0]!.assertions).toHaveLength(2)
  expect(result.callbacks[0]!.line).toBe(3)
  expect(result.callbacks[2]!.reason).toContain('addVertex')
  expect(calls).toBe(4)
  const lostEdge = await executeProjectedUpstreamFiles([{ family: 'flowchart', path: '/pinned/flow.spec.js', text }], async (source: string) => source.includes('???') ? { status: 'rejected', error: 'invalid Mermaid syntax' } : { status: 'accepted', view: { getEdges: () => [{ start: 'A', end: 'C' }], getVertices: () => new Map([['A', {}], ['B', {}]]) } })
  expect(lostEdge.callbacks[0]!.status).toBe('failed')
  expect(lostEdge.callbacks[0]!.assertions[1]).toMatchObject({ passed: false, actual: 'C', expected: 'B' })
})

test('infrastructure and unsupported assertion capabilities never satisfy original negative assertions', async () => {
  const files = [{ family: 'flowchart', path: '/pinned/negative.spec.js', text: `import flow from './flowParser.ts'; it('negative',()=>expect(()=>flow.parser.parse('bad source')).toThrow());it('private matcher',()=>expect(true).toInventedMatcher())` }]
  const unavailable = await executeProjectedUpstreamFiles(files, async () => { throw new TypeError('Cannot read parser state') })
  expect(unavailable.callbacks.map((row: any) => row.status)).toEqual(['unavailable', 'unavailable'])
  expect(unavailable.callbacks[0]).toMatchObject({ targetRejections: 0 })
  const accepted = await executeProjectedUpstreamFiles(files, async () => ({ status: 'accepted', view: {} }))
  expect(accepted.callbacks[0]!.status).toBe('failed')
  expect(accepted.callbacks[1]!.reason).toContain('Unprojected assertion matcher')
})

 test('original date assertions compare actual timestamps instead of empty object representations', async () => {
  const files = [{ family: 'gantt', path: '/pinned/date.spec.js', text: `import flow from './gantt.jison';it('preserves date',()=>{flow.parser.parse('gantt\\nA: 2024-01-01, 1d');expect(flow.parser.yy.getDate()).toEqual(new Date('2024-01-01T00:00:00Z'))})` }]
  const result = await executeProjectedUpstreamFiles(files, async () => ({ status: 'accepted', view: { getDate: () => new Date('2024-02-01T00:00:00Z') } }))
  expect(result.callbacks[0]!.status).toBe('failed')
  expect(result.callbacks[0]!.assertions[0]).toMatchObject({ passed: false, actual: { date: '2024-02-01T00:00:00.000Z' }, expected: { date: '2024-01-01T00:00:00.000Z' } })
})

test('pure helpers and sync matchers around async calls cannot manufacture public parser evidence', async () => {
  const files = [{ family: 'pie', path: '/pinned/async.spec.js', text: `import pie from './pieParser.js';it('pure helper',()=>expect(2).toBe(2));it('failing private helper',()=>expect(2).toBe(3));it('sync async mismatch',()=>expect(()=>pie.parser.parse('pie\\n"A":1')).not.toThrow());describe.skip('disabled group',()=>{it('disabled child',()=>expect(false).toBe(true))})` }]
  const result = await executeProjectedUpstreamFiles(files, async () => ({ status: 'accepted', view: {} }))
  expect(result.callbacks.map((row: any) => row.status)).toEqual(['unavailable', 'unavailable', 'unavailable', 'skipped-upstream'])
  expect(result.callbacks[0]!.reason).toContain('no target-specific evidence')
  expect(result.callbacks[1]!.reason).toContain('no target-specific evidence')
  expect(result.callbacks[2]!.reason).toContain('asynchronous public parse')
})

test('original rejects assertions invoke async functions and retain actual public rejection evidence', async () => {
  let calls = 0
  const files = [{ family: 'pie', path: '/pinned/async-negative.spec.js', text: `import pie from './pieParser.js';it('async callback rejection',async()=>{await expect(async()=>{await pie.parser.parse('pie invalid')}).rejects.toThrow('invalid')})` }]
  const rejected = await executeProjectedUpstreamFiles(files, async () => { calls++; return { status: 'rejected', error: 'invalid source' } })
  expect(rejected.callbacks[0]!.status).toBe('passed')
  expect(rejected.callbacks[0]!.sources).toEqual(['pie invalid'])
  expect(calls).toBe(1)
  const accepted = await executeProjectedUpstreamFiles(files, async () => ({ status: 'accepted', view: {} }))
  expect(accepted.callbacks[0]!.status).toBe('failed')
})

test('strict private prototypes cannot become a passing structural-only assertion', async () => {
  class PrivateNode { label = 'Alpha' }
  const files = [{ family: 'flowchart', path: '/pinned/prototype.spec.js', text: `import flow from './flowParser.ts';it('private shape',()=>{flow.parser.parse('flowchart LR\\nA');expect(flow.parser.yy.getNode()).toStrictEqual({label:'Alpha'})})` }]
  const result = await executeProjectedUpstreamFiles(files, async () => ({ status: 'accepted', view: { getNode: () => new PrivateNode() } }))
  expect(result.callbacks[0]!.status).toBe('unavailable')
  expect(result.callbacks[0]!.reason).toContain('Private prototype')
})


test('Vitest diagnostic messages do not negate assertions and public parses cannot invent cumulative private DB state', async () => {
  const files = [{ family: 'flowchart', path: '/pinned/diagnostic-state.spec.js', text: `import flow from './flowParser.ts';
it('diagnostic message',()=>{flow.parser.parse('flowchart LR\\nA');expect(flow.parser.yy.getEdges(),'authored diagnostic').toBeDefined();expect(undefined,'explicit not').not.toBeDefined()});
it('cumulative private state',()=>{flow.parser.parse('flowchart LR\\nA');flow.parser.parse('flowchart LR\\nB');expect(flow.parser.yy.getEdges()).toHaveLength(2)});
it('explicit clear',()=>{flow.parser.parse('flowchart LR\\nA');flow.parser.yy.clear();flow.parser.parse('flowchart LR\\nB');expect(flow.parser.yy.getEdges()).toHaveLength(1)})` }]
  const result = await executeProjectedUpstreamFiles(files, async () => ({ status: 'accepted', view: { getEdges: () => [{ start: 'A', end: 'B' }] } }))
  expect(result.callbacks.map((row: any) => row.status)).toEqual(['passed', 'unavailable', 'passed'])
  expect(result.callbacks[0]!.assertions.map((row: any) => row.negated)).toEqual([false, true])
  expect(result.callbacks[1]!.reason).toContain('cumulative private DB state')
})
