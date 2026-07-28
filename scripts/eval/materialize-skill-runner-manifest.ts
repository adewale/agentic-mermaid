import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function underRoot(root: string, path: string): string {
  const child = relative(root, path)
  if (child === '..' || child.startsWith('../') || isAbsolute(child)) throw new Error(`manifest path escapes repository root: ${path}`)
  return child || '.'
}

export function materializeRunnerManifest(manifest: Record<string, unknown>, manifestPath: string, repoRoot: string): Record<string, unknown> {
  const manifestDir = dirname(resolve(manifestPath))
  const root = resolve(repoRoot)
  const rooted = (value: string): string => underRoot(root, isAbsolute(value) ? resolve(value) : resolve(manifestDir, value))
  const skillPathMap = new Map(Array.isArray(manifest.skill_paths) ? manifest.skill_paths.map(value => [String(value), rooted(String(value))] as const) : [])
  const rehomeAblationComponent = (component: unknown): unknown => {
    if (!component || typeof component !== 'object' || Array.isArray(component)) return component
    const record = component as Record<string, unknown>
    const target = record.target
    if (!target || typeof target !== 'object' || Array.isArray(target)) return component
    const targetRecord = target as Record<string, unknown>
    return {
      ...record,
      target: {
        ...targetRecord,
        ...(typeof targetRecord.skill_root === 'string' ? { skill_root: skillPathMap.get(targetRecord.skill_root) ?? rooted(targetRecord.skill_root) } : {}),
        ...(record.mechanism === 'patch' && typeof targetRecord.patch === 'string' ? { patch: rooted(targetRecord.patch) } : {}),
      },
    }
  }
  const rehomeAssertions = (assertions: unknown): unknown => {
    if (!Array.isArray(assertions)) return assertions
    return assertions.map(assertion => {
      if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) return assertion
      const record = assertion as Record<string, unknown>
      if (record.type !== 'script' || !Array.isArray(record.command)) return assertion
      const command = [...record.command]
      if (typeof command[1] === 'string') command[1] = rooted(command[1])
      for (let index = 0; index < command.length - 1; index++) {
        if (command[index] === '--source-file' && typeof command[index + 1] === 'string') {
          const value = command[index + 1] as string
          command[index + 1] = isAbsolute(value) ? resolve(value) : resolve(manifestDir, value)
        }
      }
      return { ...record, command }
    })
  }
  return {
    ...manifest,
    skill_paths: Array.isArray(manifest.skill_paths) ? manifest.skill_paths.map(value => skillPathMap.get(String(value))) : manifest.skill_paths,
    ablations: Array.isArray(manifest.ablations)
      ? manifest.ablations.map(value => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return value
          const entry = value as Record<string, unknown>
          return {
            ...(rehomeAblationComponent(entry) as Record<string, unknown>),
            ...(Array.isArray(entry.components) ? { components: entry.components.map(rehomeAblationComponent) } : {}),
          }
        })
      : manifest.ablations,
    cases: Array.isArray(manifest.cases)
      ? manifest.cases.map(value => {
          const entry = value as Record<string, unknown>
          return {
            ...entry,
            ...(typeof entry.prompt_ref === 'string' ? { prompt_ref: rooted(entry.prompt_ref) } : {}),
            ...(Array.isArray(entry.files) ? { files: entry.files.map(file => rooted(String(file))) } : {}),
            ...(entry.assertions ? { assertions: rehomeAssertions(entry.assertions) } : {}),
          }
        })
      : manifest.cases,
  }
}

if (import.meta.main) {
  const manifestOption = option('--manifest')
  const repoRootOption = option('--repo-root')
  const outOption = option('--out')
  if (!manifestOption || !repoRootOption || !outOption) {
    throw new Error('usage: materialize-skill-runner-manifest.ts --manifest manifest.json --repo-root PATH --out PATH')
  }
  const manifestPath = resolve(manifestOption)
  const output = materializeRunnerManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), manifestPath, resolve(repoRootOption))
  writeFileSync(resolve(outOption), `${JSON.stringify(output, null, 2)}\n`)
  console.log(`Wrote runner manifest ${resolve(outOption)}`)
}
