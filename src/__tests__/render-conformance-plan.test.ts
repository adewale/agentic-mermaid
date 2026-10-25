import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeMermaidFacts, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { renderMermaidASCII, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { getStyle, resolveStyleStack, validateStyleSpec } from '../scene/style-registry.ts'
import { wcagCssContrastRatio, tryParseCssColor } from '../shared/color-math.ts'
import { scanSvgStartTags, svgCssText, type SvgStartTagToken } from '../svg-structure.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequestForExecution, resolvedRenderExecutionPlanOf } from '../render-contract.ts'
import { visitSceneNodes } from '../scene/walk.ts'
import type { RenderOptions } from '../types.ts'
import { COMPLEXITY_STRATA, FAMILY_CONFORMANCE_PROFILES, allConformanceSources, conformanceSourceFor } from './helpers/family-conformance-profiles.ts'
import {
  OUTPUT_FORMATS,
  buildMixedFormatConformancePlan,
  buildRenderConformancePlan,
  registeredLooks,
  registeredPalettes,
  representativeLookByBackend,
} from './helpers/render-conformance-plan.ts'

// A hang detector, not a speed assertion. The two tests that use it render the
// whole conformance portfolio; the work is CPU-bound and its wall-clock cost
// tracks machine speed, so a cap sized to the fastest machine turns "this box
// is slower than CI" into a red test — at 60s it fired on a machine completing
// the portfolio in ~62s with every oracle passing.
const RENDER_PORTFOLIO_TIMEOUT_MS = 240_000

const corePlan = buildRenderConformancePlan()
const mixedPlan = buildMixedFormatConformancePlan()
const families = BUILTIN_FAMILY_METADATA.map(entry => entry.id)

function assertSvg(svg: string, context: string): void {
  expect(svg, context).toContain('<svg')
  expect(svg, context).toContain('</svg>')
  expect(svg, context).not.toMatch(/(?:NaN|Infinity|undefined)/)
  const viewBox = /viewBox="([^"]+)"/u.exec(svg)
  expect(viewBox, `${context}: viewBox`).not.toBeNull()
  const viewport = viewBox![1]!.trim().split(/\s+/).map(Number)
  expect(viewport, `${context}: finite four-coordinate viewport`).toHaveLength(4)
  expect(viewport.every(Number.isFinite), `${context}: finite viewport`).toBe(true)
  expect(viewport[2], `${context}: width`).toBeGreaterThan(0)
  expect(viewport[3], `${context}: height`).toBeGreaterThan(0)
}

const GEOMETRY_ATTRIBUTES = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'd', 'transform', 'data-id', 'data-role', 'class']
const SHAPE_TAGS = new Set(['rect', 'path', 'polygon', 'polyline', 'circle', 'ellipse', 'line'])
type Paint = Record<string, string>
interface OutlineElement { key: string; paint: Paint; opacity: number }

function declarations(css: string): Paint {
  return Object.fromEntries(css.split(';').flatMap(declaration => {
    const colon = declaration.indexOf(':')
    return colon < 0 ? [] : [[declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]]
  }))
}

// Interpret the class-only rules emitted by our families, with an optional
// final SVG scope. Unsupported selectors cannot manufacture a passing paint:
// their unresolved outline fails below. This is not a browser CSS engine.
function outlineElements(svg: string, css = svgCssText(svg)): OutlineElement[] {
  const rules: Array<{ classes: string[]; paint: Paint }> = []
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const selector of rule[1]!.split(',')) {
      const local = selector.trim().replace(/^\.am-[a-z0-9]{14}\s+/, '')
      if (/^(?:\.[\w-]+)+$/.test(local)) rules.push({ classes: local.slice(1).split('.'), paint: declarations(rule[2]!) })
    }
  }
  const tags = scanSvgStartTags(svg)
  const events: Array<{ start: number; tag?: SvgStartTagToken }> = [
    ...tags.map(tag => ({ start: tag.start, tag })),
    ...[...svg.matchAll(/<\/[\w:-]+\s*>/g)].map(close => ({ start: close.index! })),
  ].sort((a, b) => a.start - b.start)
  const stack: Array<{ paint: Paint; opacity: number; definitions: boolean }> = []
  const elements: OutlineElement[] = []
  for (const event of events) {
    if (!event.tag) { stack.pop(); continue }
    const tag = event.tag
    const attrs = Object.fromEntries(tag.attributes.map(attribute => [attribute.name, attribute.value]))
    const classes = (attrs.class ?? '').split(/\s+/)
    const parent = stack.at(-1)
    const local = { ...attrs }
    for (const rule of rules) if (rule.classes.every(name => classes.includes(name))) Object.assign(local, rule.paint)
    Object.assign(local, declarations(attrs.style ?? ''))
    const inherited = Object.fromEntries(['stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'visibility'].flatMap(name =>
      parent?.paint[name] === undefined ? [] : [[name, parent.paint[name]!]],
    ))
    const paint = { ...inherited, ...local }
    const opacity = (parent?.opacity ?? 1) * Number(local.opacity ?? 1) * (local.display === 'none' || paint.visibility === 'hidden' ? 0 : 1)
    const definitions = (parent?.definitions ?? false) || ['defs', 'marker', 'clipPath', 'mask', 'pattern'].includes(tag.name)
    if (SHAPE_TAGS.has(tag.name) && !definitions && attrs['data-backdrop'] !== 'page') {
      const key = JSON.stringify([tag.name, ...GEOMETRY_ATTRIBUTES.map(name => (attrs[name] ?? '').replace(/\bam-[a-z0-9]{14}\b/g, 'am-scope'))])
      elements.push({ key, paint, opacity })
    }
    if (!tag.selfClosing) stack.push({ paint, opacity, definitions })
  }
  return elements
}

/** Scene owns the obligation; final public SVG owns the tested ink. Backend
 * projections locate compound/sketched primitive spans, including untagged
 * outline siblings. They never supply an expected contrast or repaired color. */
function assertOutlines(
  source: string, options: RenderOptions, svg: string, context: string,
  override?: { ids: ReadonlySet<string>; paint: string; strokeWidth?: number },
): { roles: Set<string>; ids: Set<string> } {
  const request = resolveRenderRequestForExecution(source, options, 'svg')
  const execution = resolvedRenderExecutionPlanOf(request)
  if (execution.mode !== 'scene' || !execution.backend) throw new Error(`${context}: expected Scene rendering`)
  const scene = lowerPositionedFamilyScene(request, positionResolvedFamily(execution.family.id, request))
  const backend = execution.backend.backend
  const backendContext = { seed: options.seed ?? 0, ...(request.appearance.styled ? { style: request.appearance.style } : {}) }
  const raw = backend.render(scene, backendContext)
  const rawCss = svgCssText(raw)
  const before = outlineElements(raw, rawCss), after = outlineElements(svg)
  expect(after.length, `${context}: bind actual SVG primitives`).toBe(before.length)
  after.forEach((element, index) => {
    const actual: string[] = JSON.parse(element.key), expected: string[] = JSON.parse(before[index]!.key)
    actual.forEach((value, field) => {
      // Identity stays exact. Numeric fields may change decimal spelling at
      // the public SVG boundary, within the writer's twelve-digit precision.
      if (field === 0 || field >= 1 + GEOMETRY_ATTRIBUTES.indexOf('data-id')) {
        expect(value, context).toBe(expected[field]!)
        return
      }
      const numbers = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
      const a = value.match(numbers) ?? [], b = expected[field]!.match(numbers) ?? []
      expect(value.replace(numbers, '#').replace(/[\s,]/g, ''), context).toBe(expected[field]!.replace(numbers, '#').replace(/[\s,]/g, ''))
      expect(a.length, context).toBe(b.length)
      a.forEach((token, number) => expect(Math.abs(Number(token) - Number(b[number])), context).toBeLessThanOrEqual(5e-12 * Math.max(Math.abs(Number(token)), Math.abs(Number(b[number])), Number.MIN_VALUE)))
    })
  })
  const starts = new Map<string, number[]>()
  before.forEach((element, index) => starts.set(element.key, [...(starts.get(element.key) ?? []), index]))
  const roles = new Set<string>()
  const ids = new Set<string>()
  const root = scanSvgStartTags(raw).find(tag => tag.name === 'svg')
  const authored = declarations(root?.attributes.find(attribute => attribute.name === 'style')?.value ?? '')
  const authoredPaint = (value: string, depth = 0): string | undefined => {
    if (depth > 8) throw new Error(`${context}: cyclic authored paint alias`)
    const variable = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/)
    if (!variable) return value
    if (variable[1] === '--_node-stroke') return undefined
    const declared = authored[variable[1]!]
    if (declared !== undefined) return authoredPaint(declared, depth + 1)
    // Family fallbacks are automatic only while no authored alias is active.
    return variable[2] === undefined ? value : authoredPaint(variable[2], depth + 1)
  }
  visitSceneNodes(scene.parts, node => {
    if (node.kind !== 'shape' || (override ? !override.ids.has(node.id) : !node.paint.stroke?.includes('var(--_node-stroke)'))) return
    const where = `${context}: ${node.role}/${node.id}`
    const expectedPaint = override?.paint ?? authoredPaint(node.paint.stroke!)
    const projected = outlineElements(backend.drawNode(node, backendContext), rawCss)
    expect(projected.length, `${where}: emitted geometry`).toBeGreaterThan(0)
    const matches = (starts.get(projected[0]!.key) ?? []).filter(start => projected.every((element, offset) => element.key === before[start + offset]?.key))
    expect(matches, `${where}: unique owned primitive span`).toHaveLength(1)
    let inkCount = 0
    projected.forEach((element, offset) => {
      const actual = after[matches[0]! + offset]!
      if (expectedPaint === 'none' || override?.strokeWidth === 0) {
        if (override?.strokeWidth === 0) {
          expect(node.paint.strokeWidth, `${where}: authored zero width`).toBe('0')
          expect(node.paint.stroke, `${where}: authored suppressed paint`).toBe(override.paint)
        }
        if (actual.opacity > 0 && Number(actual.paint['stroke-opacity'] ?? 1) > 0 && parseFloat(actual.paint['stroke-width'] ?? '1') > 0) {
          expect(actual.paint.stroke ?? 'none', `${where}: intentionally absent border`).toBe('none')
        }
        return
      }
      // Hybrid outlines can be filled ribbons; hatches and watercolor washes
      // use the surface paint and cannot stand in for the structural outline.
      const channel = element.paint.stroke?.includes('var(--_node-stroke)') ? 'stroke'
        : element.paint.fill?.includes('var(--_node-stroke)') ? 'fill'
        : override && element.paint.stroke && element.paint.stroke !== 'none' ? 'stroke'
        : override && element.paint.fill === node.paint.stroke ? 'fill' : undefined
      if (!channel) return
      if (!(element.opacity > 0) || !(Number(element.paint[`${channel}-opacity`] ?? 1) > 0)) return
      if (channel === 'stroke' && override?.strokeWidth !== 0 && !(parseFloat(element.paint['stroke-width'] ?? '1') > 0)) return
      const ink = actual.paint[channel]
      expect(actual.opacity, `${where}: preserve effective opacity`).toBe(before[matches[0]! + offset]!.opacity)
      expect(Number(actual.paint[`${channel}-opacity`] ?? 1), `${where}: preserve channel opacity`).toBe(Number(before[matches[0]! + offset]!.paint[`${channel}-opacity`] ?? 1))
      // Opaque source obligations cannot pass with a faded backend outline.
      // Pie emphasis and Radar fills carry intentional Scene opacity; keep
      // that declared treatment rather than inventing a page-compositing rule.
      const alpha = actual.opacity * Number(actual.paint[`${channel}-opacity`] ?? 1)
      expect(alpha === 1 || alpha === Number(node.paint.opacity ?? 1), `${where}: source-owned opacity`).toBe(true)
      expect(actual.opacity, `${where}: visible outline`).toBeGreaterThan(0)
      expect(Number(actual.paint[`${channel}-opacity`] ?? 1), `${where}: visible ${channel}`).toBeGreaterThan(0)
      if (channel === 'stroke') {
        const width = parseFloat(actual.paint['stroke-width'] ?? '1')
        if (override?.strokeWidth !== undefined) expect(width, `${where}: authored stroke width`).toBe(override.strokeWidth)
        else expect(width, `${where}: positive stroke width`).toBeGreaterThan(0)
      }
      if (expectedPaint !== undefined) expect(ink, `${where}: exact override`).toBe(expectedPaint)
      else {
        expect(tryParseCssColor(ink ?? '')?.[3], `${where}: concrete opaque ink ${ink}`).toBe(1)
        if (!options.transparent) expect(wcagCssContrastRatio(ink!, request.appearance.colors.bg), `${where}: actual ${ink} on ${request.appearance.colors.bg}`).toBeGreaterThanOrEqual(3)
      }
      inkCount++
    })
    if (expectedPaint !== 'none' && override?.strokeWidth !== 0) expect(inkCount, `${where}: structural outline, not only a fill or invisible carrier`).toBeGreaterThan(0)
    if (expectedPaint === undefined) {
      roles.add(node.role)
      if (node.role === 'chrome' && node.owner) roles.add(node.owner.role)
    }
    ids.add(node.id)
  })
  if (override) expect([...ids].sort(), `${context}: preserved source owners`).toEqual([...override.ids].sort())
  return { roles, ids }
}

describe('registry-derived complexity-aware render conformance plan', () => {
  test('complex fixture sources retain structured meaning through serialization', () => {
    for (const source of allConformanceSources()) {
      const parsed = parseRegisteredMermaid(source.source)
      expect(parsed.ok, source.id).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.value.kind, source.id).toBe(source.family)
      expect(parsed.value.body.kind, source.id).not.toBe('opaque')
      const canonical = serializeMermaid(parsed.value)
      const reparsed = parseRegisteredMermaid(canonical)
      expect(reparsed.ok, `${source.id}: canonical reparse`).toBe(true)
      if (reparsed.ok) expect(describeMermaidFacts(reparsed.value), source.id).toEqual(describeMermaidFacts(parsed.value))
    }
  }, 30_000)

  test('exhausts the pure Look × Palette resolver authority', () => {
    let combinations = 0
    for (const look of registeredLooks()) for (const palette of registeredPalettes()) {
      const resolved = resolveStyleStack([look, palette])
      expect(resolved, `${look} × ${palette}`).toBeDefined()
      expect(validateStyleSpec(resolved), `${look} × ${palette}`).toEqual([])
      expect(resolved?.colors?.bg, `${look} × ${palette}: bg`).toBe(getStyle(palette)!.colors!.bg)
      expect(resolved?.colors?.fg, `${look} × ${palette}: fg`).toBe(getStyle(palette)!.colors!.fg)
      combinations++
    }
    expect(combinations).toBe(registeredLooks().length * registeredPalettes().length)
  })

  test('renders the variable-strength SVG portfolio with semantic, finite, security and palette oracles', () => {
    const outlineCoverage = new Map<string, Set<string>>()
    for (const row of corePlan) {
      const svg = renderMermaidSVG(row.source, row.options)
      assertSvg(svg, row.id)
      expect(svg, `${row.id}: palette foreground`).toContain(`--fg:${getStyle(row.palette)!.colors!.fg}`)
      if (row.background === 'transparent') expect(svg, `${row.id}: transparency`).not.toContain('data-backdrop="page"')
      if (row.security === 'strict') expect(verifyNoExternalRefs(svg), row.id).toEqual({ ok: true, refs: [] })
      const { roles } = assertOutlines(row.source, row.options, svg, row.id)
      const profile = FAMILY_CONFORMANCE_PROFILES[row.family].outlines
      if (profile.kind === 'none') expect([...roles], `${row.id}: ${profile.reason}`).toEqual([])
      if (row.background !== 'transparent') {
        const key = `${row.family}|${row.backend}`
        const seen = outlineCoverage.get(key) ?? new Set<string>()
        for (const role of roles) seen.add(role)
        outlineCoverage.set(key, seen)
      }
    }
    for (const family of families) {
      const profile = FAMILY_CONFORMANCE_PROFILES[family].outlines
      if (profile.kind === 'none') continue
      for (const backend of ['default', 'hybrid', 'rough']) {
        for (const role of profile.roles) expect(outlineCoverage.get(`${family}|${backend}`)?.has(role), `${family}/${backend}: required ${role} outline`).toBe(true)
      }
    }
  }, RENDER_PORTFOLIO_TIMEOUT_MS)

  test('applicable families preserve deliberate role borders and authored suppression across backends', () => {
    const looks = new Map(Object.entries(representativeLookByBackend()))
    expect([...looks.keys()].sort()).toEqual(['default', 'hybrid', 'rough'])
    for (const family of families) {
      const profile = FAMILY_CONFORMANCE_PROFILES[family]
      if (profile.outlines.kind === 'none') continue
      for (const [backend, look] of looks) {
        const preservedRoles = new Set<string>()
        for (const stratum of COMPLEXITY_STRATA) {
          const { source, options } = conformanceSourceFor(family, stratum)
          // Solid fills isolate border suppression from legitimate hatch strokes.
          const base = { ...options, style: [look, 'dracula', ...(backend === 'default' ? [] : [{ fill: 'solid' as const }])], seed: 19 } satisfies RenderOptions
          const context = `${family}/${backend}/${stratum}`
          const baseline = assertOutlines(source, base, renderMermaidSVG(source, base), context)
          expect(baseline.ids.size, `${context}: automatic outline witness`).toBeGreaterThan(0)
          for (const paint of ['#282a36', 'none']) {
            const overridden = { ...base, style: [...base.style, { roles: { node: { borderColor: paint }, group: { borderColor: paint } } }] }
            assertOutlines(source, overridden, renderMermaidSVG(source, overridden), `${context}/${paint}`, { ids: baseline.ids, paint })
          }
          for (const role of baseline.roles) preservedRoles.add(role)
        }
        for (const role of profile.outlines.roles) expect(preservedRoles.has(role), `${family}/${backend}: preserved ${role} overrides`).toBe(true)
      }
    }
    for (const [backend, look] of looks) {
      const source = 'flowchart TD\nA[Card]'
      const options = { style: [look, 'dracula', ...(backend === 'default' ? [] : [{ fill: 'solid' as const }])], seed: 19 } satisfies RenderOptions
      const baseline = assertOutlines(source, options, renderMermaidSVG(source, options), backend)
      const hidden = `${source}\nstyle A stroke:#282a36,stroke-width:0`
      assertOutlines(hidden, options, renderMermaidSVG(hidden, options), `${backend}/authored zero width`, { ids: baseline.ids, paint: '#282a36', strokeWidth: 0 })

      // Treemap separators have no automatic node-outline obligation, but
      // explicit border paint and suppression still belong to the author.
      const treemap = 'treemap\n"One": 2\n"Two": 1'
      for (const paint of ['#282a36', 'none']) {
        const separators = { ...options, style: [...options.style, { roles: { node: { borderColor: paint } } }] }
        assertOutlines(treemap, separators, renderMermaidSVG(treemap, separators), `${backend}/authored treemap separators`, { ids: new Set(['cell:treemap-0', 'cell:treemap-1']), paint })
      }
    }
  }, RENDER_PORTFOLIO_TIMEOUT_MS)

  test('selected family × backend rows remain byte-deterministic across rotating complexity strata', () => {
    const seen = new Set<string>()
    for (const row of corePlan) {
      const key = `${row.family}|${row.backend}`
      if (seen.has(key) || row.externalReference === 'authored') continue
      seen.add(key)
      const first = renderMermaidSVG(row.source, row.options)
      const second = renderMermaidSVG(row.source, row.options)
      expect(createHash('sha256').update(first).digest('hex'), key)
        .toBe(createHash('sha256').update(second).digest('hex'))
    }
    expect(seen.size).toBe(families.length * 3)
  }, 20_000)

  test('executes the mixed graphical/PNG/ASCII/Unicode plan', () => {
    for (const row of mixedPlan) {
      const context = `${row.id}:${row.family}:${row.format}:${row.complexity}`
      switch (row.format) {
        case 'svg': assertSvg(renderMermaidSVG(row.source, row.options), context); break
        case 'png': {
          // Complex family layouts can exceed the raster budget at their
          // natural pixel size; exercise the public bounded-size projection.
          const png = renderMermaidPNG(row.source, { ...row.options, fitTo: { width: 1024 }, onWarning: () => {} })
          expect([...png.slice(0, 8)], context).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
          break
        }
        case 'ascii': {
          const output = renderMermaidASCII(row.source, { ...row.options, useAscii: true, colorMode: 'none' })
          expect(output.trim().length, context).toBeGreaterThan(0)
          break
        }
        case 'unicode': {
          const output = renderMermaidASCII(row.source, { ...row.options, useAscii: false, colorMode: 'none' })
          expect(output.trim().length, context).toBeGreaterThan(0)
          break
        }
      }
    }
    expect(new Set(mixedPlan.map(row => row.format))).toEqual(new Set(OUTPUT_FORMATS))
  }, RENDER_PORTFOLIO_TIMEOUT_MS)
})
