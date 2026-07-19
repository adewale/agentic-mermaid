import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { buildContactSheetPlan } from './helpers/render-conformance-plan.ts'
import { validateContactSheetReview, type ContactSheetReview } from '../../scripts/ci/test-portfolio-visual-review.ts'

const ROOT = join(import.meta.dir, '..', '..')

describe('plan-derived contact sheets', () => {
  test('selects bounded registry-derived citizenship, interaction, and outlier probes', () => {
    const citizenship = buildContactSheetPlan('citizenship')
    expect(citizenship.length).toBe(BUILTIN_FAMILY_METADATA.length * 4)
    expect(new Set(citizenship.map(row => row.family))).toEqual(new Set(BUILTIN_FAMILY_METADATA.map(entry => entry.id)))
    expect(new Set(citizenship.map(row => row.backend))).toEqual(new Set(['default', 'hybrid', 'rough']))
    expect(new Set(citizenship.map(row => row.background))).toEqual(new Set(['opaque-dark', 'opaque-light', 'transparent']))

    const interaction = buildContactSheetPlan('interaction')
    expect(interaction.length).toBe(120)
    expect(new Set(interaction.map(row => row.family)).size).toBe(BUILTIN_FAMILY_METADATA.length)

    const outlier = buildContactSheetPlan('outlier')
    expect(outlier.length).toBeGreaterThanOrEqual(BUILTIN_FAMILY_METADATA.length * 3)
    expect(outlier.every(row => row.complexity === 'corpus-outlier')).toBe(true)
  })

  test('change sheets require known rows and include adjacent controls', () => {
    const row = buildContactSheetPlan('citizenship')[0]!
    const change = buildContactSheetPlan('change', [row.id])
    expect(change[0]?.id).toBe(row.id)
    expect(change.length).toBeGreaterThan(1)
    expect(change.every(candidate => candidate.family === row.family)).toBe(true)
    expect(() => buildContactSheetPlan('change')).toThrow(/requires at least one/)
    expect(() => buildContactSheetPlan('change', ['missing-row'])).toThrow(/Unknown conformance row/)
  })

  test('generates a real before/after change probe plus adjacent controls', () => {
    const directory = join(ROOT, 'eval', 'test-portfolio', 'contact-sheets')
    const rowId = JSON.parse(readFileSync(join(directory, 'citizenship.manifest.json'), 'utf8')).rows[0].id
    const output = mkdtempSync(join(tmpdir(), 'am-change-contact-sheet-'))
    const generated = spawnSync('bun', [
      'run', 'scripts/pr-assets/test-portfolio-contact-sheet.ts',
      '--kind', 'change', '--row-id', rowId,
      '--before-html', join(directory, 'citizenship.html'), '--output-dir', output,
    ], { cwd: ROOT, encoding: 'utf8' })
    expect(generated.status, generated.stderr).toBe(0)
    const manifest = JSON.parse(readFileSync(join(output, 'change.manifest.json'), 'utf8'))
    expect(manifest.rows.filter((row: { comparisonRole: string }) => row.comparisonRole === 'changed')).toHaveLength(1)
    expect(manifest.rows.find((row: { comparisonRole: string }) => row.comparisonRole === 'changed').beforeSvgSha256)
      .toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.rows.filter((row: { comparisonRole: string }) => row.comparisonRole === 'control').length).toBeGreaterThan(0)
    expect(readFileSync(join(output, 'change.html'), 'utf8')).toContain('<h3>Before</h3>')
  }, 20_000)

  test('keeps the committed probe reproducible, hash-bound and honestly pending human review', () => {
    const directory = join(ROOT, 'eval', 'test-portfolio', 'contact-sheets')
    const html = readFileSync(join(directory, 'citizenship.html'), 'utf8')
    const manifestBytes = readFileSync(join(directory, 'citizenship.manifest.json'))
    const manifest = JSON.parse(manifestBytes.toString())
    const review = JSON.parse(readFileSync(join(directory, 'citizenship-review.json'), 'utf8'))
    expect(createHash('sha256').update(html).digest('hex')).toBe(manifest.htmlSha256)
    expect(manifest.rowCount).toBe(BUILTIN_FAMILY_METADATA.length * 4)
    expect(manifest.baselineCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(manifest.rows.map((row: { id: string }) => row.id)).toEqual(buildContactSheetPlan('citizenship').map(row => row.id))
    expect(manifest.rows.every((row: { format: string; width: number; height: number }) =>
      row.format === 'svg' && row.width > 0 && row.height > 0)).toBe(true)
    expect(review.manifestSha256).toBe(createHash('sha256').update(manifestBytes).digest('hex'))
    expect(review.status).toBe('pending-independent-human-review')
    expect(review.reviewer).toBeNull()
    expect(review.automatedAndModelSanity.status).toBe('passed-without-human-approval-claim')
    const rowIds = manifest.rows.map((row: { id: string }) => row.id)
    expect(validateContactSheetReview(review, manifestBytes, rowIds)).toContain('review status must be approved by an independent human')

    const approved: ContactSheetReview = {
      ...review,
      status: 'approved',
      reviewer: 'Independent Maintainer',
      reviewedAt: '2026-07-19T00:00:00Z',
      minutes: 20,
      nativeSizeCellsInspected: [rowIds[0]!],
      findings: [],
    }
    expect(validateContactSheetReview(approved, manifestBytes, rowIds)).toEqual([])
    expect(validateContactSheetReview({ ...approved, manifestSha256: '0'.repeat(64) }, manifestBytes, rowIds))
      .toContain('review manifestSha256 does not bind the current contact sheet')
  })
})
