import type { PortableCase } from './cohorts.ts'
import type { PortableWorkerResult, Track } from './protocol.ts'
import { calibrate, median, summarize } from './statistics.ts'
import { modelCost, processCpuCost, type UsageEvidence } from './costs.ts'

export function portableSummary(cases: PortableCase[], results: PortableWorkerResult[], settings: { rounds: number; samples: number; coldSamples: number; maximumControlSpread: number; cpuHourUsd?: number; usage?: UsageEvidence }) {
  if (new Set(results.map(result => result.protocol)).size > 1) throw Error('Cannot combine different portable measurement protocols')
  const tracks: Track[] = ['first-use', 'warm-repeat', 'warm-new-source', 'warm-label-edit']
  // Families whose canonical source the renderer rejected; their cases were never run.
  const unsupported = new Map(results.filter(result => result.mode === 'probe' && result.status === 'unsupported').map(result => [result.family, result.error ?? 'Renderer rejected the canonical family source']))
  const measured = cases.filter(testCase => !unsupported.has(testCase.family))
  const rows = measured.flatMap(testCase =>
    tracks
      .filter(track => track !== 'warm-label-edit' || testCase.edit)
      .map(track => {
        const relevant = results.filter(result => result.caseId === testCase.id && (track === 'first-use' ? result.mode === 'cold' : result.mode === 'warm'))
        const expectedWorkers = settings.rounds * 3 * (track === 'first-use' ? settings.coldSamples : 1)
        const keys = new Set(relevant.map(result => `${result.round}:${result.replica}:${result.sample}`))
        const completeWorkers = relevant.length === expectedWorkers && keys.size === expectedWorkers && relevant.every(result => Number.isInteger(result.round) && result.round >= 1 && result.round <= settings.rounds && ['A0', 'A1', 'B'].includes(result.replica) && Number.isInteger(result.sample) && result.sample >= 0 && result.sample < (track === 'first-use' ? settings.coldSamples : 1))
        const rounds = Array.from({ length: settings.rounds }, (_, index) => {
          const perReplica = (replica: string) => relevant.filter(result => result.round === index + 1 && result.replica === replica).flatMap(result => result.tracks[track] ?? [])
          return { round: index + 1, A0: perReplica('A0'), A1: perReplica('A1'), B: perReplica('B') }
        })
        const calibration = calibrate(rounds, track === 'first-use' ? Math.max(20, settings.coldSamples) : Math.max(31, settings.samples), settings.maximumControlSpread)
        if (!completeWorkers || relevant.some(result => result.status === 'failed' || result.status === 'blocked')) {
          calibration.status = 'uncalibrated'
          calibration.gaps.push(completeWorkers ? 'A worker failed or its declared output checks failed' : 'Expected worker identities are missing or duplicated')
        }
        return {
          caseId: testCase.id,
          family: testCase.family,
          cohort: testCase.cohort,
          scale: testCase.scale ?? null,
          expectedAccepted: testCase.expected.accept,
          track,
          ...summarize(rounds.flatMap(round => round.B)),
          rounds: rounds.map(round => ({ round: round.round, ...summarize(round.B) })),
          calibration,
          scope:
            track === 'first-use'
              ? testCase.prelude?.length
                ? 'First final-source API call after the declared prelude in each fresh process; import excluded.'
                : 'First API call in each fresh process; import excluded.'
              : (track === 'warm-new-source' ? 'Comment-varied source bytes with the same semantic graph; cache-key diagnostic, not proof of uncached layout. ' : '') + 'Distribution of per-call means from bounded adaptive batches; p95 of sample means is not a single-call tail latency.',
          semanticComplete: completeWorkers && relevant.every(result => result.qualification?.semanticComplete === true),
          nativeAndPaintScopes: [...new Set(relevant.flatMap(result => result.qualification?.unmeasuredScopes.filter(scope => !scope.startsWith('Repeated passing')) ?? []))],
        }
      }),
  )
  const coverage = cases.map(testCase => {
    const calls = results.filter(result => result.caseId === testCase.id && result.mode !== 'baseline')
    const failed = calls.filter(result => result.status === 'failed'),
      blocked = calls.filter(result => result.status === 'blocked')
    const timingComplete = rows.filter(row => row.caseId === testCase.id).every(row => !row.calibration.gaps.includes('Expected worker identities are missing or duplicated'))
    return {
      id: testCase.id,
      family: testCase.family,
      cohort: testCase.cohort,
      expectedAccepted: testCase.expected.accept,
      unsupported: unsupported.get(testCase.family) ?? null,
      checkedWorkers: calls.length,
      acceptanceMatches: timingComplete && calls.length > 0 && calls.every(result => result.qualification?.accepted === testCase.expected.accept),
      failedWorkers: failed.length,
      blockedWorkers: blocked.length,
      semanticComplete: timingComplete && testCase.expected.accept && calls.length > 0 && calls.every(result => result.qualification?.semanticComplete),
      unmeasuredScopes: [...new Set(calls.flatMap(result => result.qualification?.unmeasuredScopes.filter(scope => !scope.startsWith('Repeated passing')) ?? []))],
      failures: failed.slice(0, 3).map(result => ({ mode: result.mode, round: result.round, replica: result.replica, error: result.error ?? null, checks: result.qualification?.checks.filter(check => check.status === 'failed') ?? [] })),
    }
  })
  const resources = cases.flatMap(testCase =>
    Array.from({ length: settings.rounds }, (_, index) => {
      const active = results.find(result => result.caseId === testCase.id && result.mode === 'memory' && result.round === index + 1)
      const baseline = results.find(result => result.caseId === testCase.id && result.mode === 'baseline' && result.round === index + 1)
      if (!active?.memory || !baseline?.memory) return []
      const delta = (left: typeof active.memory.before, right: typeof left) => Object.fromEntries(Object.keys(left).map(key => [key, left[key as keyof typeof left] - right[key as keyof typeof right]]))
      return [
        {
          caseId: testCase.id,
          family: testCase.family,
          cohort: testCase.cohort,
          round: index + 1,
          qualified: active.status !== 'failed' && active.status !== 'blocked' && baseline.status === 'passed',
          before: active.memory.before,
          atReturn: active.memory.atReturn,
          afterGc: active.memory.afterGc,
          apiReturnDelta: delta(active.memory.atReturn, active.memory.before),
          retainedDelta: delta(active.memory.afterGc, active.memory.before),
          baselineAfterGc: baseline.memory.afterGc,
          gcAvailable: active.memory.gcAvailable,
          wholeWorker: active.resource ?? null,
          baselineWholeWorker: baseline.resource ?? null,
          cost: active.resource ? processCpuCost(active.resource.userSeconds, active.resource.systemSeconds, settings.cpuHourUsd) : null,
        },
      ]
    }).flat(),
  )
  const representativeFamilies = [...new Set(cases.filter(testCase => testCase.cohort === 'family').map(testCase => testCase.family))]
  const familyTimings = representativeFamilies.map(family => {
    const row = rows.find(row => row.family === family && row.cohort === 'family' && row.track === 'warm-repeat')
    return { family, supported: !unsupported.has(family), medianMs: row?.medianMs ?? null, calibrated: row?.calibration.status === 'calibrated', semanticComplete: row?.semanticComplete ?? false }
  })
  return {
    status: results.some(result => result.status === 'failed') ? 'failed' : results.some(result => result.status === 'blocked') ? 'blocked' : !measured.length ? 'unsupported' : rows.some(row => row.calibration.status !== 'calibrated') ? 'uncalibrated' : 'measured',
    cases: coverage,
    timing: rows,
    familyTimings,
    resources,
    retention: results.filter(result => result.mode === 'retention').map(result => ({ caseId: result.caseId, round: result.round, snapshots: result.retention })),
    modelCost: modelCost(settings.usage),
    counts: {
      cases: cases.length,
      positiveCases: cases.filter(testCase => testCase.expected.accept).length,
      negativeCases: cases.filter(testCase => !testCase.expected.accept).length,
      families: representativeFamilies.length,
      unsupportedFamilies: [...unsupported.keys()],
      unsupportedCases: cases.length - measured.length,
      workers: results.length,
      failedWorkers: results.filter(result => result.status === 'failed').length,
      blockedWorkers: results.filter(result => result.status === 'blocked').length,
      completeSemanticCases: coverage.filter(row => row.semanticComplete).length,
      calibratedTimingRows: rows.filter(row => row.calibration.status === 'calibrated').length,
      totalTimingRows: rows.length,
      actualTimedCalls: results.reduce(
        (sum, result) =>
          sum +
          Object.values(result.iterations ?? {})
            .flat()
            .reduce((a, b) => a + (b ?? 0), 0) +
          (result.mode === 'cold' ? 1 : 0),
        0,
      ),
    },
  }
}

const escape = (value: unknown) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
export function portableMarkdown(report: { project: string; version: string; startedAt: string; finishedAt: string; evidenceDirectory: string; summary: ReturnType<typeof portableSummary>; sampling: unknown; reused: boolean }) {
  const summary = report.summary
  const lines = [
    `# ${report.project} benchmark case study`,
    '',
    `Version: ${report.version}. Measured ${report.startedAt} through ${report.finishedAt}. ${report.reused ? 'Retained observations reused; no new clocks.' : 'Fresh retained observations.'}`,
    '',
    `Cases: ${summary.counts.cases}; families: ${summary.counts.families}; positive: ${summary.counts.positiveCases}; negative: ${summary.counts.negativeCases}. Failed workers: ${summary.counts.failedWorkers}; blocked workers: ${summary.counts.blockedWorkers}.`,
    '',
    `Timing calibration: ${summary.counts.calibratedTimingRows}/${summary.counts.totalTimingRows} rows calibrated. Declared native-plus-painted correspondence: ${summary.counts.completeSemanticCases}/${summary.counts.positiveCases} positive cases. Acceptance, semantic evidence and timing calibration are separate observations.`,
    '',
    'A0, A1 and B use the same admitted artifact. Their differences diagnose measurement variation; they cannot establish a product speedup. Cold imports may prepare in batches, but first API calls execute one at a time after the complete idle barrier. Timings exclude import and qualification. Cases with a prelude report first-final-source timing after that prelude.',
    '',
    ...(summary.counts.unsupportedFamilies.length ? [`Unsupported families: ${summary.counts.unsupportedFamilies.join(', ')}. The renderer rejected each family's canonical source, so their ${summary.counts.unsupportedCases} cases were not run; they are coverage gaps, not failures.`, ''] : []),
    '## Family representatives',
    '',
    '| Family | Warm repeated API median (ms) | Calibrated | Native + painted criteria |',
    '|---|---:|---|---|',
    ...summary.familyTimings.map(row => `| ${row.family} | ${row.supported ? (row.medianMs?.toFixed(4) ?? 'unavailable') : 'unsupported'} | ${row.calibrated} | ${row.semanticComplete ? 'declared criteria complete' : 'partial; see case scopes'} |`),
    '',
    '## Scaling',
    '',
    '| Family | Size | Warm repeat median (ms) | Warm calibrated | First-use p95 (ms) | First-use calibrated |',
    '|---|---:|---:|---|---:|---|',
    ...summary.timing.filter(row => row.cohort === 'scaling' && row.track === 'warm-repeat').map(row => {
      const cold = summary.timing.find(candidate => candidate.caseId === row.caseId && candidate.track === 'first-use')
      return `| ${row.family} | ${row.scale} | ${row.medianMs?.toFixed(4) ?? 'unavailable'} | ${row.calibration.status === 'calibrated'} | ${cold?.p95Ms?.toFixed(4) ?? 'unavailable'} | ${cold?.calibration.status === 'calibrated'} |`
    }),
    '',
    '## Individual cases and fidelity',
    '',
    '| Case | Acceptance matches | Failed / blocked workers | Semantic scope |',
    '|---|---|---:|---|',
    ...summary.cases.map(
      row => `| ${escape(row.id)} | ${row.acceptanceMatches} | ${row.failedWorkers} / ${row.blockedWorkers} | ${row.unsupported ? 'Family unsupported; not run' : row.semanticComplete ? 'Declared native + painted checks complete' : row.expectedAccepted ? 'Paint/native projection incomplete; never a full fidelity pass' : 'Negative-source rejection only'} |`,
    ),
    '',
    '## Memory and cost',
    '',
    'API RSS/heap snapshots are read before output qualification, at return and after dropping the output and requesting GC. Signed deltas remain signed. Independent import/prelude-only baseline processes are retained. These snapshots do not measure peak native/WASM/GPU allocation. GNU time peaks and CPU, when available, describe the whole worker, including import, driver, GC and later qualification; they are not API-only peaks or provider invoices.',
    '',
    '| Family representative | Median API-return RSS change (MiB) | Median post-GC heap change (KiB) | Median whole-worker peak RSS (MiB) |',
    '|---|---:|---:|---:|',
    ...summary.cases
      .filter(row => row.cohort === 'family')
      .map(row => {
        const resource = summary.resources.filter(resource => resource.caseId === row.id && resource.qualified)
        const rss = resource.map(resource => resource.apiReturnDelta.rss as number),
          heap = resource.map(resource => resource.retainedDelta.heapUsed as number),
          peaks = resource.flatMap(resource => (resource.wholeWorker ? [resource.wholeWorker.peakRssBytes] : []))
        return `| ${row.family} | ${rss.length ? (median(rss) / 1048576).toFixed(3) : 'unavailable'} | ${heap.length ? (median(heap) / 1024).toFixed(3) : 'unavailable'} | ${peaks.length ? (median(peaks) / 1048576).toFixed(3) : 'unavailable'} |`
      }),
    '',
    `Live model cost: ${summary.modelCost.status}. No provider call is made by this runner. CPU cost needs an explicit rate; zero coarse CPU counters are censored, not free. Retention checkpoints at 0/10/100/1000 comment-varied calls of the same semantic graph are available for the declared small flowchart case, not all families or a leak proof.`,
    '',
    '## Uncalibrated or failed timing rows',
    '',
    ...summary.timing.filter(row => row.calibration.status !== 'calibrated').map(row => `- ${row.caseId} / ${row.track}: ${row.calibration.gaps.join('; ')}`),
    '',
    '## Reproduction and raw evidence',
    '',
    `Evidence directory: ${report.evidenceDirectory}`,
    '',
    'Sampling:',
    '```json',
    JSON.stringify(report.sampling, null, 2),
    '```',
    '',
    'Every individual first-use sample and every warm batch mean is retained. Representative SVG and full qualification payloads accompany raw results; repeated passing payloads are compacted. Dave, the historical fixed core and pinned-Mermaid scores are unchanged. Curves, clipping, full shape boundaries, computed fonts and perceptual quality need separate reviewed evidence.',
    '',
  ]
  return lines.join('\n')
}
