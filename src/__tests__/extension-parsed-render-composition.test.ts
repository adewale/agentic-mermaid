import { describe, expect, test } from 'bun:test'

import {
  createExtensionIdentity,
  layoutMermaidWithReceipt,
  parseRegisteredMermaid,
  registerFamily,
  renderMermaidASCIIWithReceipt,
  renderMermaidPNGWithReceipt,
  renderMermaidSVGWithReceipt,
  toFinite,
  type ExternalFamilyId,
  type FamilyDescriptor,
  type ParsedDiagram,
} from '../agent/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { SDK_CORE_DECLARATION } from '../mcp/sdk-discovery.ts'
import {
  renderMermaidASCIIWithReceipt as renderRootASCIIWithReceipt,
  renderMermaidSVGWithReceipt as renderRootSVGWithReceipt,
} from '../index.ts'
import { renderMermaidPNGInBrowserWithReceipt } from '../browser-png.ts'
import { pngFixture } from './helpers/png-fixture.ts'

const EVIDENCE = 'src/__tests__/extension-parsed-render-composition.test.ts'
const FAMILY_ID = 'family:test/parsed-render-composition' as ExternalFamilyId
const SOURCE = 'parsedRenderCompositionDiagram\n  future payload'

function descriptor(): FamilyDescriptor {
  return {
    contractVersion: 1,
    identity: createExtensionIdentity({
      id: FAMILY_ID,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'parsed-render-composition-test', source: 'test' },
    }),
    id: FAMILY_ID,
    label: 'Parsed render composition test',
    example: SOURCE,
    headers: ['parsedRenderCompositionDiagram'],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === 'parsedrendercompositiondiagram',
    semanticRoles: [],
    semanticChannels: [],
    scenePrimitiveEvidence: [],
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: [EVIDENCE] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'parse', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'serialize', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'verify', state: 'native', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'native', evidence: [EVIDENCE] },
      { capability: 'scene', state: 'absent', evidence: [EVIDENCE] },
      { capability: 'svg', state: 'native', evidence: [EVIDENCE] },
      { capability: 'terminal', state: 'native', evidence: [EVIDENCE] },
    ],
    verify: () => [],
    layout: () => ({ width: 120, height: 40 }),
    projectPositioned: () => ({
      version: 1,
      nodes: [{
        id: 'future-node',
        x: toFinite(8),
        y: toFinite(8),
        w: toFinite(104),
        h: toFinite(24),
        shape: 'rectangle',
        label: 'Future',
      }],
      edges: [],
      groups: [],
      bounds: { w: toFinite(120), h: toFinite(40) },
    }),
    renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40" role="img"><title>Future</title><rect x="8" y="8" width="104" height="24" fill="#fff" stroke="#111" /><text x="60" y="25" text-anchor="middle">Future</text></svg>',
    renderAscii: context => context.config.useAscii ? '+-- Future --+' : '┌── Future ──┐',
  }
}

function parsedExtension(): ParsedDiagram {
  const parsed = parseRegisteredMermaid(SOURCE)
  if (!parsed.ok) throw new Error(parsed.error.map(error => error.message).join('; '))
  return parsed.value
}

describe('open parsed-diagram render composition', () => {
  test('entity-encoded headers compose through parse and every renderer', async () => {
    const authored = 'flowchart&#32;TD\n  A --> B'
    const decoded = 'flowchart TD\n  A --> B'
    const parsed = parseRegisteredMermaid(authored)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.kind).toBe('flowchart')
    expect(renderMermaidSVGWithReceipt(parsed.value).svg).toBe(renderMermaidSVGWithReceipt(decoded).svg)
    expect(renderRootSVGWithReceipt(parsed.value).svg).toBe(renderRootSVGWithReceipt(decoded).svg)
    expect(renderMermaidASCIIWithReceipt(parsed.value, { colorMode: 'none' }).text)
      .toBe(renderMermaidASCIIWithReceipt(decoded, { colorMode: 'none' }).text)
    expect(renderRootASCIIWithReceipt(parsed.value, { colorMode: 'none' }).text)
      .toBe(renderRootASCIIWithReceipt(decoded, { colorMode: 'none' }).text)
    expect(layoutMermaidWithReceipt(parsed.value).layout).toEqual(layoutMermaidWithReceipt(decoded).layout)
    const native = renderMermaidPNGWithReceipt(parsed.value, { onWarning: () => {} })
    expect(native.png).toEqual(renderMermaidPNGWithReceipt(decoded, { onWarning: () => {} }).png)

    let projectedSvg = ''
    await renderMermaidPNGInBrowserWithReceipt(parsed.value, {}, { scale: 1 }, async (svg, context) => {
      projectedSvg = svg
      return {
        png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
        fontSources: ['embedded-data-uri'],
      }
    })
    let decodedProjectedSvg = ''
    await renderMermaidPNGInBrowserWithReceipt(decoded, {}, { scale: 1 }, async (svg, context) => {
      decodedProjectedSvg = svg
      return {
        png: pngFixture(context.rasterDimensions.width, context.rasterDimensions.height),
        fontSources: ['embedded-data-uri'],
      }
    })
    expect(projectedSvg).toBe(decodedProjectedSvg)
  })

  test('rejects an extension serializer that changes the canonical example family identity', () => {
    const base = descriptor()
    const mismatched: FamilyDescriptor = {
      ...base,
      capabilityEvidence: base.capabilityEvidence.map(claim => claim.capability === 'serialize'
        ? { ...claim, state: 'native' }
        : claim),
      serialize: () => 'flowchart TD\n  A --> B\n',
    }
    expect(() => registerFamily(mismatched)).toThrow(/serializer changed family identity to "flowchart"/i)
  })

  test('accepts one ExtensionValidDiagram through every typed library renderer', async () => {
    const unregister = registerFamily(descriptor())
    try {
      const parsed = parsedExtension()
      const options = { security: 'strict' as const, embedFontImport: false }
      const svg = renderMermaidSVGWithReceipt(parsed, options)
      const ascii = renderMermaidASCIIWithReceipt(parsed, { ...options, useAscii: true, colorMode: 'none' })
      const unicode = renderMermaidASCIIWithReceipt(parsed, { ...options, useAscii: false, colorMode: 'none' })
      const layout = layoutMermaidWithReceipt(parsed, options)
      const png = renderMermaidPNGWithReceipt(parsed, {
        ...options,
        fitTo: { width: 64 },
        onWarning: () => {},
      })
      const rootSvg = renderRootSVGWithReceipt(parsed, options)
      const rootAscii = renderRootASCIIWithReceipt(parsed, { ...options, useAscii: true, colorMode: 'none' })
      const browserPng = await renderMermaidPNGInBrowserWithReceipt(
        parsed,
        options,
        { fitTo: { width: 64 } },
        async (_securedSvg, context) => ({
          png: renderMermaidPNGWithReceipt(parsed, {
            ...options,
            fitTo: { width: context.rasterDimensions.width },
            onWarning: () => {},
          }).png,
        }),
      )

      expect(parsed.kind).toBe(FAMILY_ID)
      expect(svg.svg).toContain('>Future</text>')
      expect(ascii.text).toBe('+-- Future --+')
      expect(unicode.text).toBe('┌── Future ──┐')
      expect(layout.layout).toMatchObject({ kind: FAMILY_ID, nodes: [{ id: 'future-node' }] })
      expect(Array.from(png.png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      expect(rootSvg.svg).toBe(svg.svg)
      expect(rootAscii.text).toBe(ascii.text)
      expect(Array.from(browserPng.png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])

      const receipts = [
        svg.receipt,
        ascii.receipt,
        unicode.receipt,
        layout.receipt,
        png.receipt,
        rootSvg.receipt,
        rootAscii.receipt,
        browserPng.receipt,
      ]
      expect(new Set(receipts.map(receipt => receipt.sharedRequestDigest)).size).toBe(1)
      expect(new Set(receipts.map(receipt => receipt.appearanceDigest)).size).toBe(1)
      expect(new Set(receipts.map(receipt => receipt.output))).toEqual(new Set(['svg', 'ascii', 'unicode', 'layout', 'png']))
    } finally {
      unregister()
    }
  })

  test('advertises the open parser/render envelope while keeping built-in ops closed', async () => {
    expect(SDK_CORE_DECLARATION).toContain('type ParsedDiagram = ValidDiagram | ExtensionValidDiagram | PreservedValidDiagram')
    expect(SDK_CORE_DECLARATION).toContain('parseRegisteredMermaid(source: string): Result<ParsedDiagram')
    expect(SDK_CORE_DECLARATION).toContain('renderMermaidSVGWithReceipt(input: ParsedDiagram | string')
    expect(SDK_CORE_DECLARATION).toContain('renderMermaidASCIIWithReceipt(input: ParsedDiagram | string')
    expect(SDK_CORE_DECLARATION).toContain('layoutMermaidWithReceipt(input: ParsedDiagram | string')
    expect(SDK_CORE_DECLARATION).toContain('mutate(diagram: ValidDiagram, op: MutationOp)')
    expect(SDK_CORE_DECLARATION).not.toContain('mutate(diagram: ParsedDiagram')

    const unregister = registerFamily(descriptor())
    try {
      const executed = await executeInSandbox(`
        const parsed = mermaid.parseRegisteredMermaid(${JSON.stringify(SOURCE)})
        if (!parsed.ok) return parsed
        const options = { security: 'strict', embedFontImport: false }
        const svg = mermaid.renderMermaidSVGWithReceipt(parsed.value, options)
        const text = mermaid.renderMermaidASCIIWithReceipt(parsed.value, { ...options, useAscii: true, colorMode: 'none' })
        const layout = mermaid.layoutMermaidWithReceipt(parsed.value, options)
        return {
          family: parsed.value.kind,
          outputs: [svg.receipt.output, text.receipt.output, layout.receipt.output],
          shared: [svg.receipt.sharedRequestDigest, text.receipt.sharedRequestDigest, layout.receipt.sharedRequestDigest],
        }
      `)
      expect(executed).toMatchObject({
        ok: true,
        value: {
          family: FAMILY_ID,
          outputs: ['svg', 'ascii', 'layout'],
        },
      })
      if (executed.ok && executed.value && typeof executed.value === 'object' && 'shared' in executed.value) {
        expect(new Set((executed.value as { shared: string[] }).shared).size).toBe(1)
      }
    } finally {
      unregister()
    }
  })
})
