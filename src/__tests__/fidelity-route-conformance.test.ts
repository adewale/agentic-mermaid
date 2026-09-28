import { describe, expect, test } from 'bun:test'
import { BROWSER_EDITOR_ADAPTER } from '../browser.ts'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
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
import type { RenderOptions } from '../types.ts'

const OPTIONS = Object.freeze({
  security: 'strict' as const,
  padding: 17,
  bg: '#f8fafc',
  fg: '#172033',
  accent: '#2563eb',
})
const ALTERNATE_OPTIONS = Object.freeze({
  security: 'strict' as const,
  padding: 31,
  bg: '#111827',
  fg: '#f9fafb',
  accent: '#f59e0b',
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
  let thrown: unknown
  let didThrow = false
  try {
    callable()
  } catch (error) {
    thrown = error
    didThrow = true
  }
  if (!didThrow) throw new Error('Expected the route to reject the diagnosed fidelity case')
  return projectRenderErrorDiagnostic(thrown)
}

async function svgArtifacts(source: string, options: RenderOptions = OPTIONS): Promise<Record<string, { svg: string; receipt: unknown }>> {
  const hosted = payloadOf(await handleHostedRequest(
    call('render_svg', { source, options }),
    hostedContext(),
  ))
  return {
    library: renderMermaidSVGWithReceipt(source, options),
    cli: (() => {
      const rendered = renderSourceToFormatWithReceipt(source, 'svg', options)
      return { svg: rendered.output as string, receipt: rendered.receipt }
    })(),
    browserEditor: BROWSER_EDITOR_ADAPTER.renderMermaidSVGWithReceipt(source, options),
    website: renderWebsiteSVGWithReceipt(source, options),
    hostedMcp: { svg: hosted.svg, receipt: hosted.receipt },
  }
}

describe('issue #248 fidelity route conformance', () => {
  test('diagnostic comparison rejects a route that returns an artifact', () => {
    expect(() => diagnosticFrom(() => ({ svg: '<svg />' }))).toThrow('Expected the route to reject')
  })

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

  test('every built-in family preserves the typed request digest and SVG result across public adapters', async () => {
    for (const familyId of knownBuiltinFamilies()) {
      const source = getFamily(familyId)?.example
      expect(source, `${familyId} source`).toBeDefined()
      if (!source) continue
      const first = await svgArtifacts(source, OPTIONS)
      const alternate = await svgArtifacts(source, ALTERNATE_OPTIONS)
      const firstAuthority = first.library!
      const alternateAuthority = alternate.library!
      expect((firstAuthority.receipt as { sharedRequestDigest: string }).sharedRequestDigest, familyId)
        .not.toBe((alternateAuthority.receipt as { sharedRequestDigest: string }).sharedRequestDigest)
      for (const [label, artifacts, authority] of [
        ['standard', first, firstAuthority],
        ['alternate', alternate, alternateAuthority],
      ] as const) {
        for (const [surface, artifact] of Object.entries(artifacts)) {
          expect(artifact.svg, `${familyId}/${label}/${surface} svg`).toBe(authority.svg)
          expect(artifact.receipt, `${familyId}/${label}/${surface} receipt`).toEqual(authority.receipt)
        }
      }
    }
  })

  test('a changed source changes the request digest and reaches every adapter unchanged', async () => {
    const first = await svgArtifacts('flowchart LR\n  A[Alpha] --> B[Beta]')
    const second = await svgArtifacts('flowchart LR\n  A[Alpha] --> C[Gamma]')
    expect((first.library!.receipt as { sharedRequestDigest: string }).sharedRequestDigest)
      .not.toBe((second.library!.receipt as { sharedRequestDigest: string }).sharedRequestDigest)
    for (const artifacts of [first, second]) {
      for (const [surface, artifact] of Object.entries(artifacts)) {
        expect(artifact.svg, `${surface} svg`).toBe(artifacts.library!.svg)
        expect(artifact.receipt, `${surface} receipt`).toEqual(artifacts.library!.receipt)
      }
    }
  })

  test('named style, theme, and render-option refusals retain every typed field across adapters', async () => {
    const cases = [
      {
        source: 'flowchart LR\n  A --> B\n  style A fill:notacolor',
        options: OPTIONS,
        expected: { code: 'INVALID_STYLE_COLOR', subject: 'style A', property: 'fill', value: 'notacolor' },
      },
      {
        source: '%%{init: {"themeVariables":{"xyChart":{"titleColor":"notacolor"}}}}%%\nxychart\n  x-axis [A]\n  bar [1]',
        options: OPTIONS,
        expected: { code: 'INVALID_THEME_COLOR', key: 'xyChart.titleColor', value: 'notacolor' },
      },
      {
        source: 'architecture-beta\n  service api(server)[API]',
        options: { ...OPTIONS, bg: 'none' },
        expected: { code: 'INVALID_RENDER_COLOR', field: 'bg', value: 'none' },
      },
    ] as const
    for (const { source, options, expected } of cases) {
      const authority = diagnosticFrom(() => renderMermaidSVGWithReceipt(source, options))
      expect(authority).toMatchObject(expected)
      const direct = {
        cli: diagnosticFrom(() => renderSourceToFormatWithReceipt(source, 'svg', options)),
        browserEditor: diagnosticFrom(() => BROWSER_EDITOR_ADAPTER.renderMermaidSVGWithReceipt(source, options)),
        website: diagnosticFrom(() => renderWebsiteSVGWithReceipt(source, options)),
      }
      for (const [surface, diagnostic] of Object.entries(direct)) expect(diagnostic, `${expected.code}/${surface}`).toEqual(authority)
      const hosted = payloadOf(await handleHostedRequest(call('render_svg', { source, options }), hostedContext()))
      expect(hosted).toMatchObject({ ok: false, isError: true, error: authority })
    }
  })

  test('an unknown XYChart statement has the same diagnosed rejection at every adapter boundary', async () => {
    const registry = await discoverFidelityRegistry()
    const fidelityCase = registry.cases.find(candidate => candidate.id === 'xychart.syntax.unknown-statement-render-seam')!
    const capability = FIDELITY_CAPABILITY_REPORT.features.find(feature => feature.featureId === fidelityCase.featureId)!
    expect(capability.disposition).toBe('diagnosed')
    expect(capability.surfaces.render).toBe('diagnosed')
    expect(capability.diagnostics.render).toEqual(['RENDER_FAILED'])

    const authority = diagnosticFrom(() => renderMermaidSVGWithReceipt(fidelityCase.source, OPTIONS))
    expect(authority).toEqual({ code: 'RENDER_FAILED', message: 'Rendering failed' })
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
