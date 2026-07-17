#!/usr/bin/env bun
import { resolve } from 'node:path'
import { BROWSER_CONTRACT_FILES } from './browser-contract-files.ts'

const root = resolve(import.meta.dir, '..')

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

await run(['bun', 'run', 'website'], { cwd: root })
for (const contract of BROWSER_CONTRACT_FILES) {
  await run(['bun', 'test', contract.file, '--timeout', '600000'], {
    cwd: import.meta.dir,
    env: contract.browserOptIn ? { AM_BROWSER_TESTS: '1' } : undefined,
    requireTests: true,
  })
}
