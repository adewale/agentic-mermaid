// Runnable parity example: build complicated diagrams via MCP Code Mode and
// via the `am` CLI, then assert the serialized Mermaid source is identical.
//   bun run examples/mcp-vs-cli-complex-diagrams.ts
//
// This intentionally uses MCP `execute` for composition. The non-Code-Mode
// path is the CLI, not a parallel render-tool-per-format MCP surface.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { handleRequest } from '../src/mcp/server.ts'
import type { AnyMutationOp } from '../src/agent/types.ts'

const REPO = join(import.meta.dir, '..')

const CASES: Array<{ id: string; initialSource: string; ops: AnyMutationOp[] }> = [
  {
    id: 'auth-flow',
    initialSource: `---
title: Auth Flow
---
flowchart LR
`,
    ops: [
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
    ],
  },
  {
    id: 'order-domain-er',
    initialSource: `---
title: Order Domain
---
erDiagram
`,
    ops: [
      { kind: 'add_entity', id: 'CUSTOMER', attributes: ['string id', 'string email'] },
      { kind: 'add_entity', id: 'ORDER', attributes: ['string id', 'date placed_at', 'string status'] },
      { kind: 'add_entity', id: 'LINE_ITEM', attributes: ['string id', 'int quantity'] },
      { kind: 'add_entity', id: 'PRODUCT', attributes: ['string sku', 'string name'] },
      { kind: 'add_relation', from: 'CUSTOMER', to: 'ORDER', leftCard: 'one-only', rightCard: 'zero-or-many', label: 'places' },
      { kind: 'add_relation', from: 'ORDER', to: 'LINE_ITEM', leftCard: 'one-only', rightCard: 'one-or-many', label: 'contains' },
      { kind: 'add_relation', from: 'PRODUCT', to: 'LINE_ITEM', leftCard: 'one-only', rightCard: 'zero-or-many', label: 'appears_in' },
    ],
  },
]

async function buildViaMcpCodeMode(c: typeof CASES[number]): Promise<string> {
  const code = `
    const parsed = mermaid.parseMermaid(${JSON.stringify(c.initialSource)})
    if (!parsed.ok) return { error: parsed.error }
    const narrow = parsed.value.kind === 'er' ? mermaid.asEr(parsed.value) : mermaid.asFlowchart(parsed.value)
    if (!narrow) return { error: 'unsupported-family', family: parsed.value.kind }
    let current = narrow
    const ops = ${JSON.stringify(c.ops)}
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
    id: c.id,
    method: 'tools/call',
    params: { name: 'execute', arguments: { code } },
  })
  const payload = parseMcpTextPayload(response)
  if (!payload.ok) throw new Error(`MCP execute failed for ${c.id}: ${payload.error}`)
  const value = payload.value as { source?: unknown }
  if (typeof value.source !== 'string') throw new Error(`MCP returned no source for ${c.id}: ${JSON.stringify(value)}`)
  return value.source
}

function buildViaCli(c: typeof CASES[number]): string {
  const dir = mkdtempSync(join(tmpdir(), `am-${c.id}-`))
  try {
    const input = join(dir, `${c.id}.mmd`)
    const ops = join(dir, 'ops.json')
    writeFileSync(input, c.initialSource)
    writeFileSync(ops, JSON.stringify(c.ops, null, 2))
    const r = spawnSync('bun', ['run', join(REPO, 'bin/am.ts'), 'mutate', input, '--ops', ops, '--json'], {
      cwd: REPO,
      encoding: 'utf8',
    })
    if (r.status !== 0) throw new Error(`CLI failed for ${c.id} (${r.status})\nstdout: ${r.stdout}\nstderr: ${r.stderr}`)
    const payload = JSON.parse(r.stdout) as { ok: boolean; source?: unknown; error?: unknown }
    if (!payload.ok || typeof payload.source !== 'string') throw new Error(`CLI returned no source for ${c.id}: ${r.stdout}`)
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

const sources: Record<string, string> = {}
for (const c of CASES) {
  const mcpSource = await buildViaMcpCodeMode(c)
  const cliSource = buildViaCli(c)
  if (mcpSource !== cliSource) {
    throw new Error(`${c.id}: MCP and CLI produced different source\n--- MCP ---\n${mcpSource}\n--- CLI ---\n${cliSource}`)
  }
  sources[c.id] = mcpSource
}

console.log(JSON.stringify({ ok: true, channelA: 'mcp.execute', channelB: 'am mutate --ops', cases: Object.keys(sources), sources }, null, 2))
