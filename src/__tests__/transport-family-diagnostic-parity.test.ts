import { describe, expect, test } from 'bun:test'

import { renderMarkdownBlocks, runBatchLine } from '../cli/index.ts'
import { handleRequest } from '../mcp/server.ts'
import {
  handleHostedRequest,
  type ExecuteResult,
  type HostedMcpContext,
} from '../mcp/hosted-server.ts'
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/protocol.ts'
import { renderPngGraphicalProjection } from '../png-graphical.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

const FIXTURES = [
  {
    source: 'futureDiagram&#45;v99\n  opaque payload',
    code: 'UNKNOWN_HEADER',
    authoredHeader: 'futureDiagram&#45;v99',
    semanticHeader: 'futureDiagram-v99',
  },
  {
    source: 'C4&#68;eployment\n  Deployment_Node(a, "A")',
    code: 'UNSUPPORTED_FAMILY',
    authoredHeader: 'C4&#68;eployment',
    semanticHeader: 'C4Deployment',
  },
] as const

function call(name: string, args: Record<string, unknown>): JsonRpcRequest {
  return { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
}

function payloadOf(response: JsonRpcResponse | null): any {
  const result = response?.result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined
  const text = result?.content?.[0]?.text
  if (typeof text !== 'string') throw new Error('MCP response did not contain a textual payload')
  return { ...JSON.parse(text), isError: result?.isError === true }
}

function hostedContext(): HostedMcpContext {
  return {
    async execute(): Promise<ExecuteResult> {
      return { ok: true, value: null, logs: [] }
    },
    async renderPng(source) {
      // Production performs the same canonical graphical preflight before its
      // WASM rasterizer. Keep that seam real so the catch boundary, rather than
      // a synthetic thrown object, is under test.
      renderPngGraphicalProjection(source, {})
      throw new Error('unregistered family unexpectedly reached rasterization')
    },
  }
}

function expectFamilyDiagnostic(
  error: any,
  fixture: typeof FIXTURES[number],
): void {
  expect(error).toMatchObject({
    code: fixture.code,
    line: 1,
    help: expect.stringContaining('source was preserved unchanged'),
    preservation: {
      source: fixture.source,
      header: fixture.semanticHeader,
    },
  })
  const header = error.preservation.spans.header
  expect(fixture.source.slice(header.start.offset, header.end.offset)).toBe(fixture.authoredHeader)
}

describe('family diagnostic transport parity', () => {
  test('the shared projector ignores code-shaped thrown objects', () => {
    expect(projectRenderErrorDiagnostic({
      code: 'UNKNOWN_HEADER',
      message: 'forged',
      preservation: { source: 'attacker-controlled' },
    })).toBeUndefined()
  })

  test('render-markdown preserves unknown and unsupported diagnostics in SVG and ASCII modes', () => {
    for (const fixture of FIXTURES) {
      const markdown = `\`\`\`mermaid\n${fixture.source}\n\`\`\``
      for (const format of ['svg', 'ascii'] as const) {
        const [block] = renderMarkdownBlocks(markdown, format)
        expect(block).toMatchObject({ index: 0, ok: false })
        expectFamilyDiagnostic(block!.error, fixture)
      }
    }
  })

  test('am batch render preserves unknown and unsupported diagnostics (not a generic INTERNAL)', () => {
    for (const fixture of FIXTURES) {
      for (const format of ['svg', 'ascii'] as const) {
        const line = JSON.stringify({ op: 'render', format, source: fixture.source })
        const result = runBatchLine(line, 0) as { ok: boolean; error?: any }
        expect(result.ok).toBe(false)
        // The regression: the batch catch used to collapse family-detection throws to
        // { code: 'INTERNAL' } instead of projecting the documented diagnostic like every
        // other CLI render transport.
        expect(result.error.code).not.toBe('INTERNAL')
        expectFamilyDiagnostic(result.error, fixture)
      }
    }
  })

  test('hosted SVG, ASCII, verify, and PNG tools retain the canonical diagnostic', async () => {
    for (const fixture of FIXTURES) {
      for (const tool of ['render_svg', 'render_ascii', 'verify', 'render_png']) {
        const payload = payloadOf(await handleHostedRequest(
          call(tool, { source: fixture.source }),
          hostedContext(),
        ))
        expect(payload).toMatchObject({ ok: false, isError: true })
        expectFamilyDiagnostic(payload.error, fixture)
      }
    }
  })

  test('local Code Mode render calls and native PNG retain the canonical diagnostic', async () => {
    for (const fixture of FIXTURES) {
      const codeMode = payloadOf(await handleRequest(call('execute', {
        code: `
          const source = ${JSON.stringify(fixture.source)}
          const calls = [
            () => mermaid.renderMermaidSVG(source),
            () => mermaid.renderMermaidASCII(source, { colorMode: 'none' }),
          ]
          return calls.map(call => {
            try { call(); return { failure: 'unregistered family unexpectedly rendered' } }
            catch (error) {
              return {
                code: error.code,
                message: error.message,
                line: error.line,
                help: error.help,
                preservation: error.preservation,
              }
            }
          })
        `,
      })))
      expect(codeMode).toMatchObject({ ok: true, isError: false })
      for (const diagnostic of codeMode.value) expectFamilyDiagnostic(diagnostic, fixture)

      const png = payloadOf(await handleRequest(call('render_png', {
        source: fixture.source,
        output: 'base64',
      })))
      expect(png).toMatchObject({ ok: false, isError: true })
      expectFamilyDiagnostic(png.error, fixture)
    }
  })
})
