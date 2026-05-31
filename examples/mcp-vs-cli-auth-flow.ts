// Runnable parity example: build the same Auth Flow diagram via MCP Code Mode
// and via the `am` CLI, then assert the serialized Mermaid source is identical.
//   bun run examples/mcp-vs-cli-auth-flow.ts
//
// This intentionally uses MCP `execute` for composition. The non-Code-Mode
// path is the CLI, not a parallel render-tool-per-format MCP surface.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { handleRequest } from '../src/mcp/server.ts'
import type { FlowchartMutationOp } from '../src/agent/types.ts'

const REPO = join(import.meta.dir, '..')
const INITIAL_SOURCE = `---
title: Auth Flow
---
flowchart LR
`

const AUTH_FLOW_OPS: FlowchartMutationOp[] = [
  { kind: 'add_node', id: 'A', label: 'User' },
  { kind: 'add_node', id: 'B', label: 'Login Page' },
  { kind: 'add_node', id: 'C', label: 'Valid Credentials?', shape: 'diamond' },
  { kind: 'add_node', id: 'D', label: 'MFA Enabled?', shape: 'diamond' },
  { kind: 'add_node', id: 'E', label: 'Enter MFA Code' },
  { kind: 'add_node', id: 'F', label: 'Code Valid?', shape: 'diamond' },
  { kind: 'add_node', id: 'G', label: 'Create Session' },
  { kind: 'add_node', id: 'H', label: 'Dashboard' },
  { kind: 'add_edge', from: 'A', to: 'B' },
  { kind: 'add_edge', from: 'B', to: 'C' },
  { kind: 'add_edge', from: 'C', to: 'B', label: 'No' },
  { kind: 'add_edge', from: 'C', to: 'D', label: 'Yes' },
  { kind: 'add_edge', from: 'D', to: 'E', label: 'Yes' },
  { kind: 'add_edge', from: 'E', to: 'F' },
  { kind: 'add_edge', from: 'F', to: 'E', label: 'No' },
  { kind: 'add_edge', from: 'D', to: 'G', label: 'No' },
  { kind: 'add_edge', from: 'F', to: 'G', label: 'Yes' },
  { kind: 'add_edge', from: 'G', to: 'H' },
]

async function buildViaMcpCodeMode(): Promise<string> {
  const code = `
    const parsed = mermaid.parseMermaid(${JSON.stringify(INITIAL_SOURCE)})
    if (!parsed.ok) return { error: parsed.error }
    const flow = mermaid.asFlowchart(parsed.value)
    if (!flow) return { error: 'not-flowchart' }
    let current = flow
    const ops = ${JSON.stringify(AUTH_FLOW_OPS)}
    for (const op of ops) {
      const next = mermaid.mutate(current, op)
      if (!next.ok) return { error: next.error, op }
      current = next.value
    }
    const verify = mermaid.verifyMermaid(current)
    if (!verify.ok) return { error: 'verify', warnings: verify.warnings }
    return { source: mermaid.serializeMermaid(current) }
  `

  const response = await handleRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'execute', arguments: { code } },
  })
  const payload = parseMcpTextPayload(response)
  if (!payload.ok) throw new Error(`MCP execute failed: ${payload.error}`)
  const value = payload.value as { source?: unknown }
  if (typeof value.source !== 'string') throw new Error(`MCP returned no source: ${JSON.stringify(value)}`)
  return value.source
}

function buildViaCli(): string {
  const dir = mkdtempSync(join(tmpdir(), 'am-auth-flow-'))
  try {
    const input = join(dir, 'auth-flow.mmd')
    const ops = join(dir, 'ops.json')
    writeFileSync(input, INITIAL_SOURCE)
    writeFileSync(ops, JSON.stringify(AUTH_FLOW_OPS, null, 2))
    const r = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'mutate', input, '--ops', ops, '--json'], {
      cwd: REPO,
      encoding: 'utf8',
    })
    if (r.status !== 0) throw new Error(`CLI failed (${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
    const payload = JSON.parse(r.stdout) as { ok: boolean; source?: unknown; error?: unknown }
    if (!payload.ok || typeof payload.source !== 'string') throw new Error(`CLI returned no source: ${r.stdout}`)
    return payload.source
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function parseMcpTextPayload(response: Awaited<ReturnType<typeof handleRequest>>): { ok: boolean; value?: unknown; error?: string } {
  const text = (response?.result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text
  if (typeof text !== 'string') return { ok: false, error: `bad MCP response: ${JSON.stringify(response)}` }
  const executeResult = JSON.parse(text) as { ok: boolean; value?: unknown; error?: string }
  return executeResult.ok ? { ok: true, value: executeResult.value } : { ok: false, error: executeResult.error ?? text }
}

const mcpSource = await buildViaMcpCodeMode()
const cliSource = buildViaCli()
if (mcpSource !== cliSource) {
  throw new Error(`MCP and CLI produced different source\n--- MCP ---\n${mcpSource}\n--- CLI ---\n${cliSource}`)
}

console.log(JSON.stringify({ ok: true, channelA: 'mcp.execute', channelB: 'am mutate --ops', source: mcpSource }, null, 2))
