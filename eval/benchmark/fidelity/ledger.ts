import type { BenchmarkObservation } from '../unified/types.ts'
import { assessMeaning, type AuthoredFidelityCase } from './meaning.ts'
import { plannedPaintCriteria } from './paint.ts'
import { plannedQuantitativeCriteria } from './paint-values.ts'

export interface FidelityCriterionPlan { caseId: string; family: string; required: boolean; surface: string; criterion: string }
const key = (item: Pick<FidelityCriterionPlan, 'caseId' | 'surface' | 'criterion'>) => JSON.stringify([item.caseId, item.surface, item.criterion])
const coordinates = (row: BenchmarkObservation): Pick<FidelityCriterionPlan, 'caseId' | 'surface' | 'criterion'> => ({ caseId: String(row.metrics?.authoredCase ?? ''), surface: row.surface, criterion: String(row.metrics?.criterion ?? row.operation) })
const projectOf = (row: BenchmarkObservation) => String(row.metrics?.implementation ?? row.metrics?.project ?? '')

/** Authored expectations choose the complete denominator before any renderer or
 * observer returns. A failed render cannot remove planned geometry criteria. */
export function planFidelityCriteria(cases: readonly AuthoredFidelityCase[]): FidelityCriterionPlan[] {
  const result: FidelityCriterionPlan[] = [], seen = new Set<string>()
  for (const testCase of cases) {
    const add = (surface: string, criterion: string) => {
      const item = { caseId: testCase.id, family: testCase.family, required: testCase.required, surface, criterion }
      if (seen.has(key(item))) throw Error('Duplicate authored fidelity criterion: ' + key(item))
      seen.add(key(item)); result.push(item)
    }
    add('native-public-api', 'native-admission')
    for (const item of assessMeaning(testCase).checks) add('native-public-api', item.criterion)
    for (const [index] of (testCase.prelude ?? []).entries()) { add('native-public-api', 'prelude-' + index); add('browser-public-api', 'prelude-' + index) }
    add('browser-public-api', 'public-svg-admission'); add('browser-public-api', 'standalone-svg-and-labels')
    for (const criterion of [...plannedPaintCriteria(testCase), ...plannedQuantitativeCriteria(testCase)]) add('browser-owned-ink', criterion)
  }
  return result
}

/** Complete one selected project's declared ledger without inventing a result.
 * Missing work stays unsupported or blocked; raw extra API diagnostics remain
 * visible but do not silently change the common fidelity denominator. */
export function completeCriterionLedger(planned: readonly FidelityCriterionPlan[], observations: readonly BenchmarkObservation[], project: string): BenchmarkObservation[] {
  const plans = new Map<string, FidelityCriterionPlan>(), declaredCases = new Set(planned.map(item => item.caseId)), observed = new Map<string, BenchmarkObservation>()
  for (const item of planned) { if (plans.has(key(item))) throw Error('Duplicate declared fidelity criterion'); plans.set(key(item), item) }
  for (const row of observations) {
    if (projectOf(row) && projectOf(row) !== project) throw Error('Fidelity row belongs to a different project')
    const coordinate = coordinates(row)
    if (!declaredCases.has(coordinate.caseId)) throw Error('Observed fidelity row has no declared authored case: ' + coordinate.caseId)
    if (observed.has(key(coordinate))) throw Error('Duplicate observed fidelity criterion: ' + project + ' ' + key(coordinate))
    observed.set(key(coordinate), row)
  }
  const rows = planned.map(item => {
    const recorded = observed.get(key(item))
    if (recorded) {
      if (recorded.family !== item.family) throw Error('Observed fidelity family differs from the authored plan')
      return { ...recorded, metrics: { ...recorded.metrics, implementation: project, authoredCase: item.caseId, criterion: item.criterion, required: item.required, fidelityCriterionDisposition: 'planned-observed', evidenceRecorded: true } }
    }
    const native = item.surface === 'native-public-api', admission = observed.get(key({ ...item, surface: native ? 'native-public-api' : 'browser-public-api', criterion: native ? 'native-admission' : 'public-svg-admission' }))
    const reason = admission && admission.status !== 'passed' ? `Declared criterion was not observed after ${admission.status} ${native ? 'native' : 'browser'} admission: ${admission.detail ?? ''}` : 'Producer omitted a declared criterion; no result or passing credit is inferred'
    return { suite: 'mermaid-fidelity', surface: item.surface, runtime: 'not-observed', family: item.family, caseId: item.caseId + ':' + item.criterion, operation: item.criterion, format: native ? 'structured' : 'svg', mode: 'independent-authored-criteria', status: admission?.status === 'unsupported' ? 'unsupported' : 'blocked', detail: reason, metrics: { implementation: project, authoredCase: item.caseId, criterion: item.criterion, required: item.required, fidelityCriterionDisposition: 'planned-missing', evidenceRecorded: false, missingEvidence: true } } as BenchmarkObservation
  })
  for (const [coordinate, row] of observed) if (!plans.has(coordinate)) rows.push({ ...row, metrics: { ...row.metrics, fidelityCriterionDisposition: row.operation.startsWith('serialized-') ? 'capability-specific-unranked' : 'unplanned-diagnostic', evidenceRecorded: true } })
  return rows
}

/** A row is not evidence of recovery/edit behavior when its own required setup
 * failed. Keep that raw row; withhold workflow-qualified comparison credit. */
const setupFailure = (rows: readonly BenchmarkObservation[], row: BenchmarkObservation) => {
  if (row.operation.startsWith('prelude-')) return undefined
  const coordinate = coordinates(row), native = row.surface === 'native-public-api'
  return rows.find(other => coordinates(other).caseId === coordinate.caseId && other.surface === (native ? 'native-public-api' : 'browser-public-api') && other.operation.startsWith('prelude-') && other.status !== 'passed')
}

export function compareFidelityCriteria(observations: readonly BenchmarkObservation[], projects: readonly string[], baseline = 'mermaid-js/mermaid') {
  if (new Set(projects).size !== projects.length) throw Error('Duplicate fidelity comparison project')
  const groups = new Map(projects.map(project => [project, observations.filter(row => projectOf(row) === project)]))
  const universe = new Map<string, BenchmarkObservation>()
  for (const row of observations) if (String(row.metrics?.fidelityCriterionDisposition).startsWith('planned-')) universe.set(key(coordinates(row)), row)
  if (!universe.size) throw Error('Fidelity comparison requires completed declared criterion ledgers')
  const index = new Map<string, Map<string, BenchmarkObservation>>()
  for (const [project, rows] of groups) {
    const cells = new Map<string, BenchmarkObservation>()
    for (const row of rows) if (String(row.metrics?.fidelityCriterionDisposition).startsWith('planned-')) { const coordinate = key(coordinates(row)); if (cells.has(coordinate)) throw Error('Duplicate comparison criterion for ' + project); cells.set(coordinate, row) }
    index.set(project, cells)
  }
  const reference = index.get(baseline) ?? new Map<string, BenchmarkObservation>(), referenceRows = groups.get(baseline) ?? []
  const calibrated: { caseId: string; criterion: string; family: string; required: boolean }[] = [], reviewRequired: { caseId: string; criterion: string; status: string; reason: string }[] = []
  const admittedKeys: string[] = []
  for (const [coordinate, item] of universe) {
    const row = reference.get(coordinate), setup = row && setupFailure(referenceRows, row)
    if (row?.status === 'passed' && !setup) { admittedKeys.push(coordinate); calibrated.push({ caseId: coordinates(item).caseId, criterion: item.surface + ':' + item.operation, family: item.family, required: item.metrics?.required === true }) }
    else reviewRequired.push({ caseId: coordinates(item).caseId, criterion: item.surface + ':' + item.operation, status: row?.status ?? 'missing-reference', reason: setup ? 'Reference workflow setup failed; raw postconditions cannot qualify a recovery/edit comparison' : !row ? 'No recorded baseline criterion; reference evidence is missing' : row.status === 'blocked' || row.status === 'unsupported' ? 'Required reference evidence unavailable; no peer pass or failure is inferred' : 'Review authored expectation, observer and actual reference output before ranking' })
  }
  const results = projects.map(project => {
    const rows = groups.get(project) ?? [], cells = index.get(project)!
    const comparisons = admittedKeys.map(coordinate => {
      const template = universe.get(coordinate)!, row = cells.get(coordinate), setup = row && setupFailure(rows, row)
      const status = setup ? 'blocked' : row?.status ?? 'blocked'
      return { caseId: coordinates(template).caseId, family: template.family, surface: template.surface, criterion: template.operation, required: template.metrics?.required === true, status, rawStatus: row?.status ?? 'missing', ...(setup ? { reason: 'Raw postcondition lacks workflow credit because required setup failed' } : !row ? { reason: 'Missing peer criterion is unavailable, never a pass' } : row.metrics?.missingEvidence ? { reason: row.detail } : {}) }
    })
    const cases = [...new Set([...universe.values()].map(row => coordinates(row).caseId))].map(caseId => {
      const plannedRows = [...universe.entries()].filter(([, row]) => coordinates(row).caseId === caseId)
      const all = plannedRows.map(([coordinate]) => cells.get(coordinate)), scoped = comparisons.filter(row => row.caseId === caseId)
      const diagnostics = rows.filter(row => coordinates(row).caseId === caseId && row.metrics?.fidelityCriterionDisposition === 'unplanned-diagnostic' && row.status !== 'passed')
      return { caseId, family: plannedRows[0]![1].family, required: plannedRows[0]![1].metrics?.required === true, declaredCriteria: all.length, recordedCriteria: all.filter(Boolean).length, rawPassedCriteria: all.filter(row => row?.status === 'passed').length, completeRawPass: all.every(row => row?.status === 'passed') && !diagnostics.length, calibratedCriteria: scoped.length, calibratedPassedCriteria: scoped.filter(row => row.status === 'passed').length, allDeclaredCriteriaCalibrated: scoped.length === all.length, completeCalibratedPass: scoped.length === all.length && scoped.length > 0 && scoped.every(row => row.status === 'passed') && !diagnostics.length, unqualifiedDiagnostics: diagnostics.length }
    })
    return { project, calibratedPopulation: admittedKeys.length, passed: comparisons.filter(row => row.status === 'passed').length, failed: comparisons.filter(row => row.status === 'failed').length, unavailable: comparisons.filter(row => row.status === 'blocked').length, unsupported: comparisons.filter(row => row.status === 'unsupported').length, comparisons, cases, unrankedCapabilityChecks: rows.filter(row => row.metrics?.fidelityCriterionDisposition === 'capability-specific-unranked').length }
  })
  return { baseline, baselineAvailable: reference.size > 0, rawPopulation: universe.size, calibratedPopulation: admittedKeys.length, calibrated, reviewRequired, results, scope: 'One authored criterion universe and one reference-qualified denominator across every project. Missing rows never pass. Raw outcomes and capability-specific checks stay separate; criterion totals are not a weighted overall fidelity score.' }
}
