import { describe, expect, test } from 'bun:test'
import { classifyChangedFiles, failingTestCount, redGreenVerdict } from '../../scripts/ci/red-green.ts'

describe('red → green changed-test gate', () => {
  test('separates production source from changed test files', () => {
    expect(classifyChangedFiles([
      'src/theme-color-admission.ts',
      'src/__tests__/theme-color-admission.test.ts',
      'src/__tests__/helpers/layout-runner.ts',
      'bin/am.ts',
      'docs/testing-strategy.md',
      'src/__tests__/testdata/ascii/basic.txt',
    ])).toEqual({
      production: ['bin/am.ts', 'src/theme-color-admission.ts'],
      tests: ['src/__tests__/theme-color-admission.test.ts'],
    })
  })

  test('skips when there is nothing to prove red', () => {
    expect(redGreenVerdict({ production: [], tests: ['src/__tests__/a.test.ts'] }).code).toBe('skip')
    expect(redGreenVerdict({ production: ['src/a.ts'], tests: [] }).code).toBe('skip')
  })

  test('passes when a changed test fails on the base, and fails when all pass', () => {
    const changed = { production: ['src/a.ts'], tests: ['src/__tests__/a.test.ts'] }
    expect(redGreenVerdict(changed, { exitCode: 1, failingTests: 2 })).toMatchObject({ code: 'red', ok: true })
    const green = redGreenVerdict(changed, { exitCode: 0, failingTests: 0 })
    expect(green).toMatchObject({ code: 'green-on-base', ok: false })
    expect(green.message).toContain('no-red-green')
    expect(() => redGreenVerdict(changed)).toThrow('base-branch run is required')
  })

  test('reads the final bun test failure count', () => {
    expect(failingTestCount(' 3 pass\n 2 fail\n')).toBe(2)
    expect(failingTestCount('error: Cannot find module "../new-api.ts"\n')).toBe(0)
  })
})
