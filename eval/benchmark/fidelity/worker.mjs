import { readFileSync, writeFileSync } from 'node:fs'
import { assertBenchmarkExecutionAllowed } from '../ci-policy.ts'
import { runFidelityCampaign } from './run.ts'
assertBenchmarkExecutionAllowed()
const job = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const result = await runFidelityCampaign(job.options)
writeFileSync(job.output, JSON.stringify({ invocationId: job.invocationId, result }) + '\n')
process.exitCode = result.status === 'failed' ? 1 : 0
