import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { knownBuiltinFamilies } from '../agent/families.ts'
import {
  SECTION_B_BASELINE_COMMIT,
  buildSectionBBrandEvidence,
  buildSectionBBrandEvidenceReceipt,
  sectionBVariantHeadingMarkup,
} from '../../scripts/pr-assets/section-b-brand-evidence.ts'

const ROOT = join(import.meta.dir, '..', '..')
const PNG = join(ROOT, 'docs/design/families/section-b-brand-evidence.png')
const RECEIPT = join(ROOT, 'eval/section-b-brand-evidence/evidence-receipt.json')
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
    expect(pngDimensions(checked)).toEqual({ width: 1560, height: 7944 })
    expect(checked.byteLength).toBeGreaterThan(500_000)
  }, 120_000)

  test('receipt covers every built-in family, sentinel plus three holdouts, public output paths, and an honest hard-error baseline', () => {
    const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8'))
    expect(receipt).toEqual(buildSectionBBrandEvidenceReceipt())
    expect(receipt.families).toEqual(knownBuiltinFamilies())
    expect(receipt.variants).toEqual([
      'Sentinel · every channel deliberately distinctive',
      'Holdout · warm editorial',
      'Holdout · light technical',
      'Holdout · dark operations',
    ])
    expect(receipt.outputPaths).toEqual({
      graphicalCells: 'public native renderMermaidPNG',
      graphicalBackends: 'public renderMermaidSVG + renderMermaidPNG sentinel probes',
      terminal: 'public renderMermaidASCII (Unicode, no color)',
    })
    expect(receipt.graphicalBackends).toEqual(Object.fromEntries(['default', 'rough', 'hybrid'].map(backend => [backend, {
      familyCount: knownBuiltinFamilies().length,
      svgSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      pngSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }])))
    expect(receipt.terminalSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.fontInputs).toEqual([
      { path: 'assets/fonts/DejaVuSans-Bold.ttf', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { path: 'assets/fonts/DejaVuSans.ttf', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ])
    expect(receipt.baseline).toMatchObject({
      state: 'unsupported-style-fields',
      expected: expect.stringContaining('no fabricated before image'),
    })
    expect(receipt.baseline).toMatchObject({ commit: SECTION_B_BASELINE_COMMIT, expectedExitCode: 2 })
    expect(receipt.baseline.command).toContain(SECTION_B_BASELINE_COMMIT)
    expect(receipt.baseline.command).not.toContain('origin/main')
    expect(receipt.baseline.command).toContain('eval/section-b-brand-evidence/baseline.mmd')
    expect(receipt.baseline.command).toContain('eval/section-b-brand-evidence/role-style.json')
    expect(readFileSync(join(ROOT, 'eval/section-b-brand-evidence/baseline.mmd'), 'utf8')).toContain('flowchart LR')
    expect(JSON.parse(readFileSync(join(ROOT, 'eval/section-b-brand-evidence/role-style.json'), 'utf8'))).toHaveProperty('roles.node')
    expect(receipt.outputs).toEqual([
      expect.objectContaining({ path: 'docs/design/families/section-b-brand-evidence.png', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ])
    expect(receipt.outputs[0].sha256).toBe(createHash('sha256').update(readFileSync(PNG)).digest('hex'))
    const approval = JSON.parse(readFileSync(APPROVAL, 'utf8'))
    expect(receipt.visualApproval).toEqual({
      path: 'eval/section-b-brand-evidence/visual-approval.json',
      status: 'approved',
      artifactSha256: receipt.outputs[0].sha256,
      reviewedAt: approval.reviewedAt,
      reviewer: approval.reviewer,
      audit: approval.audit,
    })
    expect(approval.scope).toContain('60 family-by-variant cells')
    expect(readFileSync(join(ROOT, 'docs/style-authoring.md'), 'utf8')).toContain('plus three holdout styles')
  }, 120_000)

})
