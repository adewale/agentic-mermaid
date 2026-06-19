// Move 2: pin the rankWarnings ordering directly (move 6 shipped the helper and
// wired it into `am verify --json`, but only the envelope was exercised).
//
// Order: Tier 1 structural → Tier 2 geometric → Tier 3 lint, and within a tier
// errors before warnings — the project's established importance hierarchy, so
// the most-important issue surfaces first.

import { describe, test, expect } from 'bun:test'
import { rankWarnings, type LayoutWarning } from '../agent/types.ts'

const W = {
  emptyStructuralError: { code: 'EMPTY_DIAGRAM' } as LayoutWarning,
  labelStructuralWarning: { code: 'LABEL_OVERFLOW', target: 'A', charCount: 99, limit: 40 } as LayoutWarning,
  overlapGeometric: { code: 'NODE_OVERLAP', a: 'A', b: 'B', areaPx: 5 } as LayoutWarning,
  dupLint: { code: 'DUPLICATE_EDGE', edge: 'A->B', duplicateOf: 'A->B', from: 'A', to: 'B' } as LayoutWarning,
  faithfulnessLint: { code: 'CONTENT_DROPPED_ON_ROUNDTRIP', before: { nodes: 3, edges: 2, groups: 0 }, after: { nodes: 2, edges: 2, groups: 0 } } as LayoutWarning,
}

describe('rankWarnings', () => {
  test('sorts Tier 1 → 2 → 3, errors before warnings within a tier', () => {
    // Deliberately scrambled input order.
    const ranked = rankWarnings([W.dupLint, W.overlapGeometric, W.labelStructuralWarning, W.emptyStructuralError])
    expect(ranked.map(r => r.code)).toEqual(['EMPTY_DIAGRAM', 'LABEL_OVERFLOW', 'NODE_OVERLAP', 'DUPLICATE_EDGE'])
  })

  test('annotates each warning with its tier and severity', () => {
    const ranked = rankWarnings([W.emptyStructuralError, W.overlapGeometric, W.faithfulnessLint])
    const byCode = Object.fromEntries(ranked.map(r => [r.code, { tier: r.tier, severity: r.severity }]))
    expect(byCode.EMPTY_DIAGRAM).toEqual({ tier: 'structural', severity: 'error' })
    expect(byCode.NODE_OVERLAP).toEqual({ tier: 'geometric', severity: 'warning' })
    expect(byCode.CONTENT_DROPPED_ON_ROUNDTRIP).toEqual({ tier: 'lint', severity: 'warning' })
  })

  test('preserves the original warning object under .warning', () => {
    const ranked = rankWarnings([W.labelStructuralWarning])
    expect(ranked[0]!.warning).toBe(W.labelStructuralWarning)
  })

  test('a lint warning never outranks a structural error', () => {
    const ranked = rankWarnings([W.faithfulnessLint, W.emptyStructuralError])
    expect(ranked[0]!.code).toBe('EMPTY_DIAGRAM')
  })

  test('empty input yields empty output', () => {
    expect(rankWarnings([])).toEqual([])
  })

  // Focused 2-element cases that isolate each half of the sort comparator
  // `tierDiff || severityDiff`, so dropping EITHER half flips the result
  // (input is given in reverse of the expected order).
  test('within one tier, the severity tiebreak orders error before warning', () => {
    const ranked = rankWarnings([W.labelStructuralWarning, W.emptyStructuralError])
    expect(ranked.map(r => r.code)).toEqual(['EMPTY_DIAGRAM', 'LABEL_OVERFLOW'])
  })

  test('at equal severity, the tier term orders structural before lint', () => {
    const ranked = rankWarnings([W.dupLint, W.labelStructuralWarning])  // both severity=warning
    expect(ranked.map(r => r.code)).toEqual(['LABEL_OVERFLOW', 'DUPLICATE_EDGE'])
  })

  // A SCRAMBLED input whose correct order is neither the input order nor its
  // reverse — so a comparator stuck at a constant (always-0 keeps input,
  // always-1 reverses it) produces a wrong order either way.
  test('a scrambled input sorts correctly (defeats a constant comparator)', () => {
    const ranked = rankWarnings([W.overlapGeometric, W.emptyStructuralError, W.dupLint, W.labelStructuralWarning])
    expect(ranked.map(r => r.code)).toEqual(['EMPTY_DIAGRAM', 'LABEL_OVERFLOW', 'NODE_OVERLAP', 'DUPLICATE_EDGE'])
  })
})
