// Ensures the Cloudflare site bundle and generated Worker inputs exist before
// the tests that read them.
//
// website/public/ and website/src/generated/ are build artifacts (gitignored,
// rebuilt at deploy). Build them once in a separate process so coverage
// instrumentation never touches generation.
//
// Liveness is tracked by a source fingerprint sentinel written only AFTER a
// fully successful build across a stable input snapshot.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acquireWebsiteBuildLock, computeWebsiteBuildFingerprint, runStableFingerprintBuild } from '../../scripts/site/website-build-fingerprint.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUT = join(ROOT, 'website', 'public')
const GENERATED = join(ROOT, 'website', 'src', 'generated')
const SENTINEL = join(OUT, '.preload-built')
const LOCK = join(ROOT, '.website-preload-build.lock')
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

ensureBuilt()

function ensureBuilt(): void {
  const fingerprint = buildFingerprint()
  if (readSentinel() === fingerprint) return

  mkdirSync(OUT, { recursive: true })
  const acquired = acquireWebsiteBuildLock({
    fingerprint: buildFingerprint,
    readSentinel,
    tryAcquire() {
      try { mkdirSync(LOCK, { recursive: false }); return true }
      catch { return false }
    },
    sleep: () => sleepSync(100),
  })
  if (!acquired) return
  try {
    const latest = buildFingerprint()
    if (readSentinel() === latest) return
    runStableFingerprintBuild({
      fingerprint: buildFingerprint,
      build() {
        const result = Bun.spawnSync(['bun', 'run', 'website/build.ts'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
        if (result.exitCode !== 0) throw new Error('website and Worker artifact build (test preload) failed')
      },
      reset() {
        rmSync(OUT, { recursive: true, force: true })
        rmSync(GENERATED, { recursive: true, force: true })
      },
      commit(stableFingerprint) { writeFileSync(SENTINEL, stableFingerprint) },
    })
  } finally {
    rmSync(LOCK, { recursive: true, force: true })
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function readSentinel(): string | null {
  if (!existsSync(SENTINEL) || GENERATED_FILES.some(file => !existsSync(join(GENERATED, file)))) return null
  return readFileSync(SENTINEL, 'utf8')
}

function buildFingerprint(): string {
  return computeWebsiteBuildFingerprint(ROOT)
}
