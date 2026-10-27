import { expect, test } from 'bun:test'
import { grammarFinderReport } from '../../scripts/ci/grammar-finder-report.ts'
import type { GrammarTriageResult } from '../../eval/mermaid-modern-compat/grammar-triage.ts'

const source = 'classDiagram\nclass A["direction RL"] {\n+x\n}'
const row: GrammarTriageResult = { family: 'class', source, disposition: 'reader-extension', referenceAccepted: false, canonical: 'classDiagram\nclass A', warningCodes: [], semanticFields: ['classes'], defects: [] }
const summary = {
  seed: 7, mutationsPerFamily: 100,
  // Raw finder evidence is deliberately present: a disagreement is not a bug.
  silentReads: { definition: 'Reference rejects; native reads', total: 1, byFamily: { class: { corpus: 0, mutations: 1 } }, examples: [{ family: 'class', id: 'class-7-1', spelled: JSON.stringify(source), mermaid: 'Rejected', ours: { native: 'accepted', envelope: 'class structured', read: source }, verify: [], occurrences: 1 }] },
  contractFindings: [row],
}

test('grammar issue reporting keeps a raw disagreement in artifacts', () => {
  expect(grammarFinderReport(summary, 'https://example.test/run/1')).toBe('')
})

test('grammar issue reporting links a known defect without requiring an open collector', () => {
  const known = { ...row, disposition: 'defect' as const, defects: [{ kind: 'portable-export' as const, detail: 'Rejected canonical token', trackedBy: 548 }] }
  expect(grammarFinderReport({ ...summary, contractFindings: [known] }, 'https://example.test/run/1')).toBe('')
  // Repairing a known defect is permitted; the report never requires it to persist.
  expect(grammarFinderReport({ ...summary, contractFindings: [{ ...known, defects: [] }] }, 'https://example.test/run/2')).toBe('')
})

test('a new failure on a previously reviewed source gets a finite actionable report', () => {
  const changed = { ...row, reviewed: 'tracked-defect' as const, disposition: 'defect' as const, defects: [
    { kind: 'portable-export' as const, detail: 'Known rejected token', trackedBy: 548 },
    { kind: 'meaning-change' as const, detail: 'Class label changed' },
  ] }
  const report = grammarFinderReport({ ...summary, contractFindings: [changed] }, 'https://example.test/run/2')
  expect(report).toContain('meaning-change: Class label changed')
  expect(report).toContain(JSON.stringify(source))
  expect(report).toContain('https://example.test/run/2')
  expect(report).toContain('Done when every retained failure')
  expect(report).not.toContain('portable-export: Known rejected token')
})

test('grammar reports keep parser error text inside a complete code fence', () => {
  const detail = 'Rejected token\n```\n@someone\n![untrusted](https://example.test/image)'
  const result = { ...row, disposition: 'defect' as const, defects: [{ kind: 'portable-export' as const, detail }] }
  const report = grammarFinderReport({ ...summary, contractFindings: [result] }, 'https://example.test/run/3')
  expect(report).toContain('````\nportable-export: ' + detail + '\n````')
})
