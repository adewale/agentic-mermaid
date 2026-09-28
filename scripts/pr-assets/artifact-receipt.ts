// Small path and content-hash helpers shared by the evidence generators.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

export const repositoryPath = (root: string, absolute: string): string =>
  relative(root, absolute).replaceAll('\\', '/')

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}
