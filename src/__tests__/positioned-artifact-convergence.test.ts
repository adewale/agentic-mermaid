import { describe, expect, test } from 'bun:test'
import {
  layoutMermaid,
  layoutMermaidWithReceipt,
  measureQuality,
  parseMermaid,
  renderMermaidSVGWithReceipt,
  parseRegisteredMermaid,
  registerFamily,
  verifyMermaid,
  type ExternalFamilyId,
  type FamilyDescriptor,
} from '../agent/index.ts'
import {
  BUILTIN_FAMILY_METADATA,
  getFamily,
  replaceFamilyForTest,
} from '../agent/families.ts'
import { toFinite } from '../agent/types.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'

const EVIDENCE = 'src/__tests__/positioned-artifact-convergence.test.ts'

function extensionDescriptor(
  localId: string,
  header: string,
  hooks: Pick<FamilyDescriptor, 'layout' | 'renderSvg'>,
): FamilyDescriptor {
  const id = `family:test/${localId}` as ExternalFamilyId
  return {
    contractVersion: 1,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.1.1' },
      provenance: { owner: 'positioned-artifact-test', source: 'test' },
    }),
    id,
    label: `Extension ${localId}`,
    example: `${header}\n  example payload`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
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
      { capability: 'terminal', state: 'absent', evidence: [EVIDENCE] },
    ],
    verify: () => [],
    ...hooks,
    projectPositioned: () => ({
      version: 1,
      nodes: [{
        id: 'extension-node',
        x: toFinite(8), y: toFinite(8), w: toFinite(104), h: toFinite(24),
        shape: 'rectangle', label: 'Extension',
      }],
      edges: [],
      groups: [],
      bounds: { w: toFinite(120), h: toFinite(40) },
    }),
  }
}

describe('canonical positioned-artifact protocol', () => {
  test('keeps positioned graphical execution behind internal module boundaries', async () => {
    const publicRenderer = await import('../index.ts')
    expect('renderGraphicalSvgWithReceipt' in publicRenderer).toBe(false)
    expect('renderPositionedMermaidSVG' in publicRenderer).toBe(false)
    expect('renderResolvedMermaidSVG' in publicRenderer).toBe(false)
  })

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

        // Structural geometry and renderability consume the exact same
        // positioned artifact: one descriptor layout, one pure projection.
        layoutCalls = 0
        projectionCalls = 0
        const verified = verifyMermaid(parsed.value)
        expect(verified.layout.kind).toBe(metadata.id)
        expect(layoutCalls, `${metadata.id} verification layout count`).toBe(1)
        expect(projectionCalls, `${metadata.id} verification independently projected`).toBe(1)
      } finally {
        restore()
      }
    }
  })

  test('a registered extension verifies and renders from one identical positioned artifact', () => {
    let layoutCalls = 0
    let renderCalls = 0
    const positioned = { width: 120, height: 40 }
    const descriptor = extensionDescriptor('single-positioning', 'singlePositioningDiagram', {
      layout: () => {
        layoutCalls++
        return { positioned }
      },
      renderSvg: context => {
        renderCalls++
        expect(context.positioned).toBe(positioned)
        return '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><text x="8" y="24">Extension</text></svg>'
      },
    })
    const unregister = registerFamily(descriptor)
    // Registration proves the bounded example twice. Runtime convergence
    // counts begin after that admission work has completed.
    layoutCalls = 0
    renderCalls = 0
    try {
      const parsed = parseRegisteredMermaid('singlePositioningDiagram\n  payload')
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const verified = verifyMermaid(parsed.value)
      expect(verified).toMatchObject({ ok: true, layout: { kind: descriptor.id } })
      expect(layoutCalls).toBe(1)
      expect(renderCalls).toBe(1)
    } finally {
      unregister()
    }
  })

  test('positioned rendering failures reject registration and roll back the candidate', () => {
    let layoutCalls = 0
    let renderCalls = 0
    const descriptor = extensionDescriptor('render-failure', 'positionedRenderFailureDiagram', {
      layout: () => {
        layoutCalls++
        return { positioned: { width: 120, height: 40 } }
      },
      renderSvg: () => {
        renderCalls++
        throw new Error('positioned render exploded')
      },
    })
    expect(() => registerFamily(descriptor)).toThrow(/failed executable registration conformance.*positioned render exploded/i)
    expect(getFamily(descriptor.id)).toBeUndefined()
    expect(layoutCalls).toBeGreaterThan(0)
    expect(renderCalls).toBeGreaterThan(0)
  })
})
