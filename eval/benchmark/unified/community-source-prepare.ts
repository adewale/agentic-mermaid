import '../ci-policy-enforce.ts'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statfsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface CommunitySourceNode {
  id: string
  repo?: string
  head?: string
  release?: { tag?: string; commit?: string }
}
export interface CommunitySourceArtifact {
  kind: 'cli'
  executable: string
  args: string[]
  input: 'stdin' | 'file'
  format: 'svg' | 'terminal'
  version: string
  revision: string
  sha256: string
  sourceRoot: string
  buildCommand: string[]
  boundary: 'cold-public-cli'
  defaults: string
}

interface Adapter {
  runtime: 'go' | 'rust'
  binary: string
  package?: string
  args: string[]
  format: CommunitySourceArtifact['format']
  defaults: string
}

const adapters: Record<string, Adapter> = {
  'AlexanderGrooff/mermaid-ascii': { runtime: 'go', binary: 'mermaid-ascii', args: [], format: 'terminal', defaults: 'Public CLI stdin with default Unicode diagram output, non-TTY color policy.' },
  'pgavlin/mermaid-ascii': { runtime: 'go', binary: 'mermaid-ascii', args: [], format: 'terminal', defaults: 'Public CLI stdin, default Unicode geometry; no terminal/TTY color.' },
  '1jehuang/mermaid-rs-renderer': { runtime: 'rust', binary: 'mmdr', args: ['-i', '-', '-e', 'svg'], format: 'svg', defaults: 'Public CLI SVG output with package default features, default font metrics/cache. Font/file caches are shared OS state, not cold-filesystem claims.' },
  'kingsword09/mermansi': {
    runtime: 'rust',
    binary: 'mermansi',
    args: ['--concise', '--no-color'],
    format: 'terminal',
    defaults: 'Public CLI explicit concise Unicode diagram output with color disabled. Default complete output includes a canonical JSON model and is a separate unmeasured presentation; JSON text is excluded from diagram-label qualification.',
  },
  'Mootikins/figurehead-rs': {
    runtime: 'rust',
    binary: 'figurehead',
    package: 'figurehead-cli',
    args: ['--log-level', 'error', 'convert', '--style', 'unicode', '--color', 'never', '-i', '-', '-o', '-'],
    format: 'terminal',
    defaults: 'Public CLI Unicode output; error-level logging keeps progress messages out of rendered text, stderr retained separately.',
  },
}

/** Bind a prepared CLI to the reviewed diagram-only presentation. Artifact
 * digests/revisions identify executable bytes; they do not validate its flags. */
export function reviewedCommunitySourcePresentation(node: CommunitySourceNode): Pick<CommunitySourceArtifact, 'args' | 'input' | 'format' | 'defaults'> {
  const adapter = adapters[node.id]
  if (!adapter) throw new Error(`No reviewed source CLI adapter for ${node.id}`)
  return { args: [...adapter.args], input: 'stdin', format: adapter.format, defaults: adapter.defaults }
}

export interface CommunityAcquisitionResources {
  minFreeBytes?: number
  storageRoots?: readonly string[]
}
function run(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv, log: string, timeoutMs = 20 * 60_000, resources: CommunityAcquisitionResources = {}): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const available = (): { path: string; bytes: number } => {
      const roots = [...new Set([cwd, ...(resources.storageRoots ?? [])])]
      return roots
        .map(path => {
          const space = statfsSync(path)
          return { path, bytes: space.bavail * space.bsize }
        })
        .reduce((least, next) => (next.bytes < least.bytes ? next : least))
    }
    const initial = available()
    if (resources.minFreeBytes && initial.bytes < resources.minFreeBytes) {
      reject(new Error(`Resource guard: acquisition requires ${resources.minFreeBytes} free bytes at ${initial.path} before spawning ${command[0]}`))
      return
    }
    const file = createWriteStream(log, { flags: 'a' })
    file.write(`\n$ ${command.join(' ')}\n`)
    const group = process.platform !== 'win32',
      child = spawn(command[0]!, command.slice(1), { cwd, env, detached: group, stdio: ['ignore', 'pipe', 'pipe'] })
    let tail = '',
      aborted: string | undefined
    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (group && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {}
    }
    const abort = (reason: string): void => {
      if (aborted) return
      aborted = reason
      file.write(`\n${reason}\n`)
      kill('SIGTERM')
      setTimeout(() => kill('SIGKILL'), 250).unref()
    }
    const append = (chunk: Buffer): void => {
      file.write(chunk)
      tail = (tail + String(chunk)).slice(-6000)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', append)
    const timer = setTimeout(() => abort(`Acquisition timeout after ${timeoutMs} ms`), timeoutMs),
      storage = resources.minFreeBytes
        ? setInterval(() => {
            try {
              const space = available()
              if (space.bytes < resources.minFreeBytes!) abort(`Resource guard: available storage ${space.bytes} bytes at ${space.path} fell below ${resources.minFreeBytes} bytes during ${command[0]}`)
            } catch (error) {
              abort(`Resource guard could not inspect acquisition storage: ${String(error)}`)
            }
          }, 500)
        : undefined
    child.on('error', error => {
      clearTimeout(timer)
      if (storage) clearInterval(storage)
      file.end()
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (storage) clearInterval(storage)
      file.end()
      if (code === 0 && !aborted) resolveRun()
      else if (aborted) reject(new Error(`${aborted}; ${log}\n${tail}`))
      else reject(new Error(`${command[0]} failed (${code ?? signal}); ${log}\n${tail}`))
    })
  })
}

/** Build an exact reviewed source revision before any timing campaign. The
 * returned boundary is deliberately CLI: process startup must not be compared
 * as though it were an in-process Rust/Go API measurement. */
export async function prepareCommunitySource(node: CommunitySourceNode, cacheRoot: string): Promise<CommunitySourceArtifact> {
  const adapter = adapters[node.id]
  if (!adapter) throw new Error(`No reviewed source CLI adapter for ${node.id}`)
  const revision = node.release?.commit ?? node.head
  if (!revision || !/^[a-f0-9]{40}$/.test(revision)) throw new Error(`${node.id}: a full immutable Git revision is required`)
  if (node.repo && node.repo !== `https://github.com/${node.id}`) throw new Error(`${node.id}: source URL does not match reviewed GitHub identity`)
  const cache = resolve(cacheRoot),
    directory = resolve(cache, node.id.replaceAll('/', '--') + '@' + revision),
    sourceRoot = resolve(directory, 'source'),
    bin = resolve(directory, 'bin')
  mkdirSync(bin, { recursive: true })
  const manifest = resolve(directory, 'artifact.json'),
    log = resolve(directory, 'acquisition.log')
  if (existsSync(manifest)) {
    const previous = JSON.parse(readFileSync(manifest, 'utf8')) as CommunitySourceArtifact
    if (previous.revision === revision && existsSync(previous.executable) && createHash('sha256').update(readFileSync(previous.executable)).digest('hex') === previous.sha256) {
      const current = { ...previous, ...reviewedCommunitySourcePresentation(node) }
      writeFileSync(manifest, JSON.stringify(current, null, 2) + '\n')
      return current
    }
  }
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb' }
  if (existsSync('/workspace/tooling/cargo')) env.CARGO_HOME ??= '/workspace/tooling/cargo'
  if (existsSync('/workspace/tooling/rustup')) env.RUSTUP_HOME ??= '/workspace/tooling/rustup'
  env.CARGO_BUILD_JOBS ??= '2'
  env.CARGO_TARGET_DIR = resolve(cache, '.cargo-target')
  env.GOCACHE ??= resolve(cache, '.go-build')
  env.GOPATH ??= resolve(cache, '.go')
  mkdirSync(sourceRoot, { recursive: true })
  if (!existsSync(resolve(sourceRoot, '.git'))) {
    await run(['git', 'init', '--quiet'], sourceRoot, env, log)
    await run(['git', 'remote', 'add', 'origin', `https://github.com/${node.id}.git`], sourceRoot, env, log)
  }
  await run(['git', 'fetch', '--depth', '1', 'origin', revision], sourceRoot, env, log)
  await run(['git', 'checkout', '--detach', '--force', revision], sourceRoot, env, log)
  const executable = resolve(bin, adapter.binary)
  let buildCommand: string[]
  if (adapter.runtime === 'go') {
    const go = process.env.AM_BENCH_GO ?? (existsSync('/workspace/tooling/go-community/go/bin/go') ? '/workspace/tooling/go-community/go/bin/go' : 'go')
    buildCommand = [go, 'build', '-trimpath', '-o', executable, '.']
    await run(buildCommand, sourceRoot, env, log)
  } else {
    const cargo = process.env.AM_BENCH_CARGO ?? (existsSync('/workspace/tooling/cargo/bin/cargo') ? '/workspace/tooling/cargo/bin/cargo' : 'cargo')
    buildCommand = [cargo, 'build', '--release', ...(existsSync(resolve(sourceRoot, 'Cargo.lock')) ? ['--locked'] : []), ...(adapter.package ? ['--package', adapter.package] : []), '--bin', adapter.binary]
    await run(buildCommand, sourceRoot, env, log)
    const bytes = readFileSync(resolve(env.CARGO_TARGET_DIR!, 'release', adapter.binary))
    writeFileSync(executable, bytes, { mode: 0o700 })
  }
  const artifact: CommunitySourceArtifact = {
    kind: 'cli',
    executable,
    ...reviewedCommunitySourcePresentation(node),
    version: node.release?.tag ?? `git-${revision.slice(0, 12)}`,
    revision,
    sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
    sourceRoot,
    buildCommand,
    boundary: 'cold-public-cli',
  }
  writeFileSync(manifest, JSON.stringify(artifact, null, 2) + '\n')
  return artifact
}

/** Shared acquisition subprocess helper; never used as a render timing clock. */
export { run as runCommunityAcquisitionCommand }
