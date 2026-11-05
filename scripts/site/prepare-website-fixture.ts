import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { HOSTED_FONT_RESOURCES } from '../../src/font-manifest.ts'

const ROOT = resolve(import.meta.dir, '../..')

export function assertWebsiteFixture(root: string): void {
  const files = [
    'website/public/index.html',
    ...['deploy-version.ts', 'execute-harness.js.txt', 'resvg.wasm', ...HOSTED_FONT_RESOURCES.map(font => font.file)]
      .map(file => `website/src/generated/${file}`),
  ]
  const missing = files.filter(file => !existsSync(join(root, file)))
  if (missing.length) throw new Error(`Website fixture is incomplete: ${missing.join(', ')}`)
}

/** One caller owns preparation; consumers receive its checkout path explicitly. */
export function prepareWebsiteFixture(root: string, reuseLazy = false): void {
  const reset = () => {
    for (const path of ['website/public', 'website/src/generated']) rmSync(join(root, path), { recursive: true, force: true })
  }
  reset()
  try {
    const result = Bun.spawnSync([process.execPath, 'run', 'website/build.ts'], {
      cwd: root,
      env: { ...process.env, AM_CI_ARTIFACTS: reuseLazy ? '1' : '0' },
      stdout: 'inherit', stderr: 'inherit', timeout: 60_000, killSignal: 'SIGKILL',
    })
    if (!result.success) throw new Error(`Website fixture build failed: exit=${result.exitCode}, signal=${result.signalCode}`)
    assertWebsiteFixture(root)
  } catch (error) {
    reset()
    throw error
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { reuse: { type: 'boolean' }, 'reuse-lazy': { type: 'boolean' } }, strict: true })
  if (values.reuse && values['reuse-lazy']) throw new Error('Choose --reuse or --reuse-lazy')
  if (values.reuse) assertWebsiteFixture(ROOT)
  else prepareWebsiteFixture(ROOT, values['reuse-lazy'])
}
