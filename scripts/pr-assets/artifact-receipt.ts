import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

export function filesUnder(directory: string, accept: (path: string) => boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return filesUnder(path, accept)
    return entry.isFile() && accept(path) ? [path] : []
  })
}

const TRAVERSABLE_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

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
 * Package imports are represented by package.json + the lockfile at the caller;
 * relative imports fail closed when they cannot be resolved. Dynamic resources
 * that are not imports (fonts, fixtures, manifests) remain explicit caller inputs.
 */
export function transitiveLocalInputs(root: string, entrypoints: readonly string[]): string[] {
  const normalizedRoot = normalize(resolve(root))
  const pending = entrypoints.map(path => normalize(resolve(path)))
  const visited = new Set<string>()

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
    const imports = ts.preProcessFile(source, true, true).importedFiles
      .map(entry => entry.fileName)
      .filter(specifier => specifier.startsWith('.'))
    for (const specifier of imports) pending.push(resolveLocalImport(path, specifier))
  }

  return sortRepositoryPaths(root, [...visited])
}
