import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArtifactStore } from '../mcp/artifacts.ts'
import { handleRequest, readRequestBody, startHttpServer, type HttpMcpServer } from '../mcp/server.ts'

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

describe('MCP HTTP/SSE transport and managed artifacts', () => {
  test('request body decoding preserves UTF-8 split across transport chunks', async () => {
    const raw = Buffer.from('{"source":"東🚀"}', 'utf8')
    const splitAt = raw.indexOf(Buffer.from('東')[0]!) + 1
    const request = {
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield raw.subarray(0, splitAt)
        yield raw.subarray(splitAt, splitAt + 2)
        yield raw.subarray(splitAt + 2)
      },
    }
    expect(await readRequestBody(request as any)).toBe('{"source":"東🚀"}')
  })

  test('render_png can write a managed file artifact', async () => {
    const store = createArtifactStore({ dir: tempDir() })
    const r = await handleRequest({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A[東京] --> B', output: 'file' } },
    }, { artifactStore: store })
    const payload = parseToolPayload(r)
    expect(payload.ok).toBe(true)
    expect(payload.artifact.mimeType).toBe('image/png')
    expect(payload.artifact.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.artifact.bytes).toBeGreaterThan(100)
    expect(payload.warnings).toContainEqual(expect.objectContaining({ code: 'PNG_FONT_COVERAGE' }))
    expect(statSync(payload.artifact.path).size).toBe(payload.artifact.bytes)
  })

  test('url artifacts are served back with PNG bytes', async () => {
    const started = await startHttpServer({ port: 0, artifactDir: tempDir() })
    servers.push(started)
    const rpc = await fetch(`${started.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'render_png', arguments: { source: 'flowchart TD\n  A[東京] --> B', output: 'url' } },
      }),
    })
    expect(rpc.status).toBe(200)
    const response = await rpc.json() as any
    const payload = JSON.parse(response.result.content[0].text)
    expect(payload.ok).toBe(true)
    expect(payload.artifact.url.startsWith(`${started.url}/artifacts/`)).toBe(true)
    expect(payload.artifact.path).toBeUndefined()
    expect(payload.warnings).toContainEqual(expect.objectContaining({ code: 'PNG_FONT_COVERAGE' }))

    const artifact = await fetch(payload.artifact.url)
    expect(artifact.status).toBe(200)
    expect(artifact.headers.get('content-type')).toBe('image/png')
    expect(artifact.headers.get('cache-control')).toMatch(/^private, max-age=(?:3599|3600), immutable$/)
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

  test('artifact TTL and aggregate quotas survive store recreation', () => {
    const dir = tempDir()
    let now = 10_000
    writeFileSync(join(dir, 'preexisting.png'), Buffer.from(PNG_MAGIC))
    const first = createArtifactStore({
      dir, ttlMs: 2_500, maxBytes: 16, maxTotalBytes: 16, maxArtifacts: 2, now: () => now,
    })
    const a = first.write(Buffer.from([1, 2, 3, 4]), { extension: '.png', mimeType: 'image/png' })
    const b = first.write(Buffer.from([5, 6, 7, 8]), { extension: '.png', mimeType: 'image/png' })
    expect(() => first.write(Buffer.from([9]), { extension: '.png', mimeType: 'image/png' })).toThrow(/maxArtifacts/)

    now = 11_000
    const restarted = createArtifactStore({
      dir, ttlMs: 2_500, maxBytes: 16, maxTotalBytes: 16, maxArtifacts: 2, now: () => now,
    })
    expect(restarted.read(a.name)).toMatchObject({ cacheMaxAgeSeconds: 1, expiresAt: 12_500 })
    expect(restarted.read(b.name)?.bytes).toEqual(Buffer.from([5, 6, 7, 8]))

    now = 12_500
    const expired = createArtifactStore({
      dir, ttlMs: 2_500, maxBytes: 16, maxTotalBytes: 16, maxArtifacts: 2, now: () => now,
    })
    expect(expired.read(a.name)).toBeNull()
    expect(expired.read(b.name)).toBeNull()
    expect(existsSync(join(dir, 'preexisting.png'))).toBe(true)

    const total = createArtifactStore({
      dir: tempDir(), maxBytes: 8, maxTotalBytes: 8, maxArtifacts: 3, now: () => now,
    })
    total.write(Buffer.from([1, 2, 3, 4]), { extension: '.png', mimeType: 'image/png' })
    total.write(Buffer.from([5, 6, 7, 8]), { extension: '.png', mimeType: 'image/png' })
    expect(() => total.write(Buffer.from([9]), { extension: '.png', mimeType: 'image/png' })).toThrow(/maxTotalBytes/)
  })

  test('HTTP RPC requires JSON content-type and bounds request bodies', async () => {
    const startedForType = await startHttpServer({ port: 0, artifactDir: tempDir() })
    servers.push(startedForType)
    const plain = await fetch(`${startedForType.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(plain.status).toBe(415)
    for (const contentType of ['application/jsonp', 'application/json-patch+json', 'application/json garbage']) {
      const invalid = await fetch(`${startedForType.url}/rpc`, {
        method: 'POST', headers: { 'content-type': contentType },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      })
      expect({ contentType, status: invalid.status }).toEqual({ contentType, status: 415 })
    }

    const notification = await fetch(`${startedForType.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping' }),
    })
    expect(notification.status).toBe(202)
    expect(await notification.text()).toBe('')

    await startedForType.close()
    servers = servers.filter(s => s !== startedForType)

    const started = await startHttpServer({ port: 0, artifactDir: tempDir(), maxRpcBodyBytes: 32 })
    servers.push(started)
    const huge = 'x'.repeat(33)
    const res = await fetch(`${started.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: huge,
    })
    expect(res.status).toBe(413)
  })

  test('local HTTP preserves exact numeric JSON-RPC ids in every JSON number form', async () => {
    const started = await startHttpServer({ port: 0, artifactDir: tempDir() })
    servers.push(started)
    for (const id of ['-0', '9007199254740993', '9007199254740993.0', '9007199254740993e0', '9.007199254740993e15']) {
      const response = await fetch(`${started.url}/rpc`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: `{"jsonrpc":"2.0","id":${id},"method":"ping"}`,
      })
      expect(await response.text()).toContain(`"id":${id}`)
    }
  })

  test('remote HTTP bind requires a bearer auth token', async () => {
    await expect(startHttpServer({ host: '0.0.0.0', port: 0, artifactDir: tempDir() })).rejects.toThrow(/auth-token/)
    const started = await startHttpServer({ host: '0.0.0.0', port: 0, artifactDir: tempDir(), authToken: 'secret' })
    servers.push(started)
    const unauthorized = await fetch(`${started.url}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(unauthorized.status).toBe(401)

    const unauthorizedSse = await fetch(`${started.url}/sse`)
    expect(unauthorizedSse.status).toBe(401)
    const unauthorizedArtifact = await fetch(`${started.url}/artifacts/missing.png`)
    expect(unauthorizedArtifact.status).toBe(401)
    const unauthorizedMessage = await fetch(`${started.url}/message?sessionId=missing`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    })
    expect(unauthorizedMessage.status).toBe(401)
    const crossOriginSse = await fetch(`${started.url}/sse`, {
      headers: { authorization: 'Bearer secret', origin: 'https://evil.example' },
    })
    expect(crossOriginSse.status).toBe(403)
    const crossOriginArtifact = await fetch(`${started.url}/artifacts/missing.png`, {
      headers: { authorization: 'Bearer secret', origin: 'https://evil.example' },
    })
    expect(crossOriginArtifact.status).toBe(403)
    const authorizedMissingArtifact = await fetch(`${started.url}/artifacts/missing.png`, {
      headers: { authorization: 'Bearer secret' },
    })
    expect(authorizedMissingArtifact.status).toBe(404)

    const controller = new AbortController()
    const authorizedSse = await fetch(`${started.url}/sse`, {
      headers: { authorization: 'Bearer secret' },
      signal: controller.signal,
    })
    expect(authorizedSse.status).toBe(200)
    await authorizedSse.body?.cancel()
    controller.abort()
  })

  test('configured public origin can fetch artifacts and open SSE', async () => {
    const publicUrl = 'https://proxy.example/artifacts'
    const started = await startHttpServer({
      port: 0,
      artifactDir: tempDir(),
      publicUrl,
    })
    servers.push(started)

    const record = started.artifactStore.write(Buffer.from(PNG_MAGIC), {
      extension: '.png',
      mimeType: 'image/png',
    })
    expect(record.url).toBe(`${publicUrl}/${record.name}`)

    const artifact = await fetch(`${started.url}/artifacts/${record.name}`, {
      headers: { origin: 'https://proxy.example' },
    })
    expect(artifact.status).toBe(200)
    expect(new Uint8Array(await artifact.arrayBuffer())).toEqual(new Uint8Array(PNG_MAGIC))

    const controller = new AbortController()
    const sse = await fetch(`${started.url}/sse`, {
      headers: { origin: 'https://proxy.example' },
      signal: controller.signal,
    })
    expect(sse.status).toBe(200)
    const reader = sse.body!.getReader()
    const first = textDecoder.decode((await reader.read()).value)
    expect(first).toContain('data: https://proxy.example/message?sessionId=')
    await reader.cancel()
    controller.abort()
  })

  test('SSE sessions are bounded', async () => {
    const started = await startHttpServer({ port: 0, artifactDir: tempDir(), maxSseSessions: 1 })
    servers.push(started)
    const firstController = new AbortController()
    const first = await fetch(`${started.url}/sse`, { signal: firstController.signal })
    expect(first.status).toBe(200)
    const refused = await fetch(`${started.url}/sse`)
    expect(refused.status).toBe(503)
    await first.body?.cancel()
    firstController.abort()
    await new Promise(resolve => setTimeout(resolve, 10))
    const replacementController = new AbortController()
    const replacement = await fetch(`${started.url}/sse`, { signal: replacementController.signal })
    expect(replacement.status).toBe(200)
    await replacement.body?.cancel()
    replacementController.abort()
  })

  test('SSE endpoint dispatches JSON-RPC responses and closes sessions', async () => {
    const started = await startHttpServer({ port: 0, artifactDir: tempDir() })
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

    const notification = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'ping' }),
    })
    expect(notification.status).toBe(202)
    expect(await notification.text()).toBe('')

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
