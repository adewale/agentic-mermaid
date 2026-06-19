// Move 1: LLM-judge protocol hardening.
//
// The original harness mocked the judge from measureQuality (circular) and had
// none of the documented LLM-as-judge mitigations (Zheng et al., NeurIPS 2023).
// These tests pin the primitives that make a real periodic judge trustworthy:
// position-bias de-biasing, self-enhancement independence, reference-guided
// requests, and a faithfulness oracle independent of the perceptual metrics.

import { describe, test, expect } from 'bun:test'
import {
  buildJudgeRequest, judgePairwiseDebiased, assertJudgeIndependence, modelFamily,
  independentFaithfulness, type JudgeRequest, type PairwiseJudgeFn,
} from '../../eval/llm-judge/judge.ts'

const reqA = buildJudgeRequest('flowchart', 'flowchart LR\n  A --> B', 'a')!
const reqB = buildJudgeRequest('flowchart', 'flowchart LR\n  A --> B --> C', 'b')!

describe('LLM-judge: position-bias de-biasing', () => {
  test('a position-biased judge (always picks left) is reported inconsistent', async () => {
    const alwaysLeft: PairwiseJudgeFn = async () => 'left'
    const v = await judgePairwiseDebiased(reqA, reqB, alwaysLeft)
    // ab → 'a' wins, ba → 'b' wins: the orders disagree, so no winner is trusted.
    expect(v.winner).toBe('inconsistent')
  })

  test('a consistent judge yields a trusted winner in both orders', async () => {
    // Prefers whichever request has the longer source (order-independent).
    const preferLonger: PairwiseJudgeFn = async (l, r) =>
      l.source.length === r.source.length ? 'tie' : l.source.length > r.source.length ? 'left' : 'right'
    const v = await judgePairwiseDebiased(reqA, reqB, preferLonger)
    expect(v.winner).toBe('b')  // reqB has the longer source, regardless of order
  })

  test('a genuine tie survives de-biasing', async () => {
    const alwaysTie: PairwiseJudgeFn = async () => 'tie'
    const v = await judgePairwiseDebiased(reqA, reqB, alwaysTie)
    expect(v.winner).toBe('tie')
  })
})

describe('LLM-judge: self-enhancement independence', () => {
  test('modelFamily buckets known providers', () => {
    expect(modelFamily('claude-opus-4-8')).toBe('claude')
    expect(modelFamily('gpt-4o')).toBe('gpt')
    expect(modelFamily('gemini-2.0-flash')).toBe('gemini')
  })

  test('same-family author+judge throws', () => {
    expect(() => assertJudgeIndependence('claude-opus-4-8', 'claude-sonnet-4-6')).toThrow(/independence/)
  })

  test('cross-family author+judge is allowed', () => {
    expect(() => assertJudgeIndependence('claude-opus-4-8', 'gpt-4o')).not.toThrow()
  })
})

describe('LLM-judge: reference-guided requests', () => {
  test('buildJudgeRequest threads a golden reference when provided', () => {
    const ref = { svg: '<svg>golden</svg>', note: 'blessed layout' }
    const req = buildJudgeRequest('flowchart', 'flowchart LR\n  A --> B', 'r', ref)
    expect(req?.reference).toEqual(ref)
  })

  test('reference is omitted by default (backward compatible)', () => {
    const req = buildJudgeRequest('flowchart', 'flowchart LR\n  A --> B', 'r')
    expect(req?.reference).toBeUndefined()
  })
})

describe('LLM-judge: faithfulness oracle independent of measureQuality', () => {
  test('a faithful diagram scores 5 without consulting perceptual metrics', () => {
    // Many edges → a visually busy layout (low aesthetics under measureQuality),
    // yet faithfulness must stay 5 because no content is dropped. This is the
    // whole point of decoupling the axes.
    const busy = 'flowchart TD\n' + ['A-->B', 'A-->C', 'A-->D', 'B-->D', 'C-->D', 'B-->C'].map(s => '  ' + s).join('\n')
    expect(independentFaithfulness(busy)).toBe(5)
  })

  test('non-flowchart families are scored on structure too', () => {
    expect(independentFaithfulness('sequenceDiagram\n  A->>B: hi\n  B-->>A: ok')).toBe(5)
    expect(independentFaithfulness('erDiagram\n  A ||--o{ B : has')).toBe(5)
  })

  test('unparseable source returns null (no fabricated score)', () => {
    expect(independentFaithfulness('this is not a diagram')).toBeNull()
  })
})
