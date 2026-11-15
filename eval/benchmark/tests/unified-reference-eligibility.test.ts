import { describe, expect, test } from 'bun:test'
import { eligibilityFromScope, referenceEligibilityFor } from '../unified/reference-eligibility.ts'

describe('paired public-parser positive eligibility', () => {
  test('a public positive contract remains eligible before either parser accepts or rejects it', () => {
    const declaration = eligibilityFromScope('public-positive', 'Authored public API source: graph TD; A --> B')
    expect(declaration.eligible).toBe(true)
    expect(declaration.scope).toBe('public-positive')
  })
  test('an authored negative contract does not award positive acceptance credit', () => {
    const declaration = eligibilityFromScope('expected-negative', 'Malformed authored alias must return a bounded diagnostic')
    expect(declaration.eligible).toBe(false)
    expect(declaration.reason).toContain('bounded diagnostic')
  })
  test('mock grammar acceptance cannot become full public DB acceptance', () => {
    const declaration = eligibilityFromScope('mocked-grammar-only', 'Authored grammar fixture mocks addClass; production DB validation was not its expectation')
    expect(declaration.eligible).toBe(false)
    expect(declaration.scope).toBe('mocked-grammar-only')
  })
  test('disabled and internal-only source contracts remain diagnostic', () => {
    expect(eligibilityFromScope('disabled-upstream-test', 'A commented-out authored test is not an active acceptance promise').eligible).toBe(false)
    expect(eligibilityFromScope('internal-parser-only', 'A raw lexer test bypasses public preprocessing').eligible).toBe(false)
  })
  test('an old dialect has independent diagnostic scope rather than a zero-cost current-language pass', () => {
    expect(eligibilityFromScope('historical-dialect', 'Authored historical header belongs to a different language revision').eligible).toBe(false)
  })
  test('case names alone cannot reclassify an otherwise positive source', () => {
    const fixture = { id: 'authored-should-not-hang', family: 'flowchart', source: 'flowchart LR\nA[Ready] --> B[Done]' }
    expect(referenceEligibilityFor(fixture).eligible).toBe(true)
  })
})
