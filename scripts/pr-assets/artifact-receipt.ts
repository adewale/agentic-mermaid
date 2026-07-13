import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

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
