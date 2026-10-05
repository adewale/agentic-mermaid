#!/usr/bin/env bun
// The payload delta (ci.yml, e2e browser lane) compares the PR's build with its
// base branch's build. Building both with the PR's Bun made a PR that upgrades
// Bun invisible to it: the toolchain's own effect on the payload landed on both
// sides. The base is now built with the Bun its own checkout pins
// (scripts/ci/session-start.sh PIN_BUN, which bun-version.test.ts keeps equal
// to every workflow's pin).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The Bun a checkout pins, from its SessionStart hook; undefined before the pin existed. */
export function pinnedBun(sessionStartSource: string): string | undefined {
  return /^PIN_BUN=(\d+\.\d+\.\d+)$/m.exec(sessionStartSource)?.[1]
}

/** Install the base's Bun only when it pins one that is not already running. */
export function baseBunPlan(basePin: string | undefined, running: string): { install?: string } {
  return basePin && basePin !== running ? { install: basePin } : {}
}

if (import.meta.main) {
  // Prints the directory to put first on PATH for every command that builds
  // the base, or nothing when the running Bun already matches its pin.
  const baseIndex = process.argv.indexOf('--base')
  const base = baseIndex >= 0 ? process.argv[baseIndex + 1] : undefined
  const installRoot = process.env.RUNNER_TEMP ? join(process.env.RUNNER_TEMP, 'base-bun') : undefined
  if (!base || !installRoot) {
    process.stderr.write('Usage: bun run scripts/ci/base-bun.ts --base <base checkout>  (in CI, with RUNNER_TEMP set)\n')
    process.exit(2)
  }
  const hook = join(base, 'scripts', 'ci', 'session-start.sh')
  const plan = baseBunPlan(existsSync(hook) ? pinnedBun(readFileSync(hook, 'utf8')) : undefined, Bun.version)
  if (plan.install) {
    process.stderr.write(`Base pins Bun ${plan.install}; this run uses ${Bun.version}. Installing ${plan.install} for the base build.\n`)
    // The installer's output goes to stderr: stdout carries only the directory.
    const install = Bun.spawnSync(['bash', '-c', `curl -fsSL https://bun.sh/install | bash -s "bun-v${plan.install}" 1>&2`], {
      env: { ...process.env, BUN_INSTALL: installRoot },
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if (install.exitCode !== 0) throw new Error(`Installing Bun ${plan.install} for the base build failed`)
    process.stdout.write(`${join(installRoot, 'bin')}\n`)
  }
}
