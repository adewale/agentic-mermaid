// Where the maintainer tests run: a standalone Trident package, or eval/benchmark of an
// Agentic Mermaid checkout whose adapter protocols resolve source relative to that root.

import { test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** The containing Agentic Mermaid checkout root, or undefined for a standalone package. */
export const agenticCheckout = (() => {
  const root = resolve(import.meta.dir, '../../../..')
  try {
    return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name === 'agentic-mermaid' ? root : undefined
  } catch {
    return undefined
  }
})()

/** A test that exercises the Agentic checkout layout; reported as skipped in a standalone package. */
export const testWithAgentic = test.skipIf(!agenticCheckout)

/** AM_CHROMIUM_EXECUTABLE, then a system Chromium, then Playwright's own browser. */
export const chromiumExecutable = process.env.AM_CHROMIUM_EXECUTABLE ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
