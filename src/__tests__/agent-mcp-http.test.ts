import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArtifactStore } from '../mcp/artifacts.ts'
import { handleRequest, startHttpServer, type HttpMcpOptions, type HttpMcpServer } from '../mcp/server.ts'

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const textDecoder = new TextDecoder()

let servers: HttpMcpServer[] = []
let temps: string[] = []

afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {})
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentic-mermaid-mcp-test-'))
  temps.push(dir)
  return dir
}

function parseToolPayload(r: Awaited<ReturnType<typeof handleRequest>>): any {
  const result = r!.result as { content: Array<{ text: string }> }
  return JSON.parse(result.content[0]!.text)
}

function isLocalSocketUnavailable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | undefined
  if (!e) return false
  if (e.code === 'EPERM' || e.code === 'EACCES') return true
  return e.code === 'EADDRINUSE' && /port 0|start server|listen/i.test(e.message ?? '')
}

async function startHttpServerIfAvailable(options: HttpMcpOptions): Promise<HttpMcpServer | null> {
  try {
    return await startHttpServer(options)
  } catch (error) {
    if (isLocalSocketUnavailable(error)) return null
    throw error
  }
}

describe('MCP HTTP/SSE transport and managed artifacts', () => {
  test('render_png can write a managed file artifact', async () => {
    const store = createArtifactStore({ dir: tempDir() })
    const r = await handleRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A --> B', output: 'file' } },
    }, { artifactStore: store })
    const payload = parseToolPayload(r)
    expect(payload.ok).toBe(true)
    expect(payload.artifact.mimeType).toBe('image/png')
    expect(payload.artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.artifact.bytes).toBeGreaterThan(100)
    expect(statSync(payload.artifact.path).size).toBe(payload.artifact.bytes)
  })

  test('url artifacts are served back with PNG bytes', async () => {
    const started = await startHttpServerIfAvailable({ port: 0, artifactDir: tempDir() })
    if (!started) return
    servers.push(started)
    const rpc = await fetch(`${started.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A --> B', output: 'url' } },
      }),
    })
    expect(rpc.status).toBe(200)
    const response = await rpc.json() as any
    const payload = JSON.parse(response.result.content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.artifact.url.startsWith(`${started.url}/artifacts/`)).toBe(true)
    expect(payload.artifact.path).toBeUndefined()

    const artifact = await fetch(payload.artifact.url)
    expect(artifact.status).toBe(200)
    expect(artifact.headers.get('content-type')).toBe('image/png')
    const bytes = new Uint8Array(await artifact.arrayBuffer())
    expect(bytes.length).toBe(payload.artifact.bytes)
    for (let i = 0; i < PNG_MAGIC.length; i++) expect(bytes[i]).toBe(PNG_MAGIC[i]!)
  })

  test('artifact store only serves tracked, unexpired artifacts', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'preexisting.png'), Buffer.from(PNG_MAGIC))
    let now = 1000
    const store = createArtifactStore({ dir, ttlMs: 5, now: () => now })
    expect(store.read('preexisting.png')).toBeNull()
    const record = store.write(Buffer.from(PNG_MAGIC), { extension: '.png', mimeType: 'image/png' })
    expect(store.read(record.name)?.bytes.length).toBe(PNG_MAGIC.length)
    now += 10
    expect(store.read(record.name)).toBeNull()
  })

  test('HTTP RPC requires JSON content-type and bounds request bodies', async () => {
    const startedForType = await startHttpServerIfAvailable({ port: 0, artifactDir: tempDir() })
    if (!startedForType) return
    servers.push(startedForType)
    const plain = await fetch(`${startedForType.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(plain.status).toBe(415)

    await startedForType.close()
    servers = servers.filter(s => s !== startedForType)

    const started = await startHttpServerIfAvailable({ port: 0, artifactDir: tempDir(), maxRpcBodyBytes: 32 })
    if (!started) return
    servers.push(started)
    const huge = 'x'.repeat(33)
    const res = await fetch(`${started.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: huge,
    })
    expect(res.status).toBe(413)
  })

  test('remote HTTP bind requires a bearer auth token', async () => {
    await expect(startHttpServer({ host: '0.0.0.0', port: 0, artifactDir: tempDir() })).rejects.toThrow(/auth-token/)
    const started = await startHttpServerIfAvailable({ host: '0.0.0.0', port: 0, artifactDir: tempDir(), authToken: 'secret' })
    if (!started) return
    servers.push(started)
    const unauthorized = await fetch(`${started.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(unauthorized.status).toBe(401)
  })

  test('SSE endpoint dispatches JSON-RPC responses and closes sessions', async () => {
    const started = await startHttpServerIfAvailable({ port: 0, artifactDir: tempDir() })
    if (!started) return
    servers.push(started)
    const controller = new AbortController()
    const sse = await fetch(`${started.url}/sse`, { signal: controller.signal })
    expect(sse.status).toBe(200)
    const reader = sse.body!.getReader()
    const first = await reader.read()
    const endpointEvent = textDecoder.decode(first.value)
    expect(endpointEvent).toContain('event: endpoint')
    const endpoint = endpointEvent.match(/data: (.+)\n/)![1]!
    expect(endpoint.startsWith(`${started.url}/message?sessionId=`)).toBe(true)

    const posted = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
    })
    expect(posted.status).toBe(202)
    const second = await reader.read()
    const messageEvent = textDecoder.decode(second.value)
    expect(messageEvent).toContain('event: message')
    expect(messageEvent).toContain('"id":3')

    await reader.cancel()
    controller.abort()
    await new Promise(resolve => setTimeout(resolve, 10))
    const stale = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'ping' }),
    })
    expect(stale.status).toBe(404)
  })
})
