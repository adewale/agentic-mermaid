import '../ci-policy-enforce.ts'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCommunityAcquisitionCommand as run } from './community-source-prepare.ts'
import type { CommunityArtifact, CommunityNode } from './community-types.ts'

const here = dirname(fileURLToPath(import.meta.url)),
  driver = resolve(here, '../../..')
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const artifactFiles = (paths: string[]): NonNullable<CommunityArtifact['files']> => paths.map(path => ({ path, sha256: digest(readFileSync(path)) }))
const safe = (id: string): string => id.replaceAll('/', '--')
const headers = { 'user-agent': 'Agentic-Mermaid-community-benchmark/1.0' }

async function json(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(45_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return (await response.json()) as Record<string, unknown>
}
async function download(url: string, destination: string, sha256?: string): Promise<void> {
  if (existsSync(destination) && (!sha256 || digest(readFileSync(destination)) === sha256)) return
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256 && digest(bytes) !== sha256) throw new Error(`Fetched artifact checksum mismatch: ${url}`)
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, bytes)
}
function verified(artifact: CommunityArtifact): boolean {
  const entry = artifact.module ?? artifact.executable ?? artifact.python
  if (!entry || !existsSync(entry)) return false
  if (artifact.sha256 && digest(readFileSync(entry)) !== artifact.sha256) return false
  return (artifact.files ?? []).every(file => existsSync(file.path) && digest(readFileSync(file.path)) === file.sha256)
}
function environment(cache: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, XDG_CONFIG_HOME: join(cache, '.config'), XDG_CACHE_HOME: join(cache, '.cache'), PUB_CACHE: join(cache, 'pub-cache') }
  if (existsSync('/workspace/tooling/cargo')) env.CARGO_HOME ??= '/workspace/tooling/cargo'
  if (existsSync('/workspace/tooling/rustup')) env.RUSTUP_HOME ??= '/workspace/tooling/rustup'
  env.CARGO_BUILD_JOBS ??= '2'
  env.PATH = [process.env.AM_BENCH_TOOL_BIN, existsSync('/workspace/tooling/bin') ? '/workspace/tooling/bin' : undefined, existsSync('/workspace/tooling/cargo/bin') ? '/workspace/tooling/cargo/bin' : undefined, process.env.PATH].filter(Boolean).join(':')
  return env
}

/** Portable artifact acquisition. An explicitly supplied immutable compiled
 * manifest can bypass toolchain work, but must match the resolved version and
 * every shipped/fetched file digest. Timings are always rerun separately. */
export async function prepareCommunityArtifact(node: CommunityNode, cacheRoot: string, providedManifest?: string): Promise<CommunityArtifact> {
  const adapter = node.benchmark?.adapter,
    recorded = process.env.AM_COMMUNITY_VERSION_POLICY === 'recorded'
  const cache = resolve(cacheRoot)
  mkdirSync(cache, { recursive: true })
  let version: string | undefined, metadata: Record<string, unknown> | undefined
  if (adapter === 'dart') {
    const declared = node.packages?.find(pkg => pkg.registry === 'pub.dev' && pkg.name === 'mermaid_core')?.version
    metadata = await json('https://pub.dev/api/packages/mermaid_core')
    version = recorded ? declared : (metadata.latest as { version?: string } | undefined)?.version
  } else if (adapter === 'bezel') {
    const declared = node.packages?.find(pkg => pkg.registry === 'crates.io' && pkg.name === 'bezel-mermaid')?.version
    metadata = await json('https://crates.io/api/v1/crates/bezel-mermaid')
    version = recorded ? declared : (metadata.crate as { newest_version?: string } | undefined)?.newest_version
  } else if (adapter === 'termaid') {
    const declared = node.packages?.find(pkg => pkg.registry === 'pypi' && pkg.name === 'termaid')?.version
    metadata = await json('https://pypi.org/pypi/termaid/json')
    version = recorded ? declared : (metadata.info as { version?: string } | undefined)?.version
  } else if (adapter === 'franken') version = node.distribution?.version
  else throw new Error(`No reviewed compiled artifact adapter for ${node.id}`)
  if (!version) throw new Error(`${node.id}: missing exact artifact version`)
  const directory = join(cache, `${safe(node.id)}@${version}`),
    manifest = join(directory, 'artifact.json'),
    log = join(directory, 'acquisition.log')
  mkdirSync(directory, { recursive: true })
  if (metadata) writeFileSync(join(directory, 'registry-observation.json'), JSON.stringify({ checkedAt: new Date().toISOString(), policy: recorded ? 'recorded' : 'latest', metadata }, null, 2) + '\n')
  const provided = providedManifest ?? process.env.AM_BENCH_COMMUNITY_ARTIFACTS
  if (provided) {
    const artifact = (JSON.parse(readFileSync(provided, 'utf8')) as Record<string, CommunityArtifact>)[node.id]
    if (artifact?.version === version && verified(artifact)) {
      writeFileSync(manifest, JSON.stringify(artifact, null, 2) + '\n')
      return artifact
    }
  }
  if (existsSync(manifest)) {
    const artifact = JSON.parse(readFileSync(manifest, 'utf8')) as CommunityArtifact
    if (artifact.version === version && verified(artifact)) return artifact
  }
  const env = environment(cache)
  let artifact: CommunityArtifact
  if (adapter === 'franken') {
    const revision = node.distribution?.revision
    if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error('Franken requires a full immutable distribution revision')
    const path = (node.distribution?.path ?? 'pkg/').replace(/\/$/, ''),
      prefix = `https://raw.githubusercontent.com/${node.id}/${revision}/${path}`
    const root = join(directory, 'pkg')
    mkdirSync(root, { recursive: true })
    await download(`${prefix}/package.json`, join(root, 'package.json'))
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; main: string; files: string[] }
    if (pkg.version !== version || !Array.isArray(pkg.files)) throw new Error('Franken distribution package identity mismatch')
    const names = [...new Set(['package.json', pkg.main, ...pkg.files])]
    for (const name of names) {
      if (name.includes('..') || name.startsWith('/') || name.endsWith('/')) throw new Error(`Unsafe Franken distribution path ${name}`)
      await download(`${prefix}/${name}`, join(root, name), name.endsWith('_bg.wasm') ? node.distribution?.wasmSha256 : undefined)
    }
    const module = join(root, pkg.main),
      wasm = join(root, names.find(name => name.endsWith('_bg.wasm')) ?? '')
    if (!existsSync(wasm)) throw new Error('Franken package has no WASM binary')
    artifact = {
      kind: 'franken',
      root,
      module,
      wasm,
      version,
      revision,
      sha256: digest(readFileSync(module)),
      files: artifactFiles(names.map(name => join(root, name))),
      runtime: 'Rust/WASM public Node/browser distribution',
      detail: 'Pinned checked-in distribution, not current native source or live-site deployment. Terminal output is not exported by this WASM API.',
    }
  } else if (adapter === 'dart') {
    const dart = process.env.AM_BENCH_DART ?? 'dart',
      root = join(directory, 'package')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'pubspec.yaml'), `name: agentic_mermaid_community_dart_benchmark\nenvironment:\n  sdk: '>=3.12.0 <4.0.0'\ndependencies:\n  mermaid_core: '${version}'\n`)
    copyFileSync(join(here, 'dart-wrapper.dart'), join(root, 'benchmark_wrapper.dart'))
    await run([dart, '--suppress-analytics', 'pub', 'get'], root, env, log)
    const module = join(root, 'dart.js')
    await run([dart, '--suppress-analytics', 'compile', 'js', '-O2', '-o', module, join(root, 'benchmark_wrapper.dart')], root, env, log)
    await run([dart, '--version'], root, env, log)
    artifact = {
      kind: 'global',
      root,
      module,
      global: 'mermaidDartRender',
      version,
      sha256: digest(readFileSync(module)),
      files: artifactFiles([module]),
      runtime: 'Dart dart2js -O2 on Node/browser',
      detail: 'Unmodified mermaid_core public Mermaid(ApproximateTextMeasurer) → renderSceneToSvg; native Flutter and PNG runtime are separate unmeasured surfaces. Compiler/dependency commands and versions are in acquisition.log/pubspec.lock.',
    }
  } else if (adapter === 'bezel') {
    const info = await json(`https://crates.io/api/v1/crates/bezel-mermaid/${version}`),
      release = info.version as { checksum: string; dl_path: string }
    if (!release?.checksum) throw new Error('Crates.io omitted archive checksum')
    const archive = join(directory, `bezel-mermaid-${version}.crate`)
    await download(`https://crates.io${release.dl_path}`, archive, release.checksum)
    const unpacked = join(directory, 'crate')
    mkdirSync(unpacked, { recursive: true })
    await run(['tar', '-xzf', archive, '-C', unpacked], directory, env, log)
    const vcs = JSON.parse(readFileSync(join(unpacked, `bezel-mermaid-${version}`, '.cargo_vcs_info.json'), 'utf8')) as { git: { sha1: string } }
    const revision = vcs.git.sha1
    if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Published Bezel crate has no immutable VCS revision')
    const checkout = join(directory, 'source')
    mkdirSync(checkout, { recursive: true })
    if (!existsSync(join(checkout, '.git'))) {
      await run(['git', 'init', '--quiet'], checkout, env, log)
      await run(['git', 'remote', 'add', 'origin', node.repo ?? `https://github.com/${node.id}.git`], checkout, env, log)
    }
    await run(['git', 'fetch', '--depth', '1', 'origin', revision], checkout, env, log)
    await run(['git', 'checkout', '--detach', '--force', revision], checkout, env, log)
    const root = join(directory, 'wasm'),
      bindgen = process.env.AM_BENCH_WASM_BINDGEN ?? 'wasm-bindgen'
    await run([process.versions.bun ? process.execPath : (process.env.AM_BENCH_BUN ?? 'bun'), 'run', join(driver, 'eval/benchmark/bezel-wasm/build.ts'), '--checkout', checkout, '--out', root, '--wasm-bindgen', bindgen], driver, env, log)
    const module = join(root, 'bezel.js'),
      wasm = join(root, 'pkg/bezel_bench_bg.wasm')
    const built = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as { version: string; revision: string }
    if (built.version !== version || built.revision !== revision) throw new Error('Compiled Bezel wrapper identity mismatch')
    artifact = {
      kind: 'global',
      root,
      module,
      global: 'bezelRender',
      wasm,
      version,
      revision,
      sha256: digest(readFileSync(module)),
      files: artifactFiles([module, wasm, archive]),
      runtime: 'Rust/WASM public render wrapper on Node/browser',
      detail: 'Checksum-verified published crate VCS revision; public render(source, Options::default, Metrics).svg. opt-level3/LTO profile and actual Rust/wasm-bindgen versions retained in wasm/manifest.json.',
    }
  } else {
    const python = process.env.AM_BENCH_PYTHON ?? 'python3',
      venv = join(directory, 'venv'),
      executable = join(venv, 'bin/python'),
      wheels = join(directory, 'wheels')
    mkdirSync(wheels, { recursive: true })
    if (!existsSync(executable)) await run([python, '-m', 'venv', venv], directory, env, log)
    await run([executable, '-m', 'pip', 'download', '--only-binary=:all:', '--dest', wheels, `termaid==${version}`], directory, env, log)
    await run([executable, '-m', 'pip', 'install', '--no-index', '--find-links', wheels, `termaid==${version}`], directory, env, log)
    await run([executable, '-c', `import importlib.metadata; assert importlib.metadata.version('termaid') == ${JSON.stringify(version)}`], directory, env, log)
    artifact = {
      kind: 'python',
      python: executable,
      executable,
      version,
      sha256: digest(readFileSync(executable)),
      files: artifactFiles(
        readdirSync(wheels)
          .filter(name => name.endsWith('.whl'))
          .map(name => join(wheels, name)),
      ),
      runtime: 'Python public termaid.render API; process startup recorded separately',
      detail: 'Exact PyPI version in an isolated venv; every resolved dependency wheel is retained and hashed. No Python model/provider integration is implied.',
    }
  }
  writeFileSync(manifest, JSON.stringify(artifact, null, 2) + '\n')
  return artifact
}
