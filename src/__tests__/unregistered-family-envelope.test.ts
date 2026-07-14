import { describe, expect, test } from 'bun:test'
import {
  applyOps,
  layoutMermaid,
  layoutMermaidWithReceipt,
  mutateChecked,
  parseRegisteredMermaid,
  renderMermaidASCII,
  renderMermaidSVG,
  serializeMermaid,
  verifyMermaid,
} from '../agent/core.ts'
import { UNREGISTERED_FAMILY_CAPABILITY_STATES } from '../agent/families.ts'
import { MermaidFamilyDetectionError } from '../family-detection.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { renderMermaidPNGInBrowserWithReceipt } from '../browser-png.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { createSectionACapabilityReport } from '../section-a-capability-report.ts'

const CASES = [
  {
    source: '---\ntitle: Deployment\n---\n%%{init: {"theme":"base"}}%%\n%% keep me\nC4Deployment\n  Deployment_Node(a, "A")\n',
    code: 'UNSUPPORTED_FAMILY',
    classification: 'inventory-only',
    representation: 'opaque',
    header: 'C4Deployment',
    family: 'c4',
  },
  {
    source: '\uFEFF\n%% untouched\nfutureDiagram-v99\n  opaque { bytes }\n',
    code: 'UNKNOWN_HEADER',
    classification: 'unknown',
    representation: 'unknown',
    header: 'futureDiagram-v99',
    family: undefined,
  },
] as const

describe('forward-compatible unregistered family envelopes', () => {
  test('unsupported and unknown sources retain exact bytes, identities, and source spans', () => {
    for (const fixture of CASES) {
      const result = parseRegisteredMermaid(fixture.source)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(result.value.body.kind).toBe('preserved')
      if (result.value.body.kind !== 'preserved') continue
      const body = result.value.body
      expect(body).toMatchObject({
        kind: 'preserved',
        representation: fixture.representation,
        source: fixture.source,
        diagnostic: { code: fixture.code },
        preservation: {
          version: 1,
          classification: fixture.classification,
          header: fixture.header,
          ...(fixture.family === undefined ? {} : { upstreamFamilyId: fixture.family }),
        },
      })
      expect(serializeMermaid(result.value)).toBe(fixture.source)
      expect(fixture.source.slice(body.spans.source.start.offset, body.spans.source.end.offset)).toBe(fixture.source)
      expect(fixture.source.slice(body.spans.header.start.offset, body.spans.header.end.offset)).toBe(fixture.header)
      expect(body.spans.body.start.offset).toBeGreaterThan(body.spans.header.end.offset)
      expect(body.preservation.spans).toEqual(body.spans)
      expect(Object.isFrozen(body.spans)).toBe(true)
    }
  })

  test('anchors preservation spans to the authored family line after BOM and frontmatter wrappers', () => {
    const attachedBom = '\uFEFFfutureDiagram-v99\n  payload\n'
    const frontmatterCollision = '---\ntitle: |\n  futureDiagram-v99\n---\nfutureDiagram-v99\n  payload\n'

    for (const [source, expectedHeaderStart] of [
      [attachedBom, 1],
      [frontmatterCollision, frontmatterCollision.lastIndexOf('futureDiagram-v99')],
    ] as const) {
      const result = parseRegisteredMermaid(source)
      expect(result.ok).toBe(true)
      if (!result.ok || result.value.body.kind !== 'preserved') continue
      const { spans } = result.value.body
      expect(spans.header.start.offset).toBe(expectedHeaderStart)
      expect(source.slice(spans.header.start.offset, spans.header.end.offset)).toBe('futureDiagram-v99')
      expect(source.slice(spans.body.start.offset)).toBe('  payload\n')
    }
  })

  test('raw SVG, native/browser PNG, terminal, and layout adapters share wrapper-aware spans', async () => {
    const source = '---\ntitle: |\n  futureDiagram-v99\n---\nfutureDiagram-v99\n  payload\n'
    const expectedHeaderStart = source.lastIndexOf('futureDiagram-v99')
    const assertDiagnostic = (error: unknown): void => {
      expect(error).toBeInstanceOf(MermaidFamilyDetectionError)
      const diagnostic = error as MermaidFamilyDetectionError
      expect(diagnostic.code).toBe('UNKNOWN_HEADER')
      expect(diagnostic.preservation.spans?.header.start.offset).toBe(expectedHeaderStart)
      expect(diagnostic.preservation.spans?.body.start.offset).toBe(source.indexOf('  payload\n'))
    }

    for (const render of [
      () => renderMermaidSVG(source),
      () => renderMermaidASCII(source, { colorMode: 'none' }),
      () => layoutMermaidWithReceipt(source),
      () => renderMermaidPNG(source),
    ]) {
      try {
        render()
        throw new Error('unknown raw family unexpectedly rendered')
      } catch (error) {
        assertDiagnostic(error)
      }
    }

    let rasterized = false
    try {
      await renderMermaidPNGInBrowserWithReceipt(source, {}, 1, async () => {
        rasterized = true
        return { png: new Uint8Array() }
      })
      throw new Error('unknown raw family unexpectedly reached the browser rasterizer')
    } catch (error) {
      assertDiagnostic(error)
    }
    expect(rasterized).toBe(false)
  })

  test('entity-decoded family detection retains exact authored preservation spans on every adapter', async () => {
    const fixtures = [
      {
        source: 'futureDiagram&#45;v99\n  payload\n',
        authoredHeader: 'futureDiagram&#45;v99',
        semanticHeader: 'futureDiagram-v99',
        code: 'UNKNOWN_HEADER',
      },
      {
        source: 'C4&#68;eployment\n  Deployment_Node(a, "A")\n',
        authoredHeader: 'C4&#68;eployment',
        semanticHeader: 'C4Deployment',
        code: 'UNSUPPORTED_FAMILY',
      },
    ] as const

    for (const fixture of fixtures) {
      const parsed = parseRegisteredMermaid(fixture.source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok || parsed.value.body.kind !== 'preserved') continue
      expect(parsed.value.body.preservation.header).toBe(fixture.semanticHeader)
      const span = parsed.value.body.spans.header
      expect(fixture.source.slice(span.start.offset, span.end.offset)).toBe(fixture.authoredHeader)

      const assertDiagnostic = (error: unknown): void => {
        expect(error).toBeInstanceOf(MermaidFamilyDetectionError)
        const diagnostic = error as MermaidFamilyDetectionError
        expect(diagnostic.code).toBe(fixture.code)
        expect(diagnostic.preservation.header).toBe(fixture.semanticHeader)
        const authored = diagnostic.preservation.spans!.header
        expect(fixture.source.slice(authored.start.offset, authored.end.offset)).toBe(fixture.authoredHeader)
      }
      for (const render of [
        () => renderMermaidSVG(fixture.source),
        () => renderMermaidASCII(fixture.source, { colorMode: 'none' }),
        () => layoutMermaidWithReceipt(fixture.source),
        () => renderMermaidPNG(fixture.source),
      ]) {
        try {
          render()
          throw new Error('entity-encoded unregistered family unexpectedly rendered')
        } catch (error) {
          assertDiagnostic(error)
        }
      }
      try {
        await renderMermaidPNGInBrowserWithReceipt(fixture.source, {}, 1, async () => ({ png: new Uint8Array() }))
        throw new Error('entity-encoded unregistered family unexpectedly rasterized')
      } catch (error) {
        assertDiagnostic(error)
      }
    }
  })

  test('entity-encoded registered headers have parse, render, terminal, and layout parity', () => {
    const encoded = 'flowchart&#32;LR\n  A[Alpha] --> B[Beta]'
    const decoded = 'flowchart LR\n  A[Alpha] --> B[Beta]'
    const parsed = parseRegisteredMermaid(encoded)
    expect(parsed).toMatchObject({ ok: true, value: { kind: 'flowchart' } })
    expect(renderMermaidSVG(encoded)).toBe(renderMermaidSVG(decoded))
    expect(renderMermaidASCII(encoded, { colorMode: 'none' }))
      .toBe(renderMermaidASCII(decoded, { colorMode: 'none' }))
    expect(layoutMermaidWithReceipt(encoded).layout).toEqual(layoutMermaidWithReceipt(decoded).layout)
  })

  test('runtime preservation and diagnostics match both capability projections', () => {
    const source = 'swimlane-beta\n  lane A\n'
    const report = createSectionACapabilityReport()
    const family = report.matrices.families.find(row => row.id === 'swimlane')!
    const processing = report.matrices.syntax.families.find(row =>
      row.familyId === family.id && row.dimensionId === 'processing')!

    expect(family.capabilities).toEqual(UNREGISTERED_FAMILY_CAPABILITY_STATES)
    expect(processing.processing).toEqual(UNREGISTERED_FAMILY_CAPABILITY_STATES)
    expect(UNREGISTERED_FAMILY_CAPABILITY_STATES).toMatchObject({
      detection: 'diagnosed',
      'source-preservation': 'source-preserved',
      parse: 'diagnosed',
      serialize: 'source-preserved',
      mutation: 'diagnosed',
      verify: 'diagnosed',
      layout: 'diagnosed',
      scene: 'diagnosed',
      svg: 'diagnosed',
      terminal: 'diagnosed',
    })
    expect(Object.values(UNREGISTERED_FAMILY_CAPABILITY_STATES)).not.toContain('absent')

    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.body).toMatchObject({
      kind: 'preserved',
      source,
      diagnostic: { code: 'UNSUPPORTED_FAMILY' },
    })
    expect(serializeMermaid(parsed.value)).toBe(source)
    for (const unavailable of [
      () => renderMermaidSVG(parsed.value),
      () => renderMermaidASCII(parsed.value, { colorMode: 'none' }),
      () => layoutMermaid(parsed.value),
    ]) {
      expect(unavailable).toThrow(MermaidFamilyDetectionError)
    }
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({
      code: 'RENDER_FAILED',
      reason: expect.stringContaining('UNSUPPORTED_FAMILY'),
    }))
    expect(mutateChecked(parsed.value, { kind: 'add_node', id: 'A', label: 'A' }))
      .toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_FAMILY' } })
  })

  test('Code Mode exposes nested frozen preservation spans through a read-only membrane', async () => {
    const source = '\uFEFFfutureDiagram-v99\n  payload\n'
    const executed = await executeInSandbox(`
      const parsed = mermaid.parseRegisteredMermaid(${JSON.stringify(source)})
      if (!parsed.ok) return parsed
      const point = parsed.value.body.spans.header.start
      let mutationError = ''
      try { point.offset = 99 } catch (error) { mutationError = error.message }
      return {
        offset: point.offset,
        line: point.line,
        col: point.col,
        receiptEnd: parsed.value.body.preservation.spans.source.end.offset,
        mutationError,
      }
    `)
    expect(executed).toMatchObject({
      ok: true,
      value: {
        offset: 1,
        line: 1,
        col: 2,
        receiptEnd: source.length,
        mutationError: expect.stringContaining('read-only'),
      },
    })
  })

  test('render, layout, verify, and mutation return the same stable capability classification', () => {
    for (const fixture of CASES) {
      const result = parseRegisteredMermaid(fixture.source)
      if (!result.ok) throw new Error('expected a preserved parsed envelope')
      const diagram = result.value

      for (const render of [
        () => renderMermaidSVG(diagram),
        () => renderMermaidASCII(diagram, { colorMode: 'none' }),
        () => layoutMermaid(diagram),
      ]) {
        try {
          render()
          throw new Error('unregistered family unexpectedly rendered')
        } catch (error) {
          expect(error).toBeInstanceOf(MermaidFamilyDetectionError)
          expect((error as MermaidFamilyDetectionError).code).toBe(fixture.code)
          expect((error as MermaidFamilyDetectionError).preservation.source).toBe(fixture.source)
        }
      }

      expect(verifyMermaid(diagram).warnings).toContainEqual(expect.objectContaining({
        code: 'RENDER_FAILED',
        reason: expect.stringContaining(fixture.code),
      }))
      const mutation = mutateChecked(diagram, { kind: 'add_node', id: 'A', label: 'A' })
      expect(mutation).toMatchObject({
        ok: false,
        error: { code: fixture.code === 'UNKNOWN_HEADER' ? 'UNKNOWN_HEADER' : 'UNSUPPORTED_FAMILY' },
      })
      expect(applyOps({ source: fixture.source, ops: [] })).toMatchObject({
        ok: false,
        error: { code: fixture.code },
      })
    }
  })
})
