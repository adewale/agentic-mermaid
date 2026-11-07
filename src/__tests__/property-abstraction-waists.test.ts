import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { layoutCertificateProof } from '../agent/certificates.ts'
import type { FamilyDescriptor, FamilyLayoutResult } from '../agent/families.ts'
import { getFamily, replaceFamilyForTest } from '../agent/families.ts'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid } from '../agent/index.ts'
import type { DiagramKind } from '../agent/types.ts'
import { resolveDiagramColors } from '../color-resolver.ts'
import { renderMermaidASCIIWithReceipt, renderMermaidSVG } from '../index.ts'
import { detectDiagramTypeFromFirstLine, normalizeMermaidSource } from '../mermaid-source.ts'
import { normalizeFamilyLayoutResult, positionResolvedFamily } from '../positioning.ts'
import { resolvedRenderExecutionPlanOf, resolveRenderRequest } from '../render-contract.ts'
import { DefaultBackend } from '../scene/backend.ts'
import { DEFAULTS } from '../theme.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from '../types.ts'
import { fcParameters } from './helpers/fc-parameters.ts'
import { type FamilyMetamorphic, METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

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

function sceneContext(
  source: string,
  options: RenderOptions = {},
): {
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
    case 'packet':
      return 'packet'
    case 'kanban':
      return 'kanban'
    case 'requirement':
      return 'requirementDiagram'
    case 'treemap':
      return 'treemap'
    case 'ishikawa':
      return 'ishikawa'
    case 'block':
      return 'block'
    case 'c4':
      return 'C4'
    case 'flowchart':
      return 'flowchart'
    case 'state':
      return 'stateDiagram'
    case 'sequence':
      return 'sequenceDiagram'
    case 'timeline':
      return 'timeline'
    case 'class':
      return 'classDiagram'
    case 'er':
      return 'erDiagram'
    case 'journey':
      return 'journey'
    case 'architecture':
      return 'architecture-beta'
    case 'xychart':
      return 'xychart-beta'
    case 'pie':
      return 'pie'
    case 'quadrant':
      return 'quadrantChart'
    case 'gantt':
      return 'gantt'
    case 'mindmap':
      return 'mindmap'
    case 'gitgraph':
      return 'gitGraph'
    case 'radar':
      return 'radar-beta'
    case 'zenuml': return 'zenuml'
    case 'eventmodeling': return 'eventmodeling'
    case 'sankey':
      return 'sankey-beta'
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

const PERTURBED_FG = '#0a0b0c'
const PERTURBED_WIDTH = 37
const PERTURBED_TERMINAL_LINE = 'perturbed-terminal-hook'

function withFamilyHooks<T>(kind: DiagramKind, replacement: FamilyDescriptor, run: () => T): T {
  const restore = replaceFamilyForTest(kind, replacement)
  try {
    return run()
  } finally {
    restore()
  }
}

function widenPositioned(result: FamilyLayoutResult | PositionedDiagram, by: number): FamilyLayoutResult {
  const { positioned, ...rest } = normalizeFamilyLayoutResult(result)
  return { ...rest, positioned: { ...positioned, width: positioned.width + by } }
}

function intrinsicWidth(svg: string): number {
  const match = /<svg\b[^>]*\bwidth="([\d.]+)"/.exec(svg) ?? /<svg\b[^>]*\bmax-width:([\d.]+)px/.exec(svg)
  if (!match) throw new Error('rendered SVG has no numeric display width')
  return Number(match[1])
}

describe('property: FamilyDescriptor render waist', () => {
  // Each registered hook is replaced by one that perturbs its result. The
  // perturbation must surface in the public output, which proves the public
  // renderers execute the registered hook rather than a private copy.
  test('public SVG and ASCII renderers dispatch through the registered family hooks', () => {
    fc.assert(
      fc.property(FAMILY, ({ family, k, tag }) => {
        const source = buildSource(family, k, tag)
        const normalized = normalizeMermaidSource(source)
        const publicKind = (detectDiagramTypeFromFirstLine(normalized.firstLine) ?? 'flowchart') as DiagramKind
        const original = getFamily(publicKind)
        expect(original?.layout).toBeDefined()
        expect(original?.lowerScene).toBeDefined()
        expect(original?.renderAscii).toBeDefined()
        if (!original?.layout || !original.lowerScene || !original.renderAscii) return
        const { layout, renderAscii, normalizeRequest } = original
        const renderSvg = () => renderMermaidSVG(source, { embedFontImport: false })
        const renderAsciiReceipt = () => renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })

        const svg = renderSvg()
        assertUsableSvg(svg)
        expect(renderSvg()).toBe(svg)
        const ascii = renderAsciiReceipt()
        assertUsableAscii(ascii.text)
        expect(renderAsciiReceipt().text).toBe(ascii.text)
        expect(svg).not.toContain(PERTURBED_FG)
        expect(ascii.terminalStyle.theme.fg).not.toBe(PERTURBED_FG)
        expect(ascii.terminalStyle.connectorProjection.evidence).toBe('scene')

        // normalizeRequest: the frozen request context is the contract; a
        // palette patch it returns reaches both the SVG and the terminal theme.
        withFamilyHooks(
          publicKind,
          {
            ...original,
            normalizeRequest: ctx => {
              expect(Object.isFrozen(ctx)).toBe(true)
              expect(Object.isFrozen(ctx.source)).toBe(true)
              expect(Object.isFrozen(ctx.renderOptions)).toBe(true)
              expect(Object.isFrozen(ctx.colors)).toBe(true)
              const result = normalizeRequest?.(ctx) ?? {}
              return { ...result, appearance: { ...result.appearance, colors: { ...result.appearance?.colors, fg: PERTURBED_FG } } }
            },
          },
          () => {
            expect(renderSvg()).toContain(PERTURBED_FG)
            expect(renderAsciiReceipt().terminalStyle.theme.fg).toBe(PERTURBED_FG)
          },
        )

        // layout: a widened positioned artifact widens the SVG canvas.
        withFamilyHooks(publicKind, { ...original, layout: ctx => widenPositioned(layout(ctx), PERTURBED_WIDTH) }, () => {
          expect(intrinsicWidth(renderSvg())).toBeCloseTo(intrinsicWidth(svg) + PERTURBED_WIDTH, 6)
        })

        // layout and lowerScene: SVG rendering surfaces a failing hook. The
        // terminal text does not depend on either hook, but its connector
        // semantics are read through them, so the receipt loses its Scene
        // evidence while the text stays byte-identical.
        for (const hook of ['layout', 'lowerScene'] as const) {
          const failure = `perturbed ${hook} hook`
          withFamilyHooks(
            publicKind,
            {
              ...original,
              [hook]: () => {
                throw new Error(failure)
              },
            },
            () => {
              expect(renderSvg).toThrow(failure)
              const perturbed = renderAsciiReceipt()
              expect(perturbed.text).toBe(ascii.text)
              expect(perturbed.terminalStyle.connectorProjection.evidence).toBe('unavailable')
            },
          )
        }

        // renderAscii: the terminal text is the registered hook's output, and
        // SVG never routes through the terminal hook.
        withFamilyHooks(publicKind, { ...original, renderAscii: ctx => `${renderAscii(ctx)}\n${PERTURBED_TERMINAL_LINE}` }, () => {
          expect(renderAsciiReceipt().text).toBe(`${ascii.text}\n${PERTURBED_TERMINAL_LINE}`)
          expect(renderSvg()).toBe(svg)
        })
      }),
      fcParameters({ numRuns: RUNS }),
    )
  }, 30_000)

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
    for (const value of [NaN, Infinity, -Infinity, 1n, Symbol('invalid'), () => true]) {
      reject(() => ({ familyConfig: { value } }), 'invalid config data')
    }
    reject(() => ({ familyConfig: JSON.parse('{"nested":{"constructor":true}}') }), 'uses a forbidden prototype key')
    reject(ctx => ({ appearance: { colors: { ...ctx.colors, font: 'A Different Font' } } }), 'may not rewrite appearance field "font"')
    reject(() => ({ legacyOptions: {} }) as never, 'unknown field "legacyOptions"')

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
    let familyReads = 0
    const familyValue = { label: 'captured' }
    const arrayValue = { label: 'captured array child' }
    const frozenFamily = Object.freeze({
      get value() { familyReads++; return familyValue },
      values: Object.freeze([arrayValue]),
    })
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
            return resultReads === 1 ? { ...ctx.renderOptions, class: classOptions } : { ...ctx.renderOptions, class: { hierarchicalNamespaces: 'changed after validation' } }
          },
        })
        result.familyConfig = frozenFamily
        return result as never
      },
    })
    try {
      const request = resolveRenderRequest('flowchart LR\n  A --> B', {}, 'svg')
      expect(resultReads).toBe(1)
      expect(nestedOptionReads).toBe(1)
      expect(request.renderOptions.class).toEqual({ hierarchicalNamespaces: false })
      expect(Object.isFrozen(request.renderOptions.class)).toBe(true)
      familyValue.label = 'changed after capture'
      arrayValue.label = 'changed array child'
      expect(familyReads).toBe(1)
      expect(request.familyConfig).toEqual({
        value: { label: 'captured' }, values: [{ label: 'captured array child' }],
      })
      expect(Object.isFrozen(request.familyConfig?.value)).toBe(true)
      expect(Object.isFrozen(request.familyConfig?.values)).toBe(true)
      expect(Object.isFrozen((request.familyConfig?.values as readonly unknown[])[0])).toBe(true)
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
      fcParameters({ numRuns: RUNS }),
    )
  })

  test('external plugins sort after metadata-ordered built-ins in an isolated registry process', async () => {
    const script = String.raw`
      import fc from 'fast-check'
      import { BUILTIN_FAMILY_METADATA, getFamily, knownFamilies } from './src/agent/families.ts'
      import { registerFamily } from './src/agent/family-registration.ts'
      import { KNOWN_EXTENSION_CONTRACT_VERSIONS } from './src/shared/extension-identity.ts'

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
            identity: { id: familyId, kind: 'family', version: '1.0.0', compatibility: { core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core }, provenance: { owner: 'property-test', source: 'test' } },
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
    const result = await runChild('bun', ['-e', script], { cwd: process.cwd() })
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
      fcParameters({ numRuns: RUNS }),
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
      fcParameters({ numRuns: RUNS }),
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
      fcParameters({ numRuns: RUNS }),
    )
  })
})

describe('layout certificate proof classification', () => {
  test('edge certificates retain route classification even when geometric checks fail', () => {
    for (const invariant of ['straight', 'explained-detour', 'bundle', 'outer-feedback', 'feedback-detour', 'self-loop', 'container-attach', 'unverified-shape'] as const) {
      expect(layoutCertificateProof({ edgeIndex: 0, routeClass: 'primary-forward', bendCount: 0, invariant })).toBe('edge-route')
    }
    for (const family of ['class', 'er'] as const) {
      for (const invariant of ['orthogonal-box', 'unverified-family-route'] as const) {
        expect(layoutCertificateProof({ family, edgeIndex: 1, routeClass: 'family-layout', invariant, bendCount: 0, orthogonal: true, sourceBoundary: true, targetBoundary: true })).toBe('edge-route')
      }
      for (const [orthogonal, sourceBoundary, targetBoundary] of [[false, true, true], [true, false, true], [true, true, false]] as const) {
        expect(layoutCertificateProof({ family, edgeIndex: 0, routeClass: 'family-layout', invariant: 'unverified-family-route', bendCount: 1,
          orthogonal, sourceBoundary, targetBoundary,
        })).toBe('edge-route')
      }
    }
    for (const invariant of ['side-anchored', 'unverified-family-route'] as const) {
      expect(layoutCertificateProof({ family: 'architecture', edgeIndex: 0, routeClass: 'family-layout', invariant,
        bendCount: 0, orthogonal: true, sourceSide: 'R', targetSide: 'L', sourceBoundary: 'item', targetBoundary: 'item',
        sourceAnchored: true, targetAnchored: true, placement: 'satisfied', sourceFacesTarget: true, targetFacesSource: true, obstacleFree: true,
      })).toBe('edge-route')
    }
    expect(layoutCertificateProof({ family: 'architecture', edgeIndex: 0, routeClass: 'family-layout', invariant: 'unverified-family-route',
      bendCount: 2, orthogonal: false, sourceSide: 'R', targetSide: 'L', sourceBoundary: 'item', targetBoundary: 'group',
      sourceAnchored: false, targetAnchored: false, placement: 'conflicted', sourceFacesTarget: false, targetFacesSource: false, obstacleFree: false,
    })).toBe('edge-route')
    for (const invariant of ['lifeline-message', 'self-message', 'unverified-family-route'] as const) {
      expect(layoutCertificateProof({ family: 'sequence', edgeIndex: 0, routeClass: 'family-layout', invariant,
        bendCount: 0, horizontal: true, sourceLifeline: true, targetLifeline: true, selfMessage: false,
      })).toBe('edge-route')
    }
  })

  test('valid element certificates retain region-containment classification', () => {
    expect(layoutCertificateProof({ family: 'pie', elementId: 'failed-legend', routeClass: 'family-layout', invariant: 'unverified-family-layout',
      bounds: { x: 0, y: 0, w: 40, h: 20 }, center: { x: 100, y: 100 }, containment: 'center', withinBounds: false, groupId: 'legend', withinGroup: false,
    })).toBe('region-containment')
    for (const family of ['timeline', 'xychart', 'pie', 'quadrant', 'gantt'] as const) {
      for (const invariant of ['timeline-interval', 'plot-contained', 'legend-contained', 'section-contained', 'unverified-family-layout'] as const) {
        expect(layoutCertificateProof({ family, elementId: 'authored-element', routeClass: 'family-layout', invariant,
          bounds: { x: 0, y: 0, w: 40, h: 20 }, center: { x: 20, y: 10 }, containment: 'bounds', withinBounds: true,
        })).toBe('region-containment')
      }
    }
  })
})

describe('property: source-context layout hooks preserve structured-body layout independence', () => {
  const structuredBodyFamilies = fc.constantFrom(METAMORPHIC_FAMILIES.xychart, METAMORPHIC_FAMILIES.pie, METAMORPHIC_FAMILIES.quadrant).chain(family =>
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
      fcParameters({ numRuns: RUNS }),
    )
  })
})
