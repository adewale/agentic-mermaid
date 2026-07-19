#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ContactSheetReview {
  schemaVersion: number
  status: string
  kind: string
  manifest: string
  manifestSha256: string
  reviewedAt: string | null
  reviewer: string | null
  minutes: number | null
  nativeSizeCellsInspected: string[]
  findings: unknown[]
}

export function validateContactSheetReview(
  review: ContactSheetReview,
  manifestBytes: Uint8Array,
  manifestRows: readonly string[],
): string[] {
  const errors: string[] = []
  const digest = createHash('sha256').update(manifestBytes).digest('hex')
  if (review.schemaVersion !== 1) errors.push('review schemaVersion must be 1')
  if (review.status !== 'approved') errors.push('review status must be approved by an independent human')
  if (review.manifestSha256 !== digest) errors.push('review manifestSha256 does not bind the current contact sheet')
  if (typeof review.reviewer !== 'string' || review.reviewer.trim() === '') errors.push('reviewer is required')
  if (typeof review.reviewedAt !== 'string' || Number.isNaN(Date.parse(review.reviewedAt))) errors.push('reviewedAt must be an ISO date')
  if (typeof review.minutes !== 'number' || !Number.isFinite(review.minutes) || review.minutes <= 0) errors.push('positive review minutes are required')
  const knownRows = new Set(manifestRows)
  if (!Array.isArray(review.nativeSizeCellsInspected) || review.nativeSizeCellsInspected.length === 0) {
    errors.push('at least one high-risk cell must be recorded as inspected at native size')
  } else {
    const unknown = review.nativeSizeCellsInspected.filter(id => !knownRows.has(id))
    if (unknown.length > 0) errors.push(`unknown inspected cells: ${unknown.join(', ')}`)
  }
  if (!Array.isArray(review.findings)) errors.push('findings must be an array (empty is an honest result)')
  return errors
}

if (import.meta.main) {
  const root = join(import.meta.dir, '..', '..')
  const directory = join(root, 'eval', 'test-portfolio', 'contact-sheets')
  const manifestPath = join(directory, 'citizenship.manifest.json')
  const reviewPath = join(directory, 'citizenship-review.json')
  const manifestBytes = readFileSync(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString()) as { rows: Array<{ id: string }> }
  const review = JSON.parse(readFileSync(reviewPath, 'utf8')) as ContactSheetReview
  const errors = validateContactSheetReview(review, manifestBytes, manifest.rows.map(row => row.id))
  if (errors.length > 0) {
    for (const error of errors) console.error(`contact-sheet-review: ${error}`)
    process.exit(1)
  }
  console.log(`contact-sheet-review: approved ${review.kind} sheet by ${review.reviewer}`)
}
