import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sectionACapabilityReportMarkdown } from '../src/section-a-capability-report.ts'

const output = join(import.meta.dir, '..', 'docs', 'project', 'section-a-capability-report.md')
const generated = sectionACapabilityReportMarkdown()

if (process.argv.includes('--check')) {
  const current = readFileSync(output, 'utf8')
  if (current !== generated) {
    process.stderr.write('Section A capability report is stale; run `bun run section-a-report`.\n')
    process.exitCode = 1
  }
} else {
  writeFileSync(output, generated)
  process.stdout.write(`Wrote ${output}\n`)
}
