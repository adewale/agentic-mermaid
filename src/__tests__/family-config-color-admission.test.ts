import { describe, expect, test } from 'bun:test'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { renderMermaidSVGAsync } from '../browser-lazy.ts'
import { verifyMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { runBatchLine } from '../cli/index.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

const TIMELINE = 'timeline\n  2020 : Start\n  2021 : End'
const JOURNEY = 'journey\n  section S\n  Task: 3: Me'
const invalid = ['notacolor', '#12345', 'rgb(x)', 'hsl(120 50% 50% / .5 / junk)', 'url(#a)'] as const

function source(family: 'timeline' | 'journey', config: Record<string, unknown>): string {
  return `%%{init: ${JSON.stringify({ [family]: config })}}%%\n${family === 'timeline' ? TIMELINE : JOURNEY}`
}

describe('family config color admission (#303, Timeline/Journey)', () => {
  test('each consumed color list and title scalar refuses malformed values in SVG and terminal output', () => {
    for (const [family, key] of [
      ['timeline', 'sectionFills'], ['timeline', 'sectionColours'], ['timeline', 'sectionColors'],
      ['journey', 'actorColours'], ['journey', 'sectionFills'], ['journey', 'sectionColours'],
      ['journey', 'titleColor'],
    ] as const) {
      for (const value of invalid) {
        const isScalar = key === 'titleColor'
        const input = source(family, { [key]: isScalar ? value : [value] })
        const path = `${family}.${key}${isScalar ? '' : '[0]'}`
        const named = `${path}: ${JSON.stringify(value)} is not a CSS color`
        expect(() => renderMermaidSVG(input), path).toThrow(named)
        expect(() => renderMermaidASCII(input), path).toThrow(named)
      }
    }
  })

  test('non-string entries and non-array lists are named before normalization drops them', () => {
    for (const family of ['timeline', 'journey'] as const) {
      const input = source(family, { sectionFills: ['#f96', 42] })
      expect(() => renderMermaidSVG(input)).toThrow(`${family}.sectionFills[1]: "42" is not a CSS color`)
      expect(verifyMermaid(input).warnings).toContainEqual({
        code: 'RENDER_FAILED', reason: expect.stringContaining(`${family}.sectionFills[1]: "42"`),
      })
      expect(() => renderMermaidSVG(source(family, { sectionFills: '#f96' })))
        .toThrow(`${family}.sectionFills: "#f96" is not an array of CSS colors`)
    }
    expect(() => renderMermaidSVG(source('journey', { titleColor: 42 })))
      .toThrow('journey.titleColor: "42" is not a CSS color')
  })

  test('derived fills and label ink reject none; direct actor dots permit none', () => {
    for (const [family, key] of [
      ['timeline', 'sectionFills'], ['timeline', 'sectionColours'], ['timeline', 'sectionColors'],
      ['journey', 'sectionFills'], ['journey', 'sectionColours'],
    ] as const) {
      expect(() => renderMermaidSVG(source(family, { [key]: ['none'] })))
        .toThrow(`${family}.${key}[0]: "none" is not a CSS color`)
    }
    expect(() => renderMermaidSVG(source('journey', { titleColor: 'none' })))
      .toThrow('journey.titleColor: "none" is not a CSS color')
    expect(() => renderMermaidSVG(source('journey', { actorColours: ['none'] }))).not.toThrow()
  })

  test('valid authored CSS colors and simple vars remain paintable', () => {
    for (const family of ['timeline', 'journey'] as const) {
      const input = source(family, { sectionFills: ['#f96', 'var(--brand)'], sectionColours: ['rebeccapurple'] })
      const svg = renderMermaidSVG(input)
      expect(svg).toContain('var(--brand)')
      // Journey may replace section ink to satisfy its contrast guard.
      if (family === 'timeline') expect(svg).toContain('rebeccapurple')
      expect(verifyMermaid(input).ok).toBe(true)
    }
    const journeySvg = renderMermaidSVG(source('journey', { actorColours: ['rgb(255 0 0)'], titleColor: 'currentColor' }))
    expect(journeySvg).toContain('.journey-actor-0 { fill: rgb(255 0 0); }')
    expect(journeySvg).toContain('.journey-title { fill: currentColor; }')
    expect(renderMermaidSVG(source('timeline', { sectionColors: ['#abc'] }))).toContain('.timeline-section-label { fill: #abc; }')
  })

  test('Timeline alias follows canonical precedence and explicit options replace source config', () => {
    expect(() => renderMermaidSVG(source('timeline', {
      sectionColours: ['#fff'], sectionColors: ['notacolor'],
    }))).not.toThrow()
    expect(() => renderMermaidSVG(source('timeline', {
      sectionColours: ['notacolor'], sectionColors: ['#fff'],
    }))).toThrow('timeline.sectionColours[0]: "notacolor" is not a CSS color')
    expect(() => renderMermaidSVG(source('timeline', { sectionFills: ['notacolor'] }), {
      mermaidConfig: { timeline: { sectionFills: ['#abc'] } },
    })).not.toThrow()
  })

  test('merged frontmatter/options and every public output route preserve named refusal', async () => {
    const input = '---\nconfig:\n  timeline:\n    sectionFills: [notacolor]\n---\n' + TIMELINE
    const named = 'timeline.sectionFills[0]: "notacolor" is not a CSS color'
    expect(() => renderMermaidPNG(input)).toThrow(named)
    expect(verifyMermaid(input).warnings).toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    await expect(renderMermaidSVGAsync(input)).rejects.toThrow(named)
    const options = { mermaidConfig: { timeline: { sectionFills: ['notacolor'] } } }
    expect(() => renderMermaidSVG(TIMELINE, options)).toThrow(named)
    expect(verifyMermaid(TIMELINE, { renderOptions: options }).warnings)
      .toContainEqual({ code: 'RENDER_FAILED', reason: expect.stringContaining(named) })
    const result = runBatchLine(JSON.stringify({ op: 'render', format: 'svg', source: input }), 0)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_CONFIG_COLOR', path: 'timeline.sectionFills[0]', value: 'notacolor' } })
    const response = await handleHostedRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'render_svg', arguments: { source: input } } },
      { async execute() { return { ok: true, value: null, logs: [] } }, async renderPng() { throw new Error('not used') } },
    )
    const payload = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0]!.text)
    expect(payload).toMatchObject({ ok: false, error: { code: 'INVALID_CONFIG_COLOR', path: 'timeline.sectionFills[0]', value: 'notacolor' } })
    expect(projectRenderErrorDiagnostic({ code: 'INVALID_CONFIG_COLOR', path: 'timeline.sectionFills[0]', value: 'notacolor', message: 'forged' }))
      .toEqual({ code: 'RENDER_FAILED', message: 'Rendering failed' })
  })

  test('family-private config paints do not affect unrelated diagrams', () => {
    expect(() => renderMermaidSVG(source('journey', { titleColor: 'notacolor' }).replace(JOURNEY, TIMELINE))).not.toThrow()
    expect(() => renderMermaidSVG(source('timeline', { sectionFills: ['notacolor'] }).replace(TIMELINE, JOURNEY))).not.toThrow()
  })
})
