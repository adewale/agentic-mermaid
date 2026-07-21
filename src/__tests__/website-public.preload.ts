// Ensures the Cloudflare site bundle and generated Worker inputs exist before
// the tests that read them.
//
// website/public/ is a build artifact (gitignored, rebuilt at deploy by
// .github/workflows/deploy-cloudflare.yml). On a fresh checkout it is absent,
// so several tests (website-build, editor-*-switch, website-browser-a11y,
// agent-doc-sync) would fail reading it. Build it once here, in a separate
// process so the unit run's coverage instrumentation never touches the build.
//
// Liveness is tracked by a source fingerprint sentinel written only AFTER a
// fully successful build. index.html is emitted early in the build, so it is
// not a reliable marker — a crashed or killed build would leave it behind and
// the next run would skip the rebuild and test a half-built bundle. On failure
// the partial output is removed so the next run rebuilds from scratch.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const OUT = join(ROOT, 'website', 'public')
const GENERATED = join(ROOT, 'website', 'src', 'generated')
const SENTINEL = join(OUT, '.preload-built')
const LOCK = join(OUT, '.preload-build.lock')
const GENERATED_FILES = [
  'ArchitectsDaughter.ttf',
  'Caveat.ttf',
  'DejaVuSans-Bold.ttf',
  'DejaVuSans.ttf',
  'EBGaramond.ttf',
  'Inter-Bold.ttf',
  'Inter-Medium.ttf',
  'Inter-Regular.ttf',
  'Inter-SemiBold.ttf',
  'ShareTechMono.ttf',
  'deploy-version.ts',
  'execute-harness.js.txt',
  'resvg.wasm',
] as const
const FINGERPRINT_PATHS = [
  'website/build.ts',
  'website/source',
  'website/src',
  'public',
  'docs/schemas/style-spec.schema.json',
  'docs/assets/style-cookbook',
  'examples/styles',
  'skills/agentic-mermaid-diagram-workflow',
  'Instructions_for_agents.md',
  'editor/examples.ts',
  'editor/js',
  'scripts/site/example-render-state.ts',
  'scripts/site/editor-state-url.ts',
  'scripts/site/samples-data.ts',
  'src',
  'eval/agent-usage/homepage-prompt.ts',
  'assets/fonts',
  'package.json',
  'bun.lock',
]

ensureBuilt()

function ensureBuilt(): void {
  const fingerprint = buildFingerprint()
  if (readSentinel() === fingerprint) return

  mkdirSync(OUT, { recursive: true })
  const acquired = acquireLock(fingerprint)
  if (!acquired) return
  try {
    const latest = buildFingerprint()
    if (readSentinel() === latest) return
    const r = Bun.spawnSync(['bun', 'run', 'website/build.ts'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
    if (r.exitCode !== 0) {
      rmSync(OUT, { recursive: true, force: true })
      rmSync(GENERATED, { recursive: true, force: true })
      throw new Error('website and Worker artifact build (test preload) failed')
    }
    writeFileSync(SENTINEL, buildFingerprint())
  } finally {
    rmSync(LOCK, { recursive: true, force: true })
  }
}

function acquireLock(fingerprint: string): boolean {
  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      mkdirSync(LOCK, { recursive: false })
      return true
    } catch {
      if (readSentinel() === fingerprint) return false
      sleepSync(100)
    }
  }
  throw new Error('Timed out waiting for website/public build preload lock')
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readSentinel(): string | null {
  if (!existsSync(SENTINEL) || GENERATED_FILES.some(file => !existsSync(join(GENERATED, file)))) return null
  return readFileSync(SENTINEL, 'utf8')
}

function buildFingerprint(): string {
  const hash = createHash('sha256')
  // Generated provenance changes when identical source bytes move from dirty
  // to committed, or when HEAD advances without touching a website input.
  for (const args of [['rev-parse', 'HEAD'], ['status', '--porcelain=v1', '--untracked-files=normal']]) {
    try { hash.update(execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })) } catch { hash.update('git-unavailable') }
    hash.update('\0')
  }
  for (const rel of FINGERPRINT_PATHS) {
    addPathToHash(hash, join(ROOT, rel), rel)
  }
  return hash.digest('hex')
}

function addPathToHash(hash: ReturnType<typeof createHash>, abs: string, rel: string): void {
  hash.update(rel)
  hash.update('\0')
  if (!existsSync(abs)) {
    hash.update('missing')
    hash.update('\0')
    return
  }
  const stat = statSync(abs)
  if (stat.isDirectory()) {
    hash.update('dir')
    hash.update('\0')
    for (const name of readdirSync(abs).sort()) {
      if (rel === 'website' && name === 'public') continue
      if (rel === 'website/src' && name === 'generated') continue
      if (rel === 'src' && name === '__tests__') continue
      addPathToHash(hash, join(abs, name), `${rel}/${name}`)
    }
    return
  }
  hash.update('file')
  hash.update('\0')
  hash.update(readFileSync(abs))
  hash.update('\0')
}
