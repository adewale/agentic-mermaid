import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import ts from 'typescript'

export const repositoryPath = (root: string, absolute: string): string =>
  relative(root, absolute).replaceAll('\\', '/')

const compareCodePoints = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0

export function sortRepositoryPaths(root: string, paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => compareCodePoints(repositoryPath(root, a), repositoryPath(root, b)))
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function fileReceiptEntries(root: string, paths: readonly string[]): Array<{ path: string; sha256: string }> {
  return sortRepositoryPaths(root, paths).map(path => ({ path: repositoryPath(root, path), sha256: sha256File(path) }))
}

export function hashFileTree(root: string, paths: readonly string[]): string {
  const hash = createHash('sha256')
  for (const path of sortRepositoryPaths(root, paths)) {
    hash.update(repositoryPath(root, path)).update('\0').update(readFileSync(path)).update('\0')
  }
  return hash.digest('hex')
}

export interface RuntimeDependencyClosureEntry {
  key: string
  resolution: string
  integrity: string | null
  recordSha256: string
  dependencies: string[]
}

export interface RuntimeDependencyClosure {
  algorithm: 'bun-lock-transitive-v1'
  roots: string[]
  packages: RuntimeDependencyClosureEntry[]
  sha256: string
}

export interface RuntimeDependencySummary {
  algorithm: RuntimeDependencyClosure['algorithm']
  roots: string[]
  packageCount: number
  sha256: string
}

export function runtimeDependencySummary(closure: RuntimeDependencyClosure): RuntimeDependencySummary {
  return {
    algorithm: closure.algorithm,
    roots: closure.roots,
    packageCount: closure.packages.length,
    sha256: closure.sha256,
  }
}

export function hashArtifactInputs(
  root: string,
  paths: readonly string[],
  dependencyClosure: RuntimeDependencyClosure,
): string {
  const hash = createHash('sha256')
  for (const path of sortRepositoryPaths(root, paths)) {
    hash.update(repositoryPath(root, path)).update('\0').update(readFileSync(path)).update('\0')
  }
  hash.update('runtime-dependency-closure\0').update(dependencyClosure.sha256).update('\0')
  return hash.digest('hex')
}

export function filesUnder(directory: string, accept: (path: string) => boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesUnder(path, accept)
    return entry.isFile() && accept(path) ? [path] : []
  })
}

const TRAVERSABLE_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const packageNameFromSpecifier = (specifier: string): string | null => {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#')) return null
  if (isBuiltin(specifier) || specifier.includes(':')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? null
}

function resolveLocalImport(importer: string, specifier: string): string {
  const raw = resolve(dirname(importer), specifier)
  const candidates = [
    raw,
    `${raw}.ts`, `${raw}.tsx`, `${raw}.js`, `${raw}.jsx`, `${raw}.mjs`, `${raw}.cjs`, `${raw}.json`,
    join(raw, 'index.ts'), join(raw, 'index.tsx'), join(raw, 'index.js'), join(raw, 'index.mjs'),
  ]
  if (raw.endsWith('.js')) candidates.push(`${raw.slice(0, -3)}.ts`, `${raw.slice(0, -3)}.tsx`)
  if (raw.endsWith('.mjs')) candidates.push(`${raw.slice(0, -4)}.ts`)
  const resolved = candidates.find(path => existsSync(path) && statSync(path).isFile())
  if (!resolved) throw new Error(`Cannot resolve local artifact dependency ${JSON.stringify(specifier)} from ${importer}`)
  return normalize(resolved)
}

/**
 * Return the exact statically imported local build graph for generated evidence.
 * External package roots are retained separately for a narrowed lockfile
 * closure; relative imports fail closed when they cannot be resolved. Dynamic
 * resources that are not imports remain explicit caller inputs.
 */
export function sourceDependencyGraph(
  root: string,
  entrypoints: readonly string[],
): { localInputs: string[]; externalPackages: string[] } {
  const normalizedRoot = normalize(resolve(root))
  const pending = entrypoints.map(path => normalize(resolve(path)))
  const visited = new Set<string>()
  const externalPackages = new Set<string>()

  while (pending.length > 0) {
    const path = pending.pop()!
    if (visited.has(path)) continue
    const fromRoot = relative(normalizedRoot, path)
    if (!isAbsolute(path) || fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
      throw new Error(`Artifact dependency escapes repository root: ${path}`)
    }
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Artifact dependency is not a file: ${path}`)
    visited.add(path)
    if (!TRAVERSABLE_SOURCE_EXTENSIONS.has(extname(path))) continue

    const source = readFileSync(path, 'utf8')
    const imports = ts.preProcessFile(source, true, true).importedFiles.map(entry => entry.fileName)
    for (const specifier of imports) {
      if (specifier.startsWith('.')) pending.push(resolveLocalImport(path, specifier))
      else {
        const packageName = packageNameFromSpecifier(specifier)
        if (packageName) externalPackages.add(packageName)
      }
    }
  }

  return {
    localInputs: sortRepositoryPaths(root, [...visited]),
    externalPackages: [...externalPackages].sort(compareCodePoints),
  }
}

export function transitiveLocalInputs(root: string, entrypoints: readonly string[]): string[] {
  return sourceDependencyGraph(root, entrypoints).localInputs
}

type BunLockPackageMetadata = {
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}
type BunLockPackage = [string, string?, BunLockPackageMetadata?, string?]
type BunLock = {
  workspaces: Record<string, {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    optionalDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }>
  packages: Record<string, BunLockPackage>
}

function readBunLock(root: string): BunLock {
  const lockPath = join(root, 'bun.lock')
  const parsed = ts.parseConfigFileTextToJson(lockPath, readFileSync(lockPath, 'utf8'))
  if (parsed.error) {
    throw new Error(`Cannot parse bun.lock: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`)
  }
  const lock = parsed.config as Partial<BunLock>
  if (!lock.workspaces?.[''] || !lock.packages) throw new Error('bun.lock is missing its root workspace or package graph')
  return lock as BunLock
}

const resolutionIdentity = (resolution: string): { name: string; version: string } | null => {
  const separator = resolution.lastIndexOf('@')
  if (separator <= 0 || separator === resolution.length - 1) return null
  return { name: resolution.slice(0, separator), version: resolution.slice(separator + 1) }
}

const rangeMatches = (version: string, range: string): boolean => {
  const normalized = range.replace(/^workspace:/, '')
  if (normalized === '*' || normalized === 'latest') return true
  try {
    return Bun.semver.satisfies(version, normalized)
  } catch {
    return version === normalized
  }
}

function resolveLockKey(
  packages: BunLock['packages'],
  name: string,
  range: string,
  parentKey?: string,
): string | null {
  const matches = (key: string): boolean => {
    const identity = resolutionIdentity(packages[key]?.[0] ?? '')
    return identity?.name === name && rangeMatches(identity.version, range)
  }
  const preferred = [parentKey ? `${parentKey}/${name}` : '', name].filter(Boolean)
  for (const key of preferred) if (packages[key] && matches(key)) return key

  const suffix = `/${name}`
  const candidates = Object.keys(packages)
    .filter(key => key.endsWith(suffix) && matches(key))
    .sort(compareCodePoints)
  if (candidates.length <= 1) return candidates[0] ?? null
  throw new Error(`bun.lock resolves ${name}@${range} ambiguously from ${parentKey ?? 'the workspace'}: ${candidates.join(', ')}`)
}

const lockedRequirements = (
  metadata: BunLockPackageMetadata | undefined,
): Array<{ name: string; range: string; optional: boolean }> => {
  if (!metadata) return []
  const requirements = new Map<string, { range: string; optional: boolean }>()
  for (const [name, range] of Object.entries(metadata.dependencies ?? {})) {
    requirements.set(name, { range, optional: false })
  }
  for (const [name, range] of Object.entries(metadata.optionalDependencies ?? {})) {
    requirements.set(name, { range, optional: true })
  }
  for (const [name, range] of Object.entries(metadata.peerDependencies ?? {})) {
    requirements.set(name, { range, optional: metadata.peerDependenciesMeta?.[name]?.optional === true })
  }
  return [...requirements.entries()]
    .sort(([a], [b]) => compareCodePoints(a, b))
    .map(([name, requirement]) => ({ name, ...requirement }))
}

/**
 * Fingerprint only packages imported by the artifact's local source graph and
 * their locked runtime closure. Unrelated tooling (for example a formatter)
 * does not invalidate evidence, while any resolved dependency byte identity
 * or transitive edge still does.
 */
export function runtimeDependencyClosure(root: string, entrypoints: readonly string[]): RuntimeDependencyClosure {
  const roots = sourceDependencyGraph(root, entrypoints).externalPackages
  const lock = readBunLock(root)
  const workspace = lock.workspaces['']!
  const workspaceRequirements = {
    ...workspace.dependencies,
    ...workspace.devDependencies,
    ...workspace.optionalDependencies,
    ...workspace.peerDependencies,
  }
  const pending: string[] = []
  for (const name of roots) {
    const range = workspaceRequirements[name]
    if (!range) throw new Error(`Artifact imports undeclared package ${name}`)
    const key = resolveLockKey(lock.packages, name, range)
    if (!key) throw new Error(`bun.lock does not resolve imported package ${name}@${range}`)
    pending.push(key)
  }

  const entries = new Map<string, RuntimeDependencyClosureEntry>()
  while (pending.length > 0) {
    const key = pending.pop()!
    if (entries.has(key)) continue
    const record = lock.packages[key]
    if (!record) throw new Error(`bun.lock dependency key disappeared during traversal: ${key}`)
    const dependencies: string[] = []
    for (const requirement of lockedRequirements(record[2])) {
      const childKey = resolveLockKey(lock.packages, requirement.name, requirement.range, key)
      if (!childKey) {
        if (requirement.optional) continue
        throw new Error(`bun.lock does not resolve ${requirement.name}@${requirement.range} required by ${key}`)
      }
      dependencies.push(childKey)
      pending.push(childKey)
    }
    entries.set(key, {
      key,
      resolution: record[0],
      integrity: record[3] ?? null,
      recordSha256: createHash('sha256').update(JSON.stringify(record)).digest('hex'),
      dependencies: dependencies.sort(compareCodePoints),
    })
  }

  const packages = [...entries.values()].sort((a, b) => compareCodePoints(a.key, b.key))
  const authority = { algorithm: 'bun-lock-transitive-v1' as const, roots, packages }
  return {
    ...authority,
    sha256: createHash('sha256').update(JSON.stringify(authority)).digest('hex'),
  }
}
