import { describe, expect, test } from 'bun:test'
import {
  layoutMermaid,
  layoutMermaidWithReceipt,
  measureQuality,
  parseMermaid,
  renderMermaidSVGWithReceipt,
  verifyMermaid,
} from '../agent/index.ts'
import {
  BUILTIN_FAMILY_METADATA,
  getFamily,
  replaceFamilyForTest,
} from '../agent/families.ts'

describe('canonical positioned-artifact protocol', () => {
  test('shared geometry options reach SVG and layout through the same resolved request', () => {
    const source = 'flowchart TD\n  A[Start] --> B[Finish]'
    const parsed = parseMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const baseline = layoutMermaid(parsed.value)
    const options = { nodeSpacing: 200, layerSpacing: 200 }
    const layout = layoutMermaidWithReceipt(source, options)
    const svg = renderMermaidSVGWithReceipt(source, options)
    const viewBox = /viewBox="([^"]+)"/.exec(svg.svg)?.[1]
      ?.split(/\s+/).map(Number)

    expect(layout.layout.nodes.find(node => node.id === 'B')?.y)
      .toBeGreaterThan(baseline.nodes.find(node => node.id === 'B')!.y)
    expect(viewBox).toHaveLength(4)
    expect(Math.round(viewBox![2]!)).toBe(layout.layout.bounds.w)
    expect(Math.round(viewBox![3]!)).toBe(layout.layout.bounds.h)
    expect(svg.receipt.sharedRequestDigest).toBe(layout.receipt.sharedRequestDigest)
  })

  test('every registered built-in dispatches layout JSON through its descriptor-owned artifact and view', () => {
    for (const metadata of BUILTIN_FAMILY_METADATA) {
      const descriptor = getFamily(metadata.id)
      expect(descriptor?.layout, `${metadata.id} layout hook`).toBeDefined()
      expect(descriptor?.projectPositioned, `${metadata.id} positioned view`).toBeDefined()
      if (!descriptor?.layout || !descriptor.projectPositioned) continue

      let layoutCalls = 0
      let projectionCalls = 0
      const restore = replaceFamilyForTest(metadata.id, {
        ...descriptor,
        layout: context => {
          layoutCalls++
          return descriptor.layout!(context)
        },
        projectPositioned: context => {
          projectionCalls++
          return descriptor.projectPositioned!(context)
        },
      })

      try {
        const parsed = parseMermaid(metadata.example)
        expect(parsed.ok, `${metadata.id} example parses`).toBe(true)
        if (!parsed.ok) continue
        const layout = layoutMermaid(parsed.value, { debug: true })
        expect(layout.kind).toBe(metadata.id)
        expect(layout.bounds.w).toBeGreaterThan(0)
        expect(layout.bounds.h).toBeGreaterThan(0)
        expect(layoutCalls, `${metadata.id} independently positioned`).toBe(1)
        expect(projectionCalls, `${metadata.id} independently projected`).toBe(1)

        // Quality consumes the descriptor projection; it must not trigger a
        // hidden second family layout.
        expect(Number.isFinite(measureQuality(layout).whitespaceBalance)).toBe(true)
        expect(layoutCalls, `${metadata.id} quality re-positioned`).toBe(1)
        expect(projectionCalls, `${metadata.id} quality re-projected`).toBe(1)

        // Verification projects exactly one positioned artifact. Its separate
        // render-parity gate may render (and therefore position) once more,
        // but must not create a second RenderedLayout projection.
        layoutCalls = 0
        projectionCalls = 0
        const verified = verifyMermaid(parsed.value)
        expect(verified.layout.kind).toBe(metadata.id)
        expect(layoutCalls, `${metadata.id} verification never positioned`).toBeGreaterThanOrEqual(1)
        expect(projectionCalls, `${metadata.id} verification independently projected`).toBe(1)
      } finally {
        restore()
      }
    }
  })
})
