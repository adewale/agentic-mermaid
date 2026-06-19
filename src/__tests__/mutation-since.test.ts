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
})
