import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateCommunityScorecard } from '../unified/update-scorecard.ts'

test('unadmitted explicit report overlays cannot erase a maintained snapshot', () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-report-admission-'))
  try {
    const output = join(directory, 'snapshot.md')
    const original = '# Previously reviewed evidence\n'
    writeFileSync(output, original)
    writeFileSync(join(directory, 'report.json'), JSON.stringify({ profile: 'full', rounds: 3, finishedAt: new Date().toISOString(), suites: [] }))
    const unknown = join(directory, 'unknown.json')
    writeFileSync(unknown, JSON.stringify({ id: 'community', status: 'passed', observations: [] }))
    for (const selection of [
      { communityRun: directory },
      { invocationCorrection: unknown },
      { referenceCorrection: unknown },
      { currentRun: directory },
      { additionalRun: directory },
      { currentInvocationRun: directory },
      { currentDaveRun: directory },
      { familyCorrection: unknown },
      { suiteRuns: [directory] },
      { historicalPrs: directory },
    ]) {
      expect(() => updateCommunityScorecard(directory, output, undefined, selection)).toThrow()
      expect(readFileSync(output, 'utf8')).toBe(original)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
