import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** This product diagnostic requires a built source checkout, not an npm package. */
export function inspectBuiltCheckout(directory: string): { root: string; revision: string } {
  const root = resolve(directory)
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.preloadIndex=false', '-c', 'index.threads=1', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  if (resolve(git('rev-parse', '--show-toplevel')) !== root) throw Error('Select the checkout root, not a nested package directory')
  if (git('status', '--porcelain', '--', 'src', 'package.json', 'bun.lock', 'assets/fonts')) throw Error('Production source, lock or fonts are dirty: ' + root)
  if (!existsSync(join(root, 'dist/agent.js'))) throw Error('Built public agent entry missing: ' + root)
  return { root, revision: git('rev-parse', 'HEAD') }
}
