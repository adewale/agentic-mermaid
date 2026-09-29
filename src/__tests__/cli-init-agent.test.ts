// `am init-agent` — repo-local, agent-agnostic onboarding drop-in.

import { describe, test, expect } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { initAgentFiles, AGENTS_MARKER, MCP_CONFIG_SAMPLE } from '../cli/init-agent.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

const REPO = join(import.meta.dir, '..', '..')

function tmp(): string {
  return temp.dir('am-init-agent-')
}

describe('initAgentFiles', () => {
  test('creates AGENTS.md, root skill bundle, and MCP config in a fresh dir', () => {
    const dir = tmp()
    const r = initAgentFiles({ dir })
    const agents = join(dir, 'AGENTS.md')
    const skill = join(dir, 'skills', 'agentic-mermaid-diagram-workflow', 'SKILL.md')
    const mcp = join(dir, '.mcp.json')
    expect(existsSync(agents)).toBe(true)
    expect(existsSync(skill)).toBe(true)
    expect(existsSync(mcp)).toBe(true)
    expect(existsSync(join(dir, '.claude'))).toBe(false)
    expect(existsSync(join(dir, '.agents'))).toBe(false)
    expect(r.written).toEqual([agents, skill, mcp])
    expect(r.appended).toEqual([])
    expect(r.skipped).toEqual([])

    const agentsText = readFileSync(agents, 'utf8')
    expect(agentsText).toContain(AGENTS_MARKER)
    expect(agentsText).toContain('parse → narrow')
    expect(agentsText).toContain('https://agentic-mermaid.dev/llms.txt')
    expect(agentsText).toContain('npx agentic-mermaid --agent-instructions')

    const skillText = readFileSync(skill, 'utf8')
    expect(skillText).toContain('name: agentic-mermaid-diagram-workflow')
    expect(skillText).toContain('agentic-mermaid/agent')
    expect(skillText).toContain('--format png --output')

    const mcpJson = JSON.parse(readFileSync(mcp, 'utf8'))
    expect(mcpJson.mcpServers['agentic-mermaid'].args).toContain('agentic-mermaid-mcp')
    expect(readFileSync(mcp, 'utf8')).toBe(MCP_CONFIG_SAMPLE)
  })

  test('appends to an existing AGENTS.md exactly once', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'AGENTS.md'), '# My agents\n\nExisting content.\n')
    const first = initAgentFiles({ dir })
    expect(first.appended).toContain(join(dir, 'AGENTS.md'))
    const afterFirst = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(afterFirst).toContain('Existing content.')
    expect(afterFirst.split(AGENTS_MARKER).length - 1).toBe(1)

    const second = initAgentFiles({ dir })
    expect(second.skipped).toContain(join(dir, 'AGENTS.md'))
    const afterSecond = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(afterSecond.split(AGENTS_MARKER).length - 1).toBe(1)
  })

  test('skips existing skill/MCP files unless forced', () => {
    const dir = tmp()
    initAgentFiles({ dir })
    const skill = join(dir, 'skills', 'agentic-mermaid-diagram-workflow', 'SKILL.md')
    const mcp = join(dir, '.mcp.json')
    const r2 = initAgentFiles({ dir })
    expect(r2.skipped).toContain(skill)
    expect(r2.skipped).toContain(mcp)

    const r3 = initAgentFiles({ dir, force: true })
    expect(r3.written).toContain(skill)
    expect(r3.written).toContain(mcp)
  })
})

describe('am init-agent', () => {
  test('--json reports created paths and exits 0', () => {
    const dir = tmp()
    const r = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'init-agent', '--dir', dir, '--json'], { encoding: 'utf8' })
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' })
    const payload = JSON.parse(r.stdout)
    expect(payload.ok).toBe(true)
    expect(payload.written).toContain(join(dir, '.mcp.json'))
    expect(payload.written).toContain(join(dir, 'skills', 'agentic-mermaid-diagram-workflow', 'SKILL.md'))
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
  })
})
