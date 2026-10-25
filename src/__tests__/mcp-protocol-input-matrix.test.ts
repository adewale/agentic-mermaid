import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMcpHandler } from '../../website/src/mcp-handler.ts'
import type { HostedMcpContext } from '../mcp/hosted-server.ts'

interface ProtocolCase {
  name: string
  mutation: string
  headers: Record<string, string>
  body: unknown
  expected: {
    status: number
    id?: number | string | null
    errorCode?: number
    errorData?: unknown
    emptyBody?: boolean
    hasResult?: boolean
  }
}

interface ProtocolCorpus {
  cases: ProtocolCase[]
}

const corpus = JSON.parse(readFileSync(join(import.meta.dir, '../../eval/mcp-protocol/cases.json'), 'utf8')) as ProtocolCorpus
if (corpus.cases.length === 0) throw new Error('MCP protocol input matrix has no executable cases')
const context: HostedMcpContext = {
  async execute() { return { ok: true, value: null, logs: [] } },
}
const handler = createMcpHandler({ context, cacheVersion: 'protocol-input-matrix', onEvent: () => {} })

function requestFor(input: ProtocolCase): Request {
  return new Request('https://agentic-mermaid.dev/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...input.headers },
    body: JSON.stringify(input.body),
  })
}

describe('MCP protocol input matrix', () => {
  for (const input of corpus.cases) {
    test(input.name, async () => {
      const response = await handler(requestFor(input))
      expect(response.status).toBe(input.expected.status)
      const text = await response.text()
      if (input.expected.emptyBody) {
        expect(text).toBe('')
        return
      }

      const body = JSON.parse(text) as Record<string, any>
      if (Object.hasOwn(input.expected, 'id')) expect(body.id).toEqual(input.expected.id)
      if (input.expected.errorCode !== undefined) expect(body.error?.code).toBe(input.expected.errorCode)
      if (input.expected.errorData !== undefined) expect(body.error?.data).toEqual(input.expected.errorData)
      if (input.expected.hasResult) {
        expect(body.error).toBeUndefined()
        expect(body.result).toBeDefined()
      }
    })
  }
})
