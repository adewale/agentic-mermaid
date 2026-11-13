import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSectionBBrandEvidence, GRAPHICAL_BACKEND_PROBES, runSectionBBackendProbe } from '../../scripts/pr-assets/section-b-brand-evidence.ts'
import { knownBuiltinFamilies } from '../agent/families.ts'

const PNG = join(import.meta.dir, 'testdata', 'section-b-brand-evidence.png')

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(Buffer.from(bytes.subarray(1, 4)).toString()).toBe('PNG')
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('Section B reviewed rendering golden', () => {
  test('byte-matches the registry-driven renderer output and is reviewable at native size', () => {
    const checked = readFileSync(PNG)
    expect(
      Buffer.from(buildSectionBBrandEvidence()).equals(checked),
      'Section B PNG differs from the reviewed golden; inspect the candidate before updating the golden',
    ).toBe(true)
    expect(pngDimensions(checked)).toEqual({ width: 1560, height: 17064 })
    expect(checked.byteLength).toBeGreaterThan(500_000)
  }, 120_000)

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
