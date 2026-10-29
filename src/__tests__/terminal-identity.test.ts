import { expect, test } from 'bun:test'
import { terminalIds } from '../ascii/identity.ts'

test('terminal generated identities distinguish structured keys from names and legacy keys', () => {
  const generated = terminalIds(['edge', 'edge#1'])
  const left = generated('edge', ['relationship', 'a:b', 'c'])
  const right = generated('edge', ['relationship', 'a', 'b:c'])
  const legacy = generated('edge', '["relationship","a:b","c"]')
  const otherKind = generated('edge', ['label', 'a:b', 'c'])
  expect(new Set([left, right, legacy, otherKind]).size).toBe(4)
  expect([left, right, legacy, otherKind]).not.toContain('edge')
  expect([left, right, legacy, otherKind]).not.toContain('edge#1')
  expect(generated('renamed', ['relationship', 'a:b', 'c'])).toBe(left)
  expect(generated('renamed', '["relationship","a:b","c"]')).toBe(legacy)
})

test('terminal composite keys preserve literal delimiters, quotes, Unicode and component types', () => {
  const generated = terminalIds([])
  const keys = [
    ['edge', 'a":"b', 'c'],
    ['edge', 'a', 'b":"c'],
    ['edge', '界:日', '本'],
    ['edge', '界', '日:本'],
    ['edge', '1', 2],
    ['edge', 1, '2'],
  ] as const
  const ids = keys.map(key => generated('relation', key))
  expect(new Set(ids).size).toBe(keys.length)
  keys.forEach((key, index) => expect(generated('other', [...key])).toBe(ids[index]!))
})

test.each([NaN, Infinity, -Infinity])('terminal composite keys reject non-finite numbers before allocating (%s)', value => {
  const generated = terminalIds([])
  expect(() => generated('edge', ['edge', value])).toThrow(/finite/)
  expect(generated('edge', ['edge', 0])).toBe('edge')
  expect(generated('other', ['edge', 0])).toBe('edge')
})

test('terminal composite keys validate and memoize one snapshot of accessor components', () => {
  const generated = terminalIds([])
  let reads = 0
  const key = Object.freeze(Object.defineProperty(['edge', 0] as [string, number], 1, {
    get: () => ++reads === 1 ? 1 : NaN,
  }))
  const id = generated('edge', key)
  expect(reads).toBe(1)
  expect(generated('other', ['edge', 1])).toBe(id)
})
