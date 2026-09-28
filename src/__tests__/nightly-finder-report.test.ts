import { describe, expect, test } from 'bun:test'
import { finderReport } from '../../scripts/ci/nightly-finder-report.ts'

const RUN = 'https://github.com/adewale/agentic-mermaid/actions/runs/1'

describe('nightly finder report', () => {
  test('lists each failing test once and keeps the fast-check reproduction', () => {
    const log = [
      'src/__tests__/property-parser.test.ts:',
      '(pass) parser > round-trips [12.00ms]',
      'error: Property failed after 37 tests',
      '{ seed: -1234567, path: "36:1:0", endOnFailure: true }',
      'Counterexample: ["flowchart LR\\n  A --> B"]',
      '(fail) parser > structural counts survive serialization [88.10ms]',
      '(fail) parser > structural counts survive serialization [88.10ms]',
      '(fail) layout > edge-add monotonicity',
    ].join('\n')
    const report = finderReport(log, RUN)
    expect(report.failingTests).toEqual([
      'parser > structural counts survive serialization',
      'layout > edge-add monotonicity',
    ])
    expect(report.reproductions).toEqual([
      'error: Property failed after 37 tests',
      '{ seed: -1234567, path: "36:1:0", endOnFailure: true }',
      'Counterexample: ["flowchart LR\\n  A --> B"]',
    ])
    expect(report.body).toContain(RUN)
    expect(report.body).toContain('- parser > structural counts survive serialization')
    expect(report.body).toContain('`examples` entry')
  })

  test('still produces an actionable body when no seed line was captured', () => {
    const report = finderReport('(fail) website > builds [30001.00ms]\n  ^ this test timed out after 30000ms.', RUN)
    expect(report.failingTests).toEqual(['website > builds'])
    expect(report.reproductions).toEqual([])
    expect(report.body).toContain('No fast-check seed line was captured')
  })
})
