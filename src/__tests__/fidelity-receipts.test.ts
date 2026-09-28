import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  FidelityCaseDefinition,
  FidelityJson,
  FidelityReceiptResult,
  FidelitySurface,
  FidelitySurfaceExpectation,
} from './fidelity/contract.ts'
import { discoverFidelityRegistry } from './fidelity/registry.ts'
import { piePathGeometry } from './fidelity/cases/pie-official-fences.fidelity.ts'
import { projectFidelityCapabilityReport } from './fidelity/projector.ts'
import { FIDELITY_REVISION_ACKNOWLEDGEMENTS } from './fidelity/revision-compatibility.ts'
import { runFidelityCases, validateFidelityRegistry } from './fidelity/runner.ts'
import { UPSTREAM_MERMAID_MANIFEST, type UpstreamMermaidManifest } from '../upstream-mermaid-manifest.ts'
import {
  FIDELITY_CAPABILITY_REPORT,
  validateFidelityCapabilityReport,
  type FidelityCapabilityFeature,
  type FidelityCapabilityReport,
} from '../fidelity-capability-report.ts'
import { fidelityFeatureSatisfiesSyntaxParity } from '../fidelity-capability-contract.ts'

const RECEIPT = join(import.meta.dir, 'fidelity', 'generated-receipt.json')
const CAPABILITY_REPORT = join(import.meta.dir, '..', '..', 'docs', 'project', 'fidelity-capability-report.json')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

function clonedManifest(): UpstreamMermaidManifest {
  return JSON.parse(JSON.stringify(UPSTREAM_MERMAID_MANIFEST)) as UpstreamMermaidManifest
}

function makeSerializeNative(feature: FidelityCapabilityFeature): void {
  ;(feature.surfaces as Record<FidelitySurface, unknown>).serialize = 'native'
  for (const evidence of feature.caseEvidence) {
    ;(evidence.surfaces as Record<FidelitySurface, unknown>).serialize = 'native'
  }
}

function setJsonPath(value: FidelityJson, path: readonly (number | string)[], replacement: FidelityJson): FidelityJson {
  const cloned = JSON.parse(JSON.stringify(value)) as FidelityJson
  let cursor: unknown = cloned
  for (const part of path.slice(0, -1)) {
    if (typeof part === 'number') {
      if (!Array.isArray(cursor) || cursor[part] === undefined) throw new Error(`Missing sabotage array path ${path.join('.')}`)
      cursor = cursor[part]
    } else {
      if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || !(part in cursor)) throw new Error(`Missing sabotage object path ${path.join('.')}`)
      cursor = (cursor as Record<string, unknown>)[part]
    }
  }
  const last = path.at(-1)
  if (typeof last === 'number') {
    if (!Array.isArray(cursor) || cursor[last] === undefined) throw new Error(`Missing sabotage array target ${path.join('.')}`)
    cursor[last] = replacement
  } else if (typeof last === 'string') {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || !(last in cursor)) throw new Error(`Missing sabotage object target ${path.join('.')}`)
    ;(cursor as Record<string, unknown>)[last] = replacement
  } else {
    throw new Error('Sabotage path must not be empty')
  }
  return cloned
}

describe('issue #248 construct fidelity receipts', () => {
  test('official Pie path observation rejects hidden extra SVG commands', () => {
    const solid = 'M 119 157 L 119 62 A 95 95 0 1 1 27.65 130.93 Z'
    const donut = 'M 119 62 A 95 95 0 0 1 175.94 233.04 L 130.39 172.21 A 19 19 0 0 0 119 138 Z'
    expect(piePathGeometry(solid).validShape).toBe(true)
    expect(piePathGeometry(donut).validShape).toBe(true)
    expect(piePathGeometry(solid.replace(' Z', ' Z M 400 400 L 401 401 Z')).validShape).toBe(false)
    expect(piePathGeometry(donut.replace(' L 130.39', ' L 400 400 L 130.39')).validShape).toBe(false)
  })

  test('the public projection rejects stale, forged, and unreceipted native claims', () => {
    expect(validateFidelityCapabilityReport(FIDELITY_CAPABILITY_REPORT)).toEqual([])

    const forged = JSON.parse(JSON.stringify(FIDELITY_CAPABILITY_REPORT)) as FidelityCapabilityReport
    const diagnosed = forged.features.find(feature => feature.disposition === 'diagnosed')!
    ;(diagnosed.diagnostics as Record<string, readonly string[]>).render = []
    ;(forged.summary as { caseCount: number }).caseCount++
    ;(forged as { upstreamRevision: string }).upstreamRevision = '0'.repeat(40)
    expect(validateFidelityCapabilityReport(forged)).toEqual(expect.arrayContaining([
      'fidelity capability report upstream revision is stale',
      'fidelity capability case count is stale',
      `${diagnosed.featureId}/render: fidelity capability diagnostic codes are invalid`,
    ]))

    const unknown = JSON.parse(JSON.stringify(FIDELITY_CAPABILITY_REPORT)) as FidelityCapabilityReport
    ;(unknown.features[0] as { featureId: string }).featureId = 'forged:unreceipted-native'
    expect(validateFidelityCapabilityReport(unknown)).toEqual(expect.arrayContaining([
      'forged:unreceipted-native: fidelity capability feature is absent from the pinned manifest',
    ]))

    const forgedDivergence = JSON.parse(JSON.stringify(FIDELITY_CAPABILITY_REPORT)) as FidelityCapabilityReport
    const divergenceTarget = forgedDivergence.features.find(feature => feature.disposition === 'diagnosed')!
    ;(divergenceTarget.acceptedDivergences as unknown as unknown[]).push({
      caseId: divergenceTarget.caseIds[0],
      policy: 'compatibility',
      rationale: 'Too broad to be accepted.',
      surfaces: ['render'],
      diagnosticCodes: { render: ['UNSUPPORTED_FAMILY'] },
    })
    expect(validateFidelityCapabilityReport(forgedDivergence)).toContain(
      `${divergenceTarget.featureId}/${divergenceTarget.caseIds[0]}: accepted divergence policy is invalid`,
    )

    const reusedCase = structuredClone(FIDELITY_CAPABILITY_REPORT)
    const sourceCaseId = reusedCase.features[0]!.caseIds[0]!
    const reuseTarget = reusedCase.features[1]!
    ;(reuseTarget.caseIds as unknown as string[])[0] = sourceCaseId
    ;(reuseTarget.caseEvidence[0] as { caseId: string }).caseId = sourceCaseId
    expect(validateFidelityCapabilityReport(reusedCase)).toEqual(expect.arrayContaining([
      `${reuseTarget.featureId}/${sourceCaseId}: fidelity case id is reused across features`,
      'fidelity capability case count is stale',
    ]))
  })

  test('accepted divergences are explicit, diagnostic-backed, and limited to security/offline policy', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases.find(fidelityCase => fidelityCase.id === 'block.family.accurately-diagnosed-unsupported')!
    const accepted: FidelityCaseDefinition = {
      ...original,
      acceptedDivergence: {
        policy: 'security',
        rationale: 'Callbacks remain disabled in the offline renderer.',
        surfaces: ['agent', 'render'],
      },
    }
    expect(validateFidelityRegistry([accepted])).toEqual([])
    const receipt = await runFidelityCases([accepted], registry.caseFiles)
    const report = projectFidelityCapabilityReport(receipt)
    expect(validateFidelityCapabilityReport(report)).toEqual([])
    expect(report.features[0]!.acceptedDivergences).toEqual([{
      caseId: original.id,
      policy: 'security',
      rationale: 'Callbacks remain disabled in the offline renderer.',
      surfaces: ['agent', 'render'],
      diagnosticCodes: {
        agent: ['UNSUPPORTED_FAMILY'],
        render: ['UNSUPPORTED_FAMILY'],
      },
    }])
    expect(report.features[0]!.caseEvidence).toEqual([{
      caseId: original.id,
      surfaces: {
        agent: 'diagnosed',
        render: 'diagnosed',
        serialize: 'source-preserved',
        mutate: { notApplicable: ['Unsupported families expose no structured mutation target by design.'] },
      },
      diagnostics: {
        agent: ['UNSUPPORTED_FAMILY'],
        render: ['UNSUPPORTED_FAMILY'],
      },
    }])
    expect(fidelityFeatureSatisfiesSyntaxParity(report.features[0]!)).toBe(false)
    const allOtherSurfacesNative = structuredClone(report.features[0]!)
    makeSerializeNative(allOtherSurfacesNative)
    expect(fidelityFeatureSatisfiesSyntaxParity(allOtherSurfacesNative)).toBe(true)

    const broadPolicy = {
      ...accepted,
      acceptedDivergence: { ...accepted.acceptedDivergence!, policy: 'compatibility' },
    } as unknown as FidelityCaseDefinition
    expect(validateFidelityRegistry([broadPolicy])).toContain(
      `${original.id}: accepted divergence policy must be security or offline`,
    )
    const nonDiagnosedSurface: FidelityCaseDefinition = {
      ...accepted,
      acceptedDivergence: { ...accepted.acceptedDivergence!, surfaces: ['serialize'] },
    }
    expect(validateFidelityRegistry([nonDiagnosedSurface])).toContain(
      `${original.id}: accepted divergence surface serialize must be an applicable diagnosed expectation with a named diagnostic`,
    )
  })

  test('every diagnosed case/surface needs its own accepted divergence before syntax parity is satisfied', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases.find(fidelityCase => fidelityCase.id === 'block.family.accurately-diagnosed-unsupported')!
    const accepted: FidelityCaseDefinition = {
      ...original,
      acceptedDivergence: {
        policy: 'security',
        rationale: 'The unsupported family stays disabled on these surfaces.',
        surfaces: ['agent', 'render'],
      },
    }
    const unaccepted: FidelityCaseDefinition = {
      ...original,
      id: 'block.family.unaccepted-same-surface-diagnosis',
    }
    expect(validateFidelityRegistry([accepted, unaccepted])).toEqual([])
    const mixedReceipt = await runFidelityCases([accepted, unaccepted], registry.caseFiles)
    const mixedReport = projectFidelityCapabilityReport(mixedReceipt)
    expect(validateFidelityCapabilityReport(mixedReport)).toEqual([])
    const mixedFeature = structuredClone(mixedReport.features[0]!)
    makeSerializeNative(mixedFeature)
    expect(mixedFeature.caseEvidence.map(evidence => evidence.caseId)).toEqual([
      original.id,
      unaccepted.id,
    ])
    expect(fidelityFeatureSatisfiesSyntaxParity(mixedFeature)).toBe(false)

    const fullyAcceptedReceipt = await runFidelityCases([
      accepted,
      { ...unaccepted, acceptedDivergence: accepted.acceptedDivergence },
    ], registry.caseFiles)
    const fullyAcceptedReport = projectFidelityCapabilityReport(fullyAcceptedReceipt)
    expect(validateFidelityCapabilityReport(fullyAcceptedReport)).toEqual([])
    const fullyAcceptedFeature = structuredClone(fullyAcceptedReport.features[0]!)
    makeSerializeNative(fullyAcceptedFeature)
    expect(fidelityFeatureSatisfiesSyntaxParity(fullyAcceptedFeature)).toBe(true)

    const omittedUnacceptedCase = structuredClone(mixedReport)
    ;(omittedUnacceptedCase.features[0]!.caseEvidence as unknown as unknown[]).pop()
    expect(validateFidelityCapabilityReport(omittedUnacceptedCase)).toContain(
      `${mixedFeature.featureId}: case evidence does not exactly cover case ids in order`,
    )
    expect(fidelityFeatureSatisfiesSyntaxParity(omittedUnacceptedCase.features[0]!)).toBe(false)
    const missingSurface = structuredClone(fullyAcceptedFeature)
    delete (missingSurface.caseEvidence[0]!.surfaces as Partial<Record<FidelitySurface, unknown>>).render
    expect(fidelityFeatureSatisfiesSyntaxParity(missingSurface)).toBe(false)

    const sourcePreserved: FidelityCaseDefinition = {
      ...unaccepted,
      id: 'block.family.unaccepted-source-preserved',
      expected: {
        ...unaccepted.expected,
        agent: {
          applicability: 'applicable',
          disposition: 'source-preserved',
          diagnosticCodes: ['UNSUPPORTED_FAMILY'],
          evaluate: () => 'source-preserved',
        },
        render: {
          applicability: 'applicable',
          disposition: 'source-preserved',
          diagnosticCodes: ['UNSUPPORTED_FAMILY'],
          evaluate: () => 'source-preserved',
        },
      },
    }
    expect(validateFidelityRegistry([accepted, sourcePreserved])).toEqual([])
    const mixedDispositionReport = projectFidelityCapabilityReport(
      await runFidelityCases([accepted, sourcePreserved], registry.caseFiles),
    )
    expect(validateFidelityCapabilityReport(mixedDispositionReport)).toEqual([])
    const mixedDispositionFeature = structuredClone(mixedDispositionReport.features[0]!)
    makeSerializeNative(mixedDispositionFeature)
    expect(fidelityFeatureSatisfiesSyntaxParity(mixedDispositionFeature)).toBe(false)
  })

  test('multi-family features fail closed until receipts can be scoped per family', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases.find(fidelityCase => fidelityCase.id === 'flowchart.links.boundary-whitespace-mutation-closure')!
    const manifest = clonedManifest()
    const feature = manifest.semanticInventory.syntaxFeatures.find(candidate => candidate.id === original.featureId)!
    ;(feature.families as string[]).push('state')
    expect(validateFidelityRegistry([original], manifest)).toContain(
      `${original.id}: multi-family feature ${original.featureId} cannot back a receipt until per-family projection is representable`,
    )
    expect(validateFidelityCapabilityReport(FIDELITY_CAPABILITY_REPORT, manifest)).toEqual(expect.arrayContaining([
      `${original.featureId}: multi-family fidelity capability features are not representable`,
      `${original.featureId}: fidelity capability family does not match the pinned manifest`,
    ]))
  })

  test('the discovered registry executes to the committed fresh result and public capability projection', async () => {
    const registry = await discoverFidelityRegistry()
    expect(registry.caseFiles.map(path => path.slice(import.meta.dir.length + 1))).toEqual([
      'fidelity/cases/class-annotation.fidelity.ts',
      'fidelity/cases/class-bare-link.fidelity.ts',
      'fidelity/cases/class-safe-link-tooltip.fidelity.ts',
      'fidelity/cases/er-multi-class.fidelity.ts',
      'fidelity/cases/er-word-cardinality.fidelity.ts',
      'fidelity/cases/gitgraph-duplicate-official.fidelity.ts',
      'fidelity/cases/journey-official-fence.fidelity.ts',
      'fidelity/cases/landed-adoption.fidelity.ts',
      'fidelity/cases/pie-duplicate-label.fidelity.ts',
      'fidelity/cases/pie-entity-display.fidelity.ts',
      'fidelity/cases/pie-official-fences.fidelity.ts',
      'fidelity/cases/pie-terminal-control.fidelity.ts',
      'fidelity/cases/sankey-official-config-fences.fidelity.ts',
      'fidelity/cases/sankey-official-csv-fences.fidelity.ts',
      'fidelity/cases/seed.fidelity.ts',
      'fidelity/cases/timeline-direction.fidelity.ts',
      'fidelity/cases/xychart-official-fences.fidelity.ts',
    ])
    expect(registry.cases.map(fidelityCase => fidelityCase.id)).toEqual([
      'block.family.accurately-diagnosed-unsupported',
      'class.annotations.inline-native',
      'class.annotations.repeated-diagnosed',
      'class.annotations.separate-native',
      'class.interaction.navigation-target-diagnosed',
      'class.interaction.safe-link-tooltip-native',
      'class.relationship.escaped-directed-native',
      'class.relationship.hyphenated-endpoint-diagnosed',
      'class.relationship.link-dashed-native',
      'class.relationship.link-solid-native',
      'er.classes.multiple-assignments-and-shorthand',
      'er.relationships.word-cardinality-aliases',
      'flowchart.classes.edge-paint-implication',
      'flowchart.links.boundary-whitespace-mutation-closure',
      'gitgraph.official.main-branch-duplicate-id-diagnosed',
      'journey.official.fence-0',
      'journey.scores.fractional-parser-render-seam',
      'pie.official.fence-0',
      'pie.official.fence-1',
      'pie.syntax.authored-formatting-literal',
      'pie.syntax.duplicate-label-first-wins',
      'pie.syntax.entity-spelling-distinct',
      'pie.syntax.escaped-newline-painted-space',
      'pie.syntax.escaped-terminal-control-sanitized',
      'pie.syntax.named-entity-display',
      'pie.syntax.numeric-entity-display',
      'pie.syntax.title-entity-display',
      'pie.syntax.xml-disallowed-control-diagnosed',
      'sankey.links.dark-background-normal-alpha-divergence',
      'sankey.links.light-background-multiply',
      'sankey.links.typed-gradient-endpoints',
      'sankey.official.fence-1',
      'sankey.official.fence-2',
      'sankey.official.fence-3',
      'sankey.official.fence-4',
      'sankey.official.fence-5',
      'sankey.official.fence-6',
      'sankey.official.fence-7',
      'state.comments.trailing-transition-loss',
      'timeline.direction.td-vertical-geometry',
      'timeline.direction.unsupported-header-diagnosis',
      'xychart.official.fence-0',
      'xychart.official.fence-1',
      'xychart.official.fence-2',
      'xychart.official.fence-3',
      'xychart.official.fence-4',
      'xychart.official.fence-5',
      'xychart.official.fence-6',
      'xychart.official.fence-7',
      'xychart.syntax.shared-parser-semantics',
      'xychart.syntax.unknown-statement-render-seam',
    ])

    const receipt = await runFidelityCases(registry.cases, registry.caseFiles)
    expect(receipt).toEqual(readJson<FidelityReceiptResult>(RECEIPT))
    expect(projectFidelityCapabilityReport(receipt)).toEqual(readJson(CAPABILITY_REPORT))
    expect(receipt.summary).toEqual({
      caseCount: 51,
      passedCaseCount: 51,
      failedCaseCount: 0,
      observedSurfaceCount: 179,
      blockedSurfaceCount: 0,
      notApplicableSurfaceCount: 25,
    })
    const capability = projectFidelityCapabilityReport(receipt)
    expect(capability).toMatchObject({ mode: 'public', publicClaimsChanged: true })
    for (const feature of capability.features) {
      expect(Object.keys(feature.surfaces)).toEqual(['agent', 'render', 'serialize', 'mutate'])
      if (feature.featureId === 'official-doc:pie:section:syntax') {
        expect(feature.acceptedDivergences).toEqual([expect.objectContaining({
          caseId: 'pie.syntax.escaped-terminal-control-sanitized',
          policy: 'security',
          surfaces: ['render'],
          diagnosticCodes: { render: ['TERMINAL_CONTROL_CHARACTERS_REPLACED'] },
        })])
      } else {
        expect(feature.acceptedDivergences).toEqual([])
      }
      expect(feature.caseEvidence.map(evidence => evidence.caseId)).toEqual([...feature.caseIds])
    }
    expect(capability.features.find(feature => feature.family === 'state')!.surfaces.mutate).toBe('native')
    expect(capability.features.find(feature => feature.featureId === 'official-doc:class:section:annotations-on-classes')!.surfaces).toEqual({
      agent: 'source-preserved', render: 'diagnosed', serialize: 'source-preserved', mutate: 'diagnosed',
    })
    expect(capability.features.find(feature => feature.featureId === 'official-doc:class:section:defining-relationship')!.surfaces).toEqual({
      agent: 'source-preserved', render: 'diagnosed', serialize: 'source-preserved', mutate: 'diagnosed',
    })
    expect(capability.features.find(feature => feature.featureId === 'official-doc:timeline:section:direction-v11-14-0')!.surfaces).toEqual({
      agent: 'source-preserved', render: 'diagnosed', serialize: 'source-preserved', mutate: 'diagnosed',
    })
    expect(capability.features.find(feature => feature.family === 'journey')!.surfaces).toEqual({
      agent: 'native', render: 'absent', serialize: 'native', mutate: 'native',
    })
    expect(capability.features.find(feature => feature.featureId === 'official-doc:flowchart:section:text-on-links')!.surfaces.mutate).toBe('native')
    expect(capability.features.find(feature => feature.featureId === 'official-doc:sankey:section:links-coloring')!.surfaces.render).toBe('absent')
    expect(capability.features.find(feature => feature.featureId === 'official-doc:xychart:section:syntax')!.surfaces).toEqual({
      agent: 'source-preserved',
      render: 'diagnosed',
      serialize: 'source-preserved',
      mutate: 'diagnosed',
    })
  })

  test('landed-behavior receipts reject sabotaged semantic evidence', async () => {
    const registry = await discoverFidelityRegistry()
    const sabotages: ReadonlyArray<{
      caseId: string
      surface: FidelitySurface
      path: readonly (number | string)[]
      replacement: FidelityJson
      additionalChanges?: readonly Readonly<{ path: readonly (number | string)[]; replacement: FidelityJson }>[]
    }> = [
      {
        caseId: 'journey.official.fence-0',
        surface: 'agent',
        path: ['sections', 0, 'tasks', 2, 'actors'],
        replacement: ['Me'],
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'tasks', 2, 'actorDots', 1, 'actor'],
        replacement: 'Dog',
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'tasks', 2, 'face', 'y'],
        replacement: 256.3,
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['default', 'curve'],
        replacement: null,
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'sections', 0, 'box', 'width'],
        replacement: 1,
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['default', 'curvePaint'],
        replacement: ['transparent', '2'],
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'guideLines', 2, 'y1'],
        replacement: 100,
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'actorLegendText', 1, 'text'],
        replacement: 'Dog',
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'sections', 0, 'box', 'width'],
        replacement: 500,
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'tasks', 0, 'box', 'width'],
        replacement: 260,
        additionalChanges: [{ path: ['parityMode', 'tasks', 0, 'box', 'x'], replacement: 118 }],
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'tasks', 0, 'track', 'y1'],
        replacement: -100,
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'tasks', 2, 'actorDots', 1, 'x'],
        replacement: 540,
      },
      {
        caseId: 'journey.official.fence-0',
        surface: 'render',
        path: ['parityMode', 'actorLegend', 1, 'y'],
        replacement: 94,
        additionalChanges: [{ path: ['parityMode', 'actorLegendText', 1, 'y'], replacement: 94 }],
      },
      {
        caseId: 'journey.scores.fractional-parser-render-seam',
        surface: 'agent',
        path: ['score'],
        replacement: 3,
      },
      {
        caseId: 'journey.scores.fractional-parser-render-seam',
        surface: 'render',
        path: ['midpointY'],
        replacement: false,
      },
      {
        caseId: 'journey.scores.fractional-parser-render-seam',
        surface: 'serialize',
        path: ['reparsedScore'],
        replacement: 3,
      },
      {
        caseId: 'journey.scores.fractional-parser-render-seam',
        surface: 'mutate',
        path: ['mutatedScore'],
        replacement: 4,
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'agent',
        path: ['links', 2, 'target'],
        replacement: 'Unrelated conversion',
      },
      {
        caseId: 'sankey.official.fence-2',
        surface: 'render',
        path: ['links', 1, 'source'],
        replacement: 'Unrelated source',
      },
      {
        caseId: 'sankey.official.fence-3',
        surface: 'render',
        path: ['gradients', 0, 'stops', 0, 'color'],
        replacement: '#ff0000',
      },
      {
        caseId: 'sankey.official.fence-4',
        surface: 'render',
        path: ['nodes', 1, 'label'],
        replacement: 'Heating and cooling, homes',
      },
      {
        caseId: 'sankey.official.fence-4',
        surface: 'serialize',
        path: ['links', 0, 'target'],
        replacement: 'Heating and cooling, homes',
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['links', 0, 'path', 'end', 0],
        replacement: 500,
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['links', 1, 'width'],
        replacement: 147.32,
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['links', 1, 'fill'],
        replacement: '#ff0000',
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['labels', 1, 'y'],
        replacement: 200,
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['labels', 1, 'fill'],
        replacement: 'transparent',
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['nodes', 2, 'y'],
        replacement: 24,
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['nodes', 0, 'height'],
        replacement: 3.46,
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['nodes', 1, 'fill'],
        replacement: '#3b82f6',
        additionalChanges: [{ path: ['gradients', 0, 'stops', 1, 'color'], replacement: '#3b82f6' }],
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['links', 1, 'path', 'start', 1],
        replacement: 110.94,
        additionalChanges: [
          { path: ['links', 1, 'path', 'control1', 1], replacement: 110.94 },
          { path: ['gradients', 1, 'y1'], replacement: 110.94 },
        ],
      },
      {
        caseId: 'sankey.official.fence-3',
        surface: 'render',
        path: ['nodes', 1, 'x'],
        replacement: 35,
        additionalChanges: [
          { path: ['nodes', 2, 'x'], replacement: 35 },
          { path: ['labels', 1, 'x'], replacement: 51 },
          { path: ['labels', 1, 'anchor'], replacement: 'start' },
          { path: ['labels', 2, 'x'], replacement: 51 },
          { path: ['labels', 2, 'anchor'], replacement: 'start' },
          { path: ['links', 0, 'path', 'end', 0], replacement: 35 },
          { path: ['links', 0, 'path', 'control1', 0], replacement: 34.5 },
          { path: ['links', 0, 'path', 'control2', 0], replacement: 34.5 },
          { path: ['links', 1, 'path', 'end', 0], replacement: 35 },
          { path: ['links', 1, 'path', 'control1', 0], replacement: 34.5 },
          { path: ['links', 1, 'path', 'control2', 0], replacement: 34.5 },
          { path: ['gradients', 0, 'x2'], replacement: 35 },
          { path: ['gradients', 1, 'x2'], replacement: 35 },
        ],
      },
      {
        caseId: 'sankey.official.fence-3',
        surface: 'render',
        path: ['nodes', 0, 'fill'],
        replacement: '#000000',
        additionalChanges: [
          { path: ['nodes', 1, 'fill'], replacement: '#000001' },
          { path: ['nodes', 2, 'fill'], replacement: '#000002' },
          { path: ['gradients', 0, 'stops', 0, 'color'], replacement: '#000000' },
          { path: ['gradients', 0, 'stops', 1, 'color'], replacement: '#000001' },
          { path: ['gradients', 1, 'stops', 0, 'color'], replacement: '#000000' },
          { path: ['gradients', 1, 'stops', 1, 'color'], replacement: '#000002' },
        ],
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['links', 0, 'path', 'start', 1],
        replacement: 264.8,
        additionalChanges: [
          { path: ['links', 0, 'path', 'control1', 1], replacement: 264.8 },
          { path: ['gradients', 0, 'y1'], replacement: 264.8 },
          { path: ['links', 1, 'path', 'start', 1], replacement: 110.94 },
          { path: ['links', 1, 'path', 'control1', 1], replacement: 110.94 },
          { path: ['gradients', 1, 'y1'], replacement: 110.94 },
        ],
      },
      {
        caseId: 'sankey.official.fence-1',
        surface: 'render',
        path: ['labels', 0, 'linePositions', 1, 'x'],
        replacement: 1000,
      },
      {
        caseId: 'sankey.official.fence-5',
        surface: 'agent',
        path: ['config', 'labelStyle'],
        replacement: 'legacy',
      },
      {
        caseId: 'sankey.official.fence-5',
        surface: 'render',
        path: ['labels', 1, 'stroke'],
        replacement: null,
      },
      {
        caseId: 'sankey.official.fence-5',
        surface: 'render',
        path: ['labels', 1, 'textLength'],
        replacement: 1,
      },
      {
        caseId: 'sankey.official.fence-5',
        surface: 'render',
        path: ['labels', 1, 'strokeOpacity'],
        replacement: '0',
      },
      {
        caseId: 'sankey.official.fence-6',
        surface: 'render',
        path: ['nodes', 1, 'width'],
        replacement: 10,
      },
      {
        caseId: 'sankey.official.fence-6',
        surface: 'render',
        path: ['nodes', 2, 'y'],
        replacement: 110,
      },
      {
        caseId: 'sankey.official.fence-7',
        surface: 'render',
        path: ['nodes', 2, 'fill'],
        replacement: '#5f79f2',
      },
      {
        caseId: 'sankey.official.fence-7',
        surface: 'render',
        path: ['nodes', 2, 'fillOpacity'],
        replacement: '0',
      },
      {
        caseId: 'sankey.official.fence-7',
        surface: 'render',
        path: ['links', 1, 'strokeOpacity'],
        replacement: '0',
      },
      {
        caseId: 'sankey.official.fence-7',
        surface: 'render',
        path: ['gradients', 1, 'stops', 1, 'opacity'],
        replacement: '0',
      },
      {
        caseId: 'sankey.official.fence-7',
        surface: 'serialize',
        path: ['config', 'nodeColors', 'Industry'],
        replacement: '#5f79f2',
      },
      {
        caseId: 'sankey.links.typed-gradient-endpoints',
        surface: 'render',
        path: ['gradient', 'stops', 0, 'color'],
        replacement: '#00ff00',
      },
      {
        caseId: 'sankey.links.typed-gradient-endpoints',
        surface: 'render',
        path: ['gradient', 'id'],
        replacement: 'broken-gradient-id',
      },
      {
        caseId: 'sankey.links.typed-gradient-endpoints',
        surface: 'render',
        path: ['gradient', 'x1'],
        replacement: '1',
      },
      {
        caseId: 'sankey.links.typed-gradient-endpoints',
        surface: 'render',
        path: ['gradient', 'x1'],
        replacement: '0x22',
      },
      {
        caseId: 'sankey.links.light-background-multiply',
        surface: 'render',
        path: ['links', 0, 'blendMode'],
        replacement: 'normal',
      },
      {
        caseId: 'sankey.links.light-background-multiply',
        surface: 'render',
        path: ['background'],
        replacement: '#000000',
      },
      {
        caseId: 'sankey.links.dark-background-normal-alpha-divergence',
        surface: 'render',
        path: ['links', 0, 'blendMode'],
        replacement: 'screen',
      },
      {
        caseId: 'sankey.links.dark-background-normal-alpha-divergence',
        surface: 'render',
        path: ['links', 0, 'opacity'],
        replacement: '1',
      },
      {
        caseId: 'pie.official.fence-0',
        surface: 'render',
        path: ['paths', 0, 'end', 0],
        replacement: 119,
      },
      {
        caseId: 'pie.official.fence-0',
        surface: 'render',
        path: ['paths', 1, 'centerMove'],
        replacement: [300, 150],
      },
      {
        caseId: 'pie.official.fence-0',
        surface: 'render',
        path: ['paths', 0, 'fill'],
        replacement: '#000000',
        additionalChanges: [{ path: ['swatches', 0, 'fill'], replacement: '#000000' }],
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['paths', 1, 'innerRadii', 0],
        replacement: 0,
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['paths', 1, 'innerLargeArc'],
        replacement: 1,
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['paths', 1, 'validShape'],
        replacement: false,
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['paths', 1, 'highlighted'],
        replacement: false,
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['paths', 1, 'highlightClass'],
        replacement: false,
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['dimSliceOpacity'],
        replacement: '1',
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['highlightRule', 'stroke'],
        replacement: 'none',
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['outerStrokeColor'],
        replacement: 'transparent',
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['outer', 'cy'],
        replacement: 177,
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['legends', 1, 'text'],
        replacement: 'Potassium (46.3%)',
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['legends', 1, 'x'],
        replacement: 1000,
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['swatches', 1, 'x'],
        replacement: 20,
        additionalChanges: [{ path: ['legends', 1, 'x'], replacement: 42 }],
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['swatches', 1, 'y'],
        replacement: 117,
        additionalChanges: [{ path: ['legends', 1, 'y'], replacement: 124 }],
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['sliceLabels', 0, 'fill'],
        replacement: 'transparent',
      },
      {
        caseId: 'pie.official.fence-1',
        surface: 'render',
        path: ['sliceLabels', 0, 'x'],
        replacement: 1000,
      },
      {
        caseId: 'xychart.official.fence-1',
        surface: 'render',
        path: ['lines', 0, 'points', 1, 0],
        replacement: 111.89,
      },
      {
        caseId: 'xychart.official.fence-1',
        surface: 'render',
        path: ['lineStrokeWidth'],
        replacement: '0',
      },
      {
        caseId: 'xychart.official.fence-2',
        surface: 'render',
        path: ['barPaint', 1, 'color'],
        replacement: '#ff00ff',
      },
      {
        caseId: 'xychart.official.fence-2',
        surface: 'render',
        path: ['bars', 0, 'x'],
        replacement: 97.7425,
        additionalChanges: [{ path: ['bars', 4, 'x'], replacement: 97.7425 }],
      },
      {
        caseId: 'xychart.official.fence-2',
        surface: 'render',
        path: ['bars', 0, 'x'],
        replacement: 131.69,
        additionalChanges: [{ path: ['bars', 4, 'x'], replacement: 63.79 }],
      },
      {
        caseId: 'xychart.official.fence-3',
        surface: 'render',
        path: ['bars', 0, 'height'],
        replacement: 1,
      },
      {
        caseId: 'xychart.official.fence-3',
        surface: 'render',
        path: ['bars', 0, 'x'],
        replacement: 1000,
      },
      {
        caseId: 'xychart.official.fence-3',
        surface: 'render',
        path: ['bars', 0, 'width'],
        replacement: 0.00001,
        additionalChanges: [{ path: ['bars', 0, 'x'], replacement: 113.534995 }],
      },
      {
        caseId: 'xychart.official.fence-3',
        surface: 'render',
        path: ['dataLabels', 0, 'x'],
        replacement: 1000,
      },
      {
        caseId: 'xychart.official.fence-3',
        surface: 'render',
        path: ['dataLabels', 0, 'fontSize'],
        replacement: '0',
      },
      {
        caseId: 'xychart.official.fence-3',
        surface: 'render',
        path: ['dataLabelPaint'],
        replacement: 'transparent',
      },
      {
        caseId: 'xychart.official.fence-4',
        surface: 'render',
        path: ['identicalToInsideLabels'],
        replacement: false,
      },
      {
        caseId: 'xychart.official.fence-5',
        surface: 'render',
        path: ['labels', 0, 'x'],
        replacement: 636.78,
      },
      {
        caseId: 'xychart.official.fence-5',
        surface: 'render',
        path: ['labels', 0, 'fill'],
        replacement: '#ff00ff',
      },
      {
        caseId: 'xychart.official.fence-5',
        surface: 'render',
        path: ['lines', 0, 'points', 0, 0],
        replacement: 1131,
      },
      {
        caseId: 'xychart.official.fence-6',
        surface: 'render',
        path: ['labels', 0, 'fontSize'],
        replacement: '16',
      },
      {
        caseId: 'xychart.official.fence-6',
        surface: 'render',
        path: ['lines', 0, 'points', 0, 1],
        replacement: 1361,
      },
      {
        caseId: 'xychart.official.fence-6',
        surface: 'render',
        path: ['yTicks', 0, 'value'],
        replacement: 99,
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'agent',
        path: ['diagram', 'series', 0, 'values', 1],
        replacement: 999,
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'agent',
        path: ['diagram', 'xAxis', 'name'],
        replacement: 'unexpected',
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'agent',
        path: ['diagram', 'xAxis', 'range'],
        replacement: { min: 0, max: 1 },
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'agent',
        path: ['diagram', 'yAxis', 'categories'],
        replacement: ['unexpected'],
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'agent',
        path: ['diagram', 'series', 0, 'pointLabels'],
        replacement: ['unexpected', null],
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'render',
        path: ['bars', 0, 'width'],
        replacement: null,
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'render',
        path: ['bars', 0, 'width'],
        replacement: '0x10',
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'render',
        path: ['bars', 0, 'height'],
        replacement: '0b1000000',
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'render',
        path: ['bars', 0, 'width'],
        replacement: '117.74',
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'mutate',
        path: ['renderedBars', 0, 'value'],
        replacement: '999',
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'mutate',
        path: ['renderedBars', 0, 'width'],
        replacement: '0x10',
      },
      {
        caseId: 'xychart.syntax.shared-parser-semantics',
        surface: 'mutate',
        path: ['renderedBars', 0, 'width'],
        replacement: '147.18',
        additionalChanges: [{ path: ['renderedBars', 1, 'width'], replacement: '58.87' }],
      },
      {
        caseId: 'xychart.syntax.unknown-statement-render-seam',
        surface: 'agent',
        path: ['bodyFamily'],
        replacement: 'flowchart',
      },
      {
        caseId: 'xychart.syntax.unknown-statement-render-seam',
        surface: 'agent',
        path: ['bodySource'],
        replacement: 'xychart-beta\n  bar [1, 2]\n',
      },
      {
        caseId: 'xychart.syntax.unknown-statement-render-seam',
        surface: 'render',
        path: ['errorMessage'],
        replacement: 'Unrecognized XYChart line: "different"',
      },
      {
        caseId: 'flowchart.links.boundary-whitespace-mutation-closure',
        surface: 'mutate',
        path: ['mutatedDiagram', 'edges', 1, 'label'],
        replacement: 'b',
      },
      {
        caseId: 'flowchart.classes.edge-paint-implication',
        surface: 'render',
        path: ['stroke'],
        replacement: '#939395',
      },
      {
        caseId: 'flowchart.classes.edge-paint-implication',
        surface: 'render',
        path: ['className'],
        replacement: null,
      },
      {
        caseId: 'flowchart.links.boundary-whitespace-mutation-closure',
        surface: 'render',
        path: ['rendered', 'edges'],
        replacement: [
          { source: 'A', target: 'B', label: ' a ' },
          { source: 'X', target: 'Y', label: 'ghost' },
        ],
      },
      {
        caseId: 'flowchart.links.boundary-whitespace-mutation-closure',
        surface: 'mutate',
        path: ['rendered', 'edges'],
        replacement: [{ source: 'A', target: 'B', label: ' a ' }],
      },
      {
        caseId: 'flowchart.links.boundary-whitespace-mutation-closure',
        surface: 'mutate',
        path: ['rendered', 'labelGroups', 0, 'visibleText'],
        replacement: ' b ',
        additionalChanges: [{ path: ['rendered', 'labelGroups', 1, 'visibleText'], replacement: ' a ' }],
      },
    ]

    for (const sabotage of sabotages) {
      const original = registry.cases.find(candidate => candidate.id === sabotage.caseId)!
      const sabotaged: FidelityCaseDefinition = {
        ...original,
        id: `${original.id}.sabotage`,
        observe: async () => {
          const evidence = await original.observe()
          const observation = evidence[sabotage.surface]
          if (!observation || observation.status !== 'observed') throw new Error(`${sabotage.caseId}: missing observed ${sabotage.surface}`)
          return {
            ...evidence,
            [sabotage.surface]: {
              ...observation,
              semantics: (sabotage.additionalChanges ?? []).reduce(
                (semantics, change) => setJsonPath(semantics, change.path, change.replacement),
                setJsonPath(observation.semantics, sabotage.path, sabotage.replacement),
              ),
            },
          }
        },
      }
      const receipt = await runFidelityCases([sabotaged], registry.caseFiles)
      expect(receipt.cases[0]!.passed).toBe(false)
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
    expect(() => projectFidelityCapabilityReport(receipt)).toThrow('Cannot project capability report from failing fidelity receipts')
  })

  test('semantic evaluation catches a native claim with a missing rendered edge', async () => {
    const registry = await discoverFidelityRegistry()
    const state = registry.cases.find(fidelityCase => fidelityCase.id === 'state.comments.trailing-transition-loss')!
    const render = state.expected.render
    if (render.applicability !== 'applicable') throw new Error('state render must be applicable')
    const sabotaged: FidelityCaseDefinition = {
      ...state,
      id: 'state.comments.native-claim-sabotage',
      observe: async () => {
        const evidence = await state.observe()
        return {
          ...evidence,
          render: {
            status: 'observed',
            diagnosticCodes: [],
            semantics: { renderedEdges: ['A->B'] },
          },
        }
      },
    }
    const receipt = await runFidelityCases([sabotaged], registry.caseFiles)
    expect(receipt.cases[0]!.passed).toBe(false)
    expect(receipt.cases[0]!.issues).toContain('render: expected native, observed absent')
  })

  test('native flowchart claims require the edge, class assignment, paint, and unrelated topology', async () => {
    const registry = await discoverFidelityRegistry()
    const flowchart = registry.cases.find(fidelityCase => fidelityCase.id === 'flowchart.classes.edge-paint-implication')!
    const edge = { id: 'e1', source: 'A', target: 'B', style: 'solid' }
    const sabotaged: FidelityCaseDefinition = {
      ...flowchart,
      id: 'flowchart.classes.native-oracle-sabotage',
      observe: async () => {
        const evidence = await flowchart.observe()
        return {
          ...evidence,
          agent: {
            status: 'observed',
            diagnosticCodes: [],
            semantics: {
              bodyKind: 'flowchart',
              graphFacts: { nodeIds: ['A', 'B'], edges: [edge], hotClass: { stroke: '#ff0000', strokeWidth: '6px' }, e1Class: null },
            },
          },
          mutate: {
            status: 'observed',
            diagnosticCodes: [],
            semantics: {
              mutationOk: true,
              errorCode: null,
              graphFacts: { nodeIds: ['A'], edges: [edge], hotClass: { stroke: '#00ff00', strokeWidth: '4px' }, e1Class: 'hot' },
            },
          },
        }
      },
    }
    const receipt = await runFidelityCases([sabotaged], registry.caseFiles)
    expect(receipt.cases[0]!.issues).toContain('agent: expected native, observed absent')
    expect(receipt.cases[0]!.issues).toContain('mutate: expected native, observed absent')
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
    expect(() => projectFidelityCapabilityReport(malformedReceipt)).toThrow('invalid observed disposition')
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
    expect(diagnosticReceipt.cases[0]!.issues).toContain('agent: expected diagnostics ["WRONG_CODE"], observed ["COMMENT_DROPPED"]')
  })

  test('diagnosed dispositions require a concrete diagnostic in validation, execution, and projection', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    const agent = original.expected.agent
    if (agent.applicability !== 'applicable') throw new Error('block agent must be applicable')
    const emptyDiagnosis = {
      ...original,
      id: 'block.family.empty-diagnosis',
      expected: { ...original.expected, agent: { ...agent, diagnosticCodes: [] } },
    } as FidelityCaseDefinition
    expect(validateFidelityRegistry([emptyDiagnosis])).toContain('block.family.empty-diagnosis: agent: diagnosed disposition requires at least one diagnostic code')
    await expect(runFidelityCases([emptyDiagnosis], registry.caseFiles)).rejects.toThrow('diagnosed disposition requires at least one diagnostic code')

    const malformedReceipt = readJson<FidelityReceiptResult>(RECEIPT)
    const expectedAgent = malformedReceipt.cases[0]!.expected.agent
    const observedAgent = malformedReceipt.cases[0]!.observations.agent
    if (expectedAgent.applicability !== 'applicable' || !observedAgent || observedAgent.status !== 'observed') throw new Error('block agent fixture must be applicable and observed')
    ;(expectedAgent as unknown as { diagnosticCodes: string[] }).diagnosticCodes = []
    ;(observedAgent as unknown as { diagnosticCodes: string[] }).diagnosticCodes = []
    expect(() => projectFidelityCapabilityReport(malformedReceipt)).toThrow('diagnosed expectation has no diagnostic code')
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

  test('malformed semantic JSON is rejected instead of normalized away', async () => {
    const registry = await discoverFidelityRegistry()
    const original = registry.cases[0]!
    for (const [id, semantics, message] of [
      ['undefined-value', { lost: undefined }, 'fidelity JSON property "lost" is undefined'],
      ['non-plain-object', new Date(0), 'fidelity JSON objects must be plain records'],
    ] as const) {
      const malformed: FidelityCaseDefinition = {
        ...original,
        id: `block.family.${id}`,
        observe: async () => {
          const evidence = await original.observe()
          const agent = evidence.agent
          if (!agent || agent.status !== 'observed') throw new Error('block agent evidence must be observed')
          return { ...evidence, agent: { ...agent, semantics } } as never
        },
      }
      const receipt = await runFidelityCases([malformed], registry.caseFiles)
      expect(receipt.cases[0]!.issues[0]).toBe(`observer failed: ${message}`)
    }
  })
})
