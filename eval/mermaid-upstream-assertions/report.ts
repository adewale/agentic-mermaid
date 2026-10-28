import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { upstreamSpecFiles } from './inventory.ts'

type Spec = ReturnType<typeof upstreamSpecFiles>[number]
type Audit = { file: string; name: string; path: string[]; inputs: Array<{ family: string; source: string; accepted?: boolean; error?: string }>; checks?: Array<{ family: string; operation: string; targetType?: string; sourceTypes?: Array<string | null> }>; unavailable: string[] }
type Assertion = { ancestorTitles: string[]; fullName: string; title: string; status: string; failureMessages: string[] }
type Suite = { name: string; message: string; assertionResults: Assertion[] }
type Cause = 'passed' | 'native-refusal' | 'assertion-mismatch' | 'adapter-unavailable' | 'reference-unqualified' | 'skipped'

function records(path: string): Map<string, Audit[]> {
  const grouped = new Map<string, Audit[]>()
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const audit: Audit = JSON.parse(line)
    const key = JSON.stringify([audit.file, audit.path])
    const entries = grouped.get(key) ?? []
    entries.push(audit)
    grouped.set(key, entries)
  }
  return grouped
}

/** A reference pass qualifies a comparison. Missing APIs are coverage gaps,
 * even when an original negative assertion happened to catch their error. */
export function assertionReport(upstream: string, specs: Spec[], candidatePath: string, referencePath: string, candidateAuditPath: string, referenceAuditPath: string) {
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8'))
  const reference = JSON.parse(readFileSync(referencePath, 'utf8'))
  const candidateAudits = records(candidateAuditPath), referenceAudits = records(referenceAuditPath)
  const references = new Map<string, Assertion[]>()
  for (const suite of reference.testResults as Suite[]) for (const assertion of suite.assertionResults) {
    const key = JSON.stringify([suite.name, assertion.fullName])
    references.set(key, [...references.get(key) ?? [], assertion])
  }
  const byFile = new Map(specs.map(spec => [spec.path, spec.family]))
  const cases: Array<{ family: string; file: string; name: string; cause: Cause; candidateStatus: string; referenceStatus?: string; unavailable: string[]; inputs: Audit['inputs']; checks: NonNullable<Audit['checks']>; referenceChecks: NonNullable<Audit['checks']>; failures: string[] }> = []
  for (const suite of candidate.testResults as Suite[]) for (const assertion of suite.assertionResults) {
    const key = JSON.stringify([suite.name, assertion.fullName])
    const control = references.get(key)?.shift()
    const auditKey = JSON.stringify([suite.name, [...assertion.ancestorTitles, assertion.title]])
    const audit = candidateAudits.get(auditKey)?.shift()
    const referenceAudit = referenceAudits.get(auditKey)?.shift()
    let cause: Cause
    if (assertion.status === 'pending' || assertion.status === 'skipped' || assertion.status === 'todo') cause = 'skipped'
    else if (!audit || audit.unavailable.length) cause = 'adapter-unavailable'
    else if (control?.status !== 'passed' || !referenceAudit || referenceAudit.unavailable.length) cause = 'reference-unqualified'
    else if (assertion.status === 'passed') cause = 'passed'
    else if (audit?.inputs.some(input => input.accepted === false)) cause = 'native-refusal'
    else cause = 'assertion-mismatch'
    cases.push({ family: byFile.get(suite.name) ?? 'unknown', file: relative(upstream, suite.name), name: assertion.fullName, cause,
      candidateStatus: assertion.status, referenceStatus: control?.status, unavailable: audit?.unavailable ?? ['Missing per-case audit receipt'], inputs: audit?.inputs ?? [], checks: audit?.checks ?? [], referenceChecks: referenceAudit?.checks ?? [], failures: assertion.failureMessages })
  }
  const families = [...new Set(specs.map(spec => spec.family))].sort().map(family => {
    const selected = cases.filter(entry => entry.family === family)
    const counts = Object.fromEntries((['passed', 'native-refusal', 'assertion-mismatch', 'adapter-unavailable', 'reference-unqualified', 'skipped'] as Cause[]).map(cause => [cause, selected.filter(entry => entry.cause === cause).length])) as Record<Cause, number>
    const qualified = counts.passed! + counts['native-refusal']! + counts['assertion-mismatch']!
    return { family, files: specs.filter(spec => spec.family === family).length, registered: selected.length, ...counts, qualified, passPercentAmongQualified: qualified ? Math.round(counts.passed! / qualified * 1000) / 10 : null }
  })
  const uncollected = specs.flatMap(spec => {
    const found = (candidate.testResults as Suite[]).find(suite => suite.name === spec.path)
    return found?.assertionResults.length ? [] : [{ family: spec.family, file: relative(upstream, spec.path), message: found?.message ?? 'No suite result: file did not collect' }]
  })
  const totals = { inventoriedFiles: specs.length, uncollectedFiles: uncollected.length, registered: cases.length,
    ...Object.fromEntries(['passed', 'native-refusal', 'assertion-mismatch', 'adapter-unavailable', 'reference-unqualified', 'skipped'].map(cause => [cause, cases.filter(entry => entry.cause === cause).length])) }
  return { totals, families, uncollected, cases, referenceTotals: { registered: reference.numTotalTests, passed: reference.numPassedTests, failed: reference.numFailedTests, skipped: reference.numPendingTests + (reference.numTodoTests ?? 0) },
    interpretation: 'Original upstream assertions executed through native model adapters. The whole file inventory is attempted; uncollected and unmapped cases remain visible. Assertion mismatches require review: they can be runtime defects, deliberate divergences or model-view differences. This is not a claim that the complete upstream suite passes.' }
}

export function reportMarkdown(report: ReturnType<typeof assertionReport>): string {
  const rows = report.families.map(row => `| ${row.family} | ${row.registered} | ${row.passed} | ${row['native-refusal']} | ${row['assertion-mismatch']} | ${row['adapter-unavailable']} | ${row['reference-unqualified']} | ${row.skipped} |`)
  return `# Pinned Mermaid original assertion run\n\n${report.interpretation}\n\n${report.totals.inventoriedFiles} original files inventoried; ${report.totals.uncollectedFiles} did not collect. ${report.totals.registered} original test cases registered.\n\n| Family | Cases | Pass | Native refusal | Assertion mismatch | Unmapped API | Reference unqualified | Skip |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n\n“Pass” requires the corresponding pinned Mermaid control to pass. Native refusal and assertion mismatch are disjoint failure buckets, not adjudicated bug counts. Unmapped API includes direct database/helper and renderer APIs outside the native input-language contract. Full case names, sources, failures and collection errors are in report.json.\n`
}
