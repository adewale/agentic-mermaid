// Built-in admission freezes its own data in place under bounded work. Keep
// diagnostics and partial-freeze behavior at that owner; hostile descriptor
// snapshots have their separate public-API proof in external-scene-public-api.
import { expect, test } from 'bun:test'
import { freezeBoundedFirstPartyData, type ExternalDataSnapshotLimits } from '../scene/external-data-snapshot.ts'

const limits: ExternalDataSnapshotLimits = {
  maxObjects: 16, maxTextBytes: 32, maxArrayEntries: 8, maxAggregateArrayEntries: 16,
  maxDepth: 4, maxPropertiesPerObject: 8, maxAggregateProperties: 32,
  maxPropertyKeyBytes: 32, maxAggregatePropertyKeyBytes: 128,
}
const cycle = () => { const value: { self?: unknown } = {}; value.self = value; return value }

test.each([
  ['nested function with a numeric object key', () => ({ group: [{ '0': () => 0 }] }), {}, TypeError, 'External Scene scene.group[0].0 must be declarative data'],
  ['nested symbol beside delimiter-bearing keys', () => ({ 'a.b': [{ 'x[0]': Symbol() }] }), {}, TypeError, 'External Scene scene.a.b[0].x[0] must be declarative data'],
  ['a forbidden root scalar', () => 1n, {}, TypeError, 'External Scene scene must be declarative data'],
  ['a nested sparse array', () => ({ group: [{ items: new Array(1) }] }), {}, TypeError, 'External Scene scene.group[0].items must not be sparse'],
  ['a non-plain array', () => ({ group: [Object.setPrototypeOf([], null)] }), {}, TypeError, 'External Scene scene.group[0] must be a plain array'],
  ['a non-plain object', () => ({ group: [new Date(0)] }), {}, TypeError, 'External Scene scene.group[0] must be a plain object'],
  ['an oversized array before sparse checking', () => ({ group: new Array(3) }), { maxArrayEntries: 2 }, Error, 'External Scene scene.group contains too many entries'],
  ['too many properties before reading values', () => ({ group: { a: () => 0, b: 0 } }), { maxPropertiesPerObject: 1 }, Error, 'External Scene scene.group contains too many properties'],
  ['a multibyte property key', () => ({ a: { é: 0 } }), { maxPropertyKeyBytes: 1 }, Error, 'External Scene scene.a contains a property key longer than 1 bytes'],
  ['a cycle', cycle, {}, Error, 'External Scene input must be acyclic'],
  ['object count before cycle detection', cycle, { maxObjects: 1 }, Error, 'External Scene input object graph is too large'],
  ['depth before object count', () => ({ a: {} }), { maxDepth: 0, maxObjects: 1 }, Error, 'External Scene input object graph is too deeply nested'],
  ['aggregate multibyte text', () => ['é', 'é'], { maxTextBytes: 3 }, Error, 'External Scene text values exceed the aggregate 3-byte limit'],
  ['aggregate array entries', () => ({ a: [0, 0], b: [0] }), { maxAggregateArrayEntries: 2 }, Error, 'External Scene input exceeds the aggregate 2-array-entry limit'],
  ['aggregate properties', () => ({ a: { x: 0, y: 0 } }), { maxAggregateProperties: 2 }, Error, 'External Scene input exceeds the aggregate 2-property limit'],
  ['aggregate property-key bytes', () => ({ a: { éé: 0 } }), { maxAggregatePropertyKeyBytes: 4 }, Error, 'External Scene property keys exceed the aggregate 4-byte limit'],
] satisfies Array<[string, () => unknown, Partial<ExternalDataSnapshotLimits>, ErrorConstructor, string]>)('first-party admission reports %s', (_name, make, overrides, errorType, message) => {
  let caught: unknown
  try { freezeBoundedFirstPartyData(make(), { ...limits, ...overrides }, 'scene') }
  catch (error) { caught = error }
  expect((caught as Error | undefined)?.constructor).toBe(errorType)
  expect((caught as Error).message).toBe(message)
})

test('first-party admission preserves identities, aliases and exact inclusive work limits', () => {
  const shared = Object.assign(Object.create(null), { label: 'é' })
  const value = { left: shared, right: shared }
  // The root plus two references to the shared object use three object visits;
  // the shared object's properties and text are only traversed once.
  expect(freezeBoundedFirstPartyData(value, { ...limits, maxObjects: 3, maxTextBytes: 2, maxAggregateProperties: 3, maxAggregatePropertyKeyBytes: 14 })).toBe(value)
  expect(value.left).toBe(shared)
  expect(value.right).toBe(shared)
  expect(Object.getPrototypeOf(shared)).toBeNull()
  expect(Object.isFrozen(value)).toBe(true)
  expect(Object.isFrozen(shared)).toBe(true)
  const other = { label: 'é' }
  expect(() => freezeBoundedFirstPartyData({ left: other, right: other }, { ...limits, maxObjects: 2 })).toThrow('External Scene input object graph is too large')
})

test('first-party failure keeps completed descendants frozen and diagnoses the next sibling', () => {
  const completed = [{ label: 'kept' }]
  const later = { bad: () => 0 }
  const value = { completed, later }
  expect(() => freezeBoundedFirstPartyData(value, limits, 'custom-root')).toThrow('External Scene custom-root.later.bad must be declarative data')
  expect(Object.isFrozen(value)).toBe(false)
  expect(Object.isFrozen(later)).toBe(false)
  expect(Object.isFrozen(completed)).toBe(true)
  expect(Object.isFrozen(completed[0])).toBe(true)
  expect(value.completed).toBe(completed)
})
