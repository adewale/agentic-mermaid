import { describe, expect, test } from 'bun:test'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { parseRegisteredMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { runBatchLine } from '../cli/index.ts'
import { CHANNEL_THEME_KEYS } from '../color-resolver.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import type { RenderOptions } from '../types.ts'

// Issue #303: a theme or family-config color is refused by name before any
// output can drop it or paint a renderer-specific fallback. Every family admits
// its paints through one template, so each family is a row of FAMILIES and the
// template is written once. Rules that do not fit it follow as explicit tests;
// XY Chart palette-string, Timeline/Journey list-shape and Quadrant authored
// point paints keep their own files.
//
// A paint path says where the color is authored: `themeVariables.<key>` is
// refused as INVALID_THEME_COLOR, any other `<family>.<key>` is family config
// refused as INVALID_CONFIG_COLOR, and a trailing `[0]` authors a one-entry list.
//
// Shared keys come from CHANNEL_THEME_KEYS, the resolver's registry of the keys
// it reads, so a new shared channel key is covered automatically. Family keys
// are listed by hand: production enumerates them only as private sets inside
// theme-color-admission.ts, the code under test, and deriving the oracle from
// those would let a dropped key shrink this suite instead of failing it.

const FLOW = 'flowchart TD\n  A --> B'
const PIE = 'pie\n  "A" : 3\n  "B" : 2'
const GITGRAPH = 'gitGraph\n  commit id:"A" type:HIGHLIGHT'
const TIMELINE = 'timeline\n  2020 : Start\n  2021 : End'
const JOURNEY = 'journey\n  section S\n  Task: 3: Me'
const RADAR = 'radar-beta\n  title Skills\n  axis a, b, c\n  curve x{1,2,3}\n  max 5'
const ARCHITECTURE = 'architecture-beta\n  group app(cloud)[App]\n  service api(server)[API] in app'
const XYCHART = 'xychart\n  title Sales\n  x-axis [A, B]\n  y-axis 0 --> 2\n  bar [1, 2]'

const INVALID: readonly unknown[] = [
  'notacolor', '#12345', 'rgb(x)', 'hsl(120 50% 50% / .5 / junk)', 'url(#a)',
  123, null, [], { nested: 'red' },
]
const VALID = [
  'rebeccapurple', '#f96', '#3b82', '#112233', '#11223380', 'rgb(255 0 0)',
  'hsl(120 100% 50%)', 'transparent', 'currentColor', 'var(--brand)',
] as const
const SINK = 'var(--am-sink)'

type Entry = readonly [path: string, value: unknown]

const theme = (...keys: readonly string[]): string[] => keys.map(key => `themeVariables.${key}`)
const indexed = (stem: string, from: number, count: number): string[] =>
  Array.from({ length: count }, (_, index) => `${stem}${from + index}`)
const without = (paths: readonly string[], drop: readonly string[]): string[] =>
  paths.filter(path => !drop.includes(path))

const SHARED = theme(...new Set(Object.values(CHANNEL_THEME_KEYS).flat()))
// Text channels are ink: `none` would erase the label.
const SHARED_INK = theme(...CHANNEL_THEME_KEYS.fg, ...CHANNEL_THEME_KEYS.muted)
// Architecture mixes these channels into derived color-mix() paints.
const ARCHITECTURE_MIXED = theme(...new Set([
  ...CHANNEL_THEME_KEYS.bg, ...CHANNEL_THEME_KEYS.surface,
  ...CHANNEL_THEME_KEYS.line, ...CHANNEL_THEME_KEYS.accent,
]))
const TIMELINE_PAINTS = [
  ...theme(...indexed('cScale', 0, 12), ...indexed('cScaleLabel', 0, 12), ...indexed('cScaleInv', 0, 12)),
  'timeline.sectionFills[0]', 'timeline.sectionColours[0]', 'timeline.sectionColors[0]',
]
const XYCHART_STROKES = theme('xyChart.xAxisTickColor', 'xyChart.xAxisLineColor', 'xyChart.yAxisTickColor', 'xyChart.yAxisLineColor')
const XYCHART_PAINTS = [
  ...theme('xyChart.backgroundColor', 'xyChart.titleColor', 'xyChart.legendTextColor', 'xyChart.plotColorPalette[0]'),
  ...theme('xyChart.xAxisLabelColor', 'xyChart.xAxisTitleColor', 'xyChart.yAxisLabelColor', 'xyChart.yAxisTitleColor'),
  ...XYCHART_STROKES,
]

interface FamilyAdmission {
  family: string
  /** Minimal source; it must reach every sink below. */
  body: string
  /** Every paint path the family admits. Each refuses every INVALID value. */
  paints: readonly string[]
  /** Paints that refuse `none`: text ink and operands of derived color-mix(). */
  refusesNone: readonly string[]
  /** Paints where `none` is a legal direct fill or stroke and still renders. */
  admitsNone: readonly string[]
  /** Paint path -> the SVG text that directly precedes an admitted var() paint. */
  sinks: Readonly<Record<string, string>>
  /** Invalid paints checked once each on every public route and input form. */
  probes: readonly Entry[]
}

const FAMILIES: readonly FamilyAdmission[] = [
  {
    family: 'Flowchart (shared channels)',
    body: FLOW,
    paints: SHARED,
    refusesNone: SHARED_INK,
    admitsNone: without(SHARED, SHARED_INK),
    sinks: {
      'themeVariables.background': '--bg:',
      'themeVariables.primaryTextColor': '--fg:',
      'themeVariables.lineColor': '--line:',
      'themeVariables.arrowheadColor': '--accent:',
      'themeVariables.secondaryTextColor': '--muted:',
      'themeVariables.nodeBkg': '--surface:',
      'themeVariables.primaryBorderColor': '--border:',
    },
    probes: [['themeVariables.primaryColor', 'notacolor']],
  },
  {
    family: 'Pie',
    body: PIE,
    paints: theme(
      ...indexed('pie', 1, 12), 'pieStrokeColor', 'pieOuterStrokeColor',
      'pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor',
    ),
    refusesNone: theme('pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor'),
    admitsNone: theme(...indexed('pie', 1, 12), 'pieStrokeColor', 'pieOuterStrokeColor'),
    sinks: {
      'themeVariables.pie1': 'fill="',
      'themeVariables.pieStrokeColor': '.pie-slice { stroke: ',
      'themeVariables.pieOuterStrokeColor': '.pie-outer-circle { stroke: ',
      'themeVariables.pieSectionTextColor': 'fill="',
      'themeVariables.pieTitleTextColor': '.pie-title { fill: ',
      'themeVariables.pieLegendTextColor': '.pie-legend-text { fill: ',
    },
    probes: [['themeVariables.pie1', 'notacolor']],
  },
  {
    family: 'GitGraph',
    body: GITGRAPH,
    paints: theme(
      ...indexed('git', 0, 8), ...indexed('gitBranchLabel', 0, 8), ...indexed('gitInv', 0, 8),
      'commitLabelColor', 'commitLabelBackground',
    ),
    refusesNone: theme(...indexed('gitBranchLabel', 0, 8), 'commitLabelColor'),
    admitsNone: theme(...indexed('git', 0, 8), ...indexed('gitInv', 0, 8), 'commitLabelBackground'),
    sinks: {
      'themeVariables.git0': 'stroke="',
      'themeVariables.gitInv0': 'fill="',
      'themeVariables.gitBranchLabel0': 'fill="',
      'themeVariables.commitLabelColor': 'fill="',
      'themeVariables.commitLabelBackground': 'fill="',
    },
    probes: [['themeVariables.git7', 'url(#unsafe)']],
  },
  {
    family: 'Timeline',
    body: TIMELINE,
    paints: TIMELINE_PAINTS,
    // Labels are ink; fills and lines feed derived color-mix() paints.
    refusesNone: TIMELINE_PAINTS,
    admitsNone: [],
    sinks: {
      'themeVariables.cScale0': '--tl-accent:',
      'themeVariables.cScaleLabel0': '--tl-label:',
      'themeVariables.cScaleInv0': '--tl-line:',
      'timeline.sectionFills[0]': '--tl-fill:',
      'timeline.sectionColours[0]': '--tl-label:',
      'timeline.sectionColors[0]': '--tl-label:',
    },
    probes: [['themeVariables.cScale11', 'url(#unsafe)'], ['timeline.sectionFills[0]', 'notacolor']],
  },
  {
    family: 'Journey',
    body: JOURNEY,
    paints: ['journey.actorColours[0]', 'journey.sectionFills[0]', 'journey.sectionColours[0]', 'journey.titleColor'],
    refusesNone: ['journey.sectionFills[0]', 'journey.sectionColours[0]', 'journey.titleColor'],
    admitsNone: ['journey.actorColours[0]'],
    // Section ink may be replaced by Journey's contrast guard, so it has no sink.
    sinks: {
      'journey.actorColours[0]': '.journey-actor-0 { fill: ',
      'journey.sectionFills[0]': '.journey-section-0 { fill: ',
      'journey.titleColor': '.journey-title { fill: ',
    },
    probes: [['journey.titleColor', 'notacolor']],
  },
  {
    family: 'Radar',
    body: RADAR,
    paints: theme('titleColor', ...indexed('cScale', 0, 12), 'radar.axisColor', 'radar.graticuleColor'),
    // Curve colors are reused as terminal text ink.
    refusesNone: theme('titleColor', ...indexed('cScale', 0, 12), 'radar.axisColor'),
    admitsNone: theme('radar.graticuleColor'),
    sinks: {
      'themeVariables.titleColor': '.radar-title { fill: ',
      'themeVariables.cScale0': 'fill="',
      'themeVariables.radar.axisColor': '.radar-axis-line { stroke: ',
      'themeVariables.radar.graticuleColor': '.radar-ring { stroke: ',
    },
    probes: [['themeVariables.radar.axisColor', 'url(#unsafe)']],
  },
  {
    family: 'Architecture',
    body: ARCHITECTURE,
    // Shared keys are listed because Architecture's none rule for them differs.
    paints: [...SHARED, ...theme('clusterBkg', 'clusterBorder', 'secondaryColor')],
    // The group fill, like the mixed channels, feeds a derived color-mix() paint.
    refusesNone: [...SHARED_INK, ...ARCHITECTURE_MIXED, ...theme('clusterBkg')],
    admitsNone: theme(...CHANNEL_THEME_KEYS.border, 'clusterBorder', 'secondaryColor'),
    sinks: {
      'themeVariables.clusterBkg': '--arch-group-fill:',
      'themeVariables.clusterBorder': '--arch-group-stroke:',
      'themeVariables.secondaryColor': '--arch-service-fill:',
    },
    probes: [['themeVariables.clusterBkg', 'url(#unsafe)'], ['themeVariables.mainBkg', 'none']],
  },
  {
    family: 'XY Chart',
    body: XYCHART,
    paints: XYCHART_PAINTS,
    refusesNone: without(XYCHART_PAINTS, XYCHART_STROKES),
    admitsNone: XYCHART_STROKES,
    // This chart has no legend, so legendTextColor has no sink.
    sinks: {
      'themeVariables.xyChart.backgroundColor': '--bg:',
      'themeVariables.xyChart.titleColor': '.xychart-title { fill: ',
      'themeVariables.xyChart.xAxisLabelColor': '.xychart-x-label { fill: ',
      'themeVariables.xyChart.xAxisTickColor': '.xychart-x-tick { stroke: ',
      'themeVariables.xyChart.xAxisLineColor': '.xychart-x-axis-line { stroke: ',
      'themeVariables.xyChart.xAxisTitleColor': '.xychart-x-axis-title { fill: ',
      'themeVariables.xyChart.yAxisLabelColor': '.xychart-y-label { fill: ',
      'themeVariables.xyChart.yAxisTickColor': '.xychart-y-tick { stroke: ',
      'themeVariables.xyChart.yAxisLineColor': '.xychart-y-axis-line { stroke: ',
      'themeVariables.xyChart.yAxisTitleColor': '.xychart-y-axis-title { fill: ',
      'themeVariables.xyChart.plotColorPalette[0]': '--xychart-color-0: ',
    },
    probes: [['themeVariables.xyChart.titleColor', 'notacolor'], ['themeVariables.xyChart.plotColorPalette[0]', 'notacolor']],
  },
]

const SHARED_PATHS = new Set(SHARED)
const privatePaints = (row: FamilyAdmission): string[] => row.paints.filter(path => !SHARED_PATHS.has(path))

/** The config object that authors each value at its path. */
function configAt(entries: readonly Entry[]): MermaidRuntimeConfig {
  const config: Record<string, unknown> = {}
  for (const [path, value] of entries) {
    const segments = path.split('.')
    let node = config
    for (const segment of segments.slice(0, -1)) node = (node[segment] ??= {}) as Record<string, unknown>
    const leaf = segments.at(-1)!
    if (leaf.endsWith('[0]')) node[leaf.slice(0, -3)] = [value]
    else node[leaf] = value
  }
  return config as MermaidRuntimeConfig
}

const init = (body: string, ...entries: Entry[]): string =>
  `%%{init: ${JSON.stringify(configAt(entries))}}%%\n${body}`
const frontmatter = (body: string, ...entries: Entry[]): string =>
  `---\nconfig: ${JSON.stringify(configAt(entries))}\n---\n${body}`
const initVars = (body: string, themeVariables: Record<string, unknown>): string =>
  `%%{init: ${JSON.stringify({ themeVariables })}}%%\n${body}`

const shown = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value)
const refusal = (path: string, value: unknown): string =>
  `${path}: ${JSON.stringify(shown(value))} is not a CSS color`
const renderFailed = (reason: string) => ({ code: 'RENDER_FAILED' as const, reason: expect.stringContaining(reason) })

function diagnosticFor(path: string, value: unknown): Record<string, string> {
  return path.startsWith('themeVariables.')
    ? { code: 'INVALID_THEME_COLOR', key: path.slice('themeVariables.'.length), value: shown(value) }
    : { code: 'INVALID_CONFIG_COLOR', path, value: shown(value) }
}

async function mcpRenderSvg(source: string, options?: RenderOptions): Promise<unknown> {
  const response = await handleHostedRequest(
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source, ...(options ? { options } : {}) } } },
    {
      async execute() { return { ok: true, value: null, logs: [] } },
      async renderPng() { throw new Error('not used') },
    },
  )
  return JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
}

/** One named refusal on every public route. PNG, browser-lazy, CLI and MCP load
 * heavier machinery, so callers run this once per family probe, not per key. */
async function expectRefusedOnEveryRoute(
  source: string,
  options: RenderOptions | undefined,
  named: string,
  diagnostic: Record<string, string>,
): Promise<void> {
  expect(() => renderMermaidSVG(source, options), 'svg').toThrow(named)
  expect(() => renderMermaidPNG(source, options), 'png').toThrow(named)
  await expect(renderMermaidSVGAsync(source, options)).rejects.toThrow(named)
  expect(verifyMermaid(source, { renderOptions: options }).warnings, 'verify').toContainEqual(renderFailed(named))
  const parsed = parseRegisteredMermaid(source)
  expect(parsed.ok).toBe(true)
  if (parsed.ok) {
    expect(verifyMermaid(parsed.value, { renderOptions: options }).warnings, 'verify parsed').toContainEqual(renderFailed(named))
  }
  for (const format of ['svg', 'ascii', 'unicode'] as const) {
    expect(runBatchLine(JSON.stringify({ op: 'render', source, options: { ...options, format } }), 0), `cli ${format}`)
      .toMatchObject({ ok: false, error: { ...diagnostic, message: expect.stringContaining(named) } })
  }
  expect(await mcpRenderSvg(source, options), 'mcp').toMatchObject({ ok: false, error: diagnostic })
  expect(projectRenderErrorDiagnostic({ ...diagnostic, message: 'forged' }), 'forged diagnostic')
    .toEqual({ code: 'RENDER_FAILED', message: 'Rendering failed' })
}

test('the admission table classifies only paints its family admits', () => {
  for (const row of FAMILIES) {
    const classified = [...row.refusesNone, ...row.admitsNone, ...Object.keys(row.sinks), ...row.probes.map(([path]) => path)]
    expect(classified.filter(path => !row.paints.includes(path)), row.family).toEqual([])
    expect(row.refusesNone.filter(path => row.admitsNone.includes(path)), row.family).toEqual([])
  }
})

describe.each([...FAMILIES])('theme color admission (#303): $family', row => {
  test.each([...row.paints])('%s refuses every malformed paint by name', path => {
    for (const value of INVALID) {
      expect(() => renderMermaidSVG(init(row.body, [path, value])), shown(value)).toThrow(refusal(path, value))
    }
    // Terminal output and verify admit through the same request waist as SVG,
    // so one value proves each is wired for this key.
    const source = init(row.body, [path, INVALID[0]])
    const named = refusal(path, INVALID[0])
    expect(() => renderMermaidASCII(source, { useAscii: true }), 'ascii').toThrow(named)
    expect(() => renderMermaidASCII(source, { useAscii: false }), 'unicode').toThrow(named)
    expect(verifyMermaid(source).warnings, 'verify').toContainEqual(renderFailed(named))
  })

  test.each([...row.refusesNone])('%s refuses none', path => {
    const source = init(row.body, [path, 'none'])
    expect(() => renderMermaidSVG(source), 'svg').toThrow(refusal(path, 'none'))
    expect(() => renderMermaidASCII(source), 'terminal').toThrow(refusal(path, 'none'))
    expect(verifyMermaid(source).warnings, 'verify').toContainEqual(renderFailed(refusal(path, 'none')))
  })

  // A wrongly refused key names itself in the thrown error, so one render covers the row.
  if (row.admitsNone.length > 0) {
    test('direct fills and strokes admit none', () => {
      expect(() => renderMermaidSVG(init(row.body, ...row.admitsNone.map((path): Entry => [path, 'none'])))).not.toThrow()
    })
  }

  test('every paint admits each drawable CSS paint, and verify agrees', () => {
    const everyPaint = (value: string): string => init(row.body, ...row.paints.map((path): Entry => [path, value]))
    for (const value of VALID) expect(() => renderMermaidSVG(everyPaint(value)), value).not.toThrow()
    expect(verifyMermaid(everyPaint(SINK)).warnings).not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })

  test.each(Object.entries(row.sinks))('%s keeps an admitted var() paint at its SVG sink', (path, sink) => {
    expect(renderMermaidSVG(init(row.body, [path, SINK]))).toContain(`${sink}${SINK}`)
  })

  test.each([...row.probes])('%s refusal agrees on every route and input form', async (path, value) => {
    const named = refusal(path, value)
    await expectRefusedOnEveryRoute(init(row.body, [path, value]), undefined, named, diagnosticFor(path, value))
    const forms: ReadonlyArray<readonly [string, string, RenderOptions | undefined]> = [
      ['frontmatter', frontmatter(row.body, [path, value]), undefined],
      ['render options', row.body, { mermaidConfig: configAt([[path, value]]) }],
    ]
    for (const [form, source, options] of forms) {
      expect(() => renderMermaidSVG(source, options), form).toThrow(named)
      expect(verifyMermaid(source, { renderOptions: options }).warnings, form).toContainEqual(renderFailed(named))
    }
  })
})

// A leaked key names itself in the thrown error, so one render covers the row.
test.each([...FAMILIES])('$family ignores the private paints of every other family', row => {
  const foreign = [...new Set(FAMILIES.flatMap(privatePaints))].filter(path => !row.paints.includes(path))
  expect(() => renderMermaidSVG(init(row.body, ...foreign.map((path): Entry => [path, 'notacolor'])))).not.toThrow()
})

describe('theme color admission (#303): Radar terminal ink', () => {
  test('curve paint reaches terminal HTML, where none is refused as ink', () => {
    expect(renderMermaidASCII(init(RADAR, ['themeVariables.cScale0', SINK]), { colorMode: 'html' }))
      .toContain(`style="color:${SINK}"`)
    expect(() => renderMermaidASCII(init(RADAR, ['themeVariables.cScale0', 'none']), { colorMode: 'html' }))
      .toThrow(refusal('themeVariables.cScale0', 'none'))
  })
})

describe('theme color admission (#303): Architecture derived paint', () => {
  test('shadowed shared fallbacks do not receive the Architecture color-mix restriction', () => {
    for (const [leading, shadowed] of [
      ['lineColor', 'defaultLinkColor'],
      ['primaryColor', 'nodeBkg'],
    ] as const) {
      const leadingOnly = initVars(ARCHITECTURE, { [leading]: '#f00' })
      const withShadowedNone = initVars(ARCHITECTURE, { [leading]: '#f00', [shadowed]: 'none' })
      expect(renderMermaidSVG(withShadowedNone), shadowed).toBe(renderMermaidSVG(leadingOnly))
    }
    const directServiceNone = initVars(ARCHITECTURE, { background: '#fff', primaryColor: '#f00', mainBkg: 'none' })
    expect(renderMermaidSVG(directServiceNone)).toContain('--arch-service-fill:none')
    for (const vars of [
      { lineColor: 'none', defaultLinkColor: '#f00' },
      { background: 'none', mainBkg: '#f00' },
      { arrowheadColor: '#f00', primaryColor: 'none' },
    ]) {
      expect(() => renderMermaidSVG(initVars(ARCHITECTURE, vars))).toThrow('is not a CSS color')
    }
  })

  test('resolved visual paint shadows theme fallbacks only when every mixed use is covered', () => {
    for (const key of ['lineColor', 'arrowheadColor']) {
      const source = initVars(ARCHITECTURE, { [key]: 'none' })
      const options = { architecture: { visual: { edgeStroke: '#f00' } } }
      expect(() => renderMermaidSVG(source, options), key).not.toThrow()
      expect(verifyMermaid(source, { renderOptions: options }).ok).toBe(true)
    }
    const group = initVars(ARCHITECTURE, { clusterBkg: 'none' })
    for (const visual of [{ groupSurface: '#eee' }, { groupHeaderSurface: '#eee' }]) {
      const options = { architecture: { visual } }
      expect(() => renderMermaidSVG(group, options)).not.toThrow()
      expect(verifyMermaid(group, { renderOptions: options }).ok).toBe(true)
    }
    const sharedSurface = initVars(ARCHITECTURE, { nodeBkg: 'none' })
    const surfaceOptions = { architecture: { visual: { groupSurface: '#eee' } } }
    expect(() => renderMermaidSVG(sharedSurface, surfaceOptions)).not.toThrow()
    expect(verifyMermaid(sharedSurface, { renderOptions: surfaceOptions }).ok).toBe(true)
    const dualChannel = initVars(ARCHITECTURE, { primaryColor: 'none' })
    expect(() => renderMermaidSVG(dualChannel, surfaceOptions)).toThrow('themeVariables.primaryColor: "none"')
    const fullyShadowed = { architecture: { visual: { groupSurface: '#eee', edgeStroke: '#f00' } } }
    expect(() => renderMermaidSVG(dualChannel, fullyShadowed)).not.toThrow()
    expect(verifyMermaid(dualChannel, { renderOptions: fullyShadowed }).ok).toBe(true)
    expect(() => renderMermaidSVG(initVars(ARCHITECTURE, { background: 'none' }), fullyShadowed))
      .toThrow('themeVariables.background: "none"')
  })

  test('explicit render colors override theme sources at the same admission boundary', () => {
    for (const [key, colors] of [
      ['background', { bg: '#fff' }],
      ['lineColor', { line: '#f00' }],
      ['arrowheadColor', { accent: '#00f' }],
      ['nodeBkg', { surface: '#0f0' }],
      ['primaryColor', { surface: '#0f0', accent: '#00f' }],
      ['mainBkg', { bg: '#fff', surface: '#0f0' }],
    ] as const) {
      const source = initVars(ARCHITECTURE, { [key]: 'none' })
      expect(renderMermaidSVG(source, colors), key).toContain('<svg')
      expect(verifyMermaid(source, { renderOptions: colors }).warnings, key)
        .not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
    }
  })

  test('secondaryColor is a fallback only when mainBkg is absent', () => {
    const source = initVars(ARCHITECTURE, { mainBkg: '#123456', secondaryColor: 'notacolor' })
    expect(() => renderMermaidSVG(source)).not.toThrow()
    expect(renderMermaidSVG(source)).not.toContain('--arch-service-fill:notacolor')
  })
})

describe('render option color admission (#303, Architecture derived paint)', () => {
  test('none is refused for each Architecture color-mix channel, including trimmed case variants', () => {
    for (const field of ['bg', 'surface', 'line', 'accent'] as const) {
      for (const value of ['none', ' NONE ']) {
        const options = { [field]: value }
        const named = `render option "${field}": ${JSON.stringify(value)} is not a CSS color for Architecture derived paint`
        expect(() => renderMermaidSVG(ARCHITECTURE, options), `${field} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(ARCHITECTURE, options), `${field} ${value}`).toThrow(named)
        expect(verifyMermaid(ARCHITECTURE, { renderOptions: options }).warnings).toContainEqual(renderFailed(named))
      }
    }
  })

  test('direct none paint and other-family options remain available', () => {
    for (const field of ['bg', 'surface', 'line', 'accent'] as const) {
      expect(() => renderMermaidSVG(FLOW, { [field]: 'none' }), field).not.toThrow()
    }
    expect(() => renderMermaidSVG(ARCHITECTURE, { border: 'none' })).not.toThrow()
    for (const field of ['bg', 'surface', 'line', 'accent'] as const) {
      expect(() => renderMermaidSVG(ARCHITECTURE, { [field]: 'var(--paint)' }), field).not.toThrow()
    }
  })

  test('resolved Architecture visuals shadow unused line, accent, and surface fallbacks', () => {
    const edge = { architecture: { visual: { edgeStroke: '#f00' } }, line: 'none', accent: 'none' }
    expect(() => renderMermaidSVG(ARCHITECTURE, edge)).not.toThrow()
    expect(verifyMermaid(ARCHITECTURE, { renderOptions: edge }).ok).toBe(true)
    const group = { architecture: { visual: { groupSurface: '#eee' } }, surface: 'none' }
    expect(() => renderMermaidSVG(ARCHITECTURE, group)).not.toThrow()
    expect(verifyMermaid(ARCHITECTURE, { renderOptions: group }).ok).toBe(true)
    const band = { architecture: { visual: { groupHeaderSurface: '#eee' } }, surface: 'none' }
    expect(() => renderMermaidSVG(ARCHITECTURE, band)).not.toThrow()
    expect(verifyMermaid(ARCHITECTURE, { renderOptions: band }).ok).toBe(true)
    expect(() => renderMermaidSVG(ARCHITECTURE, { architecture: { visual: { edgeStroke: 'none' } } }))
      .toThrow('render option "architecture.visual.edgeStroke": "none" is not a CSS color')
    expect(() => renderMermaidSVG(ARCHITECTURE, { architecture: { visual: { groupSurface: 'none' } } }))
      .toThrow('render option "architecture.visual.groupSurface": "none" is not a CSS color')
    expect(() => renderMermaidSVG(ARCHITECTURE, { architecture: { visual: { groupSurface: 'none', groupHeaderSurface: '#eee' } } }))
      .not.toThrow()
  })

  test('padded none cannot amplify a verify diagnostic', () => {
    const value = `${' '.repeat(10_000)}none`
    const result = verifyMermaid(ARCHITECTURE, { renderOptions: { bg: value } })
    expect(result.ok).toBe(false)
    const reason = result.warnings.find(warning => warning.code === 'RENDER_FAILED')?.reason ?? ''
    expect(reason).toContain('render option "bg"')
    expect(reason.length).toBeLessThan(500)
  })

  test('named refusal agrees on every route', async () => {
    await expectRefusedOnEveryRoute(
      ARCHITECTURE,
      { bg: 'none' },
      'render option "bg": "none" is not a CSS color for Architecture derived paint',
      { code: 'INVALID_RENDER_COLOR', field: 'bg', value: 'none' },
    )
  })
})
