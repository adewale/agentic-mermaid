import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

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

export interface PreparationOptions {
  skillCheckout?: string
  fixtureCheckout?: string
  skillNames?: Set<string>
  seed?: string
}

export interface PreparationReceipt {
  schemaVersion: 2
  workspaceRoot: string
  workspaceDigest: string
  fixtureRoot: string
  fixtureDigest: string
  treatmentRoot: string
  treatmentPaths: string[]
  treatmentDigest: string
  stimulusDigest: string
  scheduleDigest: string
  preparedTasksDigest: string
  seed: string | null
  taskCount: number
  cases: string[]
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

function containsPath(root: string, path: string): boolean {
  const child = relative(root, path)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

export function sourceRepository(task: PreparedTask): string {
  const paths = [task.repo_root, ...task.skill_paths, ...task.input_files].filter(isAbsolute).map(value => resolve(value))
  let root = resolve(task.repo_root)
  while (!paths.every(path => containsPath(root, path))) {
    const parent = dirname(root)
    if (parent === root) throw new Error(`cannot determine source repository for ${task.case_id}`)
    root = parent
  }
  return root
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function stableDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

function compareCodePointStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1
}

function filesUnder(path: string, ignoredDirectoryNames: Set<string>): string[] {
  const info = lstatSync(path)
  if (info.isSymbolicLink()) throw new Error(`cannot hash symbolic link in evidence input: ${path}`)
  if (info.isFile()) return [path]
  if (!info.isDirectory()) throw new Error(`cannot hash non-file evidence input: ${path}`)
  return readdirSync(path, { withFileTypes: true })
    .flatMap(entry => {
      if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) return []
      const child = join(path, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`cannot hash symbolic link in evidence input: ${child}`)
      if (!entry.isDirectory() && !entry.isFile()) throw new Error(`cannot hash non-file evidence input: ${child}`)
      return entry.isDirectory() ? filesUnder(child, ignoredDirectoryNames) : [child]
    })
    .sort()
}

export function contentTreeDigest(paths: string[], root: string, ignoredDirectoryNames = new Set<string>()): string {
  const hash = createHash('sha256')
  const seen = new Set<string>()
  for (const path of [...paths].sort()) {
    for (const file of filesUnder(path, ignoredDirectoryNames)) {
      const name = relative(root, file)
      if (!name || name === '..' || name.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(name)) {
        throw new Error(`evidence input escapes digest root ${root}: ${file}`)
      }
      if (seen.has(name)) continue
      seen.add(name)
      hash.update(name).update('\0').update(readFileSync(file)).update('\0')
    }
  }
  return `sha256:${hash.digest('hex')}`
}

function selectedSourceSkills(task: PreparedTask, names: Set<string>): string[] {
  return names.size === 0 ? task.skill_paths : task.skill_paths.filter(path => names.has(basename(path)))
}

export function prepareSkillEvidence(tasks: PreparedTask[], workspace: string, runsRoot: string, selectedCases: Set<string>, options: PreparationOptions = {}): PreparedTask[] {
  const skillCheckout = options.skillCheckout ?? workspace
  const fixtureCheckout = options.fixtureCheckout ?? workspace
  const skillNames = options.skillNames ?? new Set<string>()
  const prepared = tasks
    .filter(task => selectedCases.size === 0 || selectedCases.has(task.case_id))
    .map(task => {
      // skill-benchmark roots prepared tasks at the manifest directory. Keep the
      // model workspace, treatment skill tree, and fixture tree independently
      // selectable so a before/after run can change only the treatment.
      const sourceRepo = sourceRepository(task)
      const sourceSkills = selectedSourceSkills(task, skillNames)
      if (task.variant !== 'without_skill' && sourceSkills.length === 0) {
        throw new Error(`skill filter selected no treatment path for ${task.case_id}/${task.variant}`)
      }
      const treatmentSkills = sourceSkills.map(value => rehome(value, sourceRepo, skillCheckout))
      const activeSkills = task.variant === 'without_skill' ? [] : treatmentSkills
      const runBase = join(runsRoot, task.run_dir)
      const outputPrefix = `${runBase}/outputs/`
      // Move ordinary repository references into the neutral workspace first,
      // then replace the resulting workspace skill paths with the treatment
      // paths. Reversing that order rewrites a candidate skillCheckout that is
      // also the source repository back into the neutral workspace.
      const workspaceSkills = task.skill_paths.map(value => rehome(value, sourceRepo, workspace))
      const treatmentByWorkspaceSkill = new Map(
        task.skill_paths.map(sourcePath => {
          const workspacePath = rehome(sourcePath, sourceRepo, workspace)
          const selected = sourceSkills.includes(sourcePath)
          return [workspacePath, selected ? rehome(sourcePath, sourceRepo, skillCheckout) : ''] as const
        }),
      )
      let instruction = task.instruction.split(sourceRepo).join(workspace)
      instruction = instruction.split(workspaceSkills.join(', ')).join(activeSkills.join(', '))
      for (const [workspaceSkill, treatmentSkill] of treatmentByWorkspaceSkill) {
        instruction = instruction.split(workspaceSkill).join(treatmentSkill)
      }
      return {
        ...task,
        skill_tree_hash: activeSkills.length > 0 ? contentTreeDigest(activeSkills, skillCheckout).slice('sha256:'.length) : undefined,
        repo_root: workspace,
        skill_paths: activeSkills,
        input_files: task.input_files.map(value => rehome(value, sourceRepo, fixtureCheckout)),
        instruction: `${instruction} Work only in the target workspace. When the task requests outputs/, write them under the absolute run-artifact directory named in the prompt.`,
        prompt: task.prompt.split('outputs/').join(outputPrefix),
      }
    })
  if (!options.seed) return prepared
  return prepared.sort((left, right) => {
    const rank = (task: PreparedTask) => createHash('sha256').update(`${options.seed}\0${task.case_id}\0${task.variant}\0${task.run_number}`).digest('hex')
    return compareCodePointStrings(rank(left), rank(right))
  })
}

export function preparationReceipt(tasks: PreparedTask[], workspace: string, fixtureRoot: string, treatmentRoot: string, treatmentPaths: string[], runsRoot: string, seed?: string): PreparationReceipt {
  const fixturePaths = [...new Set(tasks.flatMap(task => task.input_files))].sort()
  const roots = [
    [treatmentRoot, '<TREATMENT_ROOT>'],
    [fixtureRoot, '<FIXTURE_ROOT>'],
    [workspace, '<WORKSPACE_ROOT>'],
    [runsRoot, '<RUNS_ROOT>'],
  ] as const
  const orderedRoots = [...roots].sort((left, right) => right[0].length - left[0].length)
  const canonicalize = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return orderedRoots.reduce((text, [root, token]) => text.split(root).join(token), value)
    }
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, canonicalize(child)]))
    }
    return value
  }
  const stimulus = tasks
    .map(task => {
      const canonical = canonicalize(task) as Record<string, unknown>
      if (typeof canonical.skill_tree_hash === 'string') canonical.skill_tree_hash = '<TREATMENT_DIGEST>'
      canonical.input_files = task.input_files.map(path => ({
        path: canonicalize(path),
        digest: contentTreeDigest([path], fixtureRoot),
      }))
      return canonical
    })
    .sort((left, right) => compareCodePointStrings(
      `${left.case_id}/${left.variant}/${left.run_number}`,
      `${right.case_id}/${right.variant}/${right.run_number}`,
    ))
  return {
    schemaVersion: 2,
    workspaceRoot: workspace,
    workspaceDigest: contentTreeDigest([workspace], workspace, new Set(['.git'])),
    fixtureRoot,
    fixtureDigest: contentTreeDigest(fixturePaths, fixtureRoot),
    treatmentRoot,
    treatmentPaths: treatmentPaths.map(path => relative(treatmentRoot, path)).sort(),
    treatmentDigest: contentTreeDigest(treatmentPaths, treatmentRoot),
    stimulusDigest: stableDigest(stimulus),
    scheduleDigest: stableDigest(tasks.map(task => `${task.case_id}/${task.variant}/${task.run_number}`)),
    preparedTasksDigest: stableDigest(JSON.parse(JSON.stringify(tasks))),
    seed: seed ?? null,
    taskCount: tasks.length,
    cases: [...new Set(tasks.map(task => task.case_id))].sort(),
  }
}

if (import.meta.main) {
  const tasksOption = option('--tasks')
  const workspaceOption = option('--workspace') ?? option('--checkout')
  const runsRootOption = option('--runs-root')
  const outOption = option('--out')
  if (!tasksOption || !workspaceOption || !runsRootOption || !outOption) {
    throw new Error('usage: bun run scripts/eval/prepare-skill-evidence.ts --tasks tasks.jsonl --workspace PATH --runs-root PATH --out tasks.jsonl [--skill-checkout PATH] [--fixture-checkout PATH] [--skills name,name] [--cases id,id] [--seed value] [--receipt receipt.json]')
  }
  const tasksPath = resolve(tasksOption)
  const workspace = resolve(workspaceOption)
  const skillCheckout = resolve(option('--skill-checkout') ?? workspace)
  const fixtureCheckout = resolve(option('--fixture-checkout') ?? workspace)
  const runsRoot = resolve(runsRootOption)
  const outPath = resolve(outOption)
  const selectedCases = new Set((option('--cases') ?? '').split(',').filter(Boolean))
  const skillNames = new Set((option('--skills') ?? '').split(',').filter(Boolean))
  const tasks = readFileSync(tasksPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as PreparedTask)
  const prepared = prepareSkillEvidence(tasks, workspace, runsRoot, selectedCases, { skillCheckout, fixtureCheckout, skillNames, seed: option('--seed') })
  if (!prepared.length) throw new Error('case filter selected no tasks')
  writeFileSync(outPath, `${prepared.map(task => JSON.stringify(task)).join('\n')}\n`)
  const receiptPath = option('--receipt')
  if (receiptPath) {
    const treatmentPaths = [...new Set(tasks.filter(task => task.variant !== 'without_skill' && (selectedCases.size === 0 || selectedCases.has(task.case_id))).flatMap(task => selectedSourceSkills(task, skillNames).map(path => rehome(path, sourceRepository(task), skillCheckout))))].sort()
    if (!treatmentPaths.length) throw new Error('cannot build treatment receipt without a treatment task')
    writeFileSync(resolve(receiptPath), `${JSON.stringify(preparationReceipt(prepared, workspace, fixtureCheckout, skillCheckout, treatmentPaths, runsRoot, option('--seed')), null, 2)}\n`)
  }
  console.log(`Prepared ${prepared.length} tasks in ${workspace} with treatment ${skillCheckout} (${new Set(prepared.map(task => task.case_id)).size} cases)`)
}
