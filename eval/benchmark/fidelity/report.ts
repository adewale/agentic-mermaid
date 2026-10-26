import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { assertBenchmarkSetVersions, canonicalBenchmarkTool } from '../tool-versions.ts'
import type { BenchmarkObservation } from '../unified/types.ts'
import { fidelityCoreProjects } from './selection.ts'
import { readBenchmarkDocument, readBenchmarkResult, writeBenchmarkDocument, stableValue } from '../portable/project-records.ts'
import { compareFidelityCriteria, completeCriterionLedger, planFidelityCriteria } from './ledger.ts'

const read = readBenchmarkDocument
const html = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export interface FidelityReportOptions { core: string; community?: string; out: string }

/** Raw computed sizes remain observations. An export name cannot establish
 * a global font option that controls every owned node and relationship label. */
export function reviewFidelityCapabilities(rows: readonly BenchmarkObservation[], boundaries: readonly { project: string; kind?: string }[]) {
  const reviews: { project: string; caseId: string; criterion: string; rawStatus: string; status: string; rawActual: unknown; rawExpected: unknown; rawValueScope: string; reason: string }[] = []
  const observations = rows.map(row => {
    const project = String(row.metrics?.implementation ?? row.metrics?.project ?? ''), boundary = boundaries.find(item => item.project === project)
    if (Object.values(fidelityCoreProjects).some(value => value === project) || boundary?.kind !== 'beautiful' || row.operation !== 'computed-authored-font-size') return row
    const reason = 'No reviewed global all-label font option mapping for this actual Beautiful API. Published base RenderOptions lacks fontSize; the Vercel API separates node fontSize and edgeFontSize. Export-name inference cannot promise configured node and edge sizes. Original computed-size status and owned SVG remain in raw evidence.'
    reviews.push({ project, caseId: String(row.metrics?.authoredCase ?? row.caseId), criterion: row.operation, rawStatus: row.status, status: 'blocked', rawActual: row.metrics?.actual ?? null, rawExpected: row.metrics?.expected ?? null, rawValueScope: row.metrics?.actual === undefined ? 'Collector did not serialize passing values; original status and actual SVG remain available. No values are inferred from expectations.' : 'Actual recorded computed-size observation', reason })
    return { ...row, status: 'blocked' as const, detail: reason, metrics: { ...row.metrics, capabilityReview: 'unavailable-font-option-mapping', rawObservedStatus: row.status } }
  })
  return { observations, reviews }
}

/** Read retained observations only. Rendering, acquisition and performance
 * workers are deliberately absent from this consumer's dependency graph. */
export function writeFidelityComparison(options: FidelityReportOptions) {
  assertBenchmarkExecutionAllowed()
  const core = read(options.core), community = options.community ? read(options.community) : undefined
  const caseIds: string[] = core.cases.map((item: any) => item.id)
  if (community && JSON.stringify(community.selectedCaseIds) !== JSON.stringify(caseIds)) throw Error('Community and core authored case universes differ; collect matching functional evidence before composition')
  if (!core.criteriaProtocol?.producers?.length) throw Error('Core report lacks the actual shared authored/observer protocol receipt')
  if (community && stableValue(community.criteriaProtocol) !== stableValue(core.criteriaProtocol)) throw Error('Authored expectations, paint observers or actual browser differ; matching case names alone cannot qualify composition')
  const raw: BenchmarkObservation[] = [...core.observations, ...(community?.observations ?? [])]
  const versions = assertBenchmarkSetVersions([...(core.toolVersions ?? []), ...(community?.toolVersions ?? [])])
  const projects = [...new Set<string>([...core.targets.map((target: any) => String(target.project)), ...(community?.boundaries ?? []).filter((boundary: any) => boundary.status === 'admitted').map((boundary: any) => String(boundary.project))])]
  if (projects.includes('') || !projects.length) throw Error('Declared admitted project population is missing')
  if (raw.some(row => !projects.includes(String(row.metrics?.implementation ?? row.metrics?.project ?? '')))) throw Error('Observed row has no declared admitted implementation')
  const planned = planFidelityCriteria(core.cases)
  const rawLedger = projects.flatMap(project => completeCriterionLedger(planned, raw.filter(row => String(row.metrics?.implementation ?? row.metrics?.project ?? '') === project), project)).map(row => row.metrics?.missingEvidence ? { ...row, metrics: { ...row.metrics, fidelityCriterionDisposition: 'planned-missing', evidenceRecorded: false } } : row)
  const reviewed = reviewFidelityCapabilities(rawLedger, community?.boundaries ?? [])
  const observations: BenchmarkObservation[] = reviewed.observations
  const comparison = compareFidelityCriteria(observations, projects)
  for (const result of comparison.results) for (const item of result.cases) { const ledger = observations.filter(row => row.metrics?.implementation === result.project && row.metrics?.authoredCase === item.caseId && String(row.metrics?.fidelityCriterionDisposition).startsWith('planned-')); item.recordedCriteria = ledger.filter(row => row.metrics?.evidenceRecorded === true).length }
  const surfaces = ['browser-public-api', 'browser-owned-ink', 'native-public-api']
  const rows = comparison.results.map(result => {
    const projectRows = observations.filter(row => row.metrics?.implementation === result.project), rawRows = rawLedger.filter(row => row.metrics?.implementation === result.project)
    const cells = surfaces.map(surface => {
      const values = result.comparisons.filter(value => value.surface === surface)
      const authored = rawRows.filter(row => row.surface === surface && String(row.metrics?.fidelityCriterionDisposition).startsWith('planned-'))
      return { surface, requiredDenominator: values.filter(value => value.required).length, requiredPassed: values.filter(value => value.required && value.status === 'passed').length, supplementDenominator: values.filter(value => !value.required).length, supplementPassed: values.filter(value => !value.required && value.status === 'passed').length, denominator: values.length, passed: values.filter(value => value.status === 'passed').length, failed: values.filter(value => value.status === 'failed').length, unavailable: values.filter(value => ['blocked','unsupported'].includes(value.status)).length, rawDenominator: authored.length, rawRecorded: authored.filter(value => value.metrics?.evidenceRecorded === true).length, rawMissing: authored.filter(value => value.metrics?.evidenceRecorded !== true).length, rawPassed: authored.filter(value => value.status === 'passed').length, referenceUnqualified: authored.length - values.length }
    })
    const families = [...new Set(core.cases.map((value: any) => String(value.family)))].map(family => {
      const values = result.comparisons.filter(value => value.family === family && value.surface === 'browser-owned-ink')
      return { family, required: core.cases.some((value: any) => value.family === family && value.required), passed: values.filter(value => value.status === 'passed').length, total: values.length, failed: values.filter(value => value.status === 'failed').length, unavailable: values.filter(value => ['blocked','unsupported'].includes(value.status)).length }
    })
    const alias = projectRows.find(row => row.metrics?.artifactAliasSource)?.metrics?.artifactAliasSource
    return { project: result.project, version: versions.find(value => value.tool === canonicalBenchmarkTool(result.project))?.version ?? 'unreported', aliasOf: alias ?? null, cells, families, completeReviewedCases: result.cases.filter(value => value.completeRawPass).length, declaredCases: result.cases.length, serializedChecks: result.unrankedCapabilityChecks }
  }).sort((a,b) => b.cells[1]!.passed - a.cells[1]!.passed || a.cells[1]!.failed - b.cells[1]!.failed || a.project.localeCompare(b.project))
  const measuredWindow = (lane: string, source: any) => {
    const directories = [...new Set<string>((source.artifacts ?? []).filter((path: string) => /(?:fidelity-cases|artifact-alias)\.json$/.test(path)).map((path: string) => dirname(path)))]
    const measurements = directories.map(directory => { const result = readBenchmarkResult(join(directory, 'result.json')); return { project: result.observations[0]?.metrics?.implementation, startedAt: result.startedAt, finishedAt: result.finishedAt, evidenceDirectory: directory } })
    return { lane, measurements, compositionWindow: { startedAt: source.startedAt, finishedAt: source.finishedAt }, scope: measurements.length ? 'Original owning immutable result dates; top-level campaign times are composition, including cache reuse' : 'Owning measurement dates unavailable; top-level campaign dates are composition only' }
  }
  const report = { generatedAt: new Date().toISOString(), sourceReports: options, measurementWindows: [measuredWindow('core', core), ...(community ? [measuredWindow('community', community)] : [])], sourcePin: core.sourcePin, referenceBackend: core.addon, versions, declaredCaseCount: caseIds.length, authoredFamilyCount: new Set(core.cases.map((value: any) => value.family)).size, comparison, rows, capabilityReviews: reviewed.reviews, boundaries: community?.boundaries ?? [], gaps: [...new Set([...(core.gaps ?? []), ...(community?.gaps ?? [])])], scope: 'Ordering is measured independent paint criteria on one actual reference-qualified denominator, not overall fidelity or speed. Native APIs, admission and painted output remain separate. Reference-unqualified criteria remain explicit; the reference is not assumed perfect. Aliases are attributed, never extra independent votes.' }
  const lines = ['# Mermaid fidelity comparison', '', report.scope, '', `Measured ${report.declaredCaseCount} authored cases across ${report.authoredFamilyCount} families. Raw criterion universe: ${comparison.rawPopulation}; baseline-qualified: ${comparison.calibratedPopulation}; requiring review: ${comparison.reviewRequired.length}.`, '', '| Implementation | Version | SVG/API criteria | Paint criteria | Native model criteria | Complete reviewed cases |', '| --- | --- | ---: | ---: | ---: | ---: |', ...rows.map(row => `| ${row.project}${row.aliasOf ? ' (alias of '+row.aliasOf+')' : ''} | ${row.version} | ${row.cells.map(cell => `${cell.passed}/${cell.denominator} (${cell.failed} failed; ${cell.unavailable} unavailable)`).join(' | ')} | ${row.completeReviewedCases}/${row.declaredCases} |`), '', 'A complete reviewed case requires every authored criterion, including those the reference cannot qualify. A high partial pass count is not complete family support. Whole-family aesthetics, whole-browser/native/GPU memory and private upstream implementation tests are outside this lane.', '', 'Reference-unqualified criteria and all per-family/project outcomes remain in `comparison.json`. Actual SVG/PNG files are owned by the immutable measurement attempts. This report does not create new measurements.']
  const style = 'body{font:15px system-ui;margin:2rem;color:#17202a}table{border-collapse:collapse;font-size:13px}td,th{padding:.5rem;border:1px solid #ccd}th{position:sticky;top:0;background:#fff}.bar{display:flex;width:160px;height:14px;background:#eee}.pass{background:#167d50}.fail{background:#bc3545}.unknown{background:#adb4be}small{display:block}input{padding:.5rem;width:28rem}caption{text-align:left;margin:1rem 0}td[data-pct]{text-align:center}a{color:#17509a}'
  const bars = (cell: typeof rows[number]['cells'][number]) => `<div class="bar" aria-label="${cell.passed} passed, ${cell.failed} failed, ${cell.unavailable} unavailable out of ${cell.denominator}">${[['pass',cell.passed],['fail',cell.failed],['unknown',cell.unavailable]].map(([color,n]) => `<span class="${color}" style="width:${cell.denominator ? Number(n)*100/cell.denominator : 0}%"></span>`).join('')}</div><small>${cell.passed}/${cell.denominator}; ${cell.failed} failed; ${cell.unavailable} unavailable<br>required ${cell.requiredPassed}/${cell.requiredDenominator}; supplements ${cell.supplementPassed}/${cell.supplementDenominator}<br>raw ${cell.rawPassed}/${cell.rawDenominator}; ${cell.rawRecorded} observed, ${cell.rawMissing} missing; ${cell.referenceUnqualified} reference-unqualified</small>`
  const table = `<table><caption>Separate reference-qualified criteria; green passed, red failed, grey unavailable. Sorted by paint passes only.</caption><thead><tr><th>Implementation/version</th>${surfaces.map(value => `<th>${html(value)}</th>`).join('')}<th>All declared criteria pass</th></tr></thead><tbody>${rows.map(row => `<tr data-project="${html(row.project)}"><th>${html(row.project)}<small>${html(row.version)}${row.aliasOf ? '; attributed alias '+html(row.aliasOf) : ''}</small></th>${row.cells.map(cell => `<td>${bars(cell)}</td>`).join('')}<td>${row.completeReviewedCases}/${row.declaredCases} cases</td></tr>`).join('')}</tbody></table>`
  const families = rows[0]?.families.map(value => value.family) ?? []
  const heatmap = `<table><caption>Paint by family: passed/qualified, with failed and unavailable counts. No timing inference.</caption><thead><tr><th>Implementation</th>${families.map(value => `<th>${html(value)}${core.cases.some((item: any) => item.family === value && item.required) ? '' : ' (supplement)'}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr data-project="${html(row.project)}"><th>${html(row.project)}</th>${row.families.map(cell => `<td data-pct="${cell.total ? cell.passed/cell.total : 0}" style="background:hsl(150 30% ${cell.total ? 98-28*cell.passed/cell.total : 98}%)">${cell.passed}/${cell.total}<small>${cell.failed}F ${cell.unavailable}U</small></td>`).join('')}</tr>`).join('')}</tbody></table>`
  mkdirSync(options.out, { recursive: true })
  writeBenchmarkDocument(join(options.out, 'comparison.json'), report)
  writeFileSync(join(options.out,'comparison.md'),lines.join('\n')+'\n')
  writeFileSync(join(options.out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Independent Mermaid fidelity</title><style>${style}</style><h1>Independent Mermaid fidelity</h1><p>${html(report.scope)}</p><p>${report.declaredCaseCount} cases; ${comparison.rawPopulation} declared criteria; ${comparison.calibratedPopulation} baseline-qualified; ${comparison.reviewRequired.length} reference criteria requiring review.</p><label>Filter implementation <input id="filter" type="search"></label>${table}<h2>Family evidence</h2>${heatmap}<h2>Review limits</h2><p>Native unavailable means no reviewed public-model projection, not a failed diagram. Reference qualification is observational; raw reference failures remain in the JSON. Layout is each renderer’s own. No pixel-equivalence, full typography or overall quality claim.</p><p><a href="comparison.json.gz">Complete criterion and missing-evidence ledger (gzip JSON)</a></p><script>document.querySelector('#filter').addEventListener('input',e=>document.querySelectorAll('[data-project]').forEach(r=>r.hidden=!r.dataset.project.toLowerCase().includes(e.target.value.toLowerCase())))</script>`)
  return report
}

if (import.meta.main) {
  const args = new Map<string,string>()
  for (let i=2;i<process.argv.length;i+=2) { const key=process.argv[i]!, value=process.argv[i+1]; if (!['--core','--community','--out'].includes(key)||!value||args.has(key)) throw Error('Use --core FILE [--community FILE] --out DIRECTORY'); args.set(key,value) }
  if (!args.has('--core')||!args.has('--out')) throw Error('Use --core FILE [--community FILE] --out DIRECTORY')
  const result=writeFidelityComparison({core:resolve(args.get('--core')!),community:args.has('--community')?resolve(args.get('--community')!):undefined,out:resolve(args.get('--out')!)})
  console.log(JSON.stringify({cases:result.declaredCaseCount,projects:result.rows.length,referenceReview:result.comparison.reviewRequired.length}))
}
