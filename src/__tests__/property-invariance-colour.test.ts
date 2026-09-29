// Colour metamorphic relations (docs/testing-strategy.md §4) for every
// renderable family, generated from the shared METAMORPHIC_FAMILIES builders.
// Source-text relations (comments, blank lines, chains) live in
// property-invariance-source.test.ts.
//
//   MR5 Colour invariance — changing only colour inputs (built-in palettes,
//       explicit colour options, Mermaid named themes, theme colour variables,
//       per-family colour config) leaves geometry byte-identical: the
//       structured layout and the paint-free SVG projection both match the
//       default render. Looks/styles and fonts are deliberately NOT varied —
//       they legitimately change typography and geometry.
//   MR5b Colour admission — an invalid colour in any colour key a family paints
//       is refused by name before output, never emitted and never silently
//       dropped (the #303 series: invalid theme colours reached CSS in about
//       nine families; geometry alone cannot see that).

import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { layoutMermaid, parseRegisteredMermaid as parseMermaid, renderMermaidSVG } from '../agent/index.ts'
import type { DiagramKind, ParsedDiagram } from '../agent/types.ts'
import { CHANNEL_THEME_KEYS } from '../color-resolver.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'
import { BUILTIN_PALETTE_DEFINITIONS } from '../palette-catalog.ts'
import type { RenderOptions } from '../types.ts'
import { type FamilyMetamorphic, METAMORPHIC_FAMILIES } from './helpers/metamorphic-families.ts'
import { normalizeSvg } from './helpers/svg-normalize.ts'

const FAMILIES = Object.values(METAMORPHIC_FAMILIES)
const tagArb = fc.integer({ min: 0, max: 1_000_000 }).map(n => `q${n.toString(36)}`)
const kArb = (fam: FamilyMetamorphic) => fc.integer({ min: fam.kRange[0], max: fam.kRange[1] })

function parse(source: string): ParsedDiagram {
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(`generated source failed to parse:\n${source}`)
  return parsed.value
}

// Config diagnostics (e.g. a shared theme key a family never paints) must not
// spam the run; installing a collector never changes SVG bytes (RenderOptions).
const quiet = { onConfigDiagnostic: () => {} } satisfies RenderOptions

const byte = fc.integer({ min: 0, max: 255 })
const colourArb: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 0, max: 0xffffff }).map(n => `#${n.toString(16).padStart(6, '0')}`),
  fc.integer({ min: 0, max: 0xfff }).map(n => `#${n.toString(16).padStart(3, '0')}`),
  fc.tuple(byte, byte, byte).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`),
  fc
    .tuple(fc.integer({ min: 0, max: 359 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }))
    .map(([h, s, l]) => `hsl(${h}, ${s}%, ${l}%)`),
  fc.constantFrom('red', 'teal', 'navy', 'goldenrod', 'rebeccapurple'),
)
const coloursArb = fc.array(colourArb, { minLength: 1, maxLength: 4 })

const indexed = (prefix: string, count: number, start = 0) => Array.from({ length: count }, (_, i) => `${prefix}${i + start}`)
const SHARED_THEME_COLOUR_KEYS = [...new Set(Object.values(CHANNEL_THEME_KEYS).flat()), 'secondaryColor']
// The per-family colour keys each renderer paints (theme-color-admission.ts).
const FAMILY_THEME_COLOUR_KEYS: Partial<Record<DiagramKind, readonly string[]>> = {
  pie: [...indexed('pie', 12, 1), 'pieStrokeColor', 'pieOuterStrokeColor', 'pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor'],
  gitgraph: [...indexed('git', 8), ...indexed('gitBranchLabel', 8), ...indexed('gitInv', 8), 'commitLabelColor', 'commitLabelBackground'],
  timeline: [...indexed('cScale', 12), ...indexed('cScaleLabel', 12), ...indexed('cScaleInv', 12)],
  radar: [...indexed('cScale', 12), 'titleColor'],
  architecture: ['clusterBkg', 'clusterBorder'],
}
// Colour keys nested one level down inside themeVariables.
const NESTED_THEME_COLOUR_KEYS: Partial<Record<DiagramKind, { key: string; fields: readonly string[] }>> = {
  radar: { key: 'radar', fields: ['axisColor', 'graticuleColor'] },
  xychart: {
    key: 'xyChart',
    fields: [
      'backgroundColor', 'titleColor', 'xAxisLabelColor', 'xAxisTickColor', 'xAxisLineColor',
      'xAxisTitleColor', 'yAxisLabelColor', 'yAxisTickColor', 'yAxisLineColor', 'yAxisTitleColor', 'legendTextColor',
    ],
  },
}
// Colour-only family config (frontmatter `journey:` / `timeline:`); the
// neighbouring non-colour fields of those configs are typography or geometry.
const FAMILY_CONFIG_COLOURS: Partial<Record<DiagramKind, { key: string; lists: readonly string[]; singles: readonly string[] }>> = {
  journey: { key: 'journey', lists: ['actorColours', 'sectionFills', 'sectionColours'], singles: ['titleColor'] },
  timeline: { key: 'timeline', lists: ['sectionFills', 'sectionColours'], singles: [] },
}

// Colour keys that switch a decoration on rather than recolour one, so MR5
// cannot vary them (MR5b still checks their admission):
//   pieOuterStrokeColor — opts into drawing the outer ring (pie/renderer.ts);
//   by default the ring is absent, so setting it adds a stroked circle.
const DECORATION_TOGGLE_KEYS = new Set(['pieOuterStrokeColor'])

function themeVariablesArb(family: DiagramKind): fc.Arbitrary<Record<string, unknown>> {
  const keys = [...SHARED_THEME_COLOUR_KEYS, ...(FAMILY_THEME_COLOUR_KEYS[family] ?? [])].filter(key => !DECORATION_TOGGLE_KEYS.has(key))
  const nested = NESTED_THEME_COLOUR_KEYS[family]
  const nestedArb: fc.Arbitrary<Record<string, unknown>> = !nested
    ? fc.constant({})
    : fc
        .record({
          fields: fc.dictionary(fc.constantFrom(...nested.fields), colourArb, { maxKeys: 4 }),
          palette: family === 'xychart' ? fc.option(coloursArb.map(list => list.join(', ')), { nil: undefined }) : fc.constant(undefined),
        })
        .map(({ fields, palette }) => ({ [nested.key]: { ...fields, ...(palette ? { plotColorPalette: palette } : {}) } }))
  return fc
    .tuple(fc.dictionary(fc.constantFrom(...keys), colourArb, { maxKeys: 6 }), nestedArb)
    .map(([flat, deep]) => ({ ...flat, ...deep }))
}

function familyConfigArb(family: DiagramKind): fc.Arbitrary<Record<string, unknown>> {
  const config = FAMILY_CONFIG_COLOURS[family]
  if (!config) return fc.constant({})
  return fc
    .tuple(
      fc.dictionary(fc.constantFrom(...config.lists), coloursArb, { maxKeys: config.lists.length }),
      config.singles.length ? fc.dictionary(fc.constantFrom(...config.singles), colourArb) : fc.constant({}),
    )
    .map(([lists, singles]) => ({ [config.key]: { ...lists, ...singles } }))
}

/** Render options that change ONLY colour: never style Looks, fonts or sizes. */
function colourInputArb(family: DiagramKind): fc.Arbitrary<RenderOptions> {
  const mermaidConfig = fc
    .tuple(
      fc.option(fc.constantFrom('default', 'base', 'neutral', 'dark', 'forest'), { nil: undefined }),
      fc.option(themeVariablesArb(family), { nil: undefined }),
      familyConfigArb(family),
    )
    .map(([theme, themeVariables, familyConfig]) => ({
      ...(theme ? { theme } : {}),
      ...(themeVariables ? { themeVariables } : {}),
      ...familyConfig,
    }))
  return fc
    .record(
      {
        style: fc.constantFrom(...BUILTIN_PALETTE_DEFINITIONS.map(palette => palette.inputName)),
        bg: colourArb,
        fg: colourArb,
        line: colourArb,
        accent: colourArb,
        muted: colourArb,
        surface: colourArb,
        border: colourArb,
        mermaidConfig,
      },
      { requiredKeys: [] },
    )
    .filter(options => Object.keys(options).length > 0) as fc.Arbitrary<RenderOptions>
}

const geometry = (svg: string) => normalizeSvg(svg, { stripPaint: true })

describe('MR5 colour invariance: colour inputs never move geometry', () => {
  // Found by MR5: a `pieN` or `cScaleN` set without its predecessors once built
  // a sparse paletteOverrides array that the render contract refused to
  // snapshot, so the diagram did not render at all.
  test('a gapped pie or radar palette paints its slot and keeps the defaults elsewhere', () => {
    const cases = [
      ['pie2', 'pie\n  "a" : 1\n  "b" : 2\n  "c" : 3'],
      ['cScale1', 'radar-beta\n  axis a, b, c\n  curve x{1,2,3}\n  curve y{2,3,1}\n  curve z{3,1,2}\n  max 5'],
    ] as const
    const fills = (svg: string) => [...svg.matchAll(/class="(?:pie-slice|radar-area)"[^>]*fill="([^"]+)"/g)].map(match => match[1])
    for (const [key, body] of cases) {
      const defaults = fills(renderMermaidSVG(body))
      expect(defaults).toHaveLength(3)
      expect(defaults).not.toContain('#000000')
      const gapped = fills(renderMermaidSVG(`%%{init: {"themeVariables": {"${key}": "#000000"}}}%%\n${body}`))
      expect(gapped, key).toEqual([defaults[0], '#000000', defaults[2]])
    }
  })

  test('the paint-free projection strips paint but keeps geometry', () => {
    const svg = renderMermaidSVG('flowchart TD\n  A[Alpha] --> B', { style: 'dracula', bg: '#101014' })
    const projected = geometry(svg)
    for (const paint of ['#101014', 'fill=', 'stroke=', '--bg:', 'data-backdrop']) expect(projected).not.toContain(paint)
    for (const kept of ['viewBox=', 'points=', 'stroke-width', 'font-size', '>Alpha<']) expect(projected).toContain(kept)
  })

  for (const fam of FAMILIES) {
    test(`${fam.family}: layout and paint-free SVG are identical under any colour input`, () => {
      fc.assert(
        fc.property(kArb(fam), tagArb, colourInputArb(fam.family), (k, tag, colours) => {
          const source = fam.build(k, tag)
          const diagram = parse(source)
          expect(layoutMermaid(diagram, { ...colours, ...quiet })).toEqual(layoutMermaid(diagram, quiet))
          expect(geometry(renderMermaidSVG(source, { ...colours, ...quiet }))).toBe(geometry(renderMermaidSVG(source, quiet)))
        }),
        { numRuns: 25 },
      )
    })
  }
})

describe('MR5b colour admission: an invalid painted colour is refused by name', () => {
  // Distinctive tokens that no renderer could emit by coincidence.
  const invalidColourArb = fc
    .tuple(fc.constantFrom('zq{n}notacolor', '#zq{n}', 'rgb(zq{n})', 'url(#zq{n})', 'hsl(zq{n} / junk)'), fc.nat({ max: 99_999 }))
    .map(([shape, n]) => shape.replace('{n}', String(n)))
  const ADMISSION_CODE = /^(?:INVALID_THEME_COLOR|INVALID_CONFIG_COLOR)$/

  type ColourPath = { path: string; painted: boolean; config: (value: string) => MermaidRuntimeConfig }

  /** Every colour config path a family reads, as themeVariables or family config. */
  function colourPaths(family: DiagramKind): ColourPath[] {
    const paths: ColourPath[] = []
    for (const key of [...SHARED_THEME_COLOUR_KEYS, ...(FAMILY_THEME_COLOUR_KEYS[family] ?? [])]) {
      // secondaryColor is only Architecture's group-surface fallback; every
      // other family ignores it, so it must merely stay out of the output.
      const painted = key !== 'secondaryColor' || family === 'architecture'
      paths.push({ path: `themeVariables.${key}`, painted, config: value => ({ themeVariables: { [key]: value } }) })
    }
    const nested = NESTED_THEME_COLOUR_KEYS[family]
    if (nested) {
      for (const field of [...nested.fields, ...(family === 'xychart' ? ['plotColorPalette'] : [])]) {
        paths.push({ path: `themeVariables.${nested.key}.${field}`, painted: true, config: value => ({ themeVariables: { [nested.key]: { [field]: value } } }) })
      }
    }
    const config = FAMILY_CONFIG_COLOURS[family]
    if (config) {
      for (const field of config.lists) paths.push({ path: `${config.key}.${field}`, painted: true, config: value => ({ [config.key]: { [field]: ['#123456', value] } }) })
      for (const field of config.singles) paths.push({ path: `${config.key}.${field}`, painted: true, config: value => ({ [config.key]: { [field]: value } }) })
    }
    return paths
  }

  function outcome(source: string, options: RenderOptions, token: string): string {
    try {
      return renderMermaidSVG(source, { ...options, ...quiet }).includes(token) ? 'leaked into the SVG' : 'rendered without it'
    } catch (error) {
      const code = (error as { code?: string }).code
      return code && ADMISSION_CODE.test(code) ? 'refused by name' : `threw ${code ?? String(error)}`
    }
  }

  for (const fam of FAMILIES) {
    // Every path is exercised on every run (a refusal stops before layout, so
    // this is cheap); fast-check varies the diagram, the token and the route.
    test(`${fam.family}: every painted colour key refuses an invalid value by name`, () => {
      const paths = colourPaths(fam.family)
      fc.assert(
        fc.property(kArb(fam), tagArb, invalidColourArb, fc.boolean(), (k, tag, token, viaInit) => {
          const body = fam.build(k, tag)
          const got = paths.map(target => {
            const config = target.config(token)
            // The authored init directive and the mermaidConfig option share one admission waist.
            const result = viaInit ? outcome(`%%{init: ${JSON.stringify(config)}}%%\n${body}`, {}, token) : outcome(body, { mermaidConfig: config }, token)
            return `${target.path}: ${result}`
          })
          expect(got).toEqual(paths.map(target => `${target.path}: ${target.painted ? 'refused by name' : 'rendered without it'}`))
        }),
        { numRuns: 8 },
      )
    })
  }
})
