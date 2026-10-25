import '../ci-policy-enforce.ts'
/** Pinned source-only comparator acquisition. Importing this module performs no
 * acquisition, compilation or product invocation; prepare runs outside clocks. */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statfsSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { runCommunityAcquisitionCommand } from './community-source-prepare.ts'
import type { CommunityArtifact, CommunityNode } from './community-types.ts'
import { qualifyOutput } from './qualification.ts'

interface ExtraSourceNode extends CommunityNode {
  parent?: string
  benchmark?: NonNullable<CommunityNode['benchmark']> & { sourceAdapter?: string; sourcePin?: string }
}
export interface GitSourceFile {
  root: string
  revision: string
  gitPath: string
  blob: string
}
export interface ExtraSourceArtifact extends CommunityArtifact {
  sourceRevision: string
  buildRecipeId: string
  runtimeCommandId: string
  runtimeVersion: string
  reviewed: true
  supportedFamilies?: readonly string[]
  sourceFallback?: 'framed-source'
  acquisitionOrigin?: string
  sourceFiles?: GitSourceFile[]
  dependencyPatches?: GitSourceFile[]
  runtimeDependencyRoots?: string[]
  buildDependencyPrefix?: string
  artifactClass: 'compiled-or-shipped' | 'git-interpreted-source'
  apiAdmission: 'public-protocol' | 'deferred-browser'
}
const json = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))
const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const executable = (name: string) => (name.includes('/') ? resolve(name) : execFileSync('which', [name], { encoding: 'utf8' }).trim())
const version = (command: string, args = ['--version'], env: NodeJS.ProcessEnv = process.env) => execFileSync(command, args, { env, encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const select = (value: any): string | undefined => (typeof value === 'string' ? value : value && typeof value === 'object' ? select(value.import ?? value.node ?? value.default ?? value.require) : undefined)
const run = (command: readonly string[], cwd: string, env: NodeJS.ProcessEnv, log: string): Promise<void> =>
  runCommunityAcquisitionCommand(command, cwd, env, log, 20 * 60_000, { minFreeBytes: 200 * 1024 * 1024, storageRoots: [env.CARGO_TARGET_DIR, env.AM_BENCH_CARGO_TARGET_ROOT, env.CARGO_HOME].filter((path): path is string => !!path && existsSync(path)) })
function runtimeEntry(root: string): string | undefined {
  const pkg = json(join(root, 'package.json')),
    path = select(pkg.exports?.['.']) ?? pkg.module ?? pkg.main
  return typeof path === 'string' ? resolve(root, path) : undefined
}
function trackedEntry(source: string, entry: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', relative(source, entry)], { cwd: source, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
function filesUnder(directory: string, include: (path: string) => boolean = () => true): { path: string; sha256: string }[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path, include) : entry.isFile() && include(path) ? [{ path, sha256: digest(path) }] : []
  })
}
function gitSourceFiles(root: string, revision: string, gitPaths: string[]): GitSourceFile[] {
  execFileSync('git', ['diff', '--quiet', revision, '--', ...gitPaths], { cwd: root, stdio: 'ignore' })
  const tree = execFileSync('git', ['ls-tree', '-r', '--format=%(objecttype)\t%(objectname)\t%(path)', revision, '--', ...gitPaths], { cwd: root, encoding: 'utf8' })
  return tree
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [type, blob, gitPath] = line.split('\t')
      if (type !== 'blob' || !blob || !gitPath || !existsSync(join(root, gitPath))) throw Error('Executed source file has no clean tracked Git blob proof')
      return { root, revision, gitPath, blob }
    })
}
function admitted(artifact: ExtraSourceArtifact): boolean {
  const entry = artifact.module ?? artifact.executable
  if (!artifact.reviewed || !entry || !existsSync(entry) || !artifact.artifactClass || !artifact.apiAdmission) return false
  try {
    for (const file of artifact.sourceFiles ?? []) {
      const proof = gitSourceFiles(file.root, file.revision, [file.gitPath])
      if (proof.length !== 1 || proof[0]!.blob !== file.blob) return false
    }
    const entryBound = artifact.sha256 ? artifact.sha256 === digest(entry) : artifact.sourceFiles?.some(file => resolve(file.root, file.gitPath) === resolve(entry))
    return !!entryBound && (artifact.files ?? []).every(file => existsSync(file.path) && digest(file.path) === file.sha256)
  } catch {
    return false
  }
}
function storageAvailable(directory: string, adapter: string): void {
  const info = statfsSync(directory)
  const minimumMiB = adapter === 'grok-source' ? 768 : adapter === 'mermaid-source' ? 512 : 256
  if (info.bavail * info.bsize < minimumMiB * 1024 * 1024) throw Error(`Source preparation requires at least ${minimumMiB} MiB free workspace space for ${adapter}; remove only verified disposable compiler intermediates before retrying`)
}
async function capture(command: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((accept, reject) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '',
      stderr = '',
      size = 0
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const append = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024 * 1024) {
        child.kill('SIGKILL')
        return
      }
      if (kind === 'stdout') stdout += chunk.toString()
      else stderr += chunk.toString()
    }
    child.stdout.on('data', chunk => append('stdout', chunk))
    child.stderr.on('data', chunk => append('stderr', chunk))
    child.stdin.on('error', () => {})
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', code => {
      clearTimeout(timer)
      code === 0 ? accept({ stdout, stderr }) : reject(Error(`Public source adapter exited ${code}: ${stderr.slice(-3000)}`))
    })
    child.stdin.end(input ?? '')
  })
}
async function checkout(node: ExtraSourceNode, pin: string, source: string, env: NodeJS.ProcessEnv, log: string): Promise<void> {
  mkdirSync(source, { recursive: true })
  if (!existsSync(join(source, '.git'))) {
    await run(['git', 'init', '--quiet'], source, env, log)
    await run(['git', 'remote', 'add', 'origin', `https://github.com/${node.id}.git`], source, env, log)
    await run(['git', 'config', 'remote.origin.promisor', 'true'], source, env, log)
    await run(['git', 'config', 'remote.origin.partialclonefilter', 'blob:none'], source, env, log)
    await run(['git', 'sparse-checkout', 'init', '--no-cone'], source, env, log)
    writeFileSync(join(source, '.git/info/sparse-checkout'), '/*\n!/.github/\n!/docs/\n!/demos/\n!/cypress/\n!/packages/*/src/docs/\n!/packages/*/cypress/\n')
  }
  try {
    await run(['git', 'fetch', '--depth', '1', '--filter=blob:none', 'origin', pin], source, env, log)
  } catch (error) {
    if (!node.parent || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(node.parent)) throw error
    await run(['git', 'remote', 'set-url', 'origin', `https://github.com/${node.parent}.git`], source, env, log)
    await run(['git', 'fetch', '--depth', '1', '--filter=blob:none', 'origin', pin], source, env, log)
  }
  await run(['git', 'checkout', '--detach', '--force', pin], source, env, log)
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim()
  if (actual !== pin) throw Error('Source checkout differs from its immutable catalog pin')
}
async function tsupBuild(root: string, cache: string, env: NodeJS.ProcessEnv, log: string): Promise<void> {
  const pkg = json(join(root, 'package.json')),
    declared = { ...(pkg.dependencies ?? {}), ...Object.fromEntries(Object.entries(pkg.devDependencies ?? {}).filter(([name]) => name.startsWith('@types/') || name === 'bun-types')), tsup: pkg.devDependencies?.tsup ?? '^8.0.0', typescript: pkg.devDependencies?.typescript ?? '^5.0.0' },
    gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim(),
    relative = root === gitRoot ? 'package.json' : root.slice(gitRoot.length + 1) + '/package.json',
    object = execFileSync('git', ['rev-parse', `HEAD:${relative}`], { cwd: root, encoding: 'utf8' }).trim(),
    tools = join(cache, 'node-dependencies', object)
  mkdirSync(tools, { recursive: true })
  if (Object.keys(declared).some(name => !existsSync(join(tools, 'node_modules', name, 'package.json')))) {
    writeFileSync(join(tools, 'package.json'), JSON.stringify({ private: true, dependencies: declared }, null, 2))
    await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', tools], tools, env, log)
  }
  if (!existsSync(join(root, 'node_modules'))) symlinkSync(join(tools, 'node_modules'), join(root, 'node_modules'), 'dir')
  await run([join(tools, 'node_modules/.bin/tsup')], root, env, log)
}

interface SourceRuntimeClosure {
  files: { path: string; sha256: string }[]
  packageRoots: string[]
  dependencyPrefix: string
}
function runtimeClosure(prefix: string, seeds: string[], localPackages: string[]): SourceRuntimeClosure {
  const roots = new Set<string>(),
    queue = seeds.map(name => ({ name, from: prefix }))
  while (queue.length) {
    const { name, from } = queue.shift()!
    if (name.startsWith('@types/') || isBuiltin(name)) continue
    const search = createRequire(join(from, 'package.json')).resolve.paths(name) ?? [],
      root = search.map(path => join(path, name)).find(path => existsSync(join(path, 'package.json')))
    if (!root) throw Error('Installed Mermaid runtime dependency is unavailable: ' + name)
    if (roots.has(root)) continue
    roots.add(root)
    const pkg = json(join(root, 'package.json')),
      required = Object.keys(pkg.dependencies ?? {}),
      optional = Object.keys({ ...(pkg.optionalDependencies ?? {}), ...(pkg.peerDependencies ?? {}) })
    for (const name of required) if (!(name in (pkg.optionalDependencies ?? {}))) queue.push({ name, from: root })
    for (const name of optional) {
      const search = createRequire(join(root, 'package.json')).resolve.paths(name) ?? []
      if (search.some(path => existsSync(join(path, name, 'package.json')))) queue.push({ name, from: root })
    }
  }
  const shipped = [...roots].flatMap(root => filesUnder(root, path => !path.endsWith('/.package-lock.json') && !path.endsWith('.d.ts')))
  return { files: [...shipped, ...localPackages.flatMap(directory => filesUnder(join(directory, 'dist')))], packageRoots: [...roots], dependencyPrefix: prefix }
}

async function trackedMermaidRuntime(source: string, root: string, cache: string, env: NodeJS.ProcessEnv, log: string): Promise<SourceRuntimeClosure> {
  const pkg = json(join(root, 'package.json')),
    dependencies: Record<string, string> = { ...pkg.dependencies },
    object = execFileSync('git', ['rev-parse', `HEAD:${relative(source, join(root, 'package.json'))}`], { cwd: source, encoding: 'utf8' }).trim(),
    prefix = join(cache, 'node-dependencies', `mermaid-tracked-runtime-${object}`)
  if (Object.values(dependencies).some(value => typeof value !== 'string' || value.startsWith('workspace:'))) throw Error('Tracked Mermaid distribution requires an additional reviewed workspace runtime binding')
  mkdirSync(prefix, { recursive: true })
  if (Object.keys(dependencies).some(name => !existsSync(join(prefix, 'node_modules', name, 'package.json')))) {
    writeFileSync(join(prefix, 'package.json'), JSON.stringify({ private: true, dependencies }, null, 2))
    await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix], prefix, env, log)
  }
  const destination = join(root, 'node_modules')
  rmSync(destination, { recursive: true, force: true })
  symlinkSync(join(prefix, 'node_modules'), destination, 'dir')
  return runtimeClosure(prefix, Object.keys(dependencies), [root])
}

async function legacyMermaidBuild(source: string, root: string, cache: string, env: NodeJS.ProcessEnv, log: string): Promise<SourceRuntimeClosure> {
  const vite = existsSync(join(source, '.vite/build.ts')),
    webpack = existsSync(join(source, '.webpack/webpack.config.babel.js')),
    manifest = json(join(source, 'package.json')),
    pkg = json(join(root, 'package.json')),
    dependencies: Record<string, string> = { ...pkg.dependencies },
    tools = vite
      ? ['vite', 'jison', 'js-yaml', 'rollup-plugin-visualizer', ...(existsSync(join(source, '.vite/jsonSchemaPlugin.ts')) ? ['ajv', '@rollup/plugin-typescript', 'typescript', 'vite-plugin-istanbul', 'tslib'] : [])]
      : ['webpack', 'webpack-cli', 'webpack-merge', 'webpack-node-externals', '@babel/core', '@babel/register', '@babel/preset-env', 'babel-loader', 'terser-webpack-plugin', 'path-browserify', 'jison', 'css-to-string-loader']
  if (!vite && !webpack) throw Error('Pinned Mermaid source has no reviewed esbuild, Vite, or webpack public build entry')
  for (const name of tools) {
    const declared = manifest.devDependencies?.[name] ?? pkg.devDependencies?.[name]
    // tslib is the declared peer of upstream @rollup/plugin-typescript; accept
    // its installed peer binding without guessing a new manifest version.
    if (name === 'tslib' && typeof declared !== 'string') continue
    if (typeof declared !== 'string') throw Error('Pinned legacy Mermaid build lacks a declared tool version: ' + name)
    dependencies[name] = declared
  }
  for (const [name, declared] of Object.entries(pkg.devDependencies ?? {})) if (name.startsWith('@types/') && typeof declared === 'string') dependencies[name] = declared
  // These historical sources import cytoscape/dist/cytoscape.umd.js. Later
  // versions allowed by their ^ range introduced incompatible export maps;
  // preserve the actual upstream lockfile's companion, without rewriting code.
  const lockPath = join(source, 'pnpm-lock.yaml')
  if (vite && dependencies.cytoscape && existsSync(lockPath)) {
    const importer = parseYaml(readFileSync(lockPath, 'utf8')).importers?.[relative(source, root) || '.'],
      entry = importer?.dependencies?.cytoscape,
      locked = typeof entry === 'string' ? entry : entry?.version,
      pin = typeof locked === 'string' ? /^(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)/.exec(locked)?.[1] : undefined
    if (!pin) throw Error('Legacy Mermaid deep Cytoscape import has no auditable exact upstream companion lock')
    dependencies.cytoscape = pin
  }
  if (Object.values(dependencies).some(value => typeof value !== 'string' || value.startsWith('workspace:'))) throw Error('Legacy Mermaid source needs an additional reviewed workspace binding')
  const rootObject = execFileSync('git', ['rev-parse', 'HEAD:package.json'], { cwd: source, encoding: 'utf8' }).trim(),
    packageObject = execFileSync('git', ['rev-parse', `HEAD:${relative(source, join(root, 'package.json'))}`], { cwd: source, encoding: 'utf8' }).trim(),
    prefix = join(cache, 'node-dependencies', `mermaid-legacy-${rootObject}-${packageObject}`)
  mkdirSync(prefix, { recursive: true })
  if (
    Object.entries(dependencies).some(([name, declared]) => {
      const installed = join(prefix, 'node_modules', name, 'package.json')
      return !existsSync(installed) || (/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(declared) && json(installed).version !== declared)
    })
  ) {
    writeFileSync(join(prefix, 'package.json'), JSON.stringify({ private: true, dependencies }, null, 2))
    await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix], prefix, env, log)
  }
  const typescriptPlugin = join(prefix, 'node_modules/@rollup/plugin-typescript/package.json')
  if (vite && existsSync(typescriptPlugin) && !existsSync(join(prefix, 'node_modules/tslib/package.json'))) {
    const peer = json(typescriptPlugin).peerDependencies?.tslib
    if (typeof peer !== 'string') throw Error('Upstream TypeScript build plugin requires tslib but declares no peer version')
    await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, `tslib@${peer}`], prefix, env, log)
  }
  for (const directory of new Set([source, root])) {
    const destination = join(directory, 'node_modules')
    rmSync(destination, { recursive: true, force: true })
    symlinkSync(join(prefix, 'node_modules'), destination, 'dir')
  }
  if (vite) {
    const bun = executable(process.env.AM_BENCH_BUN ?? process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun'))
    await run([bun, '--version'], source, env, log)
    await run([bun, '.vite/build.ts', '--mermaid'], source, env, log)
  } else await run([join(prefix, 'node_modules/.bin/webpack'), '--config', '.webpack/webpack.config.babel.js', '--mode', 'production'], source, env, log)
  return runtimeClosure(prefix, Object.keys(pkg.dependencies ?? {}), [root])
}

async function mermaidBuild(source: string, root: string, cache: string, env: NodeJS.ProcessEnv, log: string): Promise<SourceRuntimeClosure> {
  const buildPaths = ['.build/common.ts', '.build/generateLangium.ts', '.esbuild/util.ts']
  if (buildPaths.some(path => !existsSync(join(source, path)))) return await legacyMermaidBuild(source, root, cache, env, log)
  const manifest = json(join(source, 'package.json')),
    packageRoots = new Map<string, string>(),
    dependencies: Record<string, string> = {},
    local = new Map<string, string>()
  for (const name of readdirSync(join(source, 'packages'))) {
    const directory = join(source, 'packages', name)
    if (existsSync(join(directory, 'package.json'))) packageRoots.set(json(join(directory, 'package.json')).name, directory)
  }
  const visit = (directory: string): void => {
    const pkg = json(join(directory, 'package.json'))
    if (local.has(pkg.name)) return
    local.set(pkg.name, directory)
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      if (typeof version !== 'string') throw Error('Pinned Mermaid runtime dependency lacks a declared version: ' + name)
      if (version.startsWith('workspace:')) {
        const target = packageRoots.get(name)
        if (!target) throw Error('Pinned Mermaid workspace dependency has no exact local source: ' + name)
        visit(target)
      } else dependencies[name] = version
    }
  }
  visit(root)
  const parser = packageRoots.get('@mermaid-js/parser')
  if (!parser) throw Error('Pinned Mermaid public build requires its exact local parser package')
  visit(parser)
  const runtimeSeeds = Object.keys(dependencies)
  for (const name of ['esbuild', 'tsx', 'langium-cli', 'jison', 'js-yaml', 'ajv']) {
    const version = manifest.devDependencies?.[name] ?? json(join(root, 'package.json')).devDependencies?.[name]
    if (typeof version !== 'string') throw Error('Pinned Mermaid build lacks a declared build-tool version: ' + name)
    dependencies[name] = version
  }
  for (const key of Object.keys(manifest.pnpm?.patchedDependencies ?? {})) {
    const pin = /^(.+)@(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)$/.exec(key)
    if (pin) dependencies[pin[1]!] = pin[2]!
  }
  const manifests = [...new Set([source, ...local.values()])].map(directory => relative(source, join(directory, 'package.json')) || 'package.json'),
    patchPaths = Object.values(manifest.pnpm?.patchedDependencies ?? {}) as string[],
    objects = [...manifests, ...patchPaths].map(path => execFileSync('git', ['rev-parse', `HEAD:${path}`], { cwd: source, encoding: 'utf8' }).trim()),
    prefix = join(cache, 'node-dependencies', 'mermaid-public-build-' + objects.join('-'))
  mkdirSync(prefix, { recursive: true })
  if (Object.keys(dependencies).some(name => !existsSync(join(prefix, 'node_modules', name, 'package.json')))) {
    writeFileSync(join(prefix, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies }, null, 2))
    await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix], prefix, env, log)
  }
  // Share external registry bytes, but never mutable workspace bindings across
  // source revisions whose unchanged manifests may describe different parsers.
  const bindings = join(source, '..', 'runtime-node-modules')
  mkdirSync(bindings, { recursive: true })
  for (const entry of readdirSync(join(prefix, 'node_modules'), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const names = entry.name.startsWith('@') ? readdirSync(join(prefix, 'node_modules', entry.name)).map(name => join(entry.name, name)) : [entry.name]
    for (const name of names) {
      const destination = join(bindings, name)
      mkdirSync(join(destination, '..'), { recursive: true })
      rmSync(destination, { recursive: true, force: true })
      symlinkSync(join(prefix, 'node_modules', name), destination, 'dir')
    }
  }
  for (const [name, directory] of local) {
    const destination = join(bindings, name)
    mkdirSync(join(destination, '..'), { recursive: true })
    rmSync(destination, { recursive: true, force: true })
    symlinkSync(directory, destination, 'dir')
  }
  for (const directory of [source, ...local.values()]) {
    const destination = join(directory, 'node_modules')
    rmSync(destination, { recursive: true, force: true })
    symlinkSync(bindings, destination, 'dir')
  }
  // Preserve upstream dependency patches as part of the actual declared build.
  for (const [key, value] of Object.entries(manifest.pnpm?.patchedDependencies ?? {})) {
    if (typeof value !== 'string') throw Error('Pinned Mermaid dependency patch has no concrete source path')
    const name = key.replace(/@[^/]*$/, ''),
      patch = resolve(source, value),
      directory = `node_modules/${name}`
    try {
      execFileSync('git', ['apply', '--reverse', '--check', '--unsafe-paths', `--directory=${directory}`, patch], { cwd: prefix, stdio: 'ignore' })
    } catch {
      await run(['git', 'apply', '--unsafe-paths', `--directory=${directory}`, patch], prefix, env, log)
    }
  }
  const driver = join(prefix, 'build-public-entries.ts'),
    entryArgument = /\bentryName\s*:\s*keyof\s+typeof\s+packageOptions\b/.test(readFileSync(join(source, buildPaths[2]!), 'utf8')) ? 'entryName:name' : 'options:packageOptions[name]'
  writeFileSync(
    driver,
    `import{build}from'esbuild';import{generateLangium}from${JSON.stringify(pathToFileURL(join(source, buildPaths[1]!)).href)};import{packageOptions}from${JSON.stringify(pathToFileURL(join(source, buildPaths[0]!)).href)};import{defaultOptions,getBuildConfig}from${JSON.stringify(pathToFileURL(join(source, buildPaths[2]!)).href)};await generateLangium();for(const name of ['parser','mermaid']){if(!packageOptions[name])throw Error('Upstream public build entry absent: '+name);await build(getBuildConfig({...defaultOptions,${entryArgument},core:true}));}`,
  )
  await run([join(prefix, 'node_modules/.bin/tsx'), driver], source, env, log)
  // Public core entries retain external dependencies. Admit their shipped bytes
  // and the compiled exact local parser, as well as Mermaid's distribution.
  return runtimeClosure(prefix, runtimeSeeds, [...local.values()])
}

/** Source pins are distinct population cells. Equal Git HEAD is only a cache
 * candidate: a physical artifact is reused after its bytes and reviewed public
 * runtime protocol were admitted, never across divergent revisions/recipes. */
export async function prepareExtraCommunitySource(node: ExtraSourceNode, cacheRoot: string): Promise<ExtraSourceArtifact> {
  const adapter = node.benchmark?.sourceAdapter,
    pin = node.benchmark?.sourcePin ?? node.head
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(node.id) || !pin || !/^[a-f0-9]{40}$/.test(pin)) throw Error('Extra source preparation requires a safe GitHub identity and full immutable sourcePin')
  if (node.repo && node.repo.replace(/\.git$/, '') !== `https://github.com/${node.id}`) throw Error('Extra source URL differs from its catalog GitHub identity')
  if (!adapter || !['fork-go-cli', 'mermaidtext-go', 'beautiful-source', 'mermaid-source', 'orbiter-python', 'ascii-mermaid-source', 'opencode-source', 'grok-source'].includes(adapter)) throw Error(`No reviewed extra-source recipe for ${node.id}: ${adapter}`)
  const variant = adapter === 'fork-go-cli' ? (node.parent === 'pgavlin/mermaid-ascii' ? 'pgavlin-root' : 'alexander-root') : adapter,
    directory = resolve(cacheRoot, 'extra-source', `${variant}@${pin}`),
    manifest = join(directory, 'artifact.json'),
    source = join(directory, 'source'),
    log = join(directory, 'acquisition.log'),
    env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', CARGO_BUILD_JOBS: '2', CARGO_PROFILE_RELEASE_DEBUG: '0' }
  mkdirSync(directory, { recursive: true })
  if (existsSync(manifest)) {
    const previous = json(manifest) as ExtraSourceArtifact,
      interpretedBeautiful = adapter === 'beautiful-source' && /\.[cm]?tsx?$/.test(previous.module ?? '')
    if (
      previous.revision === pin &&
      previous.buildRecipeId.startsWith(`extra-source-v1:${variant}:`) &&
      (!(adapter === 'mermaid-source' || interpretedBeautiful) || previous.buildRecipeId.endsWith(':immutable-runtime-bindings:v3')) &&
      (!interpretedBeautiful || !!previous.runtimeDependencyRoots?.length) &&
      admitted(previous)
    )
      return { ...previous, detail: `${previous.detail ?? ''}; exact physical admitted artifact reused for ${node.id} at identical Git revision/build/runtime protocol` }
  }
  storageAvailable(directory, adapter)
  await checkout(node, pin, source, env, log)
  let artifact: CommunityArtifact & { sourceFiles?: GitSourceFile[] },
    dependencyRuntime: SourceRuntimeClosure | undefined,
    buildRecipeId = `extra-source-v1:${variant}:`,
    runtimeCommandId: string,
    runtimeVersion: string
  const binary = join(directory, 'bin')
  mkdirSync(binary, { recursive: true })
  if (adapter === 'fork-go-cli' || adapter === 'mermaidtext-go') {
    const go = executable(process.env.AM_BENCH_GO ?? (existsSync('/workspace/tooling/go-community/go/bin/go') ? '/workspace/tooling/go-community/go/bin/go' : 'go')),
      output = join(binary, adapter === 'mermaidtext-go' ? 'mermaidtext' : 'mermaid-ascii')
    env.GOCACHE ??= join(resolve(cacheRoot), '.go-build')
    env.GOPATH ??= join(resolve(cacheRoot), '.go')
    runtimeVersion = version(go, ['version'])
    await run([go, 'build', '-trimpath', '-o', output, adapter === 'mermaidtext-go' ? './cmd/mermaidtext' : '.'], source, env, log)
    buildRecipeId += 'go-build-trimpath'
    runtimeCommandId = 'public-cli:stdin:default-unicode:v1'
    artifact = { kind: 'cli', root: directory, executable: output, args: [], input: 'stdin', format: 'terminal', version: `git-${pin.slice(0, 12)}`, revision: pin, runtime: `native Go (${runtimeVersion})`, sha256: digest(output) }
  } else if (adapter === 'orbiter-python') {
    const python = executable(process.env.AM_BENCH_PYTHON ?? 'python3'),
      script = join(source, 'beautiful_mermaid.py')
    if (!existsSync(script)) throw Error('Pinned Python source lacks documented public beautiful_mermaid.py CLI')
    runtimeVersion = version(python)
    runtimeCommandId = 'public-python-cli:file:default-unicode:v1'
    buildRecipeId += 'documented-single-file-cli'
    artifact = { kind: 'cli', root: source, executable: python, args: [script, '{input}'], input: 'file', format: 'terminal', version: `git-${pin.slice(0, 12)}`, revision: pin, runtime: runtimeVersion, sha256: digest(python), sourceFiles: gitSourceFiles(source, pin, ['beautiful_mermaid.py']) }
  } else if (adapter === 'opencode-source') {
    const root = join(source, 'packages/merman'),
      pkg = json(join(root, 'package.json')),
      catalog = json(join(source, 'package.json')).workspaces?.catalog ?? {},
      coreVersion = catalog['@opentui/core'],
      widthVersion = catalog['string-width'],
      dependencies = join(resolve(cacheRoot), 'node-dependencies', `opencode-merman@${pin}`),
      bun = executable(process.env.AM_BENCH_BUN ?? process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun'))
    if (typeof coreVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(coreVersion) || typeof widthVersion !== 'string') throw Error('Pinned OpenCode catalog lacks concrete public OpenTUI/string-width versions; no companion version is guessed')
    mkdirSync(dependencies, { recursive: true })
    if (!existsSync(join(dependencies, 'node_modules/@opentui/core/package.json'))) {
      writeFileSync(join(dependencies, 'package.json'), JSON.stringify({ private: true, dependencies: { '@opentui/core': coreVersion, entities: pkg.dependencies.entities, 'string-width': widthVersion } }, null, 2))
      await run(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', dependencies], dependencies, env, log)
    }
    if (json(join(dependencies, 'node_modules/@opentui/core/package.json')).version !== coreVersion) throw Error('OpenTUI companion differs from the exact pinned source catalog version')
    if (!existsSync(join(root, 'node_modules'))) symlinkSync(join(dependencies, 'node_modules'), join(root, 'node_modules'), 'dir')
    const module = join(root, 'src/markdown.ts')
    if (!existsSync(module)) throw Error('Pinned OpenCode lacks its documented public markdown export')
    runtimeVersion = version(bun)
    buildRecipeId += `public-source-export:opentui${coreVersion}`
    runtimeCommandId = 'bun-public-opentui:markdown-codeblock:headless-char-frame:v1'
    artifact = {
      kind: 'node',
      root,
      module,
      version: pkg.version,
      revision: pin,
      runtime: `Bun ${runtimeVersion}`,
      sourceFiles: gitSourceFiles(source, pin, ['packages/merman/src']),
      detail: `Public createMermaidCodeBlockRenderer using a real @opentui/core@${coreVersion} testing renderer. Exact source catalog dependencies; direct private prepareDiagram is never extracted. Requires Bun for source .js-to-.ts resolution and OpenTUI runtime.`,
    }
  } else if (adapter === 'grok-source') {
    const cargo = executable(process.env.AM_BENCH_CARGO ?? (existsSync('/workspace/tooling/cargo/bin/cargo') ? '/workspace/tooling/cargo/bin/cargo' : 'cargo')),
      rustc = executable(process.env.AM_BENCH_RUSTC ?? (existsSync('/workspace/tooling/cargo/bin/rustc') ? '/workspace/tooling/cargo/bin/rustc' : 'rustc')),
      scratch = join(directory, 'public-markdown-shim'),
      targetParent = env.AM_BENCH_CARGO_TARGET_ROOT ? resolve(env.AM_BENCH_CARGO_TARGET_ROOT, pin) : directory,
      output = join(binary, 'grok-markdown-mermaid')
    if (existsSync('/workspace/tooling/cargo')) env.CARGO_HOME ??= '/workspace/tooling/cargo'
    if (existsSync('/workspace/tooling/rustup')) env.RUSTUP_HOME ??= '/workspace/tooling/rustup'
    // Bind the installed default toolchain rather than letting a source-tree
    // rust-toolchain file download another compiler into this bounded cache.
    env.RUSTUP_TOOLCHAIN ??= 'stable'
    runtimeVersion = version(rustc, ['--version'], env)
    mkdirSync(targetParent, { recursive: true })
    const target = mkdtempSync(join(targetParent, 'compiler-target-'))
    env.CARGO_TARGET_DIR = target
    appendFileSync(log, `\nIsolated Cargo target: ${target}\nCargo home: ${env.CARGO_HOME ?? '(compiler default)'}\n`)
    mkdirSync(join(scratch, 'src'), { recursive: true })
    writeFileSync(join(scratch, 'Cargo.toml'), `[package]\nname="grok-markdown-mermaid"\nversion="0.0.0"\nedition="2024"\n[dependencies]\nxai-grok-markdown={path=${JSON.stringify(join(source, 'crates/codegen/xai-grok-markdown'))}}\n[profile.release]\ndebug=0\nstrip="debuginfo"\n`)
    if (existsSync(join(source, 'Cargo.lock'))) copyFileSync(join(source, 'Cargo.lock'), join(scratch, 'Cargo.lock'))
    writeFileSync(
      join(scratch, 'src/main.rs'),
      'use std::io::{self, Read};\nfn main(){let mut source=String::new();io::stdin().read_to_string(&mut source).unwrap();let markdown=format!("```mermaid\\n{}\\n```",source);let (lines,_)=xai_grok_markdown::render_markdown_ratatui(&markdown,xai_grok_markdown::MarkdownStyle::default(),true,None);for line in lines{println!("{}",line.spans.iter().map(|span|span.content.as_ref()).collect::<String>());}}\n',
    )
    try {
      await run([cargo, 'build', '--release', '--manifest-path', join(scratch, 'Cargo.toml')], scratch, env, log)
      copyFileSync(join(target, 'release/grok-markdown-mermaid'), output)
    } finally {
      rmSync(target, { recursive: true, force: true })
    }
    buildRecipeId += 'public-markdown-crate-shim'
    runtimeCommandId = 'public-markdown-ratatui:fenced-mermaid:plain-lines:v1'
    artifact = {
      kind: 'cli',
      root: directory,
      executable: output,
      args: [],
      input: 'stdin',
      format: 'terminal',
      version: `git-${pin.slice(0, 12)}`,
      revision: pin,
      runtime: `native Rust (${runtimeVersion}); public Markdown host`,
      sha256: digest(output),
      detail: 'Uses the unmodified public render_markdown_ratatui Markdown API on a Mermaid fence; direct mermaid::render is private and is not extracted. Markdown-host startup/work is included in this CLI boundary.',
    }
  } else {
    const root = adapter === 'ascii-mermaid-source' ? join(source, 'ts') : adapter === 'mermaid-source' && existsSync(join(source, 'packages/mermaid/package.json')) ? join(source, 'packages/mermaid') : source
    if (!existsSync(join(root, 'package.json'))) throw Error('Pinned source lacks the reviewed public package manifest')
    runtimeVersion = version(executable(process.env.AM_BENCH_NODE ?? 'node'))
    let module = runtimeEntry(root),
      runtimeFiles: { path: string; sha256: string }[] | undefined
    // A failed build may leave usable-looking JS before a later declaration
    // phase fails. Only tracked distributions or completed artifact manifests
    // may bypass the reviewed build on a fresh preparation attempt.
    if (!module || !existsSync(module) || !trackedEntry(source, module)) {
      if (adapter === 'mermaid-source') {
        dependencyRuntime = await mermaidBuild(source, root, resolve(cacheRoot), env, log)
        runtimeFiles = dependencyRuntime.files
        const compiler = existsSync(join(source, '.esbuild/util.ts')) ? 'upstream-langium-and-public-core-esbuild' : existsSync(join(source, '.vite/build.ts')) ? 'upstream-vite-mermaid-flag' : 'upstream-webpack-production'
        buildRecipeId += `bounded-declared-dependencies:${compiler}:immutable-runtime-bindings:v3`
      } else {
        await tsupBuild(root, resolve(cacheRoot), env, log)
        buildRecipeId += 'declared-tsup-config'
      }
      module = runtimeEntry(root)
    } else if (adapter === 'mermaid-source' || (adapter === 'beautiful-source' && /\.[cm]?tsx?$/.test(module))) {
      dependencyRuntime = await trackedMermaidRuntime(source, root, resolve(cacheRoot), env, log)
      runtimeFiles = dependencyRuntime.files
      buildRecipeId += 'tracked-public-distribution:declared-runtime-closure:immutable-runtime-bindings:v3'
    } else buildRecipeId += 'tracked-public-distribution'
    if (!module || !existsSync(module)) throw Error('Source build did not emit its declared public import entry')
    runtimeCommandId = adapter === 'ascii-mermaid-source' ? 'node-public-api:renderMermaidAscii:unicode:v1' : adapter === 'mermaid-source' ? 'browser-public-mermaid:render-and-parse:v1' : 'node-browser-public-beautiful:svg-and-unicode:v1'
    const interpreted = /\.[cm]?tsx?$/.test(module)
    if (interpreted) runtimeVersion = version(executable(process.env.AM_BENCH_BUN ?? process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun')))
    artifact = {
      kind: 'node',
      root,
      module,
      version: String(json(join(root, 'package.json')).version ?? `git-${pin.slice(0, 12)}`),
      revision: pin,
      runtime: interpreted ? `Bun ${runtimeVersion}` : runtimeVersion,
      ...(interpreted ? { sourceFiles: gitSourceFiles(source, pin, [relative(source, module), relative(source, join(root, 'src'))]), ...(runtimeFiles ? { files: runtimeFiles } : {}) } : { sha256: digest(module), files: runtimeFiles ?? filesUnder(join(root, 'dist')) }),
      detail: 'Unmodified catalog-pinned source or its tracked public distribution; acquisition.log retains the concrete public build commands. This is a source artifact, not an npm registry release.',
    }
  }
  // Public protocol admission is preparation, never a benchmark sample. A
  // successful build alone cannot authorize same-HEAD runtime evidence reuse.
  const sourceWitness = 'flowchart TD\nA[Start] --> B[End]',
    witnessPath = join(directory, 'admission-input.mmd')
  writeFileSync(witnessPath, sourceWitness)
  let admission: { stdout: string; stderr: string }
  if (artifact.kind === 'cli') {
    const args = artifact.args!.map(arg => arg.replaceAll('{input}', witnessPath))
    admission = await capture([artifact.executable!, ...args], directory, env, artifact.input === 'file' ? undefined : sourceWitness)
    const qualified = qualifyOutput({ id: 'source-protocol-admission', family: 'flowchart', source: sourceWitness, expectedLabels: ['Start', 'End'], features: [], provenance: 'independently authored protocol admission stimulus' }, admission.stdout, 'terminal')
    if (!qualified.ok) throw Error('Public CLI protocol admission failed: ' + qualified.findings.join('; '))
  } else if (adapter === 'mermaid-source') {
    admission = { stdout: '', stderr: 'Functional public SVG/parser admission deferred to the real browser cohort; Node import/jsdom rendering is not required or substituted.' }
  } else if (adapter === 'opencode-source') {
    const script = `import{createRequire}from'node:module';import{pathToFileURL}from'node:url';const req=createRequire(${JSON.stringify(join(artifact.root!, 'package.json'))});const{createTestRenderer}=await import(pathToFileURL(req.resolve('@opentui/core/testing')).href);const api=await import(${JSON.stringify(pathToFileURL(artifact.module!).href)});const host=await createTestRenderer({width:120,height:200});try{const render=api.createMermaidCodeBlockRenderer(host.renderer);const diagram=render({type:'code',lang:'mermaid',text:${JSON.stringify(sourceWitness)}},{defaultRender:()=>undefined});if(!diagram)throw Error('Public fenced-Mermaid renderer declined the admission witness');host.renderer.root.add(diagram);await host.renderOnce();process.stdout.write(host.captureCharFrame());}finally{host.renderer.destroy();}`
    admission = await capture([executable(process.env.AM_BENCH_BUN ?? process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun')), '-e', script], artifact.root!, env)
    const qualified = qualifyOutput({ id: 'source-protocol-admission', family: 'flowchart', source: sourceWitness, expectedLabels: ['Start', 'End'], features: [], provenance: 'independently authored real public OpenTUI host stimulus' }, admission.stdout, 'terminal')
    if (!qualified.ok) throw Error('Public OpenTUI host protocol admission failed: ' + qualified.findings.join('; '))
  } else {
    const names = adapter === 'ascii-mermaid-source' ? ['renderMermaidAscii'] : ['renderMermaidSVG', 'renderMermaidSync', 'renderMermaid'],
      script = `const m=await import(${JSON.stringify(pathToFileURL(artifact.module!).href)});const a=m.default&&typeof m.default==='object'?{...m.default,...m}:m;const names=${JSON.stringify(names)};const name=names.find(name=>typeof a[name]==='function');if(!name)throw Error('Declared public renderer absent: '+names.join(', '));const v=await a[name](${JSON.stringify(sourceWitness)});process.stdout.write(typeof v==='string'?v:JSON.stringify(v)??'');`
    admission = await capture(artifact.sourceFiles?.length ? [executable(process.env.AM_BENCH_BUN ?? process.env.BUN_BIN ?? (process.versions.bun ? process.execPath : 'bun')), '-e', script] : [executable(process.env.AM_BENCH_NODE ?? 'node'), '--input-type=module', '-e', script], artifact.root!, env)
    const qualified = qualifyOutput({ id: 'source-protocol-admission', family: 'flowchart', source: sourceWitness, expectedLabels: ['Start', 'End'], features: [], provenance: 'independently authored public API admission stimulus' }, admission.stdout, adapter === 'ascii-mermaid-source' ? 'terminal' : 'svg')
    if (!qualified.ok) throw Error('Public Node API protocol admission failed: ' + qualified.findings.join('; '))
  }
  writeFileSync(
    join(directory, 'protocol-admission.json'),
    JSON.stringify({ node: node.id, revision: pin, apiAdmission: adapter === 'mermaid-source' ? 'deferred-browser' : 'public-protocol', buildRecipeId, runtimeCommandId, runtimeVersion, stimulus: sourceWitness, stdout: admission.stdout, stderr: admission.stderr }, null, 2),
  )
  const dependencyPatchPaths = adapter === 'mermaid-source' ? (Object.values(json(join(source, 'package.json')).pnpm?.patchedDependencies ?? {}) as string[]) : [],
    result: ExtraSourceArtifact = {
      ...artifact,
      sourceRevision: pin,
      acquisitionOrigin: execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: source, encoding: 'utf8' }).trim(),
      buildRecipeId,
      runtimeCommandId,
      runtimeVersion,
      reviewed: true,
      artifactClass: artifact.sourceFiles?.length ? 'git-interpreted-source' : 'compiled-or-shipped',
      apiAdmission: adapter === 'mermaid-source' ? 'deferred-browser' : 'public-protocol',
      ...(dependencyRuntime ? { runtimeDependencyRoots: dependencyRuntime.packageRoots, buildDependencyPrefix: dependencyRuntime.dependencyPrefix } : {}),
      ...(dependencyPatchPaths.length ? { dependencyPatches: gitSourceFiles(source, pin, dependencyPatchPaths) } : {}),
      ...(adapter === 'mermaidtext-go' || adapter === 'grok-source' ? { supportedFamilies: ['flowchart', 'state', 'class', 'er', 'sequence'], sourceFallback: 'framed-source' as const } : {}),
      detail: `${artifact.detail ?? ''}${artifact.detail ? '; ' : ''}${adapter === 'mermaid-source' ? 'Build-byte and public browser export binding admitted; functional SVG admission remains deferred-browser.' : 'Public protocol admission completed outside clocks.'} Exact source revision ${pin}.`,
    }
  writeFileSync(manifest, JSON.stringify(result, null, 2))
  // Only our isolated Cargo target above is removed. Shared stores, published
  // artifacts, sources and toolchains are never cleaned by this adapter.
  return result
}
