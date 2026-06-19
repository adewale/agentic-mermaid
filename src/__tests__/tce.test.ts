// Move 7: TCE seed — prove the transpile-and-compare mechanism distinguishes
// provably-equivalent edits from real ones, so the survivor-equivalence judgment
// we'd been doing by hand can be automated for the classes Bun's transpiler
// normalizes (types / comments / formatting).

import { describe, test, expect } from 'bun:test'
import { normalizeTs, equivalentByTranspile } from '../../eval/tce/tce.ts'

describe('TCE: transpile-and-compare equivalence', () => {
  test('a type-annotation-only difference is provably equivalent', () => {
    expect(equivalentByTranspile(
      'export function f(x: number): number { return x + 1 }',
      'export function f(x: any): any { return x + 1 }',
    )).toBe(true)
  })

  test('comment-only and formatting-only differences are equivalent', () => {
    expect(equivalentByTranspile(
      'export const g = (a: number) => a * 2 // doubles',
      'export const g = (a: number) =>\n  a * 2',
    )).toBe(true)
  })

  test('a real logic change is NOT equivalent (no false positives)', () => {
    expect(equivalentByTranspile(
      'export function f(x: number) { return x + 1 }',
      'export function f(x: number) { return x - 1 }',  // the kind of mutant Stryker makes
    )).toBe(false)
  })

  test('normalizeTs is idempotent and type-free', () => {
    const n = normalizeTs('const x: number = 1; export const y = x')
    expect(normalizeTs(n)).toBe(n)        // double-normalization is stable
    expect(n).not.toContain(': number')   // types erased
  })
})
