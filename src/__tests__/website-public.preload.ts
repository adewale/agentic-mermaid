// Ensures the Cloudflare site bundle exists before the tests that read it.
//
// website/public/ is a build artifact (gitignored, rebuilt at deploy by
// .github/workflows/deploy-cloudflare.yml). On a fresh checkout it is absent,
// so several tests (website-build, editor-*-switch, website-browser-a11y,
// agent-doc-sync) would fail reading it. Build it once here, in a separate
// process so the unit run's coverage instrumentation never touches the build.
// Skipped when the bundle already exists (the common local case), so it only
// costs a build on a clean tree or in CI.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
if (!existsSync(join(ROOT, 'website', 'public', 'index.html'))) {
  const r = Bun.spawnSync(['bun', 'run', 'website/build.ts'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
  if (r.exitCode !== 0) throw new Error('website/public build (test preload) failed')
}
