import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { spawnSync } from 'node:child_process'
import { layoutMermaid, parseMermaid } from '../agent/index.ts'
import { BUILTIN_FAMILY_METADATA, registerFamily } from '../agent/families.ts'
import { layoutCertificateProof } from '../agent/certificates.ts'
import { resolveDiagramColors } from '../color-resolver.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { detectDiagramTypeFromFirstLine, normalizeMermaidSource } from '../mermaid-source.ts'
import { getFamily } from '../render-family-hooks.ts'
import type { FamilyLayoutResult, FamilyPlugin } from '../agent/families.ts'
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
import type { DiagramColors } from '../theme.ts'
import { DEFAULTS } from '../theme.ts'
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

function normalizeLayoutResult<TPositioned extends PositionedDiagram>(
  result: FamilyLayoutResult<TPositioned> | TPositioned,
): FamilyLayoutResult<TPositioned> {
  return 'positioned' in result ? result : { positioned: result }
}

function svgContext(source: string, options: RenderOptions = {}): {
  family: FamilyPlugin
  renderContext: RenderContext<PositionedDiagram>
} {
  const normalized = normalizeMermaidSource(source, options.mermaidConfig ?? {})
  const colors = resolveDiagramColors(options, normalized.config, options.font ?? 'Inter')
  const renderOptions: RenderOptions = { ...options, mermaidConfig: normalized.config }
  const kind = Object.values(METAMORPHIC_FAMILIES).find(f => source.startsWith(headerFor(f.family)))?.family
  const family = getFamily(kind ?? 'flowchart')
  if (!family?.layout || !family.renderSvg) throw new Error(`missing render hooks for ${kind ?? 'flowchart'}`)
  const layout = normalizeLayoutResult(family.layout({
    source: normalized,
    options,
    renderOptions,
    colors,
  }))
  return {
    family,
    renderContext: {
      positioned: layout.positioned,
      colors: layout.colors ?? colors,
      options: layout.options ?? renderOptions,
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

describe('property: FamilyPlugin render waist', () => {
  test('public SVG and ASCII renderers dispatch through the registered family hooks', () => {
    fc.assert(
      fc.property(FAMILY, ({ family, k, tag }) => {
        const source = buildSource(family, k, tag)
        const normalized = normalizeMermaidSource(source)
        const publicKind = detectDiagramTypeFromFirstLine(normalized.firstLine) ?? 'flowchart'
        const original = getFamily(publicKind)
        expect(original?.layout).toBeDefined()
        expect(original?.renderSvg).toBeDefined()
        expect(original?.renderAscii).toBeDefined()
        if (!original?.layout || !original.renderSvg || !original.renderAscii) return

        let layoutCalls = 0
        let svgCalls = 0
        let asciiCalls = 0
        registerFamily({
          ...original,
          layout: ctx => {
            layoutCalls++
            return original.layout!(ctx)
          },
          renderSvg: ctx => {
            svgCalls++
            return original.renderSvg!(ctx)
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

          expect(layoutCalls).toBe(2)
          expect(svgCalls).toBe(2)
          expect(asciiCalls).toBe(2)
        } finally {
          registerFamily(original)
        }
      }),
      { numRuns: RUNS },
    )
  })

  test('family SVG render hooks are pure over a generated RenderContext', () => {
    fc.assert(
      fc.property(FAMILY, ({ family, k, tag }) => {
        const { family: plugin, renderContext } = svgContext(buildSource(family, k, tag), {
          embedFontImport: false,
          idPrefix: `prop-${tag}`,
        })
        const before = JSON.stringify(renderContext)
        const first = plugin.renderSvg!(renderContext)
        const after = JSON.stringify(renderContext)
        const second = plugin.renderSvg!(renderContext)

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
      import { BUILTIN_FAMILY_METADATA, knownFamilies, registerFamily } from './src/agent/families.ts'
      import './src/agent/families-builtin.ts'

      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
      const builtin = BUILTIN_FAMILY_METADATA.map(f => f.id)
      const seen = new Set()
      const idArb = fc.uniqueArray(
        fc.array(fc.constantFrom(...chars), { minLength: 1, maxLength: 6 }).map(xs => 'x-' + xs.join('')),
        { minLength: 1, maxLength: 6 },
      )

      fc.assert(fc.property(idArb, ids => {
        for (const id of ids) {
          seen.add(id)
          registerFamily({ id, detect: () => false })
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
