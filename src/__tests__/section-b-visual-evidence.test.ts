import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { knownBuiltinFamilies } from '../agent/families.ts'
import { buildSectionBBrandEvidence } from '../../scripts/pr-assets/section-b-brand-evidence.ts'

const ROOT = join(import.meta.dir, '..', '..')
const PNG = join(ROOT, 'docs/design/families/section-b-brand-evidence.png')
const RECEIPT = join(ROOT, 'eval/section-b-brand-evidence/evidence-receipt.json')

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(Buffer.from(bytes.subarray(1, 4)).toString()).toBe('PNG')
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('Section B generated visual evidence', () => {
  test('byte-matches the registry-driven renderer output and is reviewable at native size', () => {
    const checked = readFileSync(PNG)
    expect(buildSectionBBrandEvidence()).toEqual(checked)
    expect(pngDimensions(checked)).toEqual({ width: 1560, height: 7944 })
    expect(checked.byteLength).toBeGreaterThan(500_000)
  }, 120_000)

  test('receipt covers every built-in family, sentinel plus three holdouts, public output paths, and an honest hard-error baseline', () => {
    const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8'))
    expect(receipt.families).toEqual(knownBuiltinFamilies())
    expect(receipt.variants).toHaveLength(4)
    expect(receipt.outputPaths).toEqual({
      graphicalCells: 'public native renderMermaidPNG',
      terminal: 'public renderMermaidASCII (Unicode, no color)',
    })
    expect(receipt.terminalSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt.baseline).toMatchObject({
      state: 'unsupported-style-fields',
      expected: expect.stringContaining('no fabricated before image'),
    })
    expect(receipt.baseline.command).toContain('origin/main')
    expect(receipt.baseline.command).toContain('eval/section-b-brand-evidence/baseline.mmd')
    expect(receipt.baseline.command).toContain('eval/section-b-brand-evidence/role-style.json')
    expect(readFileSync(join(ROOT, 'eval/section-b-brand-evidence/baseline.mmd'), 'utf8')).toContain('flowchart LR')
    expect(JSON.parse(readFileSync(join(ROOT, 'eval/section-b-brand-evidence/role-style.json'), 'utf8'))).toHaveProperty('roles.node')
    expect(receipt.outputs).toEqual([
      expect.objectContaining({ path: 'docs/design/families/section-b-brand-evidence.png', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ])
    expect(receipt.outputs[0].sha256).toBe(createHash('sha256').update(readFileSync(PNG)).digest('hex'))
  })
})
