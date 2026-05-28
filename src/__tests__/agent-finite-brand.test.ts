// Tests that the Finite branded type actually enforces its invariant.

import { describe, test, expect } from 'bun:test'
import { toFinite } from '../agent/types.ts'
import { verifyMermaid } from '../agent/verify.ts'

describe('toFinite', () => {
  test('accepts finite numbers', () => {
    expect(toFinite(0)).toBe(0 as never)
    expect(toFinite(-1)).toBe(-1 as never)
    expect(toFinite(3.14)).toBe(3.14 as never)
    expect(toFinite(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER as never)
  })

  test('throws on NaN', () => {
    expect(() => toFinite(NaN)).toThrow(RangeError)
  })

  test('throws on Infinity', () => {
    expect(() => toFinite(Infinity)).toThrow(RangeError)
    expect(() => toFinite(-Infinity)).toThrow(RangeError)
  })
})

describe('verifyMermaid emits only finite coordinates', () => {
  test('layout JSON contains no NaN or Infinity values', () => {
    const layout = verifyMermaid('flowchart TD\n  A --> B\n  B --> C').layout
    const flat = JSON.stringify(layout)
    expect(flat).not.toContain('NaN')
    expect(flat).not.toContain('Infinity')
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true)
      expect(Number.isFinite(n.y)).toBe(true)
      expect(Number.isFinite(n.w)).toBe(true)
      expect(Number.isFinite(n.h)).toBe(true)
    }
    for (const e of layout.edges) {
      for (const [x, y] of e.path) {
        expect(Number.isFinite(x)).toBe(true)
        expect(Number.isFinite(y)).toBe(true)
      }
    }
  })
})
