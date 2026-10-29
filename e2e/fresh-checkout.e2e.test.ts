// Exercise the actual source-checkout entrypoints with dependencies absent:
// lightweight help still works, while deferred runtime imports retain the
// prescriptive installation error instead of exposing a resolution stack.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = join(import.meta.dir, '..')
let checkout = ''

beforeAll(() => {
  checkout = mkdtempSync(join(tmpdir(), 'agentic-mermaid-fresh-'))
  // A fresh checkout still contains tracked runtime assets. Copy them so this
  // fixture removes only installed dependencies, not the embedded-font
  // resource closure required by the source CLI and compiled binary.
  for (const dir of ['assets', 'bin', 'src']) cpSync(join(REPO, dir), join(checkout, dir), { recursive: true })
  for (const file of ['package.json', 'tsconfig.json', 'bunfig.toml']) cpSync(join(REPO, file), join(checkout, file))
})

afterAll(() => {
  if (checkout) rmSync(checkout, { recursive: true, force: true })
})

describe('fresh source checkout without dependencies', () => {
  for (const [name, entry, helpArgs, startupArgs, helpText] of [
    ['am', 'bin/am.ts', ['--help'], ['capabilities'], 'Usage: am'],
    ['agentic-mermaid-mcp', 'bin/agentic-mermaid-mcp.ts', ['--help'], ['--transport', 'stdio'], 'agentic-mermaid-mcp'],
    ['am mcp', 'bin/am.ts', ['mcp', '--help'], ['mcp', '--transport', 'stdio'], 'agentic-mermaid-mcp'],
  ] as const) {
    test(`${name} help works offline without installed dependencies`, () => {
      // Bun auto-installs by default when node_modules is absent; --no-install
      // recreates an offline/fresh checkout instead of masking the condition.
      const result = spawnSync('bun', ['--no-install', entry, ...helpArgs], { cwd: checkout, encoding: 'utf8' })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(helpText)
      expect(result.stderr).toBe('')
    })

    test(`${name} startup gives one prescriptive dependency error instead of a module-resolution stack`, () => {
      const result = spawnSync('bun', ['--no-install', entry, ...startupArgs], { cwd: checkout, encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('source checkout dependencies are not installed')
      expect(result.stderr).toContain('Run `bun install` in the repository root')
      expect(result.stderr.trim().split('\n')).toHaveLength(1)
      expect(result.stderr).not.toContain('at ')
    })
  }
})
