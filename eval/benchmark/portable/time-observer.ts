import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** Whether this executable reports itself as GNU time. BSD time (macOS /usr/bin/time) does not. */
export function isGnuTime(path: string): boolean {
  if (!existsSync(path)) return false
  const result = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] })
  return result.status === 0 && /GNU\s*Time/i.test(result.stdout + result.stderr)
}

/** The host's GNU time when none is configured: /usr/bin/time on Linux, otherwise
 * Homebrew's gtime on PATH. Undefined leaves whole-process resources unavailable. */
export function defaultTimeObserver(): string | undefined {
  const onPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(directory => join(directory, 'gtime'))
  return ['/usr/bin/time', ...onPath].find(isGnuTime)
}
