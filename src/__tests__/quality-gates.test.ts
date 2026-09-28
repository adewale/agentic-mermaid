import { describe, expect, test } from 'bun:test'
import { collectFailedChecks, QUALITY_CHECKS } from '../../scripts/ci/quality-gates.ts'

describe('local/CI quality aggregate', () => {
  test('continues after failures and returns every failed check', () => {
    const checks = QUALITY_CHECKS.slice(0, 4)
    const visited: string[] = []
    const failures = collectFailedChecks(checks, check => {
      visited.push(check.id)
      return check.id === checks[1]!.id || check.id === checks[3]!.id ? 1 : 0
    })
    expect(visited).toEqual(checks.map(check => check.id))
    expect(failures.map(check => check.id)).toEqual([checks[1]!.id, checks[3]!.id])
  })
})
