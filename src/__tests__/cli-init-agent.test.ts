// `am init-agent` — repo-local agent drop-in.

import { describe, test, expect } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { initAgentFiles, AGENTS_MARKER, MCP_CONFIG_SAMPLE } from '../cli/init-agent.ts'

const REPO = join(import.meta.dir, '..', '..')

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'am-init-agent-'))
}

describe('initAgentFiles', () => {
  test('creates AGENTS.md, skill bundle, and MCP config in a fresh dir', () => {
    const dir = tmp()
    try {
      const r = initAgentFiles({ dir })
      const agents = join(dir, 'AGENTS.md')
      const skill = join(dir, '.claude', 'skills', 'agentic-mermaid', 'SKILL.md')
      const mcp = join(dir, '.mcp.json')
      expect(existsSync(agents)).toBe(true)
      expect(existsSync(skill)).toBe(true)
      expect(existsSync(mcp)).toBe(true)
      expect(r.written).toEqual([agents, skill, mcp])
      expect(r.appended).toEqual([])
      expect(r.skipped).toEqual([])

      const agentsText = readFileSync(agents, 'utf8')
      expect(agentsText).toContain(AGENTS_MARKER)
      expect(agentsText).toContain('parse → narrow')
      expect(agentsText).toContain('npx agentic-mermaid --agent-instructions')

      const skillText = readFileSync(skill, 'utf8')
      expect(skillText).toContain('name: agentic-mermaid')
      expect(skillText).toContain('agentic-mermaid/agent')

      // The MCP config is valid JSON wiring the published bin name.
      const mcpJson = JSON.parse(readFileSync(mcp, 'utf8'))
      expect(mcpJson.mcpServers['agentic-mermaid'].args).toContain('agentic-mermaid-mcp')
      expect(readFileSync(mcp, 'utf8')).toBe(MCP_CONFIG_SAMPLE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('appends to an existing AGENTS.md exactly once (idempotent)', () => {
    const dir = tmp()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# My agents\n\nExisting content.\n')
      const first = initAgentFiles({ dir })
      expect(first.appended).toContain(join(dir, 'AGENTS.md'))
      const afterFirst = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
      expect(afterFirst).toContain('Existing content.')
      expect(afterFirst.split(AGENTS_MARKER).length - 1).toBe(1)

      // Second run: marker present → skip, no duplicate section.
      const second = initAgentFiles({ dir })
      expect(second.skipped).toContain(join(dir, 'AGENTS.md'))
      const afterSecond = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
      expect(afterSecond.split(AGENTS_MARKER).length - 1).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('skips existing skill/MCP files unless --force', () => {
    const dir = tmp()
    try {
      initAgentFiles({ dir })
      const r2 = initAgentFiles({ dir })
      expect(r2.skipped).toContain(join(dir, '.claude', 'skills', 'agentic-mermaid', 'SKILL.md'))
      expect(r2.skipped).toContain(join(dir, '.mcp.json'))

      const r3 = initAgentFiles({ dir, force: true })
      expect(r3.written).toContain(join(dir, '.claude', 'skills', 'agentic-mermaid', 'SKILL.md'))
      expect(r3.written).toContain(join(dir, '.mcp.json'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('am init-agent (CLI)', () => {
  test('--json reports created paths and exits 0', () => {
    const dir = tmp()
    try {
      const r = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'init-agent', '--dir', dir, '--json'], { encoding: 'utf8' })
      expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' })
      const payload = JSON.parse(r.stdout)
      expect(payload.ok).toBe(true)
      expect(payload.written).toContain(join(dir, '.mcp.json'))
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('--help works and is listed', () => {
    const r = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'init-agent', '--help'], { encoding: 'utf8' })
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' })
    expect(r.stdout).toContain('am init-agent')
  })
})
