import { expect, test } from 'bun:test'
import { createImmutableParts } from '../shared/immutable-parts.ts'

test('keeps constructor ownership local through reentrant qualification', () => {
  const child = Object.freeze({})
  const parent = { child }
  let parts: ReturnType<typeof createImmutableParts>
  let reentered = false
  parts = createImmutableParts(value => {
    if (value === child && !reentered) {
      reentered = true
      parts.freeze(parent)
    }
    return value === child || value === null
  })

  expect(parts.freeze(parent)).toBe(parent)
  expect(parts.has(parent)).toBe(true)
  expect(Object.isFrozen(parent)).toBe(true)
  expect(Reflect.ownKeys(parent)).toEqual(['child'])
  expect(createImmutableParts().has(parent)).toBe(false)
  expect(parts.has(Object.freeze({ ...parent }))).toBe(false)
  expect(parts.has(null as unknown as object)).toBe(true)
})
