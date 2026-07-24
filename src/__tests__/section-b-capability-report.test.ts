import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getFamily, knownBuiltinFamilies, replaceFamilyForTest } from '../agent/families.ts'
import { knownBackendDescriptors } from '../scene/backend.ts'
import { SCENE_ROLE_DESCRIPTORS } from '../scene/roles.ts'
import { INTERNAL_STYLE_FACE_PROJECTION, knownStyleDescriptors, ROLE_STYLE_PROPERTY_DESCRIPTORS } from '../scene/style-registry.ts'
import { createSectionBCapabilityReport, sectionBCapabilityReportMarkdown, validateSectionBCapabilityReport } from '../section-b-capability-report.ts'

const ROOT = join(import.meta.dir, '..', '..')

describe('Section B generated capability report', () => {
  test('is immutable, JSON-safe, and exact over live authorities', () => {
    const report = createSectionBCapabilityReport()
    expect(validateSectionBCapabilityReport(report)).toEqual([])
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
    expect(Object.isFrozen(report)).toBe(true)
    expect(report.publicRoleStyleLeaves.map(row => row.field)).toEqual(Object.keys(ROLE_STYLE_PROPERTY_DESCRIPTORS))
    expect(report.roles.map(row => row.role)).toEqual(SCENE_ROLE_DESCRIPTORS.map(row => row.role))
    expect(report.privateFaceProjection.map(row => row.face)).toEqual(Object.keys(INTERNAL_STYLE_FACE_PROJECTION))
    expect(report.families.map(row => row.id)).toEqual(knownBuiltinFamilies())
    expect(report.families.every(row => row.semanticRoles.length > 0)).toBe(true)
    expect(
      report.families
        .filter(row => row.bindingRoles.length > 0)
        .map(row => row.id)
        .sort(),
    ).toEqual(['er', 'gantt', 'journey', 'pie', 'radar', 'sankey', 'sequence', 'xychart'])
    expect(new Set(report.families.flatMap(row => row.bindingChannels))).toEqual(new Set(['category']))
    const builtInBackends = knownBackendDescriptors()
      .filter(row => row.identity.provenance.source === 'built-in')
      .map(row => row.identity.id)
    for (const family of report.families) {
      const descriptor = getFamily(family.id)!
      expect(
        family.roleWitnesses.map(row => row.role),
        `${family.id} emitted-role census`,
      ).toEqual([...descriptor.semanticRoles])
      expect(
        family.channelWitnesses.map(row => row.channel),
        `${family.id} emitted-channel census`,
      ).toEqual([...descriptor.semanticChannels])
      expect(
        family.roleWitnesses.every(row => row.observedKinds.length > 0 && row.graphicalWitnessId.length > 0 && row.styleWitnessId.length > 0),
        `${family.id} role witnesses`,
      ).toBe(true)
      for (const witness of family.roleWitnesses) {
        const role = SCENE_ROLE_DESCRIPTORS.find(row => row.role === witness.role)!
        expect(witness.publicMigrationTarget, `${family.id}/${witness.role} migration target`).toBe(witness.styleProjection === 'exact' ? witness.role : witness.styleProjection === 'fallback-only' ? role.style.fallbackRole : 'none')
      }
      expect(
        family.channelWitnesses.every(row => row.representativeValues.length > 0 && row.emittingRoles.length > 0),
        `${family.id} channel witnesses`,
      ).toBe(true)
      expect(family.channelWitnesses.filter(row => row.publicBinding === 'category').map(row => row.channel)).toEqual(family.bindingRoles.length > 0 ? ['category'] : [])
      expect(
        family.graphicalBackends.map(row => row.id),
        `${family.id} backend witnesses`,
      ).toEqual(builtInBackends)
      expect(family.graphicalBackends.every(row => row.state === 'conformant-scene-consumer' && row.witnessId.length > 0)).toBe(true)
      expect(family.terminalProjection.state).toBe('native-lossy')
      expect(family.terminalProjection.witnessId.length).toBeGreaterThan(0)
      expect(family.terminalProjection.outputDigest).toMatch(/^sha256:/)
      expect(
        family.bindingWitnesses.map(row => row.role),
        `${family.id} binding consumers`,
      ).toEqual([...family.bindingRoles])
      expect(family.bindingWitnesses.every(row => row.graphicalProjection === 'changed')).toBe(true)
    }
    expect(report.families.find(row => row.id === 'pie')?.bindingWitnesses[0]?.terminalProjection).toBe('perceptible-no-color-cue')
    expect(report.families.find(row => row.id === 'radar')?.bindingWitnesses[0]?.terminalProjection).toBe('perceptible-no-color-cue')
    // These nested roles changed under the former combined probe only because
    // a sibling archetype changed inside the same serialized group.
    for (const [family, role] of [
      ['flowchart', 'group-header'],
      ['state', 'note'],
      ['journey', 'actor'],
      ['er', 'cardinality'],
    ] as const) {
      expect(report.families.find(row => row.id === family)?.roleWitnesses.find(row => row.role === role)?.styleProjection).toBe('not-applicable')
    }
    expect(report.builtInLooks.map(row => row.id)).toEqual(
      knownStyleDescriptors()
        .filter(row => row.kind === 'look' && row.identity.provenance.source === 'built-in')
        .map(row => row.identity.id),
    )
    expect(report.builtInLooks.every(row => row.exportable)).toBe(true)
    expect(report.paintAuthority.every(row => row.foreground && row.background && row.provenance && row.outputContext)).toBe(true)
    expect(report.brandPack).toMatchObject({ promoted: false })
    expect(report.phases.map(row => [row.id, row.status])).toEqual([
      ['B0', 'complete'],
      ['B1', 'complete'],
      ['B2', 'complete'],
      ['B3', 'complete'],
      ['B4', 'not-promoted'],
      ['B5', 'complete'],
    ])
    expect(report.phases.find(row => row.id === 'B5')?.evidence).toContain('eval/style-prototype-evidence/visual-approval.json')
  })

  test('checked JSON and Markdown are exact generated projections', () => {
    const report = createSectionBCapabilityReport()
    const json = JSON.parse(readFileSync(join(ROOT, 'docs/project/section-b-capability-report.json'), 'utf8'))
    const markdown = readFileSync(join(ROOT, 'docs/project/section-b-capability-report.md'), 'utf8')
    expect(json).toEqual(report)
    expect(markdown).toBe(sectionBCapabilityReportMarkdown(report))
  })

  test('cache invalidates against live family registration identity', () => {
    const before = createSectionBCapabilityReport()
    const original = getFamily('flowchart')!
    const restore = replaceFamilyForTest('flowchart', { ...original, semanticChannels: ['category'] })
    try {
      expect(() => createSectionBCapabilityReport()).toThrow('did not emit declared channels: category')
    } finally {
      restore()
    }
    expect(createSectionBCapabilityReport()).toBe(before)
  })

  test('semantic validation discriminates missing emitters, channels, consumers, and projections', () => {
    const mutations = [
      (report: any) => report.families[0].roleWitnesses.pop(),
      (report: any) => report.families.find((row: any) => row.channelWitnesses.length > 0).channelWitnesses.pop(),
      (report: any) => report.families.find((row: any) => row.bindingWitnesses.length > 0).bindingWitnesses.pop(),
      (report: any) => {
        report.families[0].graphicalBackends[0].state = 'missing'
      },
      (report: any) => {
        report.families[0].terminalProjection.outputDigest = 'sha256:missing'
      },
    ]
    for (const mutate of mutations) {
      const stale = JSON.parse(JSON.stringify(createSectionBCapabilityReport()))
      mutate(stale)
      expect(validateSectionBCapabilityReport(stale)).toEqual(expect.arrayContaining(['report digest does not match its payload', 'report does not match live Section B authorities']))
    }
  })
})
