/** Aggregate decisions, never timings, from independently calibrated runners. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { aggregateSemanticPerformance, type SemanticPerformanceShard, type PerformanceReport } from './performance-gates.ts'


function statusFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? statusFiles(path) : entry.name === 'qualification-status.json' ? [path] : []
  })
}

/** Keep the original artifacts intact. Decisions use the retained individual
 * clock values, not the much larger duplicate per-call receipt inventories. */
export function readPerformanceReport(file: string): PerformanceReport | undefined {
  if (!existsSync(file)) return undefined
  const report = JSON.parse(readFileSync(file, 'utf8')) as PerformanceReport
  if (Array.isArray(report.tracks?.observations)) for (const observation of report.tracks.observations) delete (observation as { calls?: unknown }).calls
  return report
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: aggregate-semantic-performance.ts <downloaded-artifacts> <output-directory>')
  const shards = statusFiles(resolve(input)).map(path => {
    const receipt = JSON.parse(readFileSync(path, 'utf8')) as SemanticPerformanceShard
    const report = (name: string) => {
      const file = join(dirname(path), `${name}.json`)
      return readPerformanceReport(file)
    }
    return { ...receipt, evidence: path, candidate: report('candidate'), controls: [report('aa-1'), report('aa-2')].filter((r): r is PerformanceReport => r !== undefined) }
  })
  const score = aggregateSemanticPerformance(shards)
  mkdirSync(resolve(output), { recursive: true })
  writeFileSync(join(output, 'campaign.json'), `${JSON.stringify(score, null, 2)}\n`)
  const rows = score.shards.map(s => `|${s.cache}|${s.scope.phase}|${s.scope.consumer}|${s.environment.hostname}|${s.score.status}|${s.score.scopeQualified}|`)
  writeFileSync(join(output, 'campaign.md'), ['# Semantic performance campaign', '', `Complete: **${score.campaignComplete}**. Qualified: **${score.performanceQualified}**. Status: **${score.status}**.`, '',
    ...score.checks.filter(c => !c.ok).map(c => `- FAIL ${c.name}: ${c.detail ?? ''}`), '', '|Cache|Phase|Consumer|Runner|Status|Shard qualified|', '|---|---|---|---|---|---|', ...rows, '', score.limits, ''].join('\n'))
  console.log(`Semantic campaign: ${score.status}; complete=${score.campaignComplete}; qualified=${score.performanceQualified}`)
  if (!score.ok) process.exitCode = 1
}
