// Shared release acquisition: lock artifact selectors, pin temporary runtime
// installs, and reject dependency drift before Node or browser measurement.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

interface PackageManifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}
interface RuntimePin { version: string; integrity: string }
export interface RuntimePolicy {
  source: string
  roots: string[]
  overrides: Record<string, string>
  packages: Record<string, RuntimePin>
}
export interface RuntimeReceipt {
  policy: RuntimePolicy
  integritySource: 'npm-installed-lock' | 'frozen-bun-lock'
  graph: Array<{ name: string; version: string; integrity: string | null; dependencies: string[] }>
  locks: Array<{ source: string; path: string }>
}
const manifest = (root: string) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest
const sri = (value: unknown): value is string => typeof value === 'string' && /^sha512-[A-Za-z0-9+/]+=*$/.test(value)

/** The consumer policy is separate from the shipped manifest. Include the
 * frozen runtime closure, including native optional packages and transitives. */
export function frozenRuntimePolicy(source: string): RuntimePolicy {
  source = resolve(source)
  type Locked = [string, string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }, string]
  const lock = parseYaml(readFileSync(join(source, 'bun.lock'), 'utf8')) as { packages: Record<string, Locked> }
  const packages: RuntimePolicy['packages'] = {}, visited = new Set<string>()
  function visit(name: string, parent = '') {
    const scopes = parent ? [parent, ...parent.split('/').map((_, i, all) => all.slice(0, all.length - i - 1).join('/'))] : ['']
    const key = scopes.map(scope => scope ? `${scope}/${name}` : name).find(key => lock.packages[key])
    const entry = key && lock.packages[key]
    if (!key || !entry || !entry[0].startsWith(`${name}@`) || !sri(entry[3])) throw new Error(`Missing frozen runtime identity for ${name}`)
    if (visited.has(key)) return
    visited.add(key)
    const pin = { version: entry[0].slice(name.length + 1), integrity: entry[3] }
    if (packages[name] && JSON.stringify(packages[name]) !== JSON.stringify(pin)) throw new Error(`Multiple frozen runtime versions for ${name}; an explicit nested install policy is required`)
    packages[name] = pin
    for (const dependency of Object.keys({ ...entry[2].dependencies, ...entry[2].optionalDependencies })) visit(dependency, key)
  }
  const roots = Object.keys({ ...manifest(source).dependencies, ...manifest(source).optionalDependencies }).sort()
  for (const name of roots) visit(name)
  return { source, roots, overrides: Object.fromEntries(Object.entries(packages).sort(([a], [b]) => a.localeCompare(b)).map(([name, pin]) => [name, pin.version])), packages }
}

function dependencyRoot(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const path = join(dir, 'node_modules', name)
    if (existsSync(join(path, 'package.json'))) return realpathSync(path)
    if (dirname(dir) === dir) return undefined
  }
}

/** Inspect what the package will actually resolve, rather than comparing
 * manifest ranges. npm's installed lock must agree with frozen tarball SRI;
 * a frozen Bun source install must have the exact locked package versions. */
export function inspectAgenticRuntime(root: string, policy: RuntimePolicy, out: string, label: string): RuntimeReceipt {
  root = realpathSync(root)
  const locks: RuntimeReceipt['locks'] = []
  let installed: { packages?: Record<string, RuntimePin> } | undefined, prefix: string | undefined
  for (let dir = root; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules/.package-lock.json'))) {
      prefix = dir
      installed = JSON.parse(readFileSync(join(dir, 'node_modules/.package-lock.json'), 'utf8'))
      break
    }
    if (dirname(dir) === dir) break
  }
  const actualBunPolicy = !installed && existsSync(join(root, 'bun.lock')) ? frozenRuntimePolicy(root) : undefined
  if (!installed && !actualBunPolicy) throw new Error(`${label}: runtime integrity is unknown; directory needs its own frozen bun.lock or an installed npm lock`)
  mkdirSync(out, { recursive: true })
  for (const path of [join(policy.source, 'bun.lock'), ...(prefix ? [join(prefix, 'package-lock.json'), join(prefix, 'node_modules/.package-lock.json')] : [])]) {
    if (!existsSync(path)) continue
    const source = path.endsWith('/node_modules/.package-lock.json') ? 'installed-package-lock.json' : path.endsWith('bun.lock') ? 'source.bun.lock' : 'package-lock.json'
    const saved = join(out, `${label}.${source}`)
    writeFileSync(saved, readFileSync(path))
    locks.push({ source, path: saved })
  }
  if (actualBunPolicy) {
    const path = join(out, `${label}.installed-source.bun.lock`)
    writeFileSync(path, readFileSync(join(root, 'bun.lock')))
    locks.push({ source: 'installed-source.bun.lock', path })
  }
  writeFileSync(join(out, `${label}.runtime-policy.json`), `${JSON.stringify(policy, null, 2)}\n`)
  const graph: RuntimeReceipt['graph'] = [], visited = new Set<string>(), problems: string[] = []
  function visit(from: string, name: string, optional: boolean): string | undefined {
    const path = dependencyRoot(from, name)
    if (!path) {
      if (optional) return undefined
      problems.push(`${label}: missing runtime dependency ${name}`)
      return undefined
    }
    const pkg = manifest(path), expected = policy.packages[name]
    const fetched = installed?.packages?.[relative(prefix!, path).split('\\').join('/')]
    const actual = fetched ?? actualBunPolicy?.packages[name]
    if (pkg.name !== name || !expected || pkg.version !== expected.version || actual?.version !== pkg.version || actual.integrity !== expected.integrity) {
      problems.push(`${label}: runtime dependency ${name}@${pkg.version} differs from frozen version/integrity ${expected?.version ?? '(unlocked)'}`)
    }
    const identity = `${name}@${pkg.version}`
    if (visited.has(path)) return identity
    visited.add(path)
    const dependencies: string[] = []
    for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort()) {
      const child = visit(path, dependency, !!pkg.optionalDependencies?.[dependency])
      if (child) dependencies.push(child)
    }
    graph.push({ name, version: pkg.version, integrity: actual?.version === pkg.version ? actual.integrity : null, dependencies })
    return identity
  }
  if (manifest(root).name !== 'agentic-mermaid') throw new Error(`${label}: expected agentic-mermaid package`)
  const pkg = manifest(root)
  const roots = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort()
  if (JSON.stringify(roots) !== JSON.stringify(policy.roots)) problems.push(`${label}: declared runtime roots differ from frozen policy`)
  for (const name of roots) visit(root, name, !!pkg.optionalDependencies?.[name])
  graph.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  const receipt: RuntimeReceipt = { policy, integritySource: installed ? 'npm-installed-lock' : 'frozen-bun-lock', graph, locks }
  writeFileSync(join(out, `${label}.runtime.json`), `${JSON.stringify(receipt, null, 2)}\n`)
  if (problems.length) throw new Error(problems.join('; '))
  return receipt
}

export function assertMatchedAgenticRuntimes(receipts: RuntimeReceipt[]): void {
  if (receipts.some(receipt => JSON.stringify(receipt.graph) !== JSON.stringify(receipts[0]!.graph))) throw new Error('Agentic runtime dependency graphs differ; refusing to start benchmark workers or timing')
}

/** npm verifies fetched bytes against its lock. Compare that SRI to the
 * frozen source lock before returning an install eligible for timing. */
export function installAgenticRuntime(spec: string, prefix: string, policy: RuntimePolicy, out: string, label: string, expectedIntegrity?: string, timeout = 300_000) {
  if (existsSync(join(prefix, 'package.json'))) throw new Error(`${label}: acquisition requires a fresh temporary consumer prefix`)
  mkdirSync(prefix, { recursive: true })
  const consumer = { private: true, overrides: policy.overrides }
  writeFileSync(join(prefix, 'package.json'), `${JSON.stringify(consumer, null, 2)}\n`)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${label}.install-package.json`), `${JSON.stringify(consumer, null, 2)}\n`)
  const result = spawnSync('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', spec], { encoding: 'utf8', timeout, killSignal: 'SIGKILL' })
  if (result.status !== 0) throw new Error(`${label}: npm install failed: ${result.stderr || result.error?.message || result.status}`)
  const lock = JSON.parse(readFileSync(join(prefix, 'package-lock.json'), 'utf8')) as { packages: Record<string, RuntimePin> }
  const integrity = lock.packages['node_modules/agentic-mermaid']?.integrity
  if (!sri(integrity) || (expectedIntegrity && expectedIntegrity !== integrity)) throw new Error(`${label}: installed package integrity differs from the verified artifact`)
  const root = join(prefix, 'node_modules/agentic-mermaid')
  return { root, integrity, runtime: inspectAgenticRuntime(root, policy, out, label) }
}

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
  if (process.argv[2] === '--install') {
    const args = process.argv.slice(2), option = (name: string) => args[args.indexOf(name) + 1]
    for (const name of ['--install', '--prefix', '--runtime-source', '--out']) if (!args.includes(name) || !option(name) || option(name)!.startsWith('--')) throw new Error(`Provide ${name}`)
    const policy = frozenRuntimePolicy(option('--runtime-source')!)
    const out = resolve(option('--out')!), label = args.includes('--label') ? option('--label')! : 'install'
    const result = installAgenticRuntime(resolve(option('--install')!), resolve(option('--prefix')!), policy, out, label, args.includes('--expected-integrity') ? option('--expected-integrity') : undefined)
    if (args.includes('--compare-root')) assertMatchedAgenticRuntimes([result.runtime, inspectAgenticRuntime(resolve(option('--compare-root')!), policy, out, `${label}-comparator`)])
    console.log(JSON.stringify(result))
  } else {
    const [requested, path] = process.argv.slice(2)
    if (!requested || !path) throw new Error('Usage: release-baseline.ts <npm selector> <lock.json>')
    console.log(JSON.stringify(resolveBaseline(requested, path)))
  }
}
