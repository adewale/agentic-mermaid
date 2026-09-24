import { describe, expect, test } from 'bun:test'
import { BROWSER_EDITOR_ADAPTER } from '../browser.ts'
import { renderSourceToFormatWithReceipt } from '../cli/index.ts'
import { FIDELITY_CAPABILITY_REPORT } from '../fidelity-capability-report.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import {
  handleHostedRequest,
  type ExecuteResult,
  type HostedMcpContext,
} from '../mcp/hosted-server.ts'
import type { JsonRpcRequest, JsonRpcResponse } from '../mcp/protocol.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import { renderWebsiteSVGWithReceipt } from '../../website/src/rendering.ts'
import { discoverFidelityRegistry } from './fidelity/registry.ts'

const OPTIONS = Object.freeze({
  security: 'strict' as const,
  padding: 17,
  bg: '#f8fafc',
  fg: '#172033',
  accent: '#2563eb',
})

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
    async renderPng(): Promise<never> {
      throw new Error('PNG is outside this SVG route-conformance fixture')
    },
  }
}

function diagnosticFrom(callable: () => unknown): ReturnType<typeof projectRenderErrorDiagnostic> {
  try {
    callable()
    throw new Error('Expected the route to reject the diagnosed fidelity case')
  } catch (error) {
    return projectRenderErrorDiagnostic(error)
  }
}

async function svgArtifacts(source: string): Promise<Record<string, { svg: string; receipt: unknown }>> {
  const hosted = payloadOf(await handleHostedRequest(
    call('render_svg', { source, options: OPTIONS }),
    hostedContext(),
  ))
  return {
    library: renderMermaidSVGWithReceipt(source, OPTIONS),
    cli: (() => {
      const rendered = renderSourceToFormatWithReceipt(source, 'svg', OPTIONS)
      return { svg: rendered.output as string, receipt: rendered.receipt }
    })(),
    browserEditor: BROWSER_EDITOR_ADAPTER.renderMermaidSVGWithReceipt(source, OPTIONS),
    website: renderWebsiteSVGWithReceipt(source, OPTIONS),
    hostedMcp: { svg: hosted.svg, receipt: hosted.receipt },
  }
}

describe('issue #248 fidelity route conformance', () => {
  test('a native construct crosses library, CLI, browser/editor, website, and hosted MCP unchanged', async () => {
    const registry = await discoverFidelityRegistry()
    const fidelityCase = registry.cases.find(candidate => candidate.id === 'flowchart.links.boundary-whitespace-mutation-closure')!
    const capability = FIDELITY_CAPABILITY_REPORT.features.find(feature => feature.featureId === fidelityCase.featureId)!
    expect(capability.disposition).toBe('native')

    const artifacts = await svgArtifacts(fidelityCase.source)
    const authority = artifacts.library!
    for (const [surface, artifact] of Object.entries(artifacts)) {
      expect(artifact.svg, surface).toBe(authority.svg)
      expect(artifact.receipt, surface).toEqual(authority.receipt)
    }
  })

  test('an absent construct stays absent even when every rendering adapter agrees on the partial artifact', async () => {
    const registry = await discoverFidelityRegistry()
    const fidelityCase = registry.cases.find(candidate => candidate.id === 'xychart.syntax.unknown-statement-render-seam')!
    const capability = FIDELITY_CAPABILITY_REPORT.features.find(feature => feature.featureId === fidelityCase.featureId)!
    expect(capability.disposition).toBe('absent')
    expect(capability.surfaces.render).toBe('absent')

    const artifacts = await svgArtifacts(fidelityCase.source)
    const authority = artifacts.library!
    for (const [surface, artifact] of Object.entries(artifacts)) {
      expect(artifact.svg, surface).toBe(authority.svg)
      expect(artifact.receipt, surface).toEqual(authority.receipt)
    }
  })

  test('a diagnosed unsupported construct preserves the same typed diagnostic at every adapter boundary', async () => {
    const registry = await discoverFidelityRegistry()
    const fidelityCase = registry.cases.find(candidate => candidate.id === 'block.family.accurately-diagnosed-unsupported')!
    const capability = FIDELITY_CAPABILITY_REPORT.features.find(feature => feature.featureId === fidelityCase.featureId)!
    expect(capability.disposition).toBe('diagnosed')
    expect(capability.diagnostics.render).toEqual(['UNSUPPORTED_FAMILY'])

    const authority = diagnosticFrom(() => renderMermaidSVGWithReceipt(fidelityCase.source, OPTIONS))
    const direct = {
      cli: diagnosticFrom(() => renderSourceToFormatWithReceipt(fidelityCase.source, 'svg', OPTIONS)),
      browserEditor: diagnosticFrom(() => BROWSER_EDITOR_ADAPTER.renderMermaidSVGWithReceipt(fidelityCase.source, OPTIONS)),
      website: diagnosticFrom(() => renderWebsiteSVGWithReceipt(fidelityCase.source, OPTIONS)),
    }
    for (const [surface, diagnostic] of Object.entries(direct)) expect(diagnostic, surface).toEqual(authority)

    const hosted = payloadOf(await handleHostedRequest(
      call('render_svg', { source: fidelityCase.source, options: OPTIONS }),
      hostedContext(),
    ))
    expect(hosted).toMatchObject({ ok: false, isError: true, error: authority })
  })
})
