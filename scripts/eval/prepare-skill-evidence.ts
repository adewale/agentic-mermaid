import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

interface PreparedTask {
  case_id: string
  variant: string
  run_number: number
  repo_root: string
  skill_paths: string[]
  input_files: string[]
  run_dir: string
  instruction: string
  prompt: string
  [key: string]: unknown
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function rehome(value: string, sourceRepo: string, checkout: string): string {
  if (!isAbsolute(value)) return value
  if (value === sourceRepo) return checkout
  if (!value.startsWith(`${sourceRepo}/`)) throw new Error(`cannot rehome path outside source repository: ${value}`)
  return join(checkout, value.slice(sourceRepo.length + 1))
}

export function prepareSkillEvidence(tasks: PreparedTask[], checkout: string, runsRoot: string, selectedCases: Set<string>): PreparedTask[] {
  return tasks.filter(task => selectedCases.size === 0 || selectedCases.has(task.case_id)).map(task => {
    // skill-benchmark intentionally roots prepared tasks at the manifest
    // directory. For repository-grounded work, move the agent to the target
    // checkout while retaining exact fixtures and skill paths from that SHA.
    const sourceRepo = dirname(task.repo_root)
    const runBase = join(runsRoot, task.run_dir)
    const outputPrefix = `${runBase}/outputs/`
    return {
      ...task,
      repo_root: checkout,
      skill_paths: task.skill_paths.map(value => rehome(value, sourceRepo, checkout)),
      input_files: task.input_files.map(value => rehome(value, sourceRepo, checkout)),
      instruction: `${task.instruction.split(sourceRepo).join(checkout)} Work only in the target checkout. When the task requests outputs/, write them under the absolute run-artifact directory named in the prompt.`,
      prompt: task.prompt.split('outputs/').join(outputPrefix),
    }
  })
}

if (import.meta.main) {
  const tasksPath = resolve(option('--tasks') ?? '')
  const checkout = resolve(option('--checkout') ?? '')
  const runsRoot = resolve(option('--runs-root') ?? '')
  const outPath = resolve(option('--out') ?? '')
  if (!option('--tasks') || !option('--checkout') || !option('--runs-root') || !option('--out')) {
    throw new Error('usage: bun run scripts/eval/prepare-skill-evidence.ts --tasks tasks.jsonl --checkout PATH --runs-root PATH --out tasks.jsonl [--cases id,id]')
  }
  const selectedCases = new Set((option('--cases') ?? '').split(',').filter(Boolean))
  const tasks = readFileSync(tasksPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as PreparedTask)
  const prepared = prepareSkillEvidence(tasks, checkout, runsRoot, selectedCases)
  if (!prepared.length) throw new Error('case filter selected no tasks')
  writeFileSync(outPath, `${prepared.map(task => JSON.stringify(task)).join('\n')}\n`)
  console.log(`Prepared ${prepared.length} tasks for ${checkout} (${new Set(prepared.map(task => task.case_id)).size} cases)`)
}
