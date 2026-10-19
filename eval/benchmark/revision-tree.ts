// A runnable copy of another revision's production source, for tools that
// compare two revisions with the current harness (`micro-bench.ts`,
// `output-identity.ts`). Production source, tsconfig and optional bundled fonts
// come from the revision; the current `eval/benchmark/` and node_modules are
// reused, so a comparison isolates production source and verified resources.

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function git(args: string[], cwd = ROOT): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** A revision for display: 12 hex digits, keeping any `+dirty-src` marker. */
export const shortRevision = (revision: string) => revision.replace(/^([0-9a-f]{12})[0-9a-f]+/, '$1')

/** The checked-out revision, marked when `src/` has uncommitted changes. */
export function workingRevision(): string {
  const dirty = git(['status', '--porcelain', '--', 'src']).length > 0
  return `${git(['rev-parse', 'HEAD'])}${dirty ? '+dirty-src' : ''}`
}

/**
 * Extract `ref` into `<scratch>/<label>`. The tools then run that revision's
 * code, so pass only refs you trust. A bundler resolves every import() at
 * build time, so each `../../src/...` module that `stubImportsOf` names but
 * the revision lacks becomes a stub that throws when imported; only the
 * callers that use it fail.
 */
export function extractRevisionTree(ref: string, scratch: string, label: string, stubImportsOf?: string): { root: string; revision: string } {
  const revision = git(['rev-parse', '--verify', `${ref}^{commit}`])
  const root = join(scratch, label)
  mkdirSync(root, { recursive: true })
  const fonts = git(['ls-tree', '-d', '--name-only', revision, 'assets/fonts']) === 'assets/fonts' ? ['assets/fonts'] : []
  const archive = spawnSync('git', ['archive', '--format=tar', revision, 'src', 'tsconfig.json', ...fonts], { cwd: ROOT, maxBuffer: 512 * 1024 * 1024 })
  if (archive.status !== 0) throw new Error(`git archive ${revision} failed`)
  const untar = spawnSync('tar', ['-x', '-C', root], { input: archive.stdout })
  if (untar.status !== 0) throw new Error('tar extraction failed')
  cpSync(join(ROOT, 'eval/benchmark'), join(root, 'eval/benchmark'), { recursive: true })
  symlinkSync(join(ROOT, 'node_modules'), join(root, 'node_modules'), 'dir')
  if (stubImportsOf) {
    const importer = readFileSync(join(root, stubImportsOf), 'utf8')
    for (const [, specifier] of importer.matchAll(/import\('(\.\.\/\.\.\/src\/[^']+)'\)/g)) {
      const target = resolve(root, dirname(stubImportsOf), specifier!)
      if (existsSync(target)) continue
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, `throw new Error('${specifier} is not present at ${revision.slice(0, 12)}')\n`)
    }
  }
  return { root, revision }
}
