import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
const REPORT_PATH = join(REPO, 'eval', 'test-portfolio', 'baseline.json')

interface TimedObservation {
  command: string
  coverageInstrumentation: boolean
  exitCode: number
  wallSeconds: number
  passed: number
  skipped: number
  failed: number
}

interface BaselineReport {
  schemaVersion: number
  kind: string
  provenance: {
    sourceCommit: string
    trackedTreeClean: boolean
    capturedAt: string
  }
  environment: {
    runtime: string
    os: string
    release: string
    arch: string
    cpuModel: string
    logicalCpus: number
  }
  authorities: {
    families: number
    nonDefaultLooks: number
    palettes: number
    layoutFixtures: number
  }
  observations: Record<string, TimedObservation>
  stylePortfolio: {
    docsShowcaseRows: number
    styledGoldenRows: number
    duplicateStyledRenderRows: number
    elevatedFamiliesCovered: number
    missingElevatedFamilies: string[]
  }
  ciWindow: {
    repository: string
    workflow: string
    runCount: number
    successful: number
    failed: number
    p50Seconds: number
    p95Seconds: number
  }
  artifactChurn: {
    mergeCount: number
    artifactTouchEvents: number
    uniqueArtifactPaths: number
    newStateBytesReviewed: number
    absoluteSizeDeltaBytes: number
  }
  unknowns: Record<string, { status: string; reason: string }>
}

function loadReport(): BaselineReport {
  return JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as BaselineReport
}

// A lint of a frozen, historical data file: no product code runs here, so
// these checks can only fail when someone edits baseline.json. They keep the
// record well-formed and its derived numbers consistent with each other; they
// deliberately do not pin its literal values (history is not a spec).
describe('TEST-3 immutable baseline report (data lint)', () => {
  test('is well-formed and internally consistent', () => {
    const report = loadReport()
    expect(report.schemaVersion).toBe(1)
    expect(report.kind).toBe('pre-test-portfolio-baseline')
    expect(report.provenance.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(report.provenance.trackedTreeClean).toBe(true)
    expect(Number.isNaN(Date.parse(report.provenance.capturedAt))).toBe(false)

    // Only successful diagnostic observations are recorded.
    for (const [name, observation] of Object.entries(report.observations)) {
      expect({ name, command: observation.command.length > 0, coverage: observation.coverageInstrumentation, exitCode: observation.exitCode, failed: observation.failed, timed: observation.wallSeconds > 0, passed: observation.passed > 0, skipped: observation.skipped >= 0 })
        .toEqual({ name, command: true, coverage: true, exitCode: 0, failed: 0, timed: true, passed: true, skipped: true })
    }

    // Factor and duplicated-row arithmetic.
    const { families, nonDefaultLooks, palettes, layoutFixtures } = report.authorities
    expect(report.stylePortfolio.docsShowcaseRows).toBe(families * nonDefaultLooks * palettes)
    expect(report.stylePortfolio.styledGoldenRows).toBe(layoutFixtures * nonDefaultLooks)
    expect(report.stylePortfolio.duplicateStyledRenderRows).toBe(report.stylePortfolio.styledGoldenRows)
    expect(report.stylePortfolio.elevatedFamiliesCovered + report.stylePortfolio.missingElevatedFamilies.length).toBe(families)

    // CI and artifact churn are recorded, never turned into timing gates.
    expect(report.ciWindow.successful + report.ciWindow.failed).toBe(report.ciWindow.runCount)
    expect(report.ciWindow.p95Seconds).toBeGreaterThanOrEqual(report.ciWindow.p50Seconds)
    expect(report.artifactChurn.artifactTouchEvents).toBeGreaterThanOrEqual(report.artifactChurn.uniqueArtifactPaths)
    expect(report.artifactChurn.newStateBytesReviewed).toBeGreaterThan(report.artifactChurn.absoluteSizeDeltaBytes)

    // Unmeasured coverage is an explicit unknown, never a zero.
    expect(Object.keys(report.unknowns).length).toBeGreaterThan(0)
    for (const [name, unknown] of Object.entries(report.unknowns)) {
      expect({ name, status: unknown.status, reason: unknown.reason.length > 0 }).toEqual({ name, status: 'not-measurable-before-central-ledger', reason: true })
    }
  })
})
