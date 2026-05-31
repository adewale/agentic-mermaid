// Runnable agent-improvement example:
//   1. create a non-trivial Auth Flow via MCP Code Mode mutations;
//   2. assess it and spot label-overflow warnings;
//   3. improve it through another mutation batch;
//   4. reassess the impact;
//   5. write final Mermaid, SVG, ASCII, and assessment files.
//
// Run:
//   bun run examples/agent-improve-auth-flow.ts
//   bun run examples/agent-improve-auth-flow.ts --out-dir /tmp/auth-flow-improved

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { handleRequest } from '../src/mcp/server.ts'

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

const outDir = resolve(argValue('--out-dir') ?? mkdtempSync(join(tmpdir(), 'am-agent-improve-')))
mkdirSync(outDir, { recursive: true })

const AGENT_CODE = `
const parsed = mermaid.parseMermaid('---\\ntitle: Auth Flow Draft\\n---\\nflowchart LR\\n')
if (!parsed.ok) return { phase: 'parse', errors: parsed.error }

const flow = mermaid.asFlowchart(parsed.value)
if (!flow) return { phase: 'narrow', error: 'not-flowchart' }

let current = flow
const createOps = [
  { kind: 'add_node', id: 'A', label: 'User' },
  { kind: 'add_node', id: 'B', label: 'Login Page' },
  { kind: 'add_node', id: 'C', label: 'Are the supplied credentials valid?', shape: 'diamond' },
  { kind: 'add_node', id: 'D', label: 'Does this user require multi-factor authentication?', shape: 'diamond' },
  { kind: 'add_node', id: 'E', label: 'Enter MFA Code' },
  { kind: 'add_node', id: 'F', label: 'Is the entered multi-factor code valid?', shape: 'diamond' },
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
for (const op of createOps) {
  const next = mermaid.mutate(current, op)
  if (!next.ok) return { phase: 'create', op, error: next.error }
  current = next.value
}

const assess = (diagram) => {
  const verify = mermaid.verifyMermaid(diagram, { labelCharCap: 28 })
  const source = mermaid.serializeMermaid(diagram)
  const labels = Array.from(source.matchAll(/[\\[{]([^\\]\\}]+)[\\]\\}]/g)).map(m => m[1])
  const longestLabel = labels.reduce((max, label) => Math.max(max, label.length), 0)
  return {
    ok: verify.ok,
    warningCount: verify.warnings.length,
    warnings: verify.warnings.map(w => ({ code: w.code, target: w.target, charCount: w.charCount, limit: w.limit })),
    longestLabel,
    bounds: verify.layout.bounds,
    source,
  }
}

const before = assess(current)
const problems = []
if (before.warnings.some(w => w.code === 'LABEL_OVERFLOW')) {
  problems.push('Decision labels are too long for compact rendering and screenshots.')
}
if (before.bounds.w > 1600) {
  problems.push('The left-to-right diagram is wide enough to be awkward in docs.')
}

const improveOps = [
  { kind: 'set_label', target: 'C', label: 'Valid Credentials?' },
  { kind: 'set_label', target: 'D', label: 'MFA Enabled?' },
  { kind: 'set_label', target: 'F', label: 'Code Valid?' },
]
for (const op of improveOps) {
  const next = mermaid.mutate(current, op)
  if (!next.ok) return { phase: 'improve', op, error: next.error }
  current = next.value
}

const after = assess(current)
const svg = mermaid.renderMermaidSVG(current, { security: 'strict' })
const ascii = mermaid.renderMermaidASCII(current, { useAscii: true })

return {
  createOps: createOps.length,
  improveOps: improveOps.length,
  problems,
  impact: {
    warningsBefore: before.warningCount,
    warningsAfter: after.warningCount,
    longestLabelBefore: before.longestLabel,
    longestLabelAfter: after.longestLabel,
    boundsBefore: before.bounds,
    boundsAfter: after.bounds,
  },
  beforeSource: before.source,
  source: after.source,
  svg,
  ascii,
}
`

const response = await handleRequest({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'execute', arguments: { code: AGENT_CODE } },
})

const text = (response?.result as { content?: Array<{ text?: string }> } | undefined)?.content?.[0]?.text
if (typeof text !== 'string') throw new Error(`bad MCP response: ${JSON.stringify(response)}`)
const executed = JSON.parse(text) as { ok: boolean; value?: unknown; error?: string }
if (!executed.ok) throw new Error(`agent execute failed: ${executed.error ?? text}`)

const result = executed.value as {
  createOps: number
  improveOps: number
  problems: string[]
  impact: Record<string, unknown>
  beforeSource: string
  source: string
  svg: string
  ascii: string
}

const files = {
  before: join(outDir, 'auth-flow-before.mmd'),
  source: join(outDir, 'auth-flow-improved.mmd'),
  svg: join(outDir, 'auth-flow-improved.svg'),
  ascii: join(outDir, 'auth-flow-improved.txt'),
  assessment: join(outDir, 'assessment.json'),
}

writeFileSync(files.before, result.beforeSource)
writeFileSync(files.source, result.source)
writeFileSync(files.svg, result.svg)
writeFileSync(files.ascii, result.ascii)
writeFileSync(files.assessment, JSON.stringify({
  createOps: result.createOps,
  improveOps: result.improveOps,
  problems: result.problems,
  impact: result.impact,
}, null, 2) + '\n')

console.log(JSON.stringify({
  ok: true,
  outDir,
  files,
  problems: result.problems,
  impact: result.impact,
}, null, 2))
