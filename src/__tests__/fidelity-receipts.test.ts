import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { discoverFidelityRegistry } from './fidelity/registry.ts'
import { projectFidelityCapabilityShadow } from './fidelity/projector.ts'
import { runFidelityCases, validateFidelityRegistry } from './fidelity/runner.ts'
import { FIDELITY_REVISION_ACKNOWLEDGEMENTS } from './fidelity/revision-compatibility.ts'
import type { FidelityCaseDefinition, FidelityReceiptResult } from './fidelity/contract.ts'
import { UPSTREAM_MERMAID_MANIFEST } from '../upstream-mermaid-manifest.ts'

const RECEIPT = join(import.meta.dir, 'fidelity', 'generated-receipt.json')
const SHADOW = join(import.meta.dir, '..', '..', 'docs', 'project', 'fidelity-capability-shadow.json')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

describe('issue #248 construct fidelity receipts', () => {
  test('the discovered registry executes to the committed fresh result and shadow projection', async () => {
    const registry = await discoverFidelityRegistry()
    expect(registry.caseFiles.map(path => path.slice(import.meta.dir.length + 1))).toEqual(['fidelity/cases/seed.fidelity.ts'])
    expect(registry.cases.map(fidelityCase => fidelityCase.id)).toEqual(['block.family.accurately-diagnosed-unsupported', 'flowchart.classes.edge-paint-implication', 'journey.scores.fractional-parser-render-seam', 'state.comments.trailing-transition-loss'])

    const receipt = await runFidelityCases(registry.cases, registry.caseFiles)
    expect(receipt).toEqual(readJson<FidelityReceiptResult>(RECEIPT))
    expect(projectFidelityCapabilityShadow(receipt)).toEqual(readJson(SHADOW))
    expect(receipt.summary).toEqual({
      caseCount: 4,
      passedCaseCount: 4,
      failedCaseCount: 0,
      observedSurfaceCount: 12,
      blockedSurfaceCount: 0,
    })
  })

  test('registry validation rejects duplicate/unknown cases and unacknowledged revision splits', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    const duplicate = { ...original }
    const unknownFeature = { ...original, id: 'block.family.unknown-feature', featureId: 'missing:feature' }
    const split = {
      ...original,
      id: 'block.family.unacknowledged-split',
      upstreamRevision: 'a'.repeat(40),
    }
    const issues = validateFidelityRegistry([original, duplicate, unknownFeature, split], UPSTREAM_MERMAID_MANIFEST, FIDELITY_REVISION_ACKNOWLEDGEMENTS)
    expect(issues).toContain(`${original.id}: duplicate case id`)
    expect(issues).toContain(`${unknownFeature.id}: unknown feature id missing:feature`)
    expect(issues).toContain(`${split.id}: unacknowledged case revision split ${'a'.repeat(40)} != ${UPSTREAM_MERMAID_MANIFEST.provenance.commit}`)
  })

  test('the global revision-closure gate rejects removal or stale expansion of the reviewed acknowledgement', async () => {
    const registry = await discoverFidelityRegistry()
    const withoutAcknowledgement = validateFidelityRegistry(registry.cases, UPSTREAM_MERMAID_MANIFEST, [])
    expect(withoutAcknowledgement).toEqual([
      `suite-accounting: unacknowledged revision split a2d9686451df7c4644a3eeca20535bbd4c5776b0 != ${UPSTREAM_MERMAID_MANIFEST.provenance.commit}`,
      `suite-cases: unacknowledged revision split a2d9686451df7c4644a3eeca20535bbd4c5776b0 != ${UPSTREAM_MERMAID_MANIFEST.provenance.commit}`,
      `suite-exclusions: unacknowledged revision split a2d9686451df7c4644a3eeca20535bbd4c5776b0 != ${UPSTREAM_MERMAID_MANIFEST.provenance.commit}`,
    ])
    expect(validateFidelityRegistry(registry.cases, UPSTREAM_MERMAID_MANIFEST, FIDELITY_REVISION_ACKNOWLEDGEMENTS)).toEqual([])
  })

  test('blocked applicable surfaces remain explicit and fail the receipt', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    const blocked: FidelityCaseDefinition = {
      ...original,
      id: 'block.family.blocked-surface-sabotage',
      expected: { agent: 'diagnosed', render: 'diagnosed' },
      expectedDiagnostics: [{ surface: 'agent', code: 'UNSUPPORTED_FAMILY' }],
      observe: () => ({
        agent: {
          status: 'observed',
          disposition: 'diagnosed',
          diagnosticCodes: ['UNSUPPORTED_FAMILY'],
          semantics: {},
        },
        render: {
          status: 'blocked',
          blockedBy: 'agent',
          diagnosticCodes: [],
          semantics: { reason: 'sabotage' },
        },
      }),
      assertSemantics: undefined,
    }
    const receipt = await runFidelityCases([blocked], registry.caseFiles)
    expect(receipt.summary).toEqual({
      caseCount: 1,
      passedCaseCount: 0,
      failedCaseCount: 1,
      observedSurfaceCount: 1,
      blockedSurfaceCount: 1,
    })
    expect(receipt.cases[0]!.issues).toEqual(['render: blocked by agent'])
    expect(() => projectFidelityCapabilityShadow(receipt)).toThrow('Cannot project capability shadow from failing fidelity receipts')
  })

  test('disposition comparison has teeth when a known absence is mislabeled native', async () => {
    const registry = await discoverFidelityRegistry()
    const state = registry.cases.find(fidelityCase => fidelityCase.id === 'state.comments.trailing-transition-loss')!
    const sabotaged: FidelityCaseDefinition = {
      ...state,
      id: 'state.comments.native-claim-sabotage',
      expected: { ...state.expected, render: 'native' },
    }
    const receipt = await runFidelityCases([sabotaged], registry.caseFiles)
    expect(receipt.cases[0]!.passed).toBe(false)
    expect(receipt.cases[0]!.issues).toContain('render: expected native, observed absent')
  })
})
