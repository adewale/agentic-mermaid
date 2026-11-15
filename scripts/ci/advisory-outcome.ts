// Report an advisory job's step outcomes without failing it. Advisory steps
// run with continue-on-error, so a failure surfaces here as a warning
// annotation and a job-summary line, and the check stays green: a red check
// on a pull request then always means a gating lane failed.
import { appendFileSync } from 'node:fs'

type Steps = Record<string, { outcome?: string; conclusion?: string }>
const steps = JSON.parse(process.env.OUTCOMES ?? '{}') as Steps
const failed = Object.entries(steps).filter(([, step]) => step.outcome === 'failure').map(([id]) => id)
const lines = failed.length === 0
  ? ['All advisory steps passed.']
  : ['### Advisory findings (non-gating)', '', ...failed.map(id => `- Step \`${id}\` failed. Its log and the uploaded artifact hold the evidence.`)]
for (const id of failed) console.log(`::warning title=Advisory step failed::Step ${id} failed. This job does not gate the pull request; see its log and artifact.`)
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
