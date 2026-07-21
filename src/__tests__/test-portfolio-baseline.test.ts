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

describe('TEST-3 immutable baseline report', () => {
  test('binds successful diagnostic observations to an immutable clean commit identity', () => {
    const report = loadReport()
    expect(report.schemaVersion).toBe(1)
    expect(report.kind).toBe('pre-test-portfolio-baseline')
    expect(report.provenance.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(report.provenance.trackedTreeClean).toBe(true)
    expect(Number.isNaN(Date.parse(report.provenance.capturedAt))).toBe(false)

    for (const observation of Object.values(report.observations)) {
      expect(observation.command.length).toBeGreaterThan(0)
      expect(observation.coverageInstrumentation).toBe(true)
      expect(observation.exitCode).toBe(0)
      expect(observation.wallSeconds).toBeGreaterThan(0)
      expect(observation.passed).toBeGreaterThan(0)
      expect(observation.skipped).toBeGreaterThanOrEqual(0)
      expect(observation.failed).toBe(0)
    }
  })

  test('keeps factor and duplicated-row arithmetic internally consistent', () => {
    const report = loadReport()
    const { families, nonDefaultLooks, palettes, layoutFixtures } = report.authorities
    expect(report.stylePortfolio.docsShowcaseRows).toBe(families * nonDefaultLooks * palettes)
    expect(report.stylePortfolio.styledGoldenRows).toBe(layoutFixtures * nonDefaultLooks)
    expect(report.stylePortfolio.duplicateStyledRenderRows).toBe(report.stylePortfolio.styledGoldenRows)
    expect(report.stylePortfolio.elevatedFamiliesCovered + report.stylePortfolio.missingElevatedFamilies.length).toBe(families)
  })

  test('records CI and artifact churn without converting timings into exact gates', () => {
    const report = loadReport()
    expect(report.ciWindow.repository).toBe('adewale/agentic-mermaid')
    expect(report.ciWindow.successful + report.ciWindow.failed).toBe(report.ciWindow.runCount)
    expect(report.ciWindow.p95Seconds).toBeGreaterThanOrEqual(report.ciWindow.p50Seconds)
    expect(report.artifactChurn.mergeCount).toBe(30)
    expect(report.artifactChurn.artifactTouchEvents).toBeGreaterThanOrEqual(report.artifactChurn.uniqueArtifactPaths)
    expect(report.artifactChurn.newStateBytesReviewed).toBeGreaterThan(report.artifactChurn.absoluteSizeDeltaBytes)
  })

  test('represents unmeasured coverage as explicit unknowns, never zero', () => {
    const report = loadReport()
    expect(Object.keys(report.unknowns).length).toBeGreaterThan(0)
    for (const unknown of Object.values(report.unknowns)) {
      expect(unknown.status).toBe('not-measurable-before-central-ledger')
      expect(unknown.reason.length).toBeGreaterThan(0)
    }
  })
})
