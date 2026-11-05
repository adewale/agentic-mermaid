#!/usr/bin/env bun
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { BROWSER_CONTRACT_FILES } from './browser-contract-files.ts'

const root = resolve(import.meta.dir, '..')
const { values } = parseArgs({ options: { shard: { type: 'string' } }, strict: true })
let contracts = BROWSER_CONTRACT_FILES
if (values.shard !== undefined) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(values.shard)
  const index = Number(match?.[1])
  const total = Number(match?.[2])
  if (!match || index > total || total > contracts.length) throw new Error('Expected --shard=N/M with 1 <= N <= M <= browser contract count')
  contracts = contracts.slice(Math.floor((index - 1) * contracts.length / total), Math.floor(index * contracts.length / total))
  if (contracts.length === 0) throw new Error('Browser shard contains no contracts')
}

async function run(
  command: string[],
  options: { cwd: string; env?: Record<string, string | undefined>; requireTests?: boolean },
): Promise<void> {
  console.log(`$ ${command.join(' ')}`)
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  if (exitCode !== 0) throw new Error(`Command exited ${exitCode}: ${command.join(' ')}`)
  if (options.requireTests) {
    const counts = [...`${stdout}\n${stderr}`.matchAll(/(?:^|\n)\s*(\d+) pass(?:\s|$)/g)]
    const passed = counts.reduce((total, match) => total + Number(match[1]), 0)
    if (passed === 0) throw new Error(`Browser contract executed zero passing tests: ${command.join(' ')}`)
  }
}

if (process.env.AM_CI_ARTIFACTS === '1') {
  for (const path of ['website/public/index.html', 'dist/browser.global.js']) {
    if (!existsSync(resolve(root, path))) throw new Error(`Transferred browser artifact is missing: ${path}`)
  }
} else {
  await run(['bun', 'run', 'website'], { cwd: root })
}
for (const contract of contracts) {
  await run(['bun', 'test', contract.file, '--timeout', '600000'], {
    cwd: import.meta.dir,
    env: contract.browserOptIn ? { AM_BROWSER_TESTS: '1' } : undefined,
    requireTests: true,
  })
}
