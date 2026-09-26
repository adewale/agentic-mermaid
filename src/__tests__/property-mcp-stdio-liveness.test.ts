// Property: however a client pipelines tool calls, the stdio MCP server answers
// every request exactly once and exits when its input closes. Each case runs
// the shipped bin out of process, so a wedged server fails the property by
// timeout instead of taking the test runner down with it (#298: a render_png
// sent beside execute was terminated by the sandbox's still-armed node:vm
// watchdog and the server spun without answering). Seed is pinned globally
// (fc-seed.preload.ts).
import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
const SMALL = 'flowchart TD\n  A --> B'
// Renders for far longer than the sandbox watchdog's deadline, so a render that
// starts inside the armed window is always terminated if the gate regresses.
const LARGE = `flowchart TD\n${Array.from({ length: 40 }, (_, i) => `  N${i}[Step ${i}] --> N${(i * 7 + 3) % 40}[Step ${(i * 7 + 3) % 40}]`).join('\n')}`
// A cold `bun run` of the bin under the coverage shard's load can take seconds;
// a live session finishes well inside this, a wedged one never does.
const SESSION_TIMEOUT_MS = 30_000
const RUNS = 6

interface ToolCall { name: string; arguments: Record<string, unknown> }

const EXECUTE: ToolCall = { name: 'execute', arguments: { code: 'return 1' } }
const RENDER_LARGE: ToolCall = { name: 'render_png', arguments: { source: LARGE, output: 'base64' } }
const callArb: fc.Arbitrary<ToolCall> = fc.constantFrom<ToolCall>(
  EXECUTE,
  { name: 'execute', arguments: { code: 'return mermaid.parseRegisteredMermaid("flowchart TD\\n  A --> B").ok' } },
  { name: 'render_png', arguments: { source: SMALL, output: 'base64' } },
  RENDER_LARGE,
  { name: 'describe', arguments: { source: LARGE } },
  { name: 'describe_sdk', arguments: { family: 'flowchart', detail: 'signatures' } },
)

interface Session { timedOut: boolean; exitCode: number | null; answered: number[] }

async function runSession(calls: readonly ToolCall[]): Promise<Session> {
  const proc = Bun.spawn(['bun', 'run', join(REPO, 'bin/agentic-mermaid-mcp.ts')], {
    cwd: REPO, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  })
  const requests = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'liveness', version: '0' } } },
    ...calls.map((params, index) => ({ jsonrpc: '2.0', id: index + 1, method: 'tools/call', params })),
  ]
  proc.stdin.write(requests.map(request => JSON.stringify(request)).join('\n') + '\n')
  await proc.stdin.end()
  let timedOut = false
  const guard = setTimeout(() => { timedOut = true; proc.kill() }, SESSION_TIMEOUT_MS)
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  clearTimeout(guard)
  const answered = stdout.split('\n').filter(Boolean).map(line => (JSON.parse(line) as { id: number }).id)
  return { timedOut, exitCode, answered }
}

describe('MCP stdio server liveness', () => {
  test('answers every pipelined tool call exactly once and exits when input closes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(callArb, { minLength: 2, maxLength: 5 }), async calls => {
        const session = await runSession(calls)
        expect(session.timedOut).toBe(false)
        expect(session.exitCode).toBe(0)
        expect([...session.answered].sort((a, b) => a - b)).toEqual(Array.from({ length: calls.length + 1 }, (_, id) => id))
      }),
      // The #298 race, first: a render dispatched while execute's watchdog is armed.
      // A hung case costs a full session timeout, so stop at the first failure.
      { numRuns: RUNS, examples: [[[EXECUTE, RENDER_LARGE]]], endOnFailure: true },
    )
  }, (RUNS + 1) * SESSION_TIMEOUT_MS)
})
