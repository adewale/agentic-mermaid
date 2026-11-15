// Shared release acquisition: lock artifact selectors, pin temporary runtime
// installs, and reject dependency drift before Node or browser measurement.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
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
  normalization?: {
    mode: 'normalized-npm-compound'
    basis: 'current-frozen-source-projected-to-verified-npm-roots'
    originalFrozenBaseline: false
    sourceRoots: string[]
    archive: { name: 'agentic-mermaid'; version: string; integrity: string; sha256: string; path: string }
    declaredRanges: Record<string, string>
  }
}
export interface RuntimeReceipt {
  policy: RuntimePolicy
  integritySource: 'npm-installed-lock' | 'frozen-bun-lock'
  graph: Array<{ name: string; version: string; integrity: string | null; dependencies: string[] }>
  locks: Array<{ source: string; path: string }>
}
const manifest = (root: string) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest
const sri = (value: unknown): value is string => typeof value === 'string' && /^sha512-[A-Za-z0-9+/]+=*$/.test(value)
// Bun treats invalid ranges such as "latest" as matching. Restrict this
// opt-in legacy normalization to exact/caret/tilde/equal stable versions;
// unsupported syntax must fail closed before any benchmark work.
const NORMALIZED_NPM_RANGE = /^(?:[~^=])?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/

/** The consumer policy is separate from the shipped manifest. Include the
 * frozen runtime closure, including native optional packages and transitives. */
export function frozenRuntimePolicy(source: string): RuntimePolicy {
  const roots = Object.keys({ ...manifest(source).dependencies, ...manifest(source).optionalDependencies }).sort()
  return frozenPolicyForRoots(source, roots)
}

function frozenPolicyForRoots(source: string, roots: string[]): RuntimePolicy {
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

/** Bind npm identity to the exact installed package, including aliased prefixes.
 * A same-name nested package is not evidence for the requested module root. */
export function installedNpmPackagePin(prefix: string, root: string, name: string, version: string,
  lockPath = join(prefix, 'node_modules/.package-lock.json')): RuntimePin & { packageRoot: string; lockKey: string } {
  const packageRoot = realpathSync(root), pkg = manifest(packageRoot)
  if (typeof name !== 'string' || !name || typeof version !== 'string' || !version || pkg.name !== name || pkg.version !== version) throw new Error(`${name}@${version}: installed package name/version differs`)
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { packages?: Record<string, { name?: string; version?: string; integrity?: string; link?: boolean }> }
  const bases = [...new Set([resolve(prefix), realpathSync(prefix)])]
  const matches = Object.entries(lock.packages ?? {}).filter(([key, entry]) => {
    if (!key || entry.link) return false
    const roots = new Set<string>()
    for (const base of bases) {
      try { roots.add(realpathSync(resolve(base, key))) }
      catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      }
    }
    if (roots.has(packageRoot) && roots.size !== 1) throw new Error(`${name}@${version}: ambiguous installed npm lock path`)
    return roots.has(packageRoot)
  })
  if (matches.length !== 1) throw new Error(`${name}@${version}: expected one exact installed npm lock identity, found ${matches.length}`)
  const [lockKey, pin] = matches[0]!
  if ((pin.name !== undefined && pin.name !== name) || pin.version !== version || !sri(pin.integrity) || pin.integrity.length !== 95) throw new Error(`${name}@${version}: installed npm name/version/SHA-512 identity is unavailable or differs`)
  const encoded = pin.integrity.slice(7), digest = Buffer.from(encoded, 'base64')
  if (digest.length !== 64 || digest.toString('base64') !== encoded) throw new Error(`${name}@${version}: installed npm name/version/SHA-512 identity is unavailable or differs`)
  return { version, integrity: pin.integrity, packageRoot, lockKey }
}

/** Inspect what the package will actually resolve, rather than comparing
 * manifest ranges. npm's installed lock must agree with frozen tarball SRI;
 * a frozen Bun source install must have the exact locked package versions. */
export function inspectAgenticRuntime(root: string, policy: RuntimePolicy, out: string, label: string): RuntimeReceipt {
  // Preserve a consumer's logical spelling for npm keys while finding its
  // lock through physical ancestry, including direct module symlinks.
  const logicalAncestors = new Map<string, string>()
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    const physical = realpathSync(dir)
    if (!logicalAncestors.has(physical)) logicalAncestors.set(physical, dir)
    if (dirname(dir) === dir) break
  }
  root = realpathSync(root)
  const locks: RuntimeReceipt['locks'] = []
  let installed: { packages?: Record<string, RuntimePin> } | undefined, prefix: string | undefined
  for (let physical = root; ; physical = dirname(physical)) {
    let ancestor = physical
    while (!logicalAncestors.has(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
    const logical = logicalAncestors.get(ancestor)
    const dir = logical ? join(logical, relative(ancestor, physical)) : physical
    if (existsSync(join(dir, 'node_modules/.package-lock.json'))) {
      prefix = dir
      installed = JSON.parse(readFileSync(join(dir, 'node_modules/.package-lock.json'), 'utf8'))
      break
    }
    if (dirname(physical) === physical) break
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
    let actual: RuntimePin | undefined
    if (installed) {
      try { actual = installedNpmPackagePin(prefix!, path, name, pkg.version) }
      catch (error) { problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
    } else actual = actualBunPolicy?.packages[name]
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

/** A historical anchor can have different declared runtime roots. Each side
 * must first pass its own frozen policy; shared identities and edges still
 * match exactly. Only closures attributable to exclusive roots may differ. */
export function assertHistoricalAgenticRuntimes(baseline: RuntimeReceipt, candidate: RuntimeReceipt) {
  if ([...baseline.graph, ...candidate.graph].some(row => !sri(row.integrity))) throw new Error('Historical runtime identities require verified SHA-512 integrity')
  const sharedNames = [...new Set(baseline.graph.map(row => row.name))].filter(name => candidate.graph.some(row => row.name === name)).sort()
  for (const name of sharedNames) {
    if (JSON.stringify(baseline.graph.filter(row => row.name === name)) !== JSON.stringify(candidate.graph.filter(row => row.name === name))) {
      throw new Error(`Historical shared runtime version/integrity/edges differ for ${name}; refusing to start benchmark workers or timing`)
    }
  }
  function exclusive(own: RuntimeReceipt, other: RuntimeReceipt) {
    const roots = own.policy.roots.filter(name => !other.policy.roots.includes(name))
    const byIdentity = new Map(own.graph.map(row => [`${row.name}@${row.version}`, row]))
    const reached = new Set<string>()
    function visit(identity: string) {
      if (reached.has(identity)) return
      reached.add(identity)
      for (const dependency of byIdentity.get(identity)?.dependencies ?? []) visit(dependency)
    }
    for (const row of own.graph.filter(row => roots.includes(row.name))) visit(`${row.name}@${row.version}`)
    const packages = own.graph.filter(row => !other.graph.some(peer => peer.name === row.name))
    if (packages.some(row => !reached.has(`${row.name}@${row.version}`))) throw new Error('Historical runtime difference is not attributable to an exclusive declared root')
    return { roots, packages, closure: own.graph.filter(row => reached.has(`${row.name}@${row.version}`)) }
  }
  return { mode: 'historical-compound' as const, isolatedProductionGain: false, sharedPackages: sharedNames,
    baselineOnly: exclusive(baseline, candidate), candidateOnly: exclusive(candidate, baseline) }
}

/** A published npm archive has no claimed original frozen source lock here.
 * Normalize only its declared subset of current roots; retain the distinction
 * from strict current-main and genuinely source-frozen historical comparisons. */
export function assertNormalizedNpmRuntimes(baseline: RuntimeReceipt, candidate: RuntimeReceipt) {
  const normalization = baseline.policy.normalization
  if (!normalization || candidate.policy.normalization || baseline.policy.source !== candidate.policy.source
    || JSON.stringify(normalization.sourceRoots) !== JSON.stringify(candidate.policy.roots)) throw new Error('Normalized npm comparison requires the same current frozen source policy')
  return { ...assertHistoricalAgenticRuntimes(baseline, candidate), mode: 'normalized-npm-compound' as const,
    policyBasis: normalization.basis, originalFrozenBaseline: false,
    embeddedBrowserDependencies: 'Original browser bundles are unchanged; external consumer graph normalization does not establish embedded dependency equality' }
}

/** npm verifies fetched bytes against its lock. Compare that SRI to the
 * frozen source lock before returning an install eligible for timing. */
export function installAgenticRuntime(spec: string, prefix: string, policy: RuntimePolicy, out: string, label: string, expectedIntegrity?: string, timeout = 300_000) {
  return installRuntime(spec, prefix, policy, out, label, expectedIntegrity, timeout)
}

function installRuntime(spec: string, prefix: string, policy: RuntimePolicy, out: string, label: string, expectedIntegrity: string | undefined, timeout: number,
  archive?: NonNullable<RuntimePolicy['normalization']>['archive']) {
  if (existsSync(join(prefix, 'package.json'))) throw new Error(`${label}: acquisition requires a fresh temporary consumer prefix`)
  mkdirSync(prefix, { recursive: true })
  const consumer = { private: true, overrides: policy.overrides }
  writeFileSync(join(prefix, 'package.json'), `${JSON.stringify(consumer, null, 2)}\n`)
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, `${label}.install-package.json`), `${JSON.stringify(consumer, null, 2)}\n`)
  // npm 10 drops root overrides when its consumer prefix is a symlink.
  const result = spawnSync('npm', ['install', '--prefix', realpathSync(prefix), '--ignore-scripts', '--no-audit', '--no-fund', spec], { encoding: 'utf8', timeout, killSignal: 'SIGKILL' })
  if (result.status !== 0) throw new Error(`${label}: npm install failed: ${result.stderr || result.error?.message || result.status}`)
  const root = join(prefix, 'node_modules/agentic-mermaid')
  const { integrity } = installedNpmPackagePin(prefix, root, 'agentic-mermaid', manifest(root).version, join(prefix, 'package-lock.json'))
  if (expectedIntegrity && expectedIntegrity !== integrity) throw new Error(`${label}: installed package integrity differs from the verified artifact`)
  if (archive) {
    const pkg = manifest(root)
    writeFileSync(join(out, `${label}.original-package.json`), readFileSync(join(root, 'package.json')))
    writeFileSync(join(out, `${label}.normalization-source-policy.json`), `${JSON.stringify(policy, null, 2)}\n`)
    for (const [name, path] of [['source.bun.lock', join(policy.source, 'bun.lock')], ['package-lock.json', join(prefix, 'package-lock.json')],
      ['installed-package-lock.json', join(prefix, 'node_modules/.package-lock.json')]]) {
      writeFileSync(join(out, `${label}.${name}`), readFileSync(path!))
    }
    if (pkg.name !== archive.name || pkg.version !== archive.version) throw new Error(`${label}: installed npm package name/version differs from the verified baseline`)
    const ranges = { ...pkg.dependencies, ...pkg.optionalDependencies }, roots = Object.keys(ranges).sort()
    for (const name of roots) {
      if (!policy.roots.includes(name)) throw new Error(`${label}: npm baseline declares unknown current runtime root ${name}`)
      const range = ranges[name], pin = policy.packages[name]
      if (typeof range !== 'string' || !NORMALIZED_NPM_RANGE.test(range) || !pin || !Bun.semver.satisfies(pin.version, range)) throw new Error(`${label}: npm baseline range ${name}@${range} is unsupported or does not admit frozen ${pin?.version ?? '(unlocked)'}`)
    }
    const projected = frozenPolicyForRoots(policy.source, roots)
    for (const [name, pin] of Object.entries(projected.packages)) {
      if (JSON.stringify(pin) !== JSON.stringify(policy.packages[name])) throw new Error(`${label}: projected npm closure differs from the current frozen policy for ${name}`)
    }
    policy = { ...projected, overrides: policy.overrides, normalization: { mode: 'normalized-npm-compound', basis: 'current-frozen-source-projected-to-verified-npm-roots',
      originalFrozenBaseline: false, sourceRoots: policy.roots, archive, declaredRanges: ranges } }
  }
  return { root, integrity, runtime: inspectAgenticRuntime(root, policy, out, label) }
}

/** Retain and verify original registry bytes before projecting the installed
 * manifest. This mode is selected only by explicit npm-baseline callers. */
export function installNormalizedNpmBaseline(locked: BaselineLock, prefix: string, policy: RuntimePolicy, out: string, label: string, timeout = 300_000) {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(locked.version) || !sri(locked.integrity)) throw new Error('Normalized npm baseline requires an exact version and SHA-512 integrity')
  const archiveDir = join(out, `${label}.npm-archive`), started = Date.now()
  mkdirSync(archiveDir, { recursive: true })
  if (readdirSync(archiveDir).length) throw new Error(`${label}: original npm archive destination must be empty`)
  const packed = spawnSync('npm', ['pack', `agentic-mermaid@${locked.version}`, '--ignore-scripts', '--json', '--pack-destination', archiveDir], { encoding: 'utf8', timeout, killSignal: 'SIGKILL' })
  if (packed.status !== 0) throw new Error(`${label}: original npm archive acquisition failed: ${packed.stderr || packed.error?.message}`)
  writeFileSync(join(out, `${label}.npm-pack.json`), packed.stdout)
  const result = JSON.parse(packed.stdout)[0] as { filename?: string }
  if (!result?.filename || basename(result.filename) !== result.filename || !/^[a-z0-9][a-z0-9._-]*\.tgz$/i.test(result.filename)) throw new Error(`${label}: npm pack returned an unsafe archive filename`)
  const original = join(archiveDir, result.filename)
  if (!lstatSync(original).isFile() || readdirSync(archiveDir).length !== 1) throw new Error(`${label}: expected one original npm archive`)
  const bytes = readFileSync(original), integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  if (integrity !== locked.integrity) throw new Error(`${label}: original npm archive integrity differs from the locked baseline`)
  const path = join(archiveDir, 'package.tgz')
  renameSync(original, path)
  const archive = { name: 'agentic-mermaid' as const, version: locked.version, integrity, sha256: createHash('sha256').update(bytes).digest('hex'), path }
  writeFileSync(join(out, `${label}.npm-archive.json`), `${JSON.stringify({ requested: locked.requested, ...archive }, null, 2)}\n`)
  const remaining = timeout - (Date.now() - started)
  if (remaining <= 0) throw new Error(`${label}: npm acquisition budget exhausted`)
  return installRuntime(path, prefix, policy, out, label, integrity, remaining, archive)
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
    const mode = args.includes('--runtime-comparison') ? option('--runtime-comparison') : 'matched'
    if (!['matched', 'historical-compound'].includes(mode!)) throw new Error('Invalid runtime comparison mode')
    if (mode === 'historical-compound' && (!args.includes('--compare-root') || !args.includes('--compare-runtime-source'))) throw new Error('Historical comparison requires --compare-root and --compare-runtime-source')
    if (mode !== 'historical-compound' && args.includes('--compare-runtime-source')) throw new Error('--compare-runtime-source requires historical-compound mode')
    const policy = frozenRuntimePolicy(option('--runtime-source')!)
    const out = resolve(option('--out')!), label = args.includes('--label') ? option('--label')! : 'install'
    const result = installAgenticRuntime(resolve(option('--install')!), resolve(option('--prefix')!), policy, out, label, args.includes('--expected-integrity') ? option('--expected-integrity') : undefined)
    if (args.includes('--compare-root')) {
      const comparatorPolicy = mode === 'historical-compound' ? frozenRuntimePolicy(option('--compare-runtime-source')!) : policy
      const comparator = inspectAgenticRuntime(resolve(option('--compare-root')!), comparatorPolicy, out, `${label}-comparator`)
      if (mode === 'historical-compound') {
        const comparison = assertHistoricalAgenticRuntimes(comparator, result.runtime)
        writeFileSync(join(out, `${label}.runtime-comparison.json`), `${JSON.stringify(comparison, null, 2)}\n`)
      } else assertMatchedAgenticRuntimes([comparator, result.runtime])
    }
    console.log(JSON.stringify(result))
  } else {
    const [requested, path] = process.argv.slice(2)
    if (!requested || !path) throw new Error('Usage: release-baseline.ts <npm selector> <lock.json>')
    console.log(JSON.stringify(resolveBaseline(requested, path)))
  }
}
