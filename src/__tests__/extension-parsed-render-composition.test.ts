import { KNOWN_EXTENSION_CONTRACT_VERSIONS } from '../shared/extension-identity.ts'
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
    contractVersion: 2,
    identity: createExtensionIdentity({
      id: FAMILY_ID,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core },
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
  test.each([undefined, null, 'invalid'])('rejects an invalid source policy result %s at registration', result => {
    expect(() => registerFamily({
      ...descriptor(),
      renderSource: (() => result) as unknown as NonNullable<FamilyDescriptor['renderSource']>,
    })).toThrow(/invalid render source policy/)
  })

  test.each(['canonical', 'serialized'] as const)('all render transports use the registered %s source authority', authority => {
    const original = descriptor()
    let observed = ''
    const unregister = registerFamily({
      ...original,
      renderSource: () => authority,
      layout: context => { observed = context.source.familyText.trimEnd(); return original.layout!(context) },
      renderAscii: context => { observed = context.source.familyText.trimEnd(); return original.renderAscii!(context) },
    })
    try {
      const parsed = parsedExtension()
      if (parsed.body.kind !== 'extension') throw new Error('Expected the source-preserved extension envelope')
      const bodySource = 'parsedRenderCompositionDiagram\n  body-owned payload'
      parsed.body.source = bodySource
      const expected = authority === 'serialized' ? 'parsedRenderCompositionDiagram\nbody-owned payload' : 'parsedRenderCompositionDiagram\nfuture payload'
      const options = { security: 'strict' as const, embedFontImport: false }
      observed = ''
      renderMermaidSVGWithReceipt(parsed, options)
      expect(observed).toBe(expected)
      observed = ''
      renderMermaidASCIIWithReceipt(parsed, { ...options, colorMode: 'none' })
      expect(observed).toBe(expected)
      observed = ''
      layoutMermaidWithReceipt(parsed, options)
      expect(observed).toBe(expected)
    } finally { unregister() }
  })

  test("an upgraded source policy cannot consume its predecessor's parsed data", () => {
    const removeOriginal = registerFamily(descriptor())
    const parsed = parsedExtension()
    removeOriginal()
    const upgraded = descriptor()
    let calls = 0
    const removeUpgraded = registerFamily({
      ...upgraded,
      identity: createExtensionIdentity({ ...upgraded.identity, version: '1.1.0' }),
      renderSource: () => { calls++; return 'canonical' },
    })
    try {
      calls = 0
      renderMermaidSVGWithReceipt(parsed, { security: 'strict', embedFontImport: false })
      expect(calls).toBe(0)
    } finally { removeUpgraded() }
  })

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

  test('executes open parsed inputs across graphical, terminal and layout Code Mode outputs', async () => {
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
      // Read before toMatchObject: Bun's toMatchObject writes asymmetric
      // matchers back into the received object.
      const shared = executed.ok ? (executed.value as { shared?: unknown }).shared : undefined
      expect(executed).toMatchObject({
        ok: true,
        value: {
          family: FAMILY_ID,
          outputs: ['svg', 'ascii', 'layout'],
        },
      })
      // All three outputs share one request digest.
      expect({ shared: Array.isArray(shared) ? shared.length : shared, distinct: Array.isArray(shared) ? new Set(shared).size : 0 })
        .toEqual({ shared: 3, distinct: 1 })
    } finally {
      unregister()
    }
  })
})
