import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSectionBCapabilityReport, sectionBCapabilityReportMarkdown } from '../src/section-b-capability-report.ts'

const root = join(import.meta.dir, '..')
const jsonPath = join(root, 'docs', 'project', 'section-b-capability-report.json')
const markdownPath = join(root, 'docs', 'project', 'section-b-capability-report.md')
const report = createSectionBCapabilityReport()
const outputs = [
  [jsonPath, `${JSON.stringify(report, null, 2)}\n`],
  [markdownPath, sectionBCapabilityReportMarkdown(report)],
] as const

if (process.argv.includes('--check')) {
  const stale = outputs.filter(([path, expected]) => !existsSync(path) || readFileSync(path, 'utf8') !== expected)
  if (stale.length) {
    process.stderr.write(`Section B capability report is stale: ${stale.map(([path]) => path).join(', ')}; run bun run section-b-report.\n`)
    process.exitCode = 1
  } else {
    process.stdout.write('Section B capability report is current.\n')
  }
} else {
  for (const [path, content] of outputs) writeFileSync(path, content)
  process.stdout.write(`Wrote ${outputs.map(([path]) => path).join(' and ')}\n`)
}
