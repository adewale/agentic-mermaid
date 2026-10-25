import { expect, test } from 'bun:test'
import { calibrateCriteria, classifyAdmission, compareAdmission } from '../fidelity/classification.ts'

const policy = { families: [{ id: 'flowchart', maturity: 'stable' }, { id: 'usecase', maturity: 'beta' }, { id: 'gantt', maturity: 'stable' }] }
test('docs coverage keeps required support, beta coverage, deliberate CSS rejection and environment failures distinct', () => {
  const unavailable = (family: string) => classifyAdmission(policy, family, { accepted: false, error: 'UnknownDiagramError: No diagram type detected matching given configuration' })
  expect(unavailable('usecase').cause).toBe('optional-family-unavailable')
  expect(unavailable('eventmodeling').cause).toBe('required-family-unavailable')
  expect(unavailable('zenuml').required).toBe(true)
  const security = classifyAdmission(policy, 'gantt', { accepted: false, error: 'RenderConfigError: Raw Mermaid themeCSS is not allowed in default security mode because selectors can escape an imported SVG' })
  expect(security.cause).toBe('security-policy'); expect(security.admission).toBe(false)
  const image = classifyAdmission(policy, 'flowchart', { accepted: false, error: 'EncodingError: The source image cannot be decoded.' })
  expect(image.cause).toBe('environment')
  expect(compareAdmission(classifyAdmission(policy, 'flowchart', { accepted: true }), image).fidelityConclusion).toContain('No drawing-fidelity conclusion')
  expect(classifyAdmission(policy, 'flowchart', { accepted: false, error: 'TypeError: cannot read parser state' }).cause).toBe('runtime-or-unclassified')
})
test('reference failures and missing paint remain in the ledger rather than creating peer fidelity credit', () => {
  const rows = [{ tool: 'mermaid-js/mermaid', caseId: 'authored', criterion: 'relationships', status: 'passed' }, { tool: 'mermaid-js/mermaid', caseId: 'authored', criterion: 'paint', status: 'unavailable' }, { tool: 'mermaid-js/mermaid', caseId: 'bad-fixture', criterion: 'labels', status: 'failed' }, { tool: 'peer', caseId: 'bad-fixture', criterion: 'labels', status: 'passed' }]
  const result = calibrateCriteria(rows)
  expect(result.calibrated).toEqual([{ caseId: 'authored', criterion: 'relationships' }]); expect(result.reviewRequired).toHaveLength(2); expect(result.rawPopulation).toBe(3)
  expect(() => calibrateCriteria([...rows, rows[0]!])).toThrow('Duplicate reference criterion')
})
