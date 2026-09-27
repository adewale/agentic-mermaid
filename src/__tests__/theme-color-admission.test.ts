import { describe, expect, test } from 'bun:test'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { parseRegisteredMermaid, verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { runBatchLine } from '../cli/index.ts'
import { CHANNEL_THEME_KEYS } from '../color-resolver.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

const FLOW = 'flowchart TD\n  A --> B'
const PIE = 'pie\n  "A" : 3\n  "B" : 2'
const GITGRAPH = 'gitGraph\n  commit id:"A" type:HIGHLIGHT'
const TIMELINE = 'timeline\n  2020 : Start\n  2021 : End'
const RADAR = 'radar-beta\n  title Skills\n  axis a, b, c\n  curve x{1,2,3}\n  max 5'
const ARCHITECTURE = 'architecture-beta\n  group app(cloud)[App]\n  service api(server)[API] in app'
const invalid = ['notacolor', '#12345', 'rgb(x)', 'hsl(120 50% 50% / .5 / junk)', 'url(#a)'] as const

function init(source: string, key: string, value: unknown): string {
  return `%%{init: ${JSON.stringify({ themeVariables: { [key]: value } })}}%%\n${source}`
}

describe('theme color admission (#303, shared/Pie layer)', () => {
  test('shared color keys refuse malformed paint in graphical and terminal outputs', () => {
    for (const key of new Set(Object.values(CHANNEL_THEME_KEYS).flat())) {
      for (const value of invalid) {
        const source = init(FLOW, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source, { useAscii: true }), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source, { useAscii: false }), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('Pie-specific slice, border and ink colors are named instead of silently dropped', () => {
    const pieKeys = [
      ...Array.from({ length: 12 }, (_, index) => `pie${index + 1}`),
      'pieStrokeColor', 'pieOuterStrokeColor',
      'pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor',
    ]
    for (const key of pieKeys) {
      for (const value of invalid) {
        const source = init(PIE, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('merged frontmatter, init, and render-option theme values agree with verify and PNG', () => {
    const sources = [
      init(FLOW, 'primaryColor', '#12345'),
      '---\nconfig:\n  themeVariables:\n    primaryColor: "#12345"\n---\nflowchart TD\n  A --> B',
    ]
    for (const source of sources) {
      const named = 'themeVariables.primaryColor: "#12345" is not a CSS color'
      expect(() => renderMermaidSVG(source)).toThrow(named)
      expect(() => renderMermaidPNG(source)).toThrow(named)
      expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (parsed.ok) expect(verifyMermaid(parsed.value).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    }
    const options = { mermaidConfig: { themeVariables: { primaryColor: 'notacolor' } } }
    expect(() => renderMermaidSVG(FLOW, options)).toThrow('themeVariables.primaryColor: "notacolor"')
    expect(verifyMermaid(FLOW, { renderOptions: options }).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining('themeVariables.primaryColor: "notacolor"') })
  })

  test('browser-lazy rejects the same source before rendering', async () => {
    for (const [source, key] of [[init(FLOW, 'primaryColor', 'notacolor'), 'primaryColor'], [init(PIE, 'pie1', 'notacolor'), 'pie1']] as const) {
      await expect(renderMermaidSVGAsync(source)).rejects.toThrow(`themeVariables.${key}: "notacolor" is not a CSS color`)
    }
  })

  test('CLI and MCP carry only the nominal named diagnostic', async () => {
    const source = init(FLOW, 'primaryColor', 'notacolor')
    for (const format of ['svg', 'ascii', 'unicode'] as const) {
      const result = runBatchLine(JSON.stringify({ op: 'render', format, source }), 0) as { ok: boolean; error: { code: string; key: string; value: string; message: string } }
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'primaryColor', value: 'notacolor', message: expect.stringContaining('themeVariables.primaryColor') } })
    }
    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source } } },
      {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('not used') },
      },
    )
    const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'primaryColor', value: 'notacolor' } })
    expect(projectRenderErrorDiagnostic({ code: 'INVALID_THEME_COLOR', key: 'primaryColor', value: 'notacolor', message: 'forged' }))
      .toEqual({ code: 'RENDER_FAILED', message: 'Rendering failed' })
  })

  test('valid shared and Pie colors remain paintable, while none is not text ink', () => {
    for (const value of ['rebeccapurple', '#f96', '#3b82', '#112233', '#11223380', 'rgb(255 0 0)', 'hsl(120 100% 50%)', 'transparent', 'currentColor', 'var(--brand)']) {
      expect(() => renderMermaidSVG(init(FLOW, 'primaryColor', value)), value).not.toThrow()
      expect(() => renderMermaidSVG(init(PIE, 'pie1', value)), value).not.toThrow()
    }
    expect(() => renderMermaidSVG(init(FLOW, 'lineColor', 'none'))).not.toThrow()
    for (const key of ['primaryTextColor', 'textColor', 'nodeTextColor', 'secondaryTextColor', 'tertiaryTextColor']) {
      expect(() => renderMermaidSVG(init(FLOW, key, 'none')))
        .toThrow(`themeVariables.${key}: "none" is not a CSS color`)
    }
    for (const key of ['pieSectionTextColor', 'pieTitleTextColor', 'pieLegendTextColor']) {
      expect(() => renderMermaidSVG(init(PIE, key, 'none')))
        .toThrow(`themeVariables.${key}: "none" is not a CSS color`)
    }
    for (const [source, key] of [[FLOW, 'primaryColor'], [PIE, 'pie1']] as const) {
      expect(() => renderMermaidSVG(init(source, key, 123)))
        .toThrow(`themeVariables.${key}: "123" is not a CSS color`)
    }
  })
})

describe('theme color admission (#303, GitGraph layer)', () => {
  const gitGraphColorKeys = [
    ...Array.from({ length: 8 }, (_, index) => [`git${index}`, `gitBranchLabel${index}`, `gitInv${index}`]).flat(),
    'commitLabelColor', 'commitLabelBackground',
  ]

  test('every indexed branch, label, highlight and commit-label paint refuses invalid values', () => {
    for (const key of gitGraphColorKeys) {
      for (const value of invalid) {
        const source = init(GITGRAPH, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('GitGraph ink refuses none, while fills and strokes may use it', () => {
    for (const key of [...Array.from({ length: 8 }, (_, index) => `gitBranchLabel${index}`), 'commitLabelColor']) {
      expect(() => renderMermaidSVG(init(GITGRAPH, key, 'none')))
        .toThrow(`themeVariables.${key}: "none" is not a CSS color`)
    }
    for (const key of ['git0', 'gitInv0', 'commitLabelBackground']) {
      expect(() => renderMermaidSVG(init(GITGRAPH, key, 'none'))).not.toThrow()
    }
    expect(() => renderMermaidSVG(init(GITGRAPH, 'git0', 123)))
      .toThrow('themeVariables.git0: "123" is not a CSS color')
  })

  test('admitted custom properties survive every GitGraph SVG paint sink', () => {
    const source = `%%{init: ${JSON.stringify({ themeVariables: {
      git0: 'var(--branch)', gitInv0: 'var(--highlight)', gitBranchLabel0: 'var(--label)',
      commitLabelColor: 'var(--ink)', commitLabelBackground: 'var(--pill)',
    } })}}%%\n${GITGRAPH}`
    const svg = renderMermaidSVG(source)
    for (const variable of ['branch', 'highlight', 'label', 'ink', 'pill']) {
      expect(svg).toContain(`var(--${variable})`)
    }
    expect(verifyMermaid(source).warnings).not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })

  test('GitGraph rejection agrees across verify, PNG, browser-lazy and CLI', async () => {
    const source = init(GITGRAPH, 'git7', 'url(#unsafe)')
    const named = 'themeVariables.git7: "url(#unsafe)" is not a CSS color'
    expect(() => renderMermaidPNG(source)).toThrow(named)
    expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    await expect(renderMermaidSVGAsync(source)).rejects.toThrow(named)
    const result = runBatchLine(JSON.stringify({ op: 'render', format: 'svg', source }), 0)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'git7', value: 'url(#unsafe)' } })
  })

  test('family-private keys remain scoped to GitGraph', () => {
    expect(() => renderMermaidSVG(init(FLOW, 'git0', 'notacolor'))).not.toThrow()
    expect(() => renderMermaidSVG(init(PIE, 'commitLabelColor', 'notacolor'))).not.toThrow()
  })
})

describe('theme color admission (#303, Timeline layer)', () => {
  const timelineColorKeys = Array.from({ length: 12 }, (_, index) => [
    `cScale${index}`, `cScaleLabel${index}`, `cScaleInv${index}`,
  ]).flat()

  test('every indexed Timeline fill, label and line refuses invalid paint', () => {
    for (const key of timelineColorKeys) {
      for (const value of invalid) {
        const source = init(TIMELINE, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('Timeline labels and derived fill/line paints refuse none', () => {
    for (let index = 0; index < 12; index++) {
      for (const key of [`cScaleLabel${index}`, `cScale${index}`, `cScaleInv${index}`]) {
        expect(() => renderMermaidSVG(init(TIMELINE, key, 'none')))
          .toThrow(`themeVariables.${key}: "none" is not a CSS color`)
      }
    }
    expect(() => renderMermaidSVG(init(TIMELINE, 'cScale0', 123)))
      .toThrow('themeVariables.cScale0: "123" is not a CSS color')
  })

  test('admitted Timeline custom-property paints remain in family CSS', () => {
    const source = `%%{init: ${JSON.stringify({ themeVariables: {
      cScale0: 'var(--fill)', cScaleLabel0: 'var(--ink)', cScaleInv0: 'var(--line)',
    } })}}%%\n${TIMELINE}`
    const svg = renderMermaidSVG(source)
    for (const variable of ['fill', 'ink', 'line']) expect(svg).toContain(`var(--${variable})`)
    expect(verifyMermaid(source).warnings).not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })

  test('Timeline refusal agrees across verify, PNG, browser-lazy and CLI', async () => {
    const source = init(TIMELINE, 'cScale11', 'url(#unsafe)')
    const named = 'themeVariables.cScale11: "url(#unsafe)" is not a CSS color'
    expect(() => renderMermaidPNG(source)).toThrow(named)
    expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    await expect(renderMermaidSVGAsync(source)).rejects.toThrow(named)
    const result = runBatchLine(JSON.stringify({ op: 'render', format: 'svg', source }), 0)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'cScale11', value: 'url(#unsafe)' } })
  })

  test('Timeline-private keys do not change unrelated families', () => {
    expect(() => renderMermaidSVG(init(FLOW, 'cScale0', 'notacolor'))).not.toThrow()
  })
})

describe('theme color admission (#303, Radar layer)', () => {
  const radarColors = [
    'titleColor',
    ...Array.from({ length: 12 }, (_, index) => `cScale${index}`),
  ]

  test('every indexed curve and title paint refuses invalid values', () => {
    for (const key of radarColors) {
      for (const value of invalid) {
        const source = init(RADAR, key, value)
        expect(() => renderMermaidSVG(source), `${key} ${value}`)
          .toThrow(`themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`)
        expect(() => renderMermaidASCII(source), `${key} ${value}`)
          .toThrow(`themeVariables.${key}: ${JSON.stringify(value)} is not a CSS color`)
      }
    }
  })

  test('nested axis and graticule paints refuse invalid values', () => {
    for (const key of ['axisColor', 'graticuleColor']) {
      for (const value of [...invalid, 123]) {
        const source = init(RADAR, 'radar', { [key]: value })
        expect(() => renderMermaidSVG(source), `${key} ${value}`)
          .toThrow(`themeVariables.radar.${key}: ${JSON.stringify(String(value))} is not a CSS color`)
      }
    }
  })

  test('none is allowed for grid stroke but not paints reused as text ink', () => {
    expect(() => renderMermaidSVG(init(RADAR, 'radar', { graticuleColor: 'none' }))).not.toThrow()
    expect(() => renderMermaidSVG(init(RADAR, 'cScale0', 'none')))
      .toThrow('themeVariables.cScale0: "none" is not a CSS color')
    expect(() => renderMermaidASCII(init(RADAR, 'cScale0', 'none'), { colorMode: 'html' }))
      .toThrow('themeVariables.cScale0: "none" is not a CSS color')
    expect(() => renderMermaidSVG(init(RADAR, 'titleColor', 'none')))
      .toThrow('themeVariables.titleColor: "none" is not a CSS color')
    expect(() => renderMermaidSVG(init(RADAR, 'radar', { axisColor: 'none' })))
      .toThrow('themeVariables.radar.axisColor: "none" is not a CSS color')
  })

  test('admitted custom properties survive every Radar paint sink', () => {
    const source = `%%{init: ${JSON.stringify({ themeVariables: {
      titleColor: 'var(--title)', cScale0: 'var(--curve)',
      radar: { axisColor: 'var(--axis)', graticuleColor: 'var(--grid)' },
    } })}}%%\n${RADAR}`
    const svg = renderMermaidSVG(source)
    for (const variable of ['title', 'curve', 'axis', 'grid']) expect(svg).toContain(`var(--${variable})`)
    expect(renderMermaidASCII(source, { colorMode: 'html' })).toContain('style="color:var(--curve)"')
    expect(verifyMermaid(source).warnings).not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })

  test('Radar refusal agrees across verify, PNG, browser-lazy and CLI', async () => {
    const source = init(RADAR, 'radar', { axisColor: 'url(#unsafe)' })
    const named = 'themeVariables.radar.axisColor: "url(#unsafe)" is not a CSS color'
    expect(() => renderMermaidPNG(source)).toThrow(named)
    expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    await expect(renderMermaidSVGAsync(source)).rejects.toThrow(named)
    const result = runBatchLine(JSON.stringify({ op: 'render', format: 'svg', source }), 0)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'radar.axisColor', value: 'url(#unsafe)' } })
    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source } } },
      {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('not used') },
      },
    )
    const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'radar.axisColor', value: 'url(#unsafe)' } })
  })

  test('frontmatter and render options reject nested colors before normalizing them away', () => {
    const yaml = '---\nconfig:\n  themeVariables:\n    radar:\n      graticuleColor: "#12345"\n---\n' + RADAR
    expect(() => renderMermaidSVG(yaml))
      .toThrow('themeVariables.radar.graticuleColor: "#12345" is not a CSS color')
    const options = { mermaidConfig: { themeVariables: { radar: { axisColor: 'url(#bad)' } } } }
    expect(() => renderMermaidSVG(RADAR, options))
      .toThrow('themeVariables.radar.axisColor: "url(#bad)" is not a CSS color')
    for (const bad of [null, 123, [], { nested: 'red' }]) {
      expect(() => renderMermaidSVG(init(RADAR, 'radar', { axisColor: bad })), String(bad))
        .toThrow('themeVariables.radar.axisColor:')
    }
  })

  test('Radar-private colors do not change unrelated families', () => {
    expect(() => renderMermaidSVG(init(FLOW, 'titleColor', 'notacolor'))).not.toThrow()
    expect(() => renderMermaidSVG(init(FLOW, 'radar', { axisColor: 'notacolor' }))).not.toThrow()
  })
})

describe('theme color admission (#303, Architecture layer)', () => {
  test('shared inputs to Architecture color mixes refuse none before output', () => {
    for (const key of [
      'background', 'mainBkg', 'primaryColor', 'nodeBkg',
      'lineColor', 'defaultLinkColor', 'arrowheadColor',
    ]) {
      const source = init(ARCHITECTURE, key, 'none')
      const named = `themeVariables.${key}: "none" is not a CSS color`
      expect(() => renderMermaidSVG(source), key).toThrow(named)
      expect(() => renderMermaidASCII(source), key).toThrow(named)
      expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    }
  })

  test('Architecture-only derived-paint rule preserves direct none elsewhere', () => {
    for (const key of ['background', 'mainBkg', 'primaryColor', 'nodeBkg', 'lineColor', 'defaultLinkColor', 'arrowheadColor']) {
      expect(() => renderMermaidSVG(init(FLOW, key, 'none')), key).not.toThrow()
    }
    for (const key of ['clusterBorder', 'primaryBorderColor', 'secondaryBorderColor', 'secondaryColor']) {
      expect(() => renderMermaidSVG(init(ARCHITECTURE, key, 'none')), key).not.toThrow()
    }
  })

  test('shadowed shared fallbacks do not receive the Architecture color-mix restriction', () => {
    for (const [leading, shadowed] of [
      ['lineColor', 'defaultLinkColor'],
      ['primaryColor', 'nodeBkg'],
    ] as const) {
      const leadingOnly = init(ARCHITECTURE, leading, '#f00')
      const withShadowedNone = `%%{init: ${JSON.stringify({ themeVariables: { [leading]: '#f00', [shadowed]: 'none' } })}}%%\n${ARCHITECTURE}`
      expect(renderMermaidSVG(withShadowedNone), shadowed).toBe(renderMermaidSVG(leadingOnly))
    }
    const directServiceNone = `%%{init: ${JSON.stringify({ themeVariables: {
      background: '#fff', primaryColor: '#f00', mainBkg: 'none',
    } })}}%%\n${ARCHITECTURE}`
    expect(renderMermaidSVG(directServiceNone)).toContain('--arch-service-fill:none')
    for (const vars of [
      { lineColor: 'none', defaultLinkColor: '#f00' },
      { background: 'none', mainBkg: '#f00' },
      { arrowheadColor: '#f00', primaryColor: 'none' },
    ]) {
      const source = `%%{init: ${JSON.stringify({ themeVariables: vars })}}%%\n${ARCHITECTURE}`
      expect(() => renderMermaidSVG(source)).toThrow('is not a CSS color')
    }
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
      const source = init(ARCHITECTURE, key, 'none')
      const svg = renderMermaidSVG(source, colors)
      expect(svg, key).toContain('<svg')
      expect(verifyMermaid(source, { renderOptions: colors }).warnings, key)
        .not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
    }
  })

  test('mainBkg none is named across public routes and input forms', async () => {
    const source = init(ARCHITECTURE, 'mainBkg', 'none')
    const named = 'themeVariables.mainBkg: "none" is not a CSS color'
    expect(() => renderMermaidPNG(source)).toThrow(named)
    await expect(renderMermaidSVGAsync(source)).rejects.toThrow(named)
    for (const format of ['svg', 'ascii', 'unicode'] as const) {
      expect(runBatchLine(JSON.stringify({ op: 'render', format, source }), 0))
        .toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'mainBkg', value: 'none' } })
    }
    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source } } },
      {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('not used') },
      },
    )
    const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'mainBkg', value: 'none' } })
    const yaml = '---\nconfig:\n  themeVariables:\n    mainBkg: none\n---\n' + ARCHITECTURE
    expect(() => renderMermaidSVG(yaml)).toThrow(named)
    expect(() => renderMermaidSVG(ARCHITECTURE, { mermaidConfig: { themeVariables: { mainBkg: 'none' } } }))
      .toThrow(named)
  })

  test('group fills and borders and fallback service fill reject malformed paint', () => {
    for (const key of ['clusterBkg', 'clusterBorder', 'secondaryColor']) {
      for (const value of [...invalid, 123]) {
        const source = init(ARCHITECTURE, key, value)
        const named = `themeVariables.${key}: ${JSON.stringify(String(value))} is not a CSS color`
        expect(() => renderMermaidSVG(source), `${key} ${value}`).toThrow(named)
        expect(() => renderMermaidASCII(source), `${key} ${value}`).toThrow(named)
      }
    }
  })

  test('group fill refuses none because it feeds a derived header color', () => {
    expect(() => renderMermaidSVG(init(ARCHITECTURE, 'clusterBkg', 'none')))
      .toThrow('themeVariables.clusterBkg: "none" is not a CSS color')
    for (const key of ['clusterBorder', 'secondaryColor']) {
      expect(() => renderMermaidSVG(init(ARCHITECTURE, key, 'none'))).not.toThrow()
    }
  })

  test('secondaryColor is a fallback only when mainBkg is absent', () => {
    const source = `%%{init: ${JSON.stringify({ themeVariables: { mainBkg: '#123456', secondaryColor: 'notacolor' } })}}%%\n${ARCHITECTURE}`
    expect(() => renderMermaidSVG(source)).not.toThrow()
    expect(renderMermaidSVG(source)).not.toContain('--arch-service-fill:notacolor')
  })

  test('accepted custom-property paints reach Architecture SVG variables', () => {
    const source = `%%{init: ${JSON.stringify({ themeVariables: {
      clusterBkg: 'var(--group-fill)', clusterBorder: 'var(--group-line)', secondaryColor: 'var(--service-fill)',
    } })}}%%\n${ARCHITECTURE}`
    const svg = renderMermaidSVG(source)
    for (const [name, variable] of [
      ['--arch-group-fill', 'group-fill'],
      ['--arch-group-stroke', 'group-line'],
      ['--arch-service-fill', 'service-fill'],
    ]) expect(svg).toContain(`${name}:var(--${variable})`)
    expect(verifyMermaid(source).warnings).not.toContainEqual({ code: 'RENDER_FAILED', reason: expect.any(String) })
  })

  test('named refusal agrees across verify, PNG, browser-lazy, CLI and MCP', async () => {
    const source = init(ARCHITECTURE, 'clusterBkg', 'url(#unsafe)')
    const named = 'themeVariables.clusterBkg: "url(#unsafe)" is not a CSS color'
    expect(() => renderMermaidPNG(source)).toThrow(named)
    expect(verifyMermaid(source).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    await expect(renderMermaidSVGAsync(source)).rejects.toThrow(named)
    const result = runBatchLine(JSON.stringify({ op: 'render', format: 'svg', source }), 0)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'clusterBkg', value: 'url(#unsafe)' } })
    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source } } },
      {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('not used') },
      },
    )
    const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_THEME_COLOR', key: 'clusterBkg', value: 'url(#unsafe)' } })
  })

  test('frontmatter and options agree, and Architecture-private keys do not affect Flowchart', () => {
    const yaml = '---\nconfig:\n  themeVariables:\n    clusterBorder: "#12345"\n---\n' + ARCHITECTURE
    expect(() => renderMermaidSVG(yaml)).toThrow('themeVariables.clusterBorder: "#12345" is not a CSS color')
    expect(() => renderMermaidSVG(ARCHITECTURE, { mermaidConfig: { themeVariables: { clusterBkg: 'notacolor' } } }))
      .toThrow('themeVariables.clusterBkg: "notacolor" is not a CSS color')
    for (const key of ['clusterBkg', 'clusterBorder', 'secondaryColor']) {
      expect(() => renderMermaidSVG(init(FLOW, key, 'notacolor'))).not.toThrow()
    }
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
        expect(verifyMermaid(ARCHITECTURE, { renderOptions: options }).warnings).toContainEqual({
          code: 'RENDER_FAILED', reason: expect.stringContaining(named),
        })
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
  })

  test('padded none cannot amplify a verify diagnostic', () => {
    const value = `${' '.repeat(10_000)}none`
    const result = verifyMermaid(ARCHITECTURE, { renderOptions: { bg: value } })
    expect(result.ok).toBe(false)
    const reason = result.warnings.find(warning => warning.code === 'RENDER_FAILED')?.reason ?? ''
    expect(reason).toContain('render option "bg"')
    expect(reason.length).toBeLessThan(500)
  })

  test('named refusal agrees across PNG, browser-lazy, CLI, and MCP', async () => {
    const named = 'render option "bg": "none" is not a CSS color for Architecture derived paint'
    expect(() => renderMermaidPNG(ARCHITECTURE, { bg: 'none' })).toThrow(named)
    await expect(renderMermaidSVGAsync(ARCHITECTURE, { bg: 'none' })).rejects.toThrow(named)
    for (const format of ['svg', 'ascii', 'unicode'] as const) {
      const result = runBatchLine(JSON.stringify({ op: 'render', source: ARCHITECTURE, options: { format, bg: 'none' } }), 0)
      expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_RENDER_COLOR', field: 'bg', value: 'none' } })
    }
    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source: ARCHITECTURE, options: { bg: 'none' } } } },
      {
        async execute() { return { ok: true, value: null, logs: [] } },
        async renderPng() { throw new Error('not used') },
      },
    )
    const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_RENDER_COLOR', field: 'bg', value: 'none' } })
    expect(projectRenderErrorDiagnostic({ code: 'INVALID_RENDER_COLOR', field: 'bg', value: 'none', message: 'forged' }))
      .toEqual({ code: 'RENDER_FAILED', message: 'Rendering failed' })
  })
})
