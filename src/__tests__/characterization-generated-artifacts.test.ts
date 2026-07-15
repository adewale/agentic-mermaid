import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
import { knownBuiltinFamilies } from '../agent/index.ts'
import {
  buildPng as buildIssue38StylePermutationPng,
  OUTPUT_PATH as ISSUE38_STYLE_PERMUTATION_PATH,
} from '../../scripts/pr-assets/issue-38-style-permutations.ts'
import {
  buildPng as buildFamilyElevationStylePalettePng,
  OUTPUT_PATH as FAMILY_ELEVATION_STYLE_PALETTE_PATH,
} from '../../scripts/pr-assets/family-elevation-style-palette.ts'

const ROOT = join(import.meta.dir, '..', '..')

describe('characterisation generated artifacts', () => {
  it('contact sheets are in sync with their generators', () => {
    expect(readFileSync(CONTACT_SHEET_PATH, 'utf8')).toBe(buildContactSheet())
    expect(readFileSync(FAMILY_CONTACT_SHEET_PATH, 'utf8')).toBe(buildFamilyContactSheet())
  })

  it('issue #38 style permutation PNG is in sync with its generator', () => {
    expect(existsSync(ISSUE38_STYLE_PERMUTATION_PATH)).toBe(true)
    expect(readFileSync(ISSUE38_STYLE_PERMUTATION_PATH)).toEqual(Buffer.from(buildIssue38StylePermutationPng()))
  })

  it('family-elevation Style + Palette evidence is in sync with its generator', () => {
    expect(existsSync(FAMILY_ELEVATION_STYLE_PALETTE_PATH)).toBe(true)
    expect(readFileSync(FAMILY_ELEVATION_STYLE_PALETTE_PATH)).toEqual(Buffer.from(buildFamilyElevationStylePalettePng()))
  })

  it('the interactive all-family Style contact sheet is in sync with its generator', () => {
    const result = Bun.spawnSync([
      'bun', 'run', 'scripts/pr-assets/style-switch-contact-sheet.ts', '--check',
    ], { cwd: ROOT })
    expect(result.exitCode, result.stderr.toString()).toBe(0)
    expect(result.stdout.toString()).toContain('Style-switch contact sheet is synchronized')
  }, 30_000)

  it('visual quality report and SVG snapshots are in sync with their generator', () => {
    for (const [path, expected] of buildVisualQualityArtifacts()) {
      expect(existsSync(path)).toBe(true)
      expect(readFileSync(path, 'utf8')).toBe(expected)
    }
  })

  it('visual quality metrics stay finite and reviewable for every canonical family', () => {
    const rows = collectVisualQualityRows()
    expect(rows.map(row => row.family).sort()).toEqual([...knownBuiltinFamilies()].sort())

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
      expect(row.metrics.minimumTextContrast).not.toBeNull()
    }
    const pie = rows.find(row => row.family === 'pie')!
    expect(pie.metrics.minimumTextContrast).not.toBeNull()
    expect(pie.metrics.minimumTextContrast!).toBeLessThan(4.5)
    expect(pie.metrics.minimumTextContrast!).toBeGreaterThan(3.5)
    const classDiagram = rows.find(row => row.family === 'class')!
    expect(classDiagram.metrics.minimumTextContrast).toBeCloseTo(13.54, 2)
  })
})
