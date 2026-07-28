import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

interface PrivateCase {
  id: string
  expected_behavior: string[]
  assertions: unknown[]
  review_rubric?: string[]
}

interface EvalCase {
  id: string
  split: string
  prompt?: string
  prompt_ref?: string
  files?: string[]
  expected_behavior?: string[]
  assertions?: unknown[]
  review_rubric?: string[]
  [key: string]: unknown
}

interface Manifest {
  skill_paths: string[]
  cases: EvalCase[]
  [key: string]: unknown
}

function absoluteFrom(base: string, value: string): string {
  return isAbsolute(value) ? value : resolve(base, value)
}

function resolveScriptAssertions(assertions: unknown[], manifestDir: string): unknown[] {
  return assertions.map(assertion => {
    if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) return assertion
    const record = assertion as Record<string, unknown>
    if (record.type !== 'script' || !Array.isArray(record.command)) return assertion
    const command = [...record.command]
    if (typeof command[1] === 'string') command[1] = absoluteFrom(manifestDir, command[1])
    for (let index = 0; index < command.length - 1; index++) {
      if (command[index] === '--source-file' && typeof command[index + 1] === 'string') {
        command[index + 1] = absoluteFrom(manifestDir, command[index + 1] as string)
      }
    }
    return { ...record, command }
  })
}

function resolveAblationComponent(component: unknown, manifestDir: string): unknown {
  if (!component || typeof component !== 'object' || Array.isArray(component)) return component
  const record = component as Record<string, unknown>
  const target = record.target
  if (!target || typeof target !== 'object' || Array.isArray(target)) return component
  const targetRecord = target as Record<string, unknown>
  return {
    ...record,
    target: {
      ...targetRecord,
      ...(typeof targetRecord.skill_root === 'string' ? { skill_root: absoluteFrom(manifestDir, targetRecord.skill_root) } : {}),
      ...(record.mechanism === 'patch' && typeof targetRecord.patch === 'string' ? { patch: absoluteFrom(manifestDir, targetRecord.patch) } : {}),
    },
  }
}

export function hydratePrivateManifest(publicPath: string, privateBundlePath: string): Manifest {
  const publicManifest = JSON.parse(readFileSync(publicPath, 'utf8')) as Manifest
  const privateBundle = JSON.parse(readFileSync(privateBundlePath, 'utf8')) as { version: number; cases: PrivateCase[] }
  if (privateBundle.version !== 1 || !Array.isArray(privateBundle.cases)) throw new Error('private bundle must use version 1 and contain cases[]')

  const manifestDir = dirname(publicPath)
  const hidden = publicManifest.cases.filter(entry => entry.split === 'holdout' || entry.split === 'holdback')
  const privateById = new Map(privateBundle.cases.map(entry => [entry.id, entry]))
  if (privateById.size !== privateBundle.cases.length) throw new Error('private bundle contains duplicate case IDs')

  for (const entry of hidden) {
    for (const key of ['prompt', 'expected_behavior', 'assertions', 'review_rubric'] as const) {
      if (key in entry) throw new Error(`public hidden case ${entry.id} leaks ${key}`)
    }
    if (!entry.prompt_ref) throw new Error(`public hidden case ${entry.id} has no prompt_ref`)
    if (!existsSync(absoluteFrom(manifestDir, entry.prompt_ref))) throw new Error(`private prompt is missing for ${entry.id}: ${entry.prompt_ref}`)
    if (!privateById.has(entry.id)) throw new Error(`private answer key is missing for ${entry.id}`)
  }

  const hiddenIds = new Set(hidden.map(entry => entry.id))
  for (const id of privateById.keys()) if (!hiddenIds.has(id)) throw new Error(`private answer key has no public stub: ${id}`)

  return {
    ...publicManifest,
    skill_paths: publicManifest.skill_paths.map(value => absoluteFrom(manifestDir, value)),
    ...(Array.isArray(publicManifest.ablations)
      ? {
          ablations: publicManifest.ablations.map(value => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return value
            const entry = value as Record<string, unknown>
            return {
              ...(resolveAblationComponent(entry, manifestDir) as Record<string, unknown>),
              ...(Array.isArray(entry.components)
                ? { components: entry.components.map(component => resolveAblationComponent(component, manifestDir)) }
                : {}),
            }
          }),
        }
      : {}),
    cases: publicManifest.cases.map(entry => {
      const answer = privateById.get(entry.id)
      const assertions = answer?.assertions ?? entry.assertions
      return {
        ...entry,
        ...(entry.prompt_ref ? { prompt_ref: absoluteFrom(manifestDir, entry.prompt_ref) } : {}),
        ...(entry.files ? { files: entry.files.map(value => absoluteFrom(manifestDir, value)) } : {}),
        ...(answer
          ? {
              expected_behavior: answer.expected_behavior,
              assertions: resolveScriptAssertions(answer.assertions, manifestDir),
              ...(answer.review_rubric ? { review_rubric: answer.review_rubric } : {}),
            }
          : {}),
        ...(!answer && assertions ? { assertions: resolveScriptAssertions(assertions, manifestDir) } : {}),
      }
    }),
  }
}

if (import.meta.main) {
  const publicPath = resolve(process.argv[2] ?? join(import.meta.dir, '../../skill-evals/shared-benchmark.json'))
  const privateBundlePath = resolve(process.argv[3] ?? join(import.meta.dir, '../../skill-evals/private/cases.json'))
  const outPath = resolve(process.argv[4] ?? join(import.meta.dir, '../../skill-evals/private/hydrated-benchmark.json'))
  const hydrated = hydratePrivateManifest(publicPath, privateBundlePath)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(hydrated, null, 2)}\n`)
  console.log(`Hydrated ${hydrated.cases.filter(entry => entry.split === 'holdout' || entry.split === 'holdback').length} private cases into ${outPath}`)
}
