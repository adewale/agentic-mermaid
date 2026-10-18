// Resolve a mutable npm selector once. The workflow persists this fetched
// identity across retries, and both Node and browser consumers verify it.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export interface BaselineLock {
  requested: string
  version: string
  integrity: string
}

export function resolveBaseline(requested: string, path: string): BaselineLock {
  if (existsSync(path)) {
    const lock = JSON.parse(readFileSync(path, 'utf8')) as BaselineLock
    if (lock.requested !== requested || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(lock.version) || !/^sha512-[A-Za-z0-9+/]+=*$/.test(lock.integrity)) throw new Error('Invalid or mismatched benchmark baseline lock')
    return lock
  }
  const result = spawnSync('npm', ['view', `agentic-mermaid@${requested}`, 'version', 'dist.integrity', '--json'], { encoding: 'utf8', timeout: 120_000 })
  if (result.status !== 0) throw new Error(`Could not resolve baseline: ${result.stderr || result.error?.message}`)
  const value = JSON.parse(result.stdout) as { version: string; 'dist.integrity': string }
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(value.version) || !/^sha512-[A-Za-z0-9+/]+=*$/.test(value['dist.integrity'])) throw new Error('Baseline must resolve to one exact npm version and SHA-512 integrity')
  const lock = { requested, version: value.version, integrity: value['dist.integrity'] }
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`)
  return lock
}

if (import.meta.main) {
  const [requested, path] = process.argv.slice(2)
  if (!requested || !path) throw new Error('Usage: release-baseline.ts <npm selector> <lock.json>')
  console.log(JSON.stringify(resolveBaseline(requested, path)))
}
