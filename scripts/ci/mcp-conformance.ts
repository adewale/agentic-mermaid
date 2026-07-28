#!/usr/bin/env bun

// Run the official MCP conformance CLI against the real hosted handler on a
// loopback server. CI downloads one exact pre-release package; local audits may
// point MCP_CONFORMANCE_BIN at an already-built dist/index.js.

const CONFORMANCE_PACKAGE = '@modelcontextprotocol/conformance@0.2.0-alpha.10'
const EXPECTED_FAILURES = 'eval/mcp-conformance/expected-failures.yml'

interface Scenario {
  readonly name: string
  readonly specVersion: string
  readonly baseline?: boolean
}

const SCENARIOS: readonly Scenario[] = [
  { name: 'server-initialize', specVersion: '2025-11-25' },
  { name: 'tools-list', specVersion: '2026-07-28' },
  { name: 'http-header-validation', specVersion: '2026-07-28' },
  { name: 'caching', specVersion: '2026-07-28', baseline: true },
  { name: 'server-stateless', specVersion: '2026-07-28', baseline: true },
]

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (!text.includes('\n')) {
      const next = await reader.read()
      if (next.done) break
      text += decoder.decode(next.value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
  return text.split(/\r?\n/, 1)[0] ?? ''
}

function conformanceCommand(): string[] {
  const localBin = process.env.MCP_CONFORMANCE_BIN
  return localBin
    ? ['node', localBin]
    : ['npx', '--yes', CONFORMANCE_PACKAGE]
}

async function startServer() {
  const configuredPort = process.env.MCP_CONFORMANCE_PORT
  const ports = configuredPort ? [configuredPort] : ['0', '43189', '43190', '43191']
  for (const port of ports) {
    const server = Bun.spawn(['bun', 'run', 'scripts/interop/serve-hosted.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, INTEROP_PORT: port },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'inherit',
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    const url = await Promise.race([
      firstLine(server.stdout),
      new Promise<string>(resolve => {
        timeout = setTimeout(() => resolve(''), 3_000)
      }),
    ])
    if (timeout !== undefined) clearTimeout(timeout)
    if (/^http:\/\/127\.0\.0\.1:\d+\/mcp$/.test(url)) return { server, url }
    server.kill()
    await server.exited
  }
  throw new Error(`local MCP server did not start on candidate ports: ${ports.join(', ')}`)
}

const { server, url } = await startServer()
try {
  for (const scenario of SCENARIOS) {
    process.stdout.write(`\n==> MCP conformance: ${scenario.name} (${scenario.specVersion})\n`)
    const args = [
      ...conformanceCommand(),
      'server',
      '--url', url,
      '--scenario', scenario.name,
      '--spec-version', scenario.specVersion,
      ...(scenario.baseline ? ['--expected-failures', EXPECTED_FAILURES] : []),
    ]
    const result = Bun.spawnSync(args, {
      cwd: process.cwd(),
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    if (result.exitCode !== 0) {
      throw new Error(`official MCP conformance scenario failed: ${scenario.name}`)
    }
  }
} finally {
  server.kill()
  await server.exited
}

process.stdout.write(`\nOfficial MCP conformance scenarios passed (${SCENARIOS.length}).\n`)
