import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createSectionBCapabilityReport,
  sectionBCapabilityReportMarkdown,
  validateSectionBCapabilityReport,
} from '../section-b-capability-report.ts'
import { INTERNAL_STYLE_FACE_PROJECTION, ROLE_STYLE_PROPERTY_DESCRIPTORS, knownStyleDescriptors } from '../scene/style-registry.ts'
import { SCENE_ROLE_DESCRIPTORS } from '../scene/roles.ts'
import { knownBuiltinFamilies } from '../agent/families.ts'

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
    expect(report.families.filter(row => row.bindingRoles.length > 0).map(row => row.id).sort()).toEqual([
      'er', 'gantt', 'journey', 'pie', 'radar', 'sequence', 'xychart',
    ])
    expect(new Set(report.families.flatMap(row => row.bindingChannels))).toEqual(new Set(['category']))
    expect(report.builtInLooks.map(row => row.id)).toEqual(knownStyleDescriptors()
      .filter(row => row.kind === 'look' && row.identity.provenance.source === 'built-in')
      .map(row => row.identity.id))
    expect(report.builtInLooks.every(row => row.exportable)).toBe(true)
    expect(report.paintAuthority.every(row => row.foreground && row.background && row.provenance && row.outputContext)).toBe(true)
    expect(report.brandPack).toMatchObject({ promoted: false })
    expect(report.phases.map(row => row.id)).toEqual(['B0', 'B1', 'B2', 'B3', 'B4', 'B5'])
  })

  test('checked JSON and Markdown are exact generated projections', () => {
    const report = createSectionBCapabilityReport()
    const json = JSON.parse(readFileSync(join(ROOT, 'docs/project/section-b-capability-report.json'), 'utf8'))
    const markdown = readFileSync(join(ROOT, 'docs/project/section-b-capability-report.md'), 'utf8')
    expect(json).toEqual(report)
    expect(markdown).toBe(sectionBCapabilityReportMarkdown(report))
  })

  test('semantic validation discriminates stale payloads', () => {
    const stale = JSON.parse(JSON.stringify(createSectionBCapabilityReport()))
    stale.families[0].semanticChannels.push('made-up')
    expect(validateSectionBCapabilityReport(stale)).toEqual(expect.arrayContaining([
      'report digest does not match its payload',
      'report does not match live Section B authorities',
    ]))
  })
})
