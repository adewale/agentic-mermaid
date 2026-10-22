import { expect, test } from 'bun:test'
import { CacheBudget } from '../experimental/cache-budget.ts'
import { WeightedLru } from '../experimental/weighted-lru.ts'

test('shared residency evicts the least recently used entry across cache owners', () => {
  const budget = new CacheBudget(10)
  const a = new WeightedLru<string, string>(10, 10, budget)
  const b = new WeightedLru<string, string>(10, 10, budget)
  a.set('a', 'first', 1, 4)
  b.set('b', 'second', 1, 4)
  expect(a.get('a')).toBe('first')
  b.set('c', 'third', 1, 4)
  expect(b.get('b')).toBeUndefined()
  expect(a.get('a')).toBe('first')
  expect(b.get('c')).toBe('third')
  a.clear()
  b.set('d', 'fourth', 1, 6)
  expect(b.get('c')).toBe('third')
  expect(b.get('d')).toBe('fourth')
})

test('owner limits, replacement and rejected entries release exactly their own reservation', () => {
  const budget = new CacheBudget(10)
  const a = new WeightedLru<string, number>(1, 3, budget)
  const b = new WeightedLru<string, number>(5, 10, budget)
  a.set('a', 1, 2, 8)
  a.set('a', 2, 2, 2)
  b.set('b', 3, 3, 8)
  expect(a.get('a')).toBe(2)
  a.set('large', 4, 2, 11)
  expect(a.get('large')).toBeUndefined()
  a.set('next', 5, 2, 2)
  expect(a.get('a')).toBeUndefined()
  expect(b.get('b')).toBe(3)
  expect(a.get('next')).toBe(5)
  b.clear()
  a.set('next', 6, 2, 10)
  expect(a.get('next')).toBe(6)
})
