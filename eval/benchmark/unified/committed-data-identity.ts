import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { relative, resolve } from 'node:path'

/** Bind declared corpus files as data, even when their names end in .ts.
 * A consumer may compile these inputs through an explicit facade rather than
 * execute their original imports. Git objects bind bytes; no source hashes or
 * import traversal belong at this data boundary. */
export function committedDataIdentity(root: string, inputs: readonly string[]): string[] {
  if (!inputs.length) throw Error('Benchmark corpus input files are required')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const selected = [...new Set(inputs)].sort()
  const tracked = new Set(git('ls-files', '--', ...selected).split('\n'))
  for (const path of selected) {
    const absolute = resolve(root, path)
    if (relative(resolve(root), absolute) !== path || !tracked.has(path) || !existsSync(absolute) || !lstatSync(absolute).isFile()) throw Error('Uncommitted or external benchmark corpus input: ' + path)
  }
  if (git('status', '--porcelain', '--untracked-files=all', '--', ...selected)) throw Error('Commit benchmark corpus inputs before collecting or reusing benchmark records')
  return git('ls-tree', '-r', 'HEAD', '--', ...selected)
    .split('\n')
    .filter(Boolean)
}
