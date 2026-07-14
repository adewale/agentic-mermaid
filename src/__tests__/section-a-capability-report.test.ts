import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_FAMILY_CAPABILITY_KEYS_ORDERED,
  ALL_RENDER_TRANSPORT_KEYS_ORDERED,
  createSectionACapabilityReport,
  sectionACapabilityReportMarkdown,
  validateSectionACapabilityReport,
  type SectionACapabilityReport,
} from '../section-a-capability-report.ts'
import {
  FAMILY_CAPABILITY_COLUMNS,
  UNREGISTERED_FAMILY_CAPABILITY_STATES,
  getFamily,
  knownFamilies,
  type FamilyDescriptor,
  type FamilyScenePrimitiveEvidence,
} from '../agent/families.ts'
import { registerFamily } from '../agent/family-registration.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { DefaultBackend, registerBackend } from '../scene/backend.ts'
import {
  FAMILY_SCOPED_RENDER_OPTION_FIELDS,
  RENDER_OUTPUTS,
  RENDER_TRANSPORT_SURFACES,
} from '../render-contract.ts'
import {
  NATIVE_PNG_HOST_ONLY_OPTION_FIELDS,
  PNG_OUTPUT_OPTION_FIELDS,
  PORTABLE_PNG_OUTPUT_OPTION_FIELDS,
} from '../png-contract.ts'

const ROOT = join(import.meta.dir, '..', '..')
const MARKDOWN = join(ROOT, 'docs', 'project', 'section-a-capability-report.md')

describe('Section A capability report', () => {
  test('ships on a dedicated subpath without pulling audit corpora into the renderer barrel', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(pkg.exports['./capabilities']).toMatchObject({
      types: './dist/capabilities.d.ts',
      bun: './src/capabilities.ts',
      import: './dist/capabilities.js',
    })
    expect(pkg.exports['./resources']).toMatchObject({
      types: './dist/resources.d.ts',
      bun: './src/resources.ts',
      import: './dist/resources.js',
    })
    const rendererBarrel = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')
    expect(rendererBarrel).not.toContain("'./section-a-capability-report.ts'")
    expect(rendererBarrel).not.toContain("'./upstream-mermaid-manifest.ts'")
  })

  test('is a valid, immutable, JSON-safe projection of live authorities', () => {
    const report = createSectionACapabilityReport()
    expect(ALL_RENDER_TRANSPORT_KEYS_ORDERED).toBe(true)
    expect(ALL_FAMILY_CAPABILITY_KEYS_ORDERED).toBe(true)
    expect(validateSectionACapabilityReport(report)).toEqual([])
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
    expect(Object.isFrozen(report)).toBe(true)
    expect(Object.isFrozen(report.matrices.families)).toBe(true)
    expect(Object.isFrozen(report.matrices.scene.roles[0])).toBe(true)
    expect(report.matrices.outputs).toHaveLength(RENDER_OUTPUTS.length)
    expect(report.matrices.outputs.flatMap(output =>
      RENDER_TRANSPORT_SURFACES.map(surface => output.transports[surface])))
      .toHaveLength(RENDER_OUTPUTS.length * RENDER_TRANSPORT_SURFACES.length)
    for (const output of report.matrices.outputs) {
      expect(Object.keys(output.transports).sort()).toEqual([...RENDER_TRANSPORT_SURFACES].sort())
    }
    for (const family of report.matrices.families) {
      expect(Object.keys(family.capabilities)).toEqual([...FAMILY_CAPABILITY_COLUMNS])
      expect(family.applicableRenderOptions.every(field =>
        FAMILY_SCOPED_RENDER_OPTION_FIELDS.includes(field))).toBe(true)
    }
    expect(report.summary.sharedRequestSurfaceCellCount)
      .toBe(report.summary.sharedRequestFieldCount * RENDER_TRANSPORT_SURFACES.length)
    expect(report.stateVocabularies.requestSurface).toEqual(['forwarded', 'host-enforced', 'unavailable'])
    expect(report.matrices.request.find(row => row.field === 'padding')?.surfaces)
      .toMatchObject({ hostedMcp: { state: 'forwarded' }, editor: { state: 'forwarded' } })
    expect(report.matrices.request.find(row => row.field === 'security')?.surfaces)
      .toMatchObject({
        hostedMcp: { state: 'host-enforced', enforcedValue: 'strict' },
        editor: { state: 'host-enforced', enforcedValue: 'strict' },
      })
    expect(report.matrices.request.find(row => row.field === 'embedFontImport')?.surfaces)
      .toMatchObject({
        hostedMcp: { state: 'host-enforced', enforcedValue: false },
        editor: { state: 'host-enforced', enforcedValue: false },
      })
    expect(report.matrices.outputOptions.map(row => row.field)).toEqual([...PNG_OUTPUT_OPTION_FIELDS])
    expect(report.matrices.outputOptions.filter(row => row.scope === 'portable').map(row => row.field))
      .toEqual([...PORTABLE_PNG_OUTPUT_OPTION_FIELDS])
    expect(report.matrices.outputOptions.filter(row => row.scope === 'native-host-only').map(row => row.field))
      .toEqual([...NATIVE_PNG_HOST_ONLY_OPTION_FIELDS])
    expect(report.matrices.outputOptions.find(row => row.field === 'onWarning')).toEqual({
      output: 'png',
      field: 'onWarning',
      scope: 'native-host-only',
      input: 'callback',
      policy: 'excluded',
      receipt: 'excluded',
      schema: 'not-applicable',
    })
    expect(report.matrices.outputs.find(output => output.id === 'png')?.transports.library).toMatchObject({
      evidence: ['src/agent/png.ts', 'src/browser-png.ts', 'src/index.ts'],
    })
    expect(report.matrices.resources).not.toHaveLength(0)
    expect(report.upstream.semanticInventory.syntaxFeatureCount).toBeGreaterThan(0)
    expect(report.upstream.semanticInventory.exampleCount).toBeGreaterThan(0)
    expect(report.upstream.semanticInventory.configKeyCount).toBeGreaterThan(0)
    expect(report.upstream.semanticInventory.themeVariableCount).toBeGreaterThan(0)
    expect(report.upstream.semanticInventory.sourceArtifacts).not.toHaveLength(0)
    expect(report.matrices.syntax.dimensions).toHaveLength(11)
    expect(report.matrices.syntax.features).toHaveLength(report.upstream.semanticInventory.syntaxFeatureCount)
    expect(report.matrices.syntax.families).toHaveLength(report.matrices.families.length * 11)
    expect(report.summary.syntaxAbsentCount).toBe(0)
    for (const id of knownFamilies()) {
      const descriptor = getFamily(id)!
      const registeredRow = report.matrices.families.find(row => row.registrationId === id)!
      const reportedIdentity = registeredRow.identity!
      expect(reportedIdentity).toMatchObject({
        id: descriptor.identity.id,
        version: descriptor.identity.version,
        compatibility: descriptor.identity.compatibility,
        provenance: Object.fromEntries(Object.entries(descriptor.identity.provenance)
          .filter(([, value]) => value !== undefined)),
      })
      expect(Object.hasOwn(reportedIdentity.provenance, 'reference'))
        .toBe(descriptor.identity.provenance.reference !== undefined)
      expect(registeredRow.conformance).toMatchObject({
        version: report.contracts.familyConformance,
        familyId: id,
        passed: true,
      })
      for (const declaredHeader of descriptor.headers) {
        const rows = report.matrices.families.filter(row => row.headers.some(header =>
          header.value.trim().toLowerCase() === declaredHeader.trim().toLowerCase()))
        expect({ id, declaredHeader, rowIds: rows.map(row => row.id), owners: rows.map(row => row.registrationId) })
          .toEqual({ id, declaredHeader, rowIds: [expect.any(String)], owners: [id] })
      }
    }
    const unregistered = report.matrices.families.find(row => row.id === 'swimlane')!
    const processing = report.matrices.syntax.families.find(row =>
      row.familyId === unregistered.id && row.dimensionId === 'processing')!
    expect(unregistered.capabilities).toEqual(UNREGISTERED_FAMILY_CAPABILITY_STATES)
    expect(processing.processing).toEqual(UNREGISTERED_FAMILY_CAPABILITY_STATES)
    expect(Object.values(unregistered.capabilities)).not.toContain('absent')
  })

  test('registered backends may add namespaced primitives while accounting for every core primitive', () => {
    const id = 'backend:report-extension-probe'
    const capabilities = [
      ...DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      {
        target: id,
        primitive: 'acme:glow' as const,
        feature: 'acme:intensity' as const,
        operation: 'render' as const,
        realization: 'native' as const,
        evidence: 'src/__tests__/section-a-capability-report.test.ts',
      },
    ]
    const unregister = registerBackend(
      { ...DefaultBackend, id, capabilities },
      { compatibility: { core: '^0.1.1', scene: '^1.0.0' } },
    )
    try {
      const report = createSectionACapabilityReport()
      expect(report.matrices.backends.find(backend => backend.id === id)?.primitiveIds)
        .toContain('acme:glow')
      expect(validateSectionACapabilityReport(report)).toEqual([])
    } finally {
      unregister()
    }
  })

  test('semantic invariants discriminate stale counts and unsupported claims', () => {
    const stale = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    ;(stale.summary as { outputCount: number }).outputCount++
    expect(validateSectionACapabilityReport(stale)).toEqual(expect.arrayContaining([
      'report digest does not match its payload',
      'summary outputCount is stale',
      'report does not match live contract authorities',
    ]))

    const staleUpstream = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    ;(staleUpstream.upstream.semanticInventory as { syntaxFeatureCount: number }).syntaxFeatureCount++
    expect(validateSectionACapabilityReport(staleUpstream)).toEqual(expect.arrayContaining([
      'report digest does not match its payload',
      'upstream semantic inventory syntaxFeatureCount is stale',
      'report does not match live contract authorities',
    ]))

    const unsupported = stale.matrices.families.find(row => row.support === 'unsupported')!
    ;(unsupported as { registrationId?: string }).registrationId = 'family:incorrect-claim'
    expect(validateSectionACapabilityReport(stale).some(message => message.includes('non-native upstream family'))).toBe(true)

    const contradictory = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const native = contradictory.matrices.families.find(row => row.registrationId === 'flowchart')!
    ;(native.capabilities as Record<string, string>).svg = 'absent'
    expect(validateSectionACapabilityReport(contradictory)).toContain(
      'family flowchart svg state does not match declaration plus conformance',
    )

    const staleFamilyConformance = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const staleConformanceFlowchart = staleFamilyConformance.matrices.families.find(row => row.registrationId === 'flowchart')!
    ;(staleConformanceFlowchart.conformance as { version: number }).version++
    expect(validateSectionACapabilityReport(staleFamilyConformance)).toContain(
      'registered family flowchart conformance version does not match the report contract',
    )

    const incomplete = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const incompleteNative = incomplete.matrices.families.find(row => row.registrationId === 'flowchart')!
    ;(incompleteNative.evidence as unknown as Array<{ capability: string }>).pop()
    expect(validateSectionACapabilityReport(incomplete)).toContain('family flowchart lacks evidence for terminal')

    const incompleteScene = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const flowchartScene = incompleteScene.matrices.families.find(row => row.registrationId === 'flowchart')!
    const removedCell = (flowchartScene.scenePrimitiveEvidence as FamilyScenePrimitiveEvidence[]).pop()!
    expect(validateSectionACapabilityReport(incompleteScene)).toContain(
      `family flowchart lacks Scene cell ${removedCell.role}/${removedCell.primitive}`,
    )

    const implicitNegative = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const negative = implicitNegative.matrices.families
      .find(row => row.registrationId === 'flowchart')!
      .scenePrimitiveEvidence.find(cell => cell.applicability === 'not-applicable')!
    ;(negative as { realization: string; diagnostic?: string }).realization = 'native'
    delete (negative as { diagnostic?: string }).diagnostic
    expect(validateSectionACapabilityReport(implicitNegative)).toContain(
      `family flowchart does not explicitly diagnose negative Scene cell ${negative.role}/${negative.primitive}`,
    )

    const wrongTransport = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const html = wrongTransport.matrices.outputs.find(row => row.id === 'html')!
    ;(html.transports.cli as { availability: string }).availability = 'direct'
    expect(validateSectionACapabilityReport(wrongTransport)).toContain(
      'output html transport descriptor does not match the canonical output contract',
    )

    const extraTransport = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    ;(extraTransport.matrices.outputs[0]!.transports as unknown as Record<string, unknown>).futureSurface = {
      availability: 'unavailable', entrypoint: 'none', evidence: [], reason: 'future probe',
    }
    expect(validateSectionACapabilityReport(extraTransport)).toContain(
      `output ${extraTransport.matrices.outputs[0]!.id} transport keys do not exactly match the product-surface authority`,
    )

    const extraFamilyCapability = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const extraCapabilityFamily = extraFamilyCapability.matrices.families[0]!
    ;(extraCapabilityFamily.capabilities as unknown as Record<string, string>).futureCapability = 'native'
    expect(validateSectionACapabilityReport(extraFamilyCapability)).toContain(
      `family ${extraCapabilityFamily.id} capability keys do not exactly match the family-capability authority`,
    )

    const staleOutputEvidence = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const png = staleOutputEvidence.matrices.outputs.find(row => row.id === 'png')!
    const policyEvidence = png.evidence.findIndex(evidence => evidence.startsWith('png-output-policy@'))
    ;(png.evidence as string[])[policyEvidence] = 'png-output-policy@999'
    expect(validateSectionACapabilityReport(staleOutputEvidence)).toContain(
      `output png evidence png-output-policy@999 does not match contract version ${staleOutputEvidence.contracts.pngOutputPolicy}`,
    )

    const weakenedHostPolicy = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const security = weakenedHostPolicy.matrices.request.find(row => row.field === 'security')!
    ;(security.surfaces!.hostedMcp as { state: string }).state = 'forwarded'
    expect(validateSectionACapabilityReport(weakenedHostPolicy)).toContain(
      'shared request field security surface policy does not match the canonical authority',
    )

    const uncertified = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    ;(uncertified.matrices.backends[0]!.conformance as { passed: boolean }).passed = false
    expect(validateSectionACapabilityReport(uncertified)).toEqual(expect.arrayContaining([
      'report digest does not match its payload',
      `backend ${uncertified.matrices.backends[0]!.id} did not pass registration SVG conformance`,
      'report does not match live contract authorities',
    ]))

    const missingSyntaxFeature = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    ;(missingSyntaxFeature.matrices.syntax.features as unknown[]).pop()
    expect(validateSectionACapabilityReport(missingSyntaxFeature)).toEqual(expect.arrayContaining([
      'report digest does not match its payload',
      'syntax feature classifications are missing: 1',
      'report does not match live contract authorities',
    ]))

    const absentSyntax = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const syntaxRow = absentSyntax.matrices.syntax.features[0]!
    ;(syntaxRow as { state: string }).state = 'absent'
    expect(validateSectionACapabilityReport(absentSyntax)).toContain(`syntax feature ${syntaxRow.featureId} is absent`)

    const hiddenRegisteredHeader = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const flowchart = hiddenRegisteredHeader.matrices.families.find(row => row.registrationId === 'flowchart')!
    ;(flowchart as unknown as { headers: Array<{ value: string; status: string }> }).headers = flowchart.headers
      .filter(header => header.value.toLowerCase() !== 'graph') as Array<{ value: string; status: string }>
    expect(validateSectionACapabilityReport(hiddenRegisteredHeader)).toContain(
      'registered header graph for flowchart appears 0 times in the family matrix',
    )

    const driftedOpenFamily = JSON.parse(JSON.stringify(createSectionACapabilityReport())) as SectionACapabilityReport
    const swimlane = driftedOpenFamily.matrices.families.find(row => row.id === 'swimlane')!
    ;(swimlane.capabilities as Record<string, string>).serialize = 'absent'
    expect(validateSectionACapabilityReport(driftedOpenFamily)).toEqual(expect.arrayContaining([
      'unregistered family swimlane does not match the canonical processing capability contract',
      'unregistered family swimlane disagrees with the syntax processing projection',
    ]))
  })

  test('split official aliases and mismatched valid upstreamIds retain one checked owner per header', () => {
    const before = createSectionACapabilityReport()
    expect(createSectionACapabilityReport()).toBe(before)
    const stagedVisibility: Array<{ candidate: string; registrations: readonly string[] }> = []
    const observedSvg = (candidate: string) => () => {
      stagedVisibility.push({
        candidate,
        registrations: createSectionACapabilityReport().matrices.families
          .flatMap(row => row.registrationId ? [row.registrationId] : []),
      })
      return '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="24" viewBox="0 0 80 24"></svg>'
    }
    const descriptor: FamilyDescriptor = {
      contractVersion: 1,
      identity: createExtensionIdentity({
        id: 'family:report-probe',
        kind: 'family',
        version: '1.0.0',
        compatibility: { core: '^0.1.1' },
        provenance: { owner: 'section-a-test', source: 'test' },
      }),
      id: 'family:report-probe',
      // A hostile/stale hint names a real but unrelated upstream family. Header
      // claims remain the report join authority, so neither dialect is hidden.
      upstreamId: 'flowchart',
      label: 'Report probe',
      example: 'requirementDiagram\n  example payload',
      // Adopting a currently unsupported official header must update the live
      // upstream row rather than creating a shadow/duplicate family roster.
      headers: ['requirementDiagram', 'reportProbeDiagram'],
      aliases: [],
      maturity: 'experimental',
      collisionPriority: 1,
      applicableRenderOptions: ['componentSpacing'],
      detect: line => /^(?:requirementdiagram|reportprobediagram)(?:\s|$)/.test(line),
      semanticRoles: [],
      scenePrimitiveEvidence: [],
      capabilityEvidence: [
        { capability: 'detection', state: 'native', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'source-preservation', state: 'source-preserved', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'parse', state: 'source-preserved', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'serialize', state: 'source-preserved', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'mutation', state: 'diagnosed', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'verify', state: 'diagnosed', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'layout', state: 'diagnosed', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'scene', state: 'absent', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'svg', state: 'native', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'terminal', state: 'absent', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
      ],
      // A valid graphical-only tuple: SVG is executable, while the missing
      // projectPositioned hook keeps layout JSON and verification diagnosed.
      layout: () => ({ width: 80, height: 24 }),
      renderSvg: observedSvg('family:report-probe'),
    }
    const splitDescriptor: FamilyDescriptor = {
      ...descriptor,
      identity: createExtensionIdentity({
        id: 'family:report-probe-split',
        kind: 'family',
        version: '1.0.0',
        compatibility: { core: '^0.1.1' },
        provenance: { owner: 'section-a-test', source: 'test' },
      }),
      id: 'family:report-probe-split',
      upstreamId: 'sequence',
      label: 'Report probe split alias',
      example: 'requirement\n  example payload',
      headers: ['requirement'],
      detect: line => /^requirement(?:\s|$)/.test(line),
      renderSvg: observedSvg('family:report-probe-split'),
    }
    const unregister = registerFamily(descriptor)
    const unregisterSplit = registerFamily(splitDescriptor)
    try {
      const report = createSectionACapabilityReport()
      expect(report).not.toBe(before)
      expect(stagedVisibility.length).toBeGreaterThan(0)
      expect(stagedVisibility.every(observation =>
        !observation.registrations.includes(observation.candidate))).toBe(true)
      expect(report.summary.registeredFamilyCount).toBe(before.summary.registeredFamilyCount + 2)
      expect(validateSectionACapabilityReport(report)).toEqual([])
      const row = report.matrices.families.find(candidate => candidate.id === 'requirement')!
      expect(row.registrationId).toBe(descriptor.id)
      expect(row.applicableRenderOptions).toEqual(['componentSpacing'])
      expect(row.support).toBe('extension')
      expect(row.headers.find(header => header.value === 'requirementDiagram'))
        .toEqual({ value: 'requirementDiagram', status: 'extension' })
      expect(row.headers.find(header => header.value === 'reportProbeDiagram'))
        .toEqual({ value: 'reportProbeDiagram', status: 'extension' })
      expect(row.headers.some(header => header.value === 'requirement')).toBe(false)
      const splitRow = report.matrices.families.find(candidate => candidate.id === splitDescriptor.id)!
      expect(splitRow).toMatchObject({
        registrationId: splitDescriptor.id,
        support: 'extension',
        headers: [{ value: 'requirement', status: 'extension' }],
      })
      for (const header of ['requirementDiagram', 'requirement', 'reportProbeDiagram']) {
        expect(report.matrices.families.flatMap(candidate => candidate.headers)
          .filter(candidate => candidate.value.toLowerCase() === header.toLowerCase())).toHaveLength(1)
      }
      expect(row.capabilities)
        .toEqual(Object.fromEntries(
          descriptor.capabilityEvidence.map(claim => [claim.capability, claim.state]),
        ) as typeof row.capabilities)
      expect(row.capabilities).toMatchObject({
        verify: 'diagnosed', layout: 'diagnosed', scene: 'absent', svg: 'native',
      })
      expect(validateSectionACapabilityReport(report)).toEqual([])
      expect(report.matrices.syntax.families.filter(row => row.familyId === 'requirement')).toHaveLength(11)
      expect(report.matrices.syntax.families.filter(row => row.familyId === splitDescriptor.id)).toHaveLength(11)
    } finally {
      unregisterSplit()
      unregister()
    }
    const after = createSectionACapabilityReport()
    expect(after).not.toBe(before)
    expect(after.digest).toBe(before.digest)
    expect(createSectionACapabilityReport()).toBe(after)
  })

  test('evidence and retirement entries point at existing repository gates', () => {
    const report = createSectionACapabilityReport()
    for (const backend of report.matrices.backends) {
      expect([...new Set(backend.claims.map(claim => String(claim.primitive)))].sort())
        .toEqual(report.matrices.scene.primitives.map(String).sort())
      for (const claim of backend.claims) {
        if (claim.status === 'passed') {
          expect({ backend: backend.id, claim: `${claim.primitive}/${claim.feature}/${claim.operation}`, witness: claim.witnessId })
            .toEqual({
              backend: backend.id,
              claim: `${claim.primitive}/${claim.feature}/${claim.operation}`,
              witness: expect.stringContaining('backend-claim-matrix@3/'),
            })
        } else {
          expect(claim.status).toBe('unverified-extension')
          expect(claim.diagnostic).toMatch(/Namespaced extension claim/)
        }
      }
    }
    for (const output of report.matrices.outputs) {
      for (const surface of RENDER_TRANSPORT_SURFACES) {
        for (const path of output.transports[surface].evidence) {
          expect({ output: output.id, surface, path, exists: existsSync(join(ROOT, path)) })
            .toEqual({ output: output.id, surface, path, exists: true })
        }
      }
    }
    for (const surface of RENDER_TRANSPORT_SURFACES) {
      for (const path of report.evidence.requestSurfaces[surface]) {
        expect({ surface, path, exists: existsSync(join(ROOT, path)) })
          .toEqual({ surface, path, exists: true })
      }
    }
    for (const family of report.matrices.families) {
      for (const cell of family.scenePrimitiveEvidence) {
        for (const path of cell.evidence) {
          expect({ family: family.id, cell: `${cell.role}/${cell.primitive}`, path, exists: existsSync(join(ROOT, path)) })
            .toEqual({ family: family.id, cell: `${cell.role}/${cell.primitive}`, path, exists: true })
        }
      }
    }
    for (const resource of report.matrices.resources) {
      expect({ id: resource.id, path: resource.path, exists: existsSync(join(ROOT, resource.path)) })
        .toEqual({ id: resource.id, path: resource.path, exists: true })
      expect({ id: resource.id, notice: resource.license.noticePath, exists: existsSync(join(ROOT, resource.license.noticePath)) })
        .toEqual({ id: resource.id, notice: resource.license.noticePath, exists: true })
    }
    for (const row of report.matrices.syntax.families) {
      for (const evidence of row.evidence) {
        expect({ source: evidence.source, exists: existsSync(join(ROOT, evidence.source)) })
          .toEqual({ source: evidence.source, exists: true })
      }
    }
    for (const row of report.matrices.syntax.features) {
      for (const source of row.evidence) expect({ source, exists: existsSync(join(ROOT, source)) })
        .toEqual({ source, exists: true })
    }
    for (const system of report.evidence.systems) {
      expect({ id: system.id, authority: existsSync(join(ROOT, system.authority)), gate: existsSync(join(ROOT, system.freshnessGate)) })
        .toEqual({ id: system.id, authority: true, gate: true })
    }
    for (const contract of report.evidence.contracts) {
      for (const path of contract.evidence) expect({ id: contract.id, path, exists: existsSync(join(ROOT, path)) }).toEqual({ id: contract.id, path, exists: true })
    }
    for (const authority of report.retiredAuthorities) {
      for (const path of authority.evidence) expect({ id: authority.id, path, exists: existsSync(join(ROOT, path)) }).toEqual({ id: authority.id, path, exists: true })
    }
  })

  test('the checked Markdown projection is fresh', () => {
    expect(readFileSync(MARKDOWN, 'utf8')).toBe(sectionACapabilityReportMarkdown())
  })
})
