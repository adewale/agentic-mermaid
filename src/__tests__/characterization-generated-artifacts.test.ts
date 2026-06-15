import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

import {
  build as buildContactSheet,
  OUTPUT_PATH as CONTACT_SHEET_PATH,
} from '../../scripts/characterization/contact-sheet.ts'
import {
  build as buildFamilyContactSheet,
  OUTPUT_PATH as FAMILY_CONTACT_SHEET_PATH,
} from '../../scripts/characterization/contact-sheet-families.ts'
import {
  buildArtifacts as buildVisualQualityArtifacts,
  collectVisualQualityRows,
} from '../../scripts/characterization/visual-quality.ts'

describe('characterisation generated artifacts', () => {
  it('contact sheets are in sync with their generators', () => {
    expect(readFileSync(CONTACT_SHEET_PATH, 'utf8')).toBe(buildContactSheet())
    expect(readFileSync(FAMILY_CONTACT_SHEET_PATH, 'utf8')).toBe(buildFamilyContactSheet())
  })

  it('visual quality report and SVG snapshots are in sync with their generator', () => {
    for (const [path, expected] of buildVisualQualityArtifacts()) {
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe(expected)
    }
  })

  it('visual quality metrics stay finite and reviewable for every canonical family', () => {
    const rows = collectVisualQualityRows()
    expect(rows.length).toBe(12)

    for (const row of rows) {
      expect(row.svg).toContain('<svg')
      expect(row.svgSize.width).toBeGreaterThan(0)
      expect(row.svgSize.height).toBeGreaterThan(0)
      expect(row.pngBytes).toBeGreaterThan(8)
      expect(row.bounds.width).toBeGreaterThan(0)
      expect(row.bounds.height).toBeGreaterThan(0)
      expect(row.metrics.edgeCrossings).toBeGreaterThanOrEqual(0)
      expect(row.bends).toBeGreaterThanOrEqual(0)
      expect(row.routeLength).toBeGreaterThanOrEqual(0)
      expect(row.metrics.whitespaceBalance).toBeGreaterThanOrEqual(0)
      expect(row.metrics.whitespaceBalance).toBeLessThanOrEqual(1)
      expect(row.metrics.labelLegibility).toBeGreaterThanOrEqual(0)
      expect(row.metrics.labelLegibility).toBeLessThanOrEqual(1)
      expect(row.labelOverlaps).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(row.metrics.aspectRatio)).toBe(true)
    }
  })
})
