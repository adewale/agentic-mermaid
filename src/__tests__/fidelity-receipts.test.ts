import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FidelityCaseDefinition, FidelityReceiptResult, FidelitySurfaceExpectation } from './fidelity/contract.ts'
import { discoverFidelityRegistry } from './fidelity/registry.ts'
import { projectFidelityCapabilityShadow } from './fidelity/projector.ts'
import { FIDELITY_REVISION_ACKNOWLEDGEMENTS } from './fidelity/revision-compatibility.ts'
import { runFidelityCases, validateFidelityRegistry } from './fidelity/runner.ts'
import { UPSTREAM_MERMAID_MANIFEST, type UpstreamMermaidManifest } from '../upstream-mermaid-manifest.ts'

const RECEIPT = join(import.meta.dir, 'fidelity', 'generated-receipt.json')
const SHADOW = join(import.meta.dir, '..', '..', 'docs', 'project', 'fidelity-capability-shadow.json')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function clonedManifest(): UpstreamMermaidManifest {
  return JSON.parse(JSON.stringify(UPSTREAM_MERMAID_MANIFEST)) as UpstreamMermaidManifest
}

describe('issue #248 construct fidelity receipts', () => {
  test('the discovered registry executes to the committed fresh result and explicit shadow projection', async () => {
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
      notApplicableSurfaceCount: 4,
    })
    for (const feature of projectFidelityCapabilityShadow(receipt).features) {
      expect(Object.keys(feature.surfaces)).toEqual(['agent', 'render', 'serialize', 'mutate'])
    }
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

  test('revision closure fails missing pins and prevents historical artifacts from backing receipts', async () => {
    const registry = await discoverFidelityRegistry()
    const withoutAcknowledgements = validateFidelityRegistry([], UPSTREAM_MERMAID_MANIFEST, [])
    expect(withoutAcknowledgements).toContain('docs-corpus: missing upstream revision without historical-only acknowledgement')
    expect(withoutAcknowledgements).toContain('gantt-cases: missing upstream revision without historical-only acknowledgement')
    expect(withoutAcknowledgements).toContain('gantt-exclusions: missing upstream revision without historical-only acknowledgement')
    expect(withoutAcknowledgements).toContain(`suite-cases: unacknowledged revision split a2d9686451df7c4644a3eeca20535bbd4c5776b0 != ${UPSTREAM_MERMAID_MANIFEST.provenance.commit}`)
    expect(validateFidelityRegistry(registry.cases, UPSTREAM_MERMAID_MANIFEST, FIDELITY_REVISION_ACKNOWLEDGEMENTS)).toEqual([])

    const missingPin = clonedManifest()
    const blockArtifact = missingPin.semanticInventory.sourceArtifacts.find(artifact => artifact.id === 'official-doc:block')!
    delete blockArtifact.upstreamRevision
    expect(validateFidelityRegistry([], missingPin, FIDELITY_REVISION_ACKNOWLEDGEMENTS)).toContain('official-doc:block: missing upstream revision without historical-only acknowledgement')

    const quarantined = clonedManifest()
    quarantined.semanticInventory.syntaxFeatures.find(feature => feature.id === registry.cases[0]!.featureId)!.artifact = 'docs-corpus'
    expect(validateFidelityRegistry([registry.cases[0]!], quarantined, FIDELITY_REVISION_ACKNOWLEDGEMENTS)).toContain(
      `${registry.cases[0]!.id}: feature artifact docs-corpus is historical-only and cannot back a current receipt`,
    )
  })

  test('blocked applicable surfaces remain explicit and fail the receipt', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    const notApplicable = (rationale: string): FidelitySurfaceExpectation => ({ applicability: 'not-applicable', rationale })
    const blocked: FidelityCaseDefinition = {
      ...original,
      id: 'block.family.blocked-surface-sabotage',
      expected: {
        agent: original.expected.agent,
        render: original.expected.render,
        serialize: notApplicable('Not part of this blocked-surface sabotage.'),
        mutate: notApplicable('Not part of this blocked-surface sabotage.'),
      },
      observe: () => ({
        agent: {
          status: 'observed',
          diagnosticCodes: ['UNSUPPORTED_FAMILY'],
          semantics: { bodyKind: 'preserved', upstreamFamilyId: 'block' },
        },
        render: {
          status: 'blocked',
          blockedBy: 'agent',
          diagnosticCodes: [],
          semantics: { reason: 'sabotage' },
        },
      }),
    }
    const receipt = await runFidelityCases([blocked], registry.caseFiles)
    expect(receipt.summary).toEqual({
      caseCount: 1,
      passedCaseCount: 0,
      failedCaseCount: 1,
      observedSurfaceCount: 1,
      blockedSurfaceCount: 1,
      notApplicableSurfaceCount: 2,
    })
    expect(receipt.cases[0]!.issues).toEqual(['render: blocked by agent'])
    expect(() => projectFidelityCapabilityShadow(receipt)).toThrow('Cannot project capability shadow from failing fidelity receipts')
  })

  test('semantic evaluation has teeth when a known absence is mislabeled native', async () => {
    const registry = await discoverFidelityRegistry()
    const state = registry.cases.find(fidelityCase => fidelityCase.id === 'state.comments.trailing-transition-loss')!
    const render = state.expected.render
    if (render.applicability !== 'applicable') throw new Error('state render must be applicable')
    const sabotaged: FidelityCaseDefinition = {
      ...state,
      id: 'state.comments.native-claim-sabotage',
      expected: { ...state.expected, render: { ...render, disposition: 'native' } },
    }
    const receipt = await runFidelityCases([sabotaged], registry.caseFiles)
    expect(receipt.cases[0]!.passed).toBe(false)
    expect(receipt.cases[0]!.issues).toContain('render: expected native, observed absent')
  })

  test('runtime schemas and the projector reject unknown dispositions independently', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    const malformedExpectation = {
      ...original,
      id: 'block.family.invalid-disposition',
      expected: {
        ...original.expected,
        agent: { ...original.expected.agent, disposition: 'bogus' },
      },
    } as unknown as FidelityCaseDefinition
    expect(validateFidelityRegistry([malformedExpectation])).toContain('block.family.invalid-disposition: agent: invalid disposition bogus')
    await expect(runFidelityCases([malformedExpectation], registry.caseFiles)).rejects.toThrow('invalid disposition bogus')

    const malformedReceipt = readJson<FidelityReceiptResult>(RECEIPT)
    const observation = malformedReceipt.cases[0]!.observations.agent
    if (!observation || observation.status !== 'observed') throw new Error('fixture agent observation must be observed')
    ;(observation as { disposition: string }).disposition = 'bogus'
    expect(() => projectFidelityCapabilityShadow(malformedReceipt)).toThrow('invalid observed disposition')
  })

  test('every surface needs an applicability decision and every applicable surface needs an evaluator', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    const agent = original.expected.agent
    if (agent.applicability !== 'applicable') throw new Error('block agent must be applicable')
    const missingEvaluator = {
      ...original,
      id: 'block.family.missing-evaluator',
      expected: { ...original.expected, agent: { ...agent, evaluate: undefined } },
    } as unknown as FidelityCaseDefinition
    expect(validateFidelityRegistry([missingEvaluator])).toContain('block.family.missing-evaluator: agent: executable semantic evaluator is required')

    const missingSurface = {
      ...original,
      id: 'block.family.missing-surface',
      expected: { agent: original.expected.agent, render: original.expected.render, serialize: original.expected.serialize },
    } as unknown as FidelityCaseDefinition
    expect(validateFidelityRegistry([missingSurface])).toContain('block.family.missing-surface: mutate: expectation is missing or invalid')

    const emptyRationale = {
      ...original,
      id: 'block.family.empty-rationale',
      expected: { ...original.expected, mutate: { applicability: 'not-applicable', rationale: '' } },
    } as FidelityCaseDefinition
    expect(validateFidelityRegistry([emptyRationale])).toContain('block.family.empty-rationale: mutate: not-applicable rationale is empty')
  })

  test('semantic evaluator failures and diagnostic mismatches fail receipts', async () => {
    const registry = await discoverFidelityRegistry()
    const state = registry.cases.find(fidelityCase => fidelityCase.id === 'state.comments.trailing-transition-loss')!
    const agent = state.expected.agent
    if (agent.applicability !== 'applicable') throw new Error('state agent must be applicable')
    const throwing: FidelityCaseDefinition = {
      ...state,
      id: 'state.comments.throwing-evaluator',
      expected: {
        ...state.expected,
        agent: {
          ...agent,
          evaluate: () => {
            throw new Error('sabotaged oracle')
          },
        },
      },
    }
    const throwingReceipt = await runFidelityCases([throwing], registry.caseFiles)
    expect(throwingReceipt.cases[0]!.issues).toContain('agent: semantic evaluator failed: sabotaged oracle')

    const wrongDiagnostic: FidelityCaseDefinition = {
      ...state,
      id: 'state.comments.wrong-diagnostic',
      expected: { ...state.expected, agent: { ...agent, diagnosticCodes: ['WRONG_CODE'] } },
    }
    const diagnosticReceipt = await runFidelityCases([wrongDiagnostic], registry.caseFiles)
    expect(diagnosticReceipt.cases[0]!.issues).toContain('agent: expected diagnostics ["WRONG_CODE"], observed ["UNSUPPORTED_SYNTAX"]')
  })

  test('observer failures and malformed observations fail closed', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    const malformed: FidelityCaseDefinition = {
      ...original,
      id: 'block.family.malformed-observation',
      observe: () => ({
        agent: {
          status: 'observed',
          disposition: 'native',
          diagnosticCodes: [],
          semantics: {},
        },
      }) as never,
    }
    const receipt = await runFidelityCases([malformed], registry.caseFiles)
    expect(receipt.cases[0]!.passed).toBe(false)
    expect(receipt.cases[0]!.issues[0]).toBe('observer failed: agent: unknown fields disposition')
    expect(receipt.summary.blockedSurfaceCount).toBe(3)
  })
})
