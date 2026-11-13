import { describe, expect, test } from 'bun:test'
import { createStdioMessageProcessor } from '../mcp/server.ts'
import { reply } from '../mcp/protocol.ts'

const PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'
const CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'

function modern(id: number) {
  return {
    jsonrpc: '2.0', id, method: 'tools/list',
    params: { _meta: { [PROTOCOL_VERSION]: '2026-07-28', [CLIENT_CAPABILITIES]: {} } },
  }
}

function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('stdio scheduling and cancellation', () => {
  test('a cancellation accepted before dispatch prevents the request from starting', async () => {
    const output: string[] = []
    let dispatches = 0
    const processor = createStdioMessageProcessor({}, line => output.push(line), async message => {
      dispatches++
      return reply(message.id, { completed: true })
    })

    processor.accept(JSON.stringify(modern(7)))
    processor.accept(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 7 },
    }))
    await processor.drain()

    expect(dispatches).toBe(0)
    expect(output).toEqual([])
  })

  test('a modern cancellation notification aborts work and suppresses its response', async () => {
    const output: string[] = []
    const started = deferred()
    const release = deferred()
    let signal: AbortSignal | undefined
    const processor = createStdioMessageProcessor({}, line => output.push(line), async (message, context) => {
      signal = context.signal
      started.resolve()
      await release.promise
      return reply(message.id, { completed: true })
    })

    processor.accept(JSON.stringify(modern(7)))
    await started.promise
    processor.accept(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 7, reason: 'client no longer needs the result' },
    }))
    release.resolve()
    await processor.drain()

    expect(signal?.aborted).toBe(true)
    expect(output).toEqual([])
  })

  test('established-era requests dispatch concurrently instead of blocking cancellation behind a queue', async () => {
    const output: string[] = []
    const releaseFirst = deferred()
    const secondStarted = deferred()
    const starts: number[] = []
    const processor = createStdioMessageProcessor({}, line => output.push(line), async message => {
      const id = message.id as number
      starts.push(id)
      if (id === 1) await releaseFirst.promise
      else secondStarted.resolve()
      return reply(id, { completed: true })
    })

    processor.accept(JSON.stringify(modern(1)))
    processor.accept(JSON.stringify(modern(2)))
    await secondStarted.promise
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(starts).toEqual([1, 2])
    expect(output.map(line => JSON.parse(line).id)).toEqual([2])

    releaseFirst.resolve()
    await processor.drain()
    expect(output.map(line => JSON.parse(line).id)).toEqual([2, 1])
  })

  test('initialize commits the legacy revision before the next line is admitted', async () => {
    const output: string[] = []
    const releaseInitialize = deferred()
    const initializeStarted = deferred()
    const starts: number[] = []
    const processor = createStdioMessageProcessor({}, line => output.push(line), async message => {
      const id = message.id as number
      starts.push(id)
      if (id === 1) {
        initializeStarted.resolve()
        await releaseInitialize.promise
        return reply(id, { protocolVersion: '2025-11-25' })
      }
      return reply(id, { tools: [] })
    })

    processor.accept(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    }))
    processor.accept(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    await initializeStarted.promise
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(starts).toEqual([1])

    releaseInitialize.resolve()
    await processor.drain()
    expect(starts).toEqual([1, 2])
    expect(output.map(line => JSON.parse(line).id)).toEqual([1, 2])
  })
})
