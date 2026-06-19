// Move 9: unit-test the `--since` base-ref construction (was inline ci.yml shell).
import { describe, test, expect } from 'bun:test'
import { sinceRef } from '../../scripts/ci/mutation-since.ts'

describe('sinceRef', () => {
  test('a PR base branch becomes origin/<branch>', () => {
    expect(sinceRef('main')).toBe('origin/main')
    expect(sinceRef('release/2.0')).toBe('origin/release/2.0')
  })

  test('empty / undefined / whitespace falls back to origin/main', () => {
    expect(sinceRef(undefined)).toBe('origin/main')
    expect(sinceRef('')).toBe('origin/main')
    expect(sinceRef('   ')).toBe('origin/main')
  })

  test('surrounding whitespace is trimmed', () => {
    expect(sinceRef('  feature-x \n')).toBe('origin/feature-x')
  })

  test('a SHA base is used as-is (no origin/ prefix)', () => {
    expect(sinceRef('a1b2c3d')).toBe('a1b2c3d')                              // short SHA
    expect(sinceRef('0123456789abcdef0123456789abcdef01234567')).toBe('0123456789abcdef0123456789abcdef01234567')  // full SHA
  })

  test('a branch that merely looks word-like still gets origin/', () => {
    expect(sinceRef('release')).toBe('origin/release')  // not hex-only
    expect(sinceRef('abcdefg')).toBe('origin/abcdefg')  // contains g → not a SHA
  })

  test('rejects refs git itself forbids (Move 9)', () => {
    expect(() => sinceRef('foo bar')).toThrow(/invalid base ref/)   // internal space
    expect(() => sinceRef('a..b')).toThrow(/invalid base ref/)      // double-dot
    expect(() => sinceRef('-evil')).toThrow(/invalid base ref/)     // leading dash
    expect(() => sinceRef('a~1')).toThrow(/invalid base ref/)       // tilde
    expect(() => sinceRef('a:b')).toThrow(/invalid base ref/)       // colon
  })
})
