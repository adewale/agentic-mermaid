import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { spawnSync } from 'node:child_process'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import { getFamily, replaceFamilyForTest } from '../agent/families.ts'
import { layoutCertificateProof } from '../agent/certificates.ts'
import { resolveDiagramColors } from '../color-resolver.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { detectDiagramTypeFromFirstLine, normalizeMermaidSource } from '../mermaid-source.ts'
import type { FamilyDescriptor } from '../agent/families.ts'
import type { DiagramKind } from '../agent/types.ts'
import type {
  EdgeRouteCertificate,
  FamilyEdgeRouteCertificate,
  LayoutRouteCertificate,
  PositionedDiagram,
  RegionContainmentCertificate,
  RenderContext,
  RenderOptions,
  RouteCertificate,
} from '../types.ts'
import { DEFAULTS } from '../theme.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { resolveRenderRequest, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { METAMORPHIC_FAMILIES, type FamilyMetamorphic } from './helpers/metamorphic-families.ts'

const RUNS = 24
const TAG = fc.integer({ min: 0, max: 1_000_000 }).map(n => `p${n.toString(36)}`)
const FAMILY = fc.constantFrom(...Object.values(METAMORPHIC_FAMILIES)).chain(family =>
  fc.record({
    family: fc.constant(family),
    k: fc.integer({ min: family.kRange[0], max: family.kRange[1] }),
    tag: TAG,
  }),
)
const HEX = fc.constantFrom('#111827', '#f8fafc', '#ef4444', '#22c55e', '#2563eb', '#f59e0b', '#9333ea')

function sceneContext(source: string, options: RenderOptions = {}): {
  family: FamilyDescriptor
  renderContext: RenderContext<PositionedDiagram>
} {
  const kind = Object.values(METAMORPHIC_FAMILIES).find(f => source.startsWith(headerFor(f.family)))?.family
  const request = resolveRenderRequest(source, options, 'svg')
  const family = resolvedRenderExecutionPlanOf(request).family
  if (!family?.layout || !family.lowerScene) throw new Error(`missing Scene hooks for ${kind ?? 'flowchart'}`)
  const layout = positionResolvedFamily(family.id, request)
  return {
    family,
    renderContext: {
      positioned: layout.positioned,
      colors: request.appearance.colors,
      resolved: {
        renderOptions: request.renderOptions,
        ...(request.appearance.face ? { styleFace: request.appearance.face } : {}),
        ...(request.familyConfig ? { familyConfig: request.familyConfig } : {}),
        ...(request.appearance.family ? { familyAppearance: request.appearance.family } : {}),
      },
    },
  }
}

function headerFor(kind: DiagramKind): string {
  switch (kind) {
    case 'flowchart': return 'flowchart'
    case 'state': return 'stateDiagram'
    case 'sequence': return 'sequenceDiagram'
    case 'timeline': return 'timeline'
    case 'class': return 'classDiagram'
    case 'er': return 'erDiagram'
    case 'journey': return 'journey'
    case 'architecture': return 'architecture-beta'
    case 'xychart': return 'xychart-beta'
    case 'pie': return 'pie'
    case 'quadrant': return 'quadrantChart'
    case 'gantt': return 'gantt'
    case 'mindmap': return 'mindmap'
    case 'gitgraph': return 'gitGraph'
    case 'radar': return 'radar-beta'
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

function buildSource(family: FamilyMetamorphic, k: number, tag: string): string {
  return family.build(k, tag)
}

function assertUsableSvg(svg: string): void {
  expect(svg).toContain('<svg')
  expect(svg).toContain('</svg>')
  expect(svg).not.toMatch(/NaN|undefined/)
}

function assertUsableAscii(ascii: string): void {
  expect(ascii.trim().length).toBeGreaterThan(0)
  expect(ascii).not.toMatch(/undefined/)
}

describe('property: FamilyDescriptor render waist', () => {
  test('public SVG and ASCII renderers dispatch through the registered family hooks', () => {
    fc.assert(
      fc.property(FAMILY, ({ family, k, tag }) => {
        const source = buildSource(family, k, tag)
        const normalized = normalizeMermaidSource(source)
        const publicKind = detectDiagramTypeFromFirstLine(normalized.firstLine) ?? 'flowchart'
        const original = getFamily(publicKind)
        expect(original?.layout).toBeDefined()
        expect(original?.lowerScene).toBeDefined()
        expect(original?.renderSvg).toBeUndefined()
        expect(original?.renderAscii).toBeDefined()
        expect(original?.normalizeRequest).toBeDefined()
        if (!original?.layout || !original.lowerScene || !original.renderAscii || !original.normalizeRequest) return

        let normalizationCalls = 0
        let layoutCalls = 0
        let sceneCalls = 0
        let asciiCalls = 0
        const restore = replaceFamilyForTest(publicKind as DiagramKind, {
          ...original,
          normalizeRequest: ctx => {
            normalizationCalls++
            expect(Object.isFrozen(ctx)).toBe(true)
            expect(Object.isFrozen(ctx.source)).toBe(true)
            expect(Object.isFrozen(ctx.renderOptions)).toBe(true)
            expect(Object.isFrozen(ctx.colors)).toBe(true)
            return original.normalizeRequest!(ctx)
          },
          layout: ctx => {
            layoutCalls++
            return original.layout!(ctx)
          },
          lowerScene: ctx => {
            sceneCalls++
            return original.lowerScene!(ctx)
          },
          renderAscii: ctx => {
            asciiCalls++
            return original.renderAscii!(ctx)
          },
        })

        try {
          const svgA = renderMermaidSVG(source, { embedFontImport: false })
          const svgB = renderMermaidSVG(source, { embedFontImport: false })
          assertUsableSvg(svgA)
          expect(svgB).toBe(svgA)

          const asciiA = renderMermaidASCII(source, { colorMode: 'none' })
          const asciiB = renderMermaidASCII(source, { colorMode: 'none' })
          assertUsableAscii(asciiA)
          expect(asciiB).toBe(asciiA)

          // Terminal connector projection runs the registered layout/lowering
          // waist as well as the two graphical renders.
          expect(normalizationCalls).toBe(4)
          expect(layoutCalls).toBe(4)
          // Both graphical renders and both terminal projections consume the
          // same SceneGraph connector semantics.
          expect(sceneCalls).toBe(4)
          expect(asciiCalls).toBe(2)
        } finally {
          restore()
        }
      }),
      { numRuns: RUNS },
    )
  })

  test('request normalizers cannot smuggle mutable, executable, or second appearance authorities below the waist', () => {
    const original = getFamily('flowchart')!
    const reject = (normalizeRequest: NonNullable<FamilyDescriptor['normalizeRequest']>, message: string): void => {
      const restore = replaceFamilyForTest('flowchart', { ...original, normalizeRequest })
      try {
        expect(() => resolveRenderRequest('flowchart LR\n  A --> B', {}, 'svg')).toThrow(message)
      } finally {
        restore()
      }
    }

    reject(() => ({ appearance: { family: { callback: () => true } as never } }), 'invalid appearance data')
    reject(ctx => ({ appearance: { colors: { ...ctx.colors, font: 'A Different Font' } } }), 'may not rewrite appearance field "font"')
    reject(() => ({ legacyOptions: {} } as never), 'unknown field "legacyOptions"')

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    reject(() => ({ familyConfig: cyclic }), 'data must be acyclic')

    let deep: Record<string, unknown> = { leaf: true }
    for (let depth = 0; depth < 66; depth++) deep = { child: deep }
    reject(() => ({ appearance: { family: deep } }), 'data exceeds maximum depth 64')
    reject(() => ({ familyConfig: { values: new Array(100_001).fill(null) } }), 'data array exceeds the 100000-entry limit')
    reject(() => ({ familyConfig: { value: 'x'.repeat(2_000_001) } }), 'data exceeds the 2000000-character aggregate limit')

    let resultReads = 0
    let nestedOptionReads = 0
    const restoreAccessorResult = replaceFamilyForTest('flowchart', {
      ...original,
      normalizeRequest: ctx => {
        const classOptions: Record<string, unknown> = {}
        Object.defineProperty(classOptions, 'hierarchicalNamespaces', {
          enumerable: true,
          get() {
            nestedOptionReads++
            return nestedOptionReads === 1 ? false : 'changed after validation'
          },
        })
        const result: Record<string, unknown> = {}
        Object.defineProperty(result, 'renderOptions', {
          enumerable: true,
          get() {
            resultReads++
            return resultReads === 1
              ? { ...ctx.renderOptions, class: classOptions }
              : { ...ctx.renderOptions, class: { hierarchicalNamespaces: 'changed after validation' } }
          },
        })
        return result as never
      },
    })
    try {
      const request = resolveRenderRequest('flowchart LR\n  A --> B', {}, 'svg')
      expect(resultReads).toBe(1)
      expect(nestedOptionReads).toBe(1)
      expect(request.renderOptions.class).toEqual({ hierarchicalNamespaces: false })
      expect(Object.isFrozen(request.renderOptions.class)).toBe(true)
    } finally {
      restoreAccessorResult()
    }

    let baseColors: ReturnType<typeof resolveDiagramColors> | undefined
    const restorePalettePatch = replaceFamilyForTest('flowchart', {
      ...original,
      normalizeRequest: ctx => {
        baseColors = { ...ctx.colors }
        return { appearance: { colors: { bg: '#123456' } } }
      },
    })
    try {
      const request = resolveRenderRequest('flowchart LR\n  A --> B', {}, 'svg')
      if (!baseColors) throw new Error('normalizer did not receive the base palette')
      const { bg: _baseBg, ...baseRest } = baseColors
      const { bg, ...requestRest } = request.appearance.colors
      expect(bg).toBe('#123456')
      expect(requestRest).toEqual(baseRest)
    } finally {
      restorePalettePatch()
    }

    let calls = 0
    const restore = replaceFamilyForTest('flowchart', {
      ...original,
      normalizeRequest: ctx => {
        calls++
        return {
          renderOptions: { ...ctx.renderOptions, padding: 31 },
          familyConfig: { geometry: { mode: 'compact' } },
          appearance: { family: { visual: { radius: 7 } } },
        }
      },
    })
    try {
      const request = resolveRenderRequest('flowchart LR\n  A --> B', {}, 'svg')
      const family = resolvedRenderExecutionPlanOf(request).family
      const positioned = positionResolvedFamily('flowchart', request)
      family.lowerScene!({
        positioned: positioned.positioned,
        colors: request.appearance.colors,
        resolved: {
          renderOptions: request.renderOptions,
          ...(request.appearance.face ? { styleFace: request.appearance.face } : {}),
          ...(request.familyConfig ? { familyConfig: request.familyConfig } : {}),
          ...(request.appearance.family ? { familyAppearance: request.appearance.family } : {}),
        },
      })
      expect(calls).toBe(1)
      expect(request.renderOptions.padding).toBe(31)
      expect(request.familyConfig).toEqual({ geometry: { mode: 'compact' } })
      expect(request.appearance.family).toEqual({ visual: { radius: 7 } })
      expect(Object.isFrozen(request.familyConfig)).toBe(true)
      expect(Object.isFrozen((request.familyConfig as any).geometry)).toBe(true)
      expect(Object.isFrozen(request.appearance.family)).toBe(true)
      expect(Object.isFrozen((request.appearance.family as any).visual)).toBe(true)
    } finally {
      restore()
    }
  })

  test('built-in Scene lowering and DefaultBackend are pure over a generated RenderContext', () => {
    fc.assert(
      fc.property(FAMILY, ({ family, k, tag }) => {
        const { family: plugin, renderContext } = sceneContext(buildSource(family, k, tag), {
          embedFontImport: false,
          idPrefix: `prop-${tag}`,
        })
        expect(plugin.renderSvg).toBeUndefined()
        const before = JSON.stringify(renderContext)
        const first = DefaultBackend.render(plugin.lowerScene!(renderContext), { seed: 0 })
        const after = JSON.stringify(renderContext)
        const second = DefaultBackend.render(plugin.lowerScene!(renderContext), { seed: 0 })

        assertUsableSvg(first)
        expect(second).toBe(first)
        expect(after).toBe(before)
      }),
      { numRuns: RUNS },
    )
  })

  test('external plugins sort after metadata-ordered built-ins in an isolated registry process', () => {
    const script = String.raw`
      import fc from 'fast-check'
      import { BUILTIN_FAMILY_METADATA, getFamily, knownFamilies } from './src/agent/families.ts'
      import { registerFamily } from './src/agent/family-registration.ts'

      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
      const builtin = BUILTIN_FAMILY_METADATA.map(f => f.id)
      if (knownFamilies().some(id => !builtin.includes(id))) throw new Error('unexpected preinstalled extension')
      for (const id of builtin) {
        const family = getFamily(id)
        for (const hook of ['parse', 'serialize', 'mutate', 'layout', 'projectPositioned', 'lowerScene', 'renderAscii']) {
          if (typeof family?.[hook] !== 'function') throw new Error(id + ' exposed partial hook state: ' + hook)
        }
      }
      const seen = new Set()
      const idArb = fc.uniqueArray(
        fc.array(fc.constantFrom(...chars), { minLength: 1, maxLength: 6 }).map(xs => xs.join('')),
        { minLength: 1, maxLength: 6 },
      )

      fc.assert(fc.property(idArb, ids => {
        for (const id of ids) {
          const familyId = 'family:test/' + id
          if (seen.has(familyId)) continue
          seen.add(familyId)
          registerFamily({
            contractVersion: 2,
            identity: { id: familyId, kind: 'family', version: '1.0.0', compatibility: { core: '^0.1.1' }, provenance: { owner: 'property-test', source: 'test' } },
            id: familyId,
            label: familyId,
            example: 'test-' + id + '\n  example payload',
            headers: ['test-' + id],
            aliases: [],
            maturity: 'experimental',
            collisionPriority: 0,
            detect: line => line === 'test-' + id,
            semanticRoles: [],
            scenePrimitiveEvidence: [],
            capabilityEvidence: [
              { capability: 'detection', state: 'native', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'source-preservation', state: 'source-preserved', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'parse', state: 'source-preserved', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'serialize', state: 'source-preserved', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'mutation', state: 'diagnosed', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'verify', state: 'diagnosed', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'layout', state: 'absent', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'scene', state: 'absent', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'svg', state: 'absent', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
              { capability: 'terminal', state: 'absent', evidence: ['src/__tests__/property-abstraction-waists.test.ts'] },
            ],
          })
        }
        const got = knownFamilies()
        const head = got.slice(0, builtin.length)
        const tail = got.slice(builtin.length)
        const expectedTail = Array.from(seen).sort()
        if (JSON.stringify(head) !== JSON.stringify(builtin)) {
          throw new Error('built-in order drifted: ' + JSON.stringify(head))
        }
        if (JSON.stringify(tail) !== JSON.stringify(expectedTail)) {
          throw new Error('external order drifted: ' + JSON.stringify({ tail, expectedTail }))
        }
      }), { numRuns: 25 })
    `
    const result = spawnSync('bun', ['-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    expect(result.status, result.stderr || result.stdout).toBe(0)
  })
})

describe('property: color-resolution waist', () => {
  test('RenderOptions win over Mermaid theme variables and theme presets', () => {
    fc.assert(
      fc.property(HEX, HEX, HEX, HEX, HEX, (bg, fg, line, varBg, varFg) => {
        const colors = resolveDiagramColors(
          { bg, fg, line },
          {
            theme: 'forest',
            themeVariables: {
              background: varBg,
              primaryTextColor: varFg,
              lineColor: '#000000',
            },
          },
          'TestFont',
        )
        expect(colors.bg).toBe(bg)
        expect(colors.fg).toBe(fg)
        expect(colors.line).toBe(line)
        expect(colors.font).toBe('TestFont')
      }),
      { numRuns: RUNS },
    )
  })

  test('theme variable aliases win over preset themes and ignore empty aliases', () => {
    fc.assert(
      fc.property(HEX, HEX, HEX, HEX, (mainBkg, primaryText, defaultLink, primaryColor) => {
        const colors = resolveDiagramColors(
          {},
          {
            theme: 'dark',
            themeVariables: {
              background: '',
              mainBkg,
              textColor: '#000000',
              primaryTextColor: primaryText,
              defaultLinkColor: defaultLink,
              primaryColor,
            },
          },
        )
        expect(colors.bg).toBe(mainBkg)
        expect(colors.fg).toBe(primaryText)
        expect(colors.line).toBe(defaultLink)
        expect(colors.surface).toBe(primaryColor)
      }),
      { numRuns: RUNS },
    )
  })

  test('partial and non-string theme values still resolve required bg/fg colors', () => {
    fc.assert(
      fc.property(fc.option(HEX, { nil: undefined }), fc.option(HEX, { nil: undefined }), (bg, fg) => {
        const colors = resolveDiagramColors(
          { bg, fg },
          {
            theme: 'unknown-theme',
            themeVariables: {
              background: 12,
              primaryTextColor: null,
            },
          },
        )
        expect(colors.bg).toBe(bg ?? DEFAULTS.bg)
        expect(colors.fg).toBe(fg ?? DEFAULTS.fg)
      }),
      { numRuns: RUNS },
    )
  })
})

describe('property: layout certificate proof waist', () => {
  const flowchartCert = fc.record({
    edgeIndex: fc.nat(100),
    routeClass: fc.constantFrom<RouteCertificate['routeClass']>('primary-forward', 'feedback', 'self-loop', 'container', 'cross-hierarchy'),
    invariant: fc.constantFrom<RouteCertificate['invariant']>(
      'straight',
      'explained-detour',
      'bundle',
      'outer-feedback',
      'feedback-detour',
      'self-loop',
      'container-attach',
      'unverified-shape',
    ),
    bendCount: fc.nat(8),
  }).map(cert => cert as RouteCertificate)

  const familyEdgeCert: fc.Arbitrary<FamilyEdgeRouteCertificate> = fc.oneof(
    fc.record({
      family: fc.constantFrom<'class' | 'er'>('class', 'er'),
      edgeIndex: fc.nat(100),
      routeClass: fc.constant<'family-layout'>('family-layout'),
      invariant: fc.constantFrom<'orthogonal-box' | 'unverified-family-route'>('orthogonal-box', 'unverified-family-route'),
      bendCount: fc.nat(8),
      orthogonal: fc.boolean(),
      sourceBoundary: fc.boolean(),
      targetBoundary: fc.boolean(),
    }),
    fc.record({
      family: fc.constant<'architecture'>('architecture'),
      edgeIndex: fc.nat(100),
      routeClass: fc.constant<'family-layout'>('family-layout'),
      invariant: fc.constantFrom<'side-anchored' | 'unverified-family-route'>('side-anchored', 'unverified-family-route'),
      bendCount: fc.nat(8),
      orthogonal: fc.boolean(),
      sourceSide: fc.constantFrom('L', 'R', 'T', 'B'),
      targetSide: fc.constantFrom('L', 'R', 'T', 'B'),
      sourceBoundary: fc.constantFrom('item', 'group'),
      targetBoundary: fc.constantFrom('item', 'group'),
      sourceAnchored: fc.boolean(),
      targetAnchored: fc.boolean(),
      placement: fc.constantFrom<'satisfied' | 'conflicted'>('satisfied', 'conflicted'),
      sourceFacesTarget: fc.boolean(),
      targetFacesSource: fc.boolean(),
      obstacleFree: fc.boolean(),
    }),
    fc.record({
      family: fc.constant<'sequence'>('sequence'),
      edgeIndex: fc.nat(100),
      routeClass: fc.constant<'family-layout'>('family-layout'),
      invariant: fc.constantFrom<'lifeline-message' | 'self-message' | 'unverified-family-route'>('lifeline-message', 'self-message', 'unverified-family-route'),
      bendCount: fc.nat(8),
      horizontal: fc.boolean(),
      sourceLifeline: fc.boolean(),
      targetLifeline: fc.boolean(),
      selfMessage: fc.boolean(),
    }),
  )

  const regionCert: fc.Arbitrary<RegionContainmentCertificate> = fc.record({
    family: fc.constantFrom('timeline', 'xychart', 'pie', 'quadrant', 'gantt'),
    elementId: TAG,
    routeClass: fc.constant<'family-layout'>('family-layout'),
    invariant: fc.constantFrom('timeline-interval', 'plot-contained', 'legend-contained', 'section-contained', 'unverified-family-layout'),
    bounds: fc.record({
      x: fc.integer({ min: -100, max: 100 }),
      y: fc.integer({ min: -100, max: 100 }),
      w: fc.integer({ min: 1, max: 500 }),
      h: fc.integer({ min: 1, max: 500 }),
    }),
    center: fc.record({
      x: fc.integer({ min: -100, max: 600 }),
      y: fc.integer({ min: -100, max: 600 }),
    }),
    containment: fc.constantFrom('bounds', 'center'),
    withinBounds: fc.boolean(),
    groupId: fc.option(TAG, { nil: undefined }),
    withinGroup: fc.option(fc.boolean(), { nil: undefined }),
  })

  test('edge-indexed certificates always classify as edge-route proofs', () => {
    fc.assert(
      fc.property(fc.oneof(flowchartCert, familyEdgeCert), cert => {
        expect(layoutCertificateProof(cert)).toBe('edge-route')
      }),
      { numRuns: RUNS },
    )
  })

  test('element-indexed certificates always classify as region-containment proofs', () => {
    fc.assert(
      fc.property(regionCert, cert => {
        expect(layoutCertificateProof(cert)).toBe('region-containment')
      }),
      { numRuns: RUNS },
    )
  })

  test('classification is stable over repeated proof checks', () => {
    fc.assert(
      fc.property(fc.oneof(flowchartCert, familyEdgeCert, regionCert), (cert: LayoutRouteCertificate) => {
        expect(layoutCertificateProof(cert)).toBe(layoutCertificateProof(cert))
      }),
      { numRuns: RUNS },
    )
  })
})

describe('property: source-context layout hooks preserve structured-body layout independence', () => {
  const structuredBodyFamilies = fc.constantFrom(
    METAMORPHIC_FAMILIES.xychart,
    METAMORPHIC_FAMILIES.pie,
    METAMORPHIC_FAMILIES.quadrant,
  ).chain(family =>
    fc.record({
      family: fc.constant(family),
      k: fc.integer({ min: family.kRange[0], max: family.kRange[1] }),
      tag: TAG,
    }),
  )

  test('generated structured bodies still lay out when canonicalSource is corrupted', () => {
    fc.assert(
      fc.property(structuredBodyFamilies, ({ family, k, tag }) => {
        const parsed = parseMermaid(buildSource(family, k, tag))
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return
        expect(parsed.value.body.kind).toBe(family.family)

        const corrupted = {
          ...parsed.value,
          canonicalSource: `${headerFor(family.family)}\n  deliberately invalid generated text`,
        }
        const layout = layoutMermaid(corrupted)
        expect(layout.kind).toBe(family.family)
        expect(layout.nodes.length).toBeGreaterThan(0)
        expect(layout.bounds.w).toBeGreaterThan(0)
        expect(layout.bounds.h).toBeGreaterThan(0)
      }),
      { numRuns: RUNS },
    )
  })
})
