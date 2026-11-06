import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSectionBBrandEvidence, GRAPHICAL_BACKEND_PROBES, runSectionBBackendProbe, sectionBVariantHeadingMarkup, sectionBVisualApproval } from '../../scripts/pr-assets/section-b-brand-evidence.ts'
import { knownBuiltinFamilies } from '../agent/families.ts'
import { decodePng } from './helpers/png-pixels.ts'

const ROOT = join(import.meta.dir, '..', '..')
const PNG = join(import.meta.dir, 'testdata', 'section-b-brand-evidence.png')
const APPROVAL = join(ROOT, 'eval/section-b-brand-evidence/visual-approval.json')

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(Buffer.from(bytes.subarray(1, 4)).toString()).toBe('PNG')
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('Section B reviewed rendering golden', () => {
  test('positions every variant heading inside its own section band', () => {
    const sectionHeight = 86 + 5 * 380
    for (let index = 0; index < 4; index++) {
      const cursorY = index * sectionHeight
      const markup = sectionBVariantHeadingMarkup(`Variant ${index}`, cursorY, 1560, 86)
      const positions = [...markup.matchAll(/<text\b[^>]*\sy="([^"]+)"/g)].map(match => Number(match[1]))
      expect(positions).toHaveLength(2)
      for (const y of positions) {
        expect(Number.isFinite(y)).toBe(true)
        expect(y).toBeGreaterThan(cursorY)
        expect(y).toBeLessThan(cursorY + 86)
      }
      expect(positions[1]!).toBeGreaterThan(positions[0]!)
    }
  })

  test('pixel-matches the registry-driven renderer output and is reviewable at native size', () => {
    const checked = readFileSync(PNG)
    const actual = decodePng(buildSectionBBrandEvidence())
    const expected = decodePng(checked)
    expect({ width: actual.width, height: actual.height }).toEqual({ width: expected.width, height: expected.height })
    expect(
      Buffer.from(actual.rgba).equals(Buffer.from(expected.rgba)),
      'Section B decoded pixels differ from the reviewed golden; inspect the current rendering',
    ).toBe(true)
    expect(pngDimensions(checked)).toEqual({ width: 1560, height: 14024 })
  }, 120_000)

  test('the recorded visual review approves the exact committed rendering bytes', () => {
    const approval = JSON.parse(readFileSync(APPROVAL, 'utf8'))
    expect(sectionBVisualApproval()).toEqual({
      path: 'eval/section-b-brand-evidence/visual-approval.json',
      status: 'approved',
      artifactSha256: createHash('sha256').update(readFileSync(PNG)).digest('hex'),
      reviewedAt: approval.reviewedAt,
      reviewer: approval.reviewer,
      audit: approval.audit,
    })

  })

  test('the sentinel renders every built-in family through the default, rough, and hybrid backends', () => {
    expect(GRAPHICAL_BACKEND_PROBES.map(([backend]) => backend)).toEqual(['default', 'rough', 'hybrid'])
    for (const [backend, style] of GRAPHICAL_BACKEND_PROBES) {
      const probe = runSectionBBackendProbe(style)
      expect(probe.map(entry => entry.family), backend).toEqual(knownBuiltinFamilies())
      for (const entry of probe) {
        expect(entry.svgBytes, `${backend} ${entry.family} svg`).toBeGreaterThan(0)
        expect(entry.pngBytes, `${backend} ${entry.family} png`).toBeGreaterThan(0)
      }
    }
}, 120_000)
})
