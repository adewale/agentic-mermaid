import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { stableDigest } from './prepare-skill-evidence.ts'

export interface TaskResultValidation {
  expectedCount: number
  completeCount: number
  failures: Array<{ runDir: string; problems: string[] }>
}

export interface ExecutionReceipt {
  schemaVersion: 1 | 2
  runner: string
  runnerVersion: string
  runnerBinary: string
  runnerBinaryDigest: string
  model: string
  reasoningEffort: string
  codexCommand: string
  command: string[]
  runnerCommands: string[][]
  concurrency: number
  tasksPath: string
  tasksDigest: string
  runsRoot: string
  startedAt: string
  completedAt: string
  exitCode: number
  runnerExitCode?: number
  taskResults?: TaskResultValidation
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function fileDigest(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
}

export function preparedTaskFileDigest(path: string): string {
  const tasks = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
  return stableDigest(tasks)
}

export function assertExplicitCodexConfig(codexCommand: string, model: string, reasoningEffort: string): void {
  if (!codexCommand.includes(model)) throw new Error('--codex-cmd must explicitly select the declared --model')
  if (!codexCommand.includes(reasoningEffort)) throw new Error('--codex-cmd must explicitly select the declared --reasoning-effort')
}

export function assertDeclaredRunnerVersion(declaredVersion: string, actualVersion: string): void {
  if (actualVersion !== declaredVersion) {
    throw new Error(`declared skill-benchmark version ${declaredVersion} does not match runner package ${actualVersion}`)
  }
}

export function assertRunnerVersion(runnerBinary: string, declaredVersion: string): void {
  const firstLine = readFileSync(runnerBinary, 'utf8').split('\n', 1)[0]?.trim() ?? ''
  if (!firstLine.startsWith('#!')) throw new Error(`cannot verify the skill-benchmark package version from ${runnerBinary}`)
  const interpreter = firstLine.slice(2).trim()
  if (!isAbsolute(interpreter) || /\s/.test(interpreter)) {
    throw new Error(`skill-benchmark runner has an unsupported interpreter command: ${interpreter}`)
  }
  const probe = Bun.spawnSync([
    interpreter,
    '-c',
    'import importlib.metadata as metadata; print(metadata.version("skill-eval-harness"))',
  ])
  const actualVersion = probe.stdout.toString().trim()
  if (probe.exitCode !== 0 || !actualVersion) {
    const detail = probe.stderr.toString().trim()
    throw new Error(`cannot verify the skill-benchmark package version${detail ? `: ${detail}` : ''}`)
  }
  assertDeclaredRunnerVersion(declaredVersion, actualVersion)
}

function hasCompletedAgentMessage(trace: string): boolean {
  for (const line of trace.split('\n')) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      return false
    }
    if (!value || typeof value !== 'object') continue
    const event = value as { type?: unknown; item?: unknown }
    if (event.type !== 'item.completed' || !event.item || typeof event.item !== 'object') continue
    const item = event.item as { type?: unknown; text?: unknown }
    if (item.type === 'agent_message' && typeof item.text === 'string' && item.text.trim()) return true
  }
  return false
}

/** Fail closed when a runner exits zero but one or more provider runs failed. */
export function validateCodexRunResults(tasks: unknown[], runsRoot: string): TaskResultValidation {
  const root = resolve(runsRoot)
  const failures: TaskResultValidation['failures'] = []
  const seen = new Set<string>()
  let completeCount = 0
  for (const [index, task] of tasks.entries()) {
    const rawRunDir = task && typeof task === 'object' ? (task as { run_dir?: unknown }).run_dir : undefined
    const runDir = typeof rawRunDir === 'string' ? rawRunDir : `<task-${index + 1}>`
    const problems: string[] = []
    if (typeof rawRunDir !== 'string' || !rawRunDir || isAbsolute(rawRunDir)) {
      problems.push('task has no valid relative run_dir')
    } else if (seen.has(rawRunDir)) {
      problems.push('duplicate run_dir')
    }
    seen.add(runDir)
    const absoluteRunDir = resolve(root, typeof rawRunDir === 'string' ? rawRunDir : runDir)
    const child = relative(root, absoluteRunDir)
    if (!child || child === '..' || child.startsWith('../') || isAbsolute(child)) {
      problems.push('run_dir escapes or aliases the runs root')
    }
    if (problems.length === 0) {
      const metricsPath = join(absoluteRunDir, 'metrics.json')
      const tracePath = join(absoluteRunDir, 'trace.jsonl')
      const outputPath = join(absoluteRunDir, 'output.md')
      let metrics: Record<string, unknown> | undefined
      if (!existsSync(metricsPath)) {
        problems.push('missing metrics.json')
      } else {
        try {
          const parsed = JSON.parse(readFileSync(metricsPath, 'utf8')) as unknown
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) problems.push('metrics.json is not an object')
          else metrics = parsed as Record<string, unknown>
        } catch {
          problems.push('metrics.json is invalid JSON')
        }
      }
      if (metrics) {
        if (metrics.returncode !== 0) problems.push(`provider returncode is ${String(metrics.returncode)}`)
        for (const field of ['observation_complete', 'process_observation_complete', 'trace_observation_complete', 'provider_response_complete', 'operation_observation_complete']) {
          if (metrics[field] !== true) problems.push(`${field} is not true`)
        }
      }
      if (!existsSync(tracePath)) problems.push('missing trace.jsonl')
      else if (!hasCompletedAgentMessage(readFileSync(tracePath, 'utf8'))) problems.push('trace has no completed agent_message')
      if (!existsSync(outputPath) || !readFileSync(outputPath, 'utf8').trim()) problems.push('missing or empty output.md')
    }
    if (problems.length > 0) failures.push({ runDir, problems })
    else completeCount++
  }
  return { expectedCount: tasks.length, completeCount, failures }
}

if (import.meta.main) {
  const runnerOption = option('--runner')
  const runnerVersion = option('--runner-version')
  const tasksOption = option('--tasks')
  const runsOption = option('--runs')
  const model = option('--model')
  const reasoningEffort = option('--reasoning-effort')
  const codexCommand = option('--codex-cmd')
  const receiptOption = option('--receipt')
  const timeout = option('--timeout')
  const concurrency = Number(option('--concurrency') ?? '1')
  if (!runnerOption || !runnerVersion || !tasksOption || !runsOption || !model || !reasoningEffort || !codexCommand || !receiptOption) {
    throw new Error('usage: run-codex-evidence.ts --runner PATH --runner-version VERSION --tasks tasks.jsonl --runs PATH --model MODEL --reasoning-effort LEVEL --codex-cmd COMMAND --receipt receipt.json [--timeout SECONDS] [--concurrency 1-16]')
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('--concurrency must be an integer from 1 to 16')
  assertExplicitCodexConfig(codexCommand, model, reasoningEffort)
  const runnerBinary = resolve(runnerOption)
  const tasksPath = resolve(tasksOption)
  const runsRoot = resolve(runsOption)
  const receiptPath = resolve(receiptOption)
  assertRunnerVersion(runnerBinary, runnerVersion)
  const taskLines = readFileSync(tasksPath, 'utf8').trim().split('\n').filter(Boolean)
  const tasks = taskLines.map(line => JSON.parse(line) as unknown)
  const shardCount = Math.min(concurrency, taskLines.length)
  const shardRoot = mkdtempSync(join(dirname(receiptPath), '.runner-shards-'))
  const shardPaths = Array.from({ length: shardCount }, (_, index) => join(shardRoot, `tasks-${index + 1}.jsonl`))
  for (let index = 0; index < shardCount; index++) {
    const lines = taskLines.filter((_, taskIndex) => taskIndex % shardCount === index)
    writeFileSync(shardPaths[index]!, `${lines.join('\n')}\n`)
  }
  const runnerCommands = shardPaths.map(path => {
    const command = [runnerBinary, 'run-codex', '--tasks', path, '--runs', runsRoot, '--codex-cmd', codexCommand]
    if (timeout) command.push('--timeout', timeout)
    return command
  })
  const startedAt = new Date().toISOString()
  let runnerExitCode = 1
  try {
    const processes = runnerCommands.map(command => Bun.spawn(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }))
    const exitCodes = await Promise.all(processes.map(process => process.exited))
    runnerExitCode = exitCodes.find(code => code !== 0) ?? 0
  } finally {
    rmSync(shardRoot, { recursive: true, force: true })
  }
  const taskResults = validateCodexRunResults(tasks, runsRoot)
  const exitCode = runnerExitCode !== 0 ? runnerExitCode : taskResults.failures.length > 0 ? 1 : 0
  const receipt: ExecutionReceipt = {
    schemaVersion: 2,
    runner: 'skill-eval-harness',
    runnerVersion,
    runnerBinary,
    runnerBinaryDigest: fileDigest(runnerBinary),
    model,
    reasoningEffort,
    codexCommand,
    command: process.argv,
    runnerCommands,
    concurrency: shardCount,
    tasksPath,
    tasksDigest: preparedTaskFileDigest(tasksPath),
    runsRoot,
    startedAt,
    completedAt: new Date().toISOString(),
    exitCode,
    runnerExitCode,
    taskResults,
  }
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)
  if (exitCode !== 0) {
    throw new Error(`skill-benchmark evidence run failed: runner exit ${runnerExitCode}, ${taskResults.failures.length}/${taskResults.expectedCount} incomplete task results; receipt written to ${receiptPath}`)
  }
}
