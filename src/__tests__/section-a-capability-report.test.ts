import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createSectionACapabilityReport,
  sectionACapabilityReportMarkdown,
  validateSectionACapabilityReport,
  type SectionACapabilityReport,
} from '../section-a-capability-report.ts'
import { registerFamily, type FamilyDescriptor, type FamilyScenePrimitiveEvidence } from '../agent/families.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { DefaultBackend, registerBackend } from '../scene/backend.ts'
import { RENDER_OUTPUTS, RENDER_TRANSPORT_SURFACES } from '../render-contract.ts'

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
    expect(validateSectionACapabilityReport(report)).toEqual([])
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
    expect(Object.isFrozen(report)).toBe(true)
    expect(Object.isFrozen(report.matrices.families)).toBe(true)
    expect(Object.isFrozen(report.matrices.scene.roles[0])).toBe(true)
    expect(report.matrices.outputs).toHaveLength(RENDER_OUTPUTS.length)
    expect(report.matrices.outputs.flatMap(output =>
      RENDER_TRANSPORT_SURFACES.map(surface => output.transports[surface]))).toHaveLength(42)
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
    const unregister = registerBackend({ ...DefaultBackend, id, capabilities })
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
      'family flowchart svg state does not match descriptor evidence',
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
  })

  test('a namespaced family appears without adding a copied family roster', () => {
    const before = createSectionACapabilityReport()
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
      label: 'Report probe',
      // Adopting a currently unsupported official header must update the live
      // upstream row rather than creating a shadow/duplicate family roster.
      headers: ['requirementDiagram'],
      aliases: [],
      maturity: 'experimental',
      collisionPriority: 1,
      detect: line => /^requirementdiagram(?:\s|$)/.test(line),
      semanticRoles: [],
      scenePrimitiveEvidence: [],
      capabilityEvidence: [
        { capability: 'detection', state: 'native', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'source-preservation', state: 'source-preserved', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'parse', state: 'source-preserved', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'serialize', state: 'source-preserved', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'mutation', state: 'diagnosed', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'verify', state: 'diagnosed', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'layout', state: 'absent', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'scene', state: 'absent', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'svg', state: 'absent', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
        { capability: 'terminal', state: 'absent', evidence: ['src/__tests__/section-a-capability-report.test.ts'] },
      ],
    }
    const unregister = registerFamily(descriptor)
    try {
      const report = createSectionACapabilityReport()
      expect(report.summary.registeredFamilyCount).toBe(before.summary.registeredFamilyCount + 1)
      expect(report.matrices.families.find(row => row.id === 'requirement')).toMatchObject({
        registrationId: descriptor.id,
        support: 'extension',
        capabilities: Object.fromEntries(descriptor.capabilityEvidence.map(claim => [claim.capability, claim.state])),
      })
      expect(validateSectionACapabilityReport(report)).toEqual([])
      expect(report.matrices.syntax.families.filter(row => row.familyId === 'requirement')).toHaveLength(11)
    } finally {
      unregister()
    }
    expect(createSectionACapabilityReport().digest).toBe(before.digest)
  })

  test('evidence and retirement entries point at existing repository gates', () => {
    const report = createSectionACapabilityReport()
    for (const backend of report.matrices.backends) {
      expect([...new Set(backend.claims.map(claim => String(claim.primitive)))].sort())
        .toEqual(report.matrices.scene.primitives.map(String).sort())
      for (const claim of backend.claims) {
        expect({ backend: backend.id, claim: `${claim.primitive}/${claim.feature}/${claim.operation}`, evidence: existsSync(join(ROOT, claim.evidence!)) })
          .toEqual({ backend: backend.id, claim: `${claim.primitive}/${claim.feature}/${claim.operation}`, evidence: true })
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
