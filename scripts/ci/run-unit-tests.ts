import { resolve } from 'node:path'
import { assertWebsiteFixture, prepareWebsiteFixture } from '../site/prepare-website-fixture.ts'
import { unitTestFiles } from './unit-test-files.ts'

const root = resolve(import.meta.dir, '../..')
const args = process.argv.slice(2)
if (args[0] === '--') args.shift()

if (args.includes('--help') || args.includes('-h')) {
  const help = Bun.spawn([process.execPath, 'test', ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
  process.exit(await help.exited)
}

if (process.env.AM_WEBSITE_FIXTURE_ROOT === root) assertWebsiteFixture(root)
else prepareWebsiteFixture(root)

const child = Bun.spawn([process.execPath, 'test', '--timeout', '30000', ...unitTestFiles(), ...args], {
  cwd: root,
  env: { ...process.env, AM_WEBSITE_FIXTURE_ROOT: root },
  stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
})
process.exit(await child.exited)
