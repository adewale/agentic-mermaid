import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { byteDigest } from '../portable/artifacts.ts'
import { environmentIdentity } from '../portable/environment.ts'
import { captureInstalledDependencyClosure } from '../portable/artifact-dependencies.ts'
import { protocolIdentity } from './protocol-identity.ts'

/** The Chromium a browser lane runs when none is configured: the system browser
 * (/usr/bin/chromium on Linux) when present, otherwise Playwright's own. */
export function defaultChromium(chromium: { executablePath(): string }): string {
  return existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : chromium.executablePath()
}

export function executableIdentity(path: string | undefined) {
  if (!path) return { status: 'not-configured', path: null }
  try {
    const resolved = path.includes('/') ? realpathSync(path) : realpathSync(execFileSync('which', [path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim())
    const file = statSync(resolved)
    if (!file.isFile()) throw Error('Not an executable file')
    let version: string | null = null
    try { version = execFileSync(resolved, ['--version'], { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() } catch {}
    // Debian's Chromium launcher is a shell script; it is not the browser
    // machine code. Bind both when this installed layout is actually present.
    const companions = resolved === '/usr/bin/chromium' && existsSync('/usr/lib/chromium/chromium') ? ['/usr/lib/chromium/chromium'] : []
    return { status: 'available', path: resolved, mode: file.mode, version, sha256: byteDigest(resolved), companions: companions.map(file => ({ path: file, sha256: byteDigest(file) })) }
  } catch (error) {
    return { status: 'unavailable', path, error: String(error) }
  }
}

/** Only call this for compiled/delivered assets, never our source corpus. */
export function deliveredArtifactIdentity(directory: string, omitNestedDependencies = false) {
  if (!existsSync(directory)) return { status: 'missing', directory, files: [] }
  const walk = (relative: string): { path: string; bytes: number; sha256: string }[] => readdirSync(join(directory, relative), { withFileTypes: true }).flatMap(entry => {
    if (omitNestedDependencies && entry.name === 'node_modules') return []
    const path = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) throw Error('Delivered asset symlinks need explicit admission: ' + path)
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [{ path, bytes: statSync(join(directory, path)).size, sha256: byteDigest(join(directory, path)) }] : []
  })
  return { status: 'available', directory, files: walk('').sort((left, right) => left.path.localeCompare(right.path)) }
}

/** Bind actual fetched dependency bytes as well as our committed producer
 * closure. A qualifier update must invalidate qualification, not just clocks. */
export function benchmarkContext(harnessRoot: string, node: string, producers: readonly string[], optionalTools: readonly string[] = []) {
  const require = createRequire(join(harnessRoot, 'eval/benchmark/package.json'))
  const typescript = require.resolve('typescript')
  const tools = optionalTools.map(specifier => {
    const entry = require.resolve(specifier)
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    let root = dirname(entry)
    while (root !== dirname(root)) {
      const manifest = join(root, 'package.json')
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) break
      root = dirname(root)
    }
    if (root === dirname(root)) throw Error('Cannot admit actual optional benchmark dependency: ' + specifier)
    return { specifier, entry, package: deliveredArtifactIdentity(root, true), dependencies: captureInstalledDependencyClosure(root) }
  })
  return {
    producers: protocolIdentity(harnessRoot, producers),
    dependencies: captureInstalledDependencyClosure(join(harnessRoot, 'eval/benchmark')),
    typescript: { path: typescript, sha256: byteDigest(typescript) },
    driver: { executable: process.execPath, sha256: byteDigest(process.execPath), versions: process.versions },
    executionEnvironment: Object.fromEntries(['NODE_COMPILE_CACHE', 'NODE_DISABLE_COMPILE_CACHE', 'BUN_OPTIONS', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH', 'UV_THREADPOOL_SIZE'].map(name => [name, process.env[name] ?? null])),
    optionalTools: tools,
    environment: environmentIdentity(node),
  }
}
