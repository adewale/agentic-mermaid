// Exercise the actual source-checkout entrypoints with dependencies absent.
// This closes the gap where the formatter helper was unit-tested but the bins
// still crashed before it could run because of top-level imports.
import { describe, expect, test, beforeAll } from 'bun:test'
import { cpSync, mkdtempSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO = join(import.meta.dir, '..')
let checkout = ''

beforeAll(() => {
  checkout = mkdtempSync(join(tmpdir(), 'agentic-mermaid-fresh-'))
  for (const dir of ['bin', 'src']) cpSync(join(REPO, dir), join(checkout, dir), { recursive: true })
  for (const file of ['package.json', 'tsconfig.json', 'bunfig.toml']) cpSync(join(REPO, file), join(checkout, file))
})

describe('fresh source checkout without dependencies', () => {
  for (const [name, entry] of [
    ['am', 'bin/am.ts'],
    ['agentic-mermaid-mcp', 'bin/agentic-mermaid-mcp.ts'],
  ] as const) {
    test(`${name} gives one prescriptive error instead of a module-resolution stack`, () => {
      // Bun auto-installs by default when node_modules is absent; --no-install
      // recreates an offline/fresh checkout instead of masking the condition.
      const result = spawnSync('bun', ['--no-install', entry, '--help'], { cwd: checkout, encoding: 'utf8' })
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('source checkout dependencies are not installed')
      expect(result.stderr).toContain('Run `bun install` in the repository root')
      expect(result.stderr.trim().split('\n')).toHaveLength(1)
      expect(result.stderr).not.toContain('at ')
    })
  }
})
