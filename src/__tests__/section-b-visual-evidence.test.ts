import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSectionBBrandEvidence, GRAPHICAL_BACKEND_PROBES, runSectionBBackendProbe, SECTION_B_BASELINE_COMMIT, sectionBVariantHeadingMarkup, sectionBVisualApproval } from '../../scripts/pr-assets/section-b-brand-evidence.ts'
import { knownBuiltinFamilies } from '../agent/families.ts'

const ROOT = join(import.meta.dir, '..', '..')
const PNG = join(ROOT, 'docs/design/families/section-b-brand-evidence.png')
const APPROVAL = join(ROOT, 'eval/section-b-brand-evidence/visual-approval.json')

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(Buffer.from(bytes.subarray(1, 4)).toString()).toBe('PNG')
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('Section B generated visual evidence', () => {
  test('positions every variant heading inside its own section band', () => {
    const sectionHeight = 86 + 5 * 380
    for (let index = 0; index < 4; index++) {
      const cursorY = index * sectionHeight
      const markup = sectionBVariantHeadingMarkup(`Variant ${index}`, cursorY, 1560, 86)
      expect(markup).toContain(`y="${cursorY + 37}"`)
      expect(markup).toContain(`y="${cursorY + 64}"`)
      if (index > 0) expect(markup).not.toContain('y="37"')
    }
  })

  test('byte-matches the registry-driven renderer output and is reviewable at native size', () => {
    const checked = readFileSync(PNG)
    expect(buildSectionBBrandEvidence()).toEqual(checked)
    expect(pngDimensions(checked)).toEqual({ width: 1560, height: 9464 })
    expect(checked.byteLength).toBeGreaterThan(500_000)
  }, 120_000)

  test('the human approval names the exact committed bytes and the frozen baseline inputs exist', () => {
    const approval = JSON.parse(readFileSync(APPROVAL, 'utf8'))
    expect(sectionBVisualApproval()).toEqual({
      path: 'eval/section-b-brand-evidence/visual-approval.json',
      status: 'approved',
      artifactSha256: createHash('sha256').update(readFileSync(PNG)).digest('hex'),
      reviewedAt: approval.reviewedAt,
      reviewer: approval.reviewer,
      audit: approval.audit,
    })
    expect(approval.scope).toContain('64 family-by-variant cells')
    expect(SECTION_B_BASELINE_COMMIT).toMatch(/^[0-9a-f]{40}$/)
    expect(readFileSync(join(ROOT, 'eval/section-b-brand-evidence/baseline.mmd'), 'utf8')).toContain('flowchart LR')
    expect(JSON.parse(readFileSync(join(ROOT, 'eval/section-b-brand-evidence/role-style.json'), 'utf8'))).toHaveProperty('roles.node')
    expect(readFileSync(join(ROOT, 'docs/style-authoring.md'), 'utf8')).toContain('plus three holdout styles')
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
