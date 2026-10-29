import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectBuiltCheckout } from '../source-checkout.ts'

test('endpoint admission distinguishes a clean built checkout from package directories and changed source', () => {
  const root = mkdtempSync(join(tmpdir(), 'endpoint-checkout-'))
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
      .toString()
      .trim()
  try {
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'src/input.ts'), 'export const version = 1\n')
    writeFileSync(join(root, 'package.json'), '{"type":"module"}')
    writeFileSync(join(root, 'bun.lock'), '{}')
    writeFileSync(join(root, 'dist/agent.js'), 'export const built = true\n')
    git('init', '-q')
    git('add', 'src', 'package.json', 'bun.lock')
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture')
    expect(inspectBuiltCheckout(root)).toEqual({ root, revision: git('rev-parse', 'HEAD') })
    const nested = join(root, 'package')
    mkdirSync(nested)
    expect(() => inspectBuiltCheckout(nested)).toThrow('checkout root')
    writeFileSync(join(root, 'src/input.ts'), 'export const version = 2\n')
    expect(() => inspectBuiltCheckout(root)).toThrow('dirty')
    git('checkout', '--', 'src/input.ts')
    rmSync(join(root, 'dist/agent.js'))
    expect(() => inspectBuiltCheckout(root)).toThrow('Built public agent entry missing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
