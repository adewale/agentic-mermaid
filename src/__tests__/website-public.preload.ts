// Ensures the Cloudflare site bundle exists before the tests that read it.
//
// website/public/ is a build artifact (gitignored, rebuilt at deploy by
// .github/workflows/deploy-cloudflare.yml). On a fresh checkout it is absent,
// so several tests (website-build, editor-*-switch, website-browser-a11y,
// agent-doc-sync) would fail reading it. Build it once here, in a separate
// process so the unit run's coverage instrumentation never touches the build.
//
// Liveness is tracked by a sentinel written only AFTER a fully successful build.
// index.html is emitted early in the build, so it is not a reliable marker — a
// crashed or killed build would leave it behind and the next run would skip the
// rebuild and test a half-built bundle. On failure the partial output is removed
// so the next run rebuilds from scratch.
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const OUT = join(ROOT, 'website', 'public')
const SENTINEL = join(OUT, '.preload-built')

if (!existsSync(SENTINEL)) {
  const r = Bun.spawnSync(['bun', 'run', 'website/build.ts'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
  if (r.exitCode !== 0) {
    rmSync(OUT, { recursive: true, force: true })
    throw new Error('website/public build (test preload) failed')
  }
  writeFileSync(SENTINEL, '')
}
