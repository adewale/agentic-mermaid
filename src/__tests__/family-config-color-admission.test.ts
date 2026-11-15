import { describe, expect, test } from 'bun:test'

import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'

// Each Timeline and Journey config paint runs through the shared #303
// admission table in theme-color-admission.test.ts. This file keeps the
// config-list rules outside that template: list shape, the Timeline alias,
// and explicit options replacing source config.

const TIMELINE = 'timeline\n  2020 : Start\n  2021 : End'
const JOURNEY = 'journey\n  section S\n  Task: 3: Me'

function source(family: 'timeline' | 'journey', config: Record<string, unknown>): string {
  return `%%{init: ${JSON.stringify({ [family]: config })}}%%\n${family === 'timeline' ? TIMELINE : JOURNEY}`
}

describe('family config color admission (#303, Timeline/Journey)', () => {
  test('non-string entries and non-array lists are named before normalization drops them', () => {
    for (const family of ['timeline', 'journey'] as const) {
      const input = source(family, { sectionFills: ['#f96', 42] })
      expect(() => renderMermaidSVG(input)).toThrow(`${family}.sectionFills[1]: "42" is not a CSS color`)
      expect(verifyMermaid(input).warnings).toContainEqual({
        code: 'RENDER_FAILED', reason: expect.stringContaining(`${family}.sectionFills[1]: "42"`), origin: 'config',
      })
      expect(() => renderMermaidSVG(source(family, { sectionFills: '#f96' })))
        .toThrow(`${family}.sectionFills: "#f96" is not an array of CSS colors`)
    }
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
})

describe('Sankey config color admission (#303)', () => {
  const sankey = (config: Record<string, unknown>): string =>
    `%%{init: ${JSON.stringify({ sankey: config })}}%%\nsankey-beta\nA,B,1`

  test('node-color maps reject invalid shapes and entries before normalization', () => {
    for (const nodeColors of [null, [], 'red', 42]) {
      expect(() => renderMermaidSVG(sankey({ nodeColors }))).toThrow('sankey.nodeColors:')
    }
    for (const value of ['notacolor', 'rgb(x)', '#12345', 'url(#a)', 42, null]) {
      const input = sankey({ nodeColors: { Unused: value } })
      const named = 'sankey.nodeColors.Unused:'
      expect(() => renderMermaidSVG(input)).toThrow(named)
      expect(() => renderMermaidASCII(input)).toThrow(named)
      expect(verifyMermaid(input).warnings).toContainEqual({
        code: 'RENDER_FAILED', reason: expect.stringContaining(named), origin: 'config',
      })
    }
    expect(() => renderMermaidSVG(sankey({ nodeColors: {} }))).not.toThrow()
    expect(() => renderMermaidSVG(sankey({ nodeColors: { A: 'notacolor' } }), {
      mermaidConfig: { sankey: { nodeColors: { A: '#abc' } } },
    })).not.toThrow()
  })

  test('paint modes remain modes, and none is only admitted outside gradient stops', () => {
    for (const linkColor of ['source', 'target', 'gradient']) {
      const input = sankey({ linkColor, nodeColors: { A: '#123456', B: '#abcdef' } })
      expect(() => renderMermaidSVG(input), linkColor).not.toThrow()
      expect(verifyMermaid(input).ok, linkColor).toBe(true)
    }
    for (const linkColor of ['source', 'target', 'red', 'none']) {
      expect(() => renderMermaidSVG(sankey({ linkColor, nodeColors: { A: 'none' } })), linkColor).not.toThrow()
    }
    for (const linkColor of [undefined, 'gradient']) {
      expect(() => renderMermaidSVG(sankey({ linkColor, nodeColors: { A: 'none' } })))
        .toThrow('sankey.nodeColors.A: "none" is not a CSS color')
    }
  })

  test('admitted functional colors and variables survive normalization and reach their paints', () => {
    for (const color of ['rgb(1,2,3)', 'hsl(120 50% 50%)', 'var(--brand)']) {
      const input = `%%{init: ${JSON.stringify({ sankey: { nodeColors: { toString: color, hasOwnProperty: color } } })}}%%\nsankey-beta\ntoString,hasOwnProperty,1`
      const svg = renderMermaidSVG(input)
      expect(svg).toContain(`fill="${color}"`)
      expect(svg).toContain(`stop-color="${color}"`)
      expect(renderMermaidASCII(input, { colorMode: 'html' })).toContain(`style="color:${color}"`)
      expect(verifyMermaid(input).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG')).toEqual([])
    }
  })

  test('node labels never inherit object prototype entries as colors', () => {
    const labels = ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']
    const body = `sankey-beta\n${labels.map((label, index) => `Source${index},${label},1`).join('\n')}`
    for (const linkColor of ['source', 'target', 'gradient']) {
      for (const nodeColors of [{}, { Unused: '#abcdef' }]) {
        const input = `%%{init: ${JSON.stringify({ sankey: { linkColor, nodeColors } })}}%%\n${body}`
        const svg = renderMermaidSVG(input)
        const fills = [...svg.matchAll(/<rect class="sankey-node"[^>]* fill="([^"]+)"/g)].map(match => match[1])
        expect(fills).toHaveLength(labels.length * 2)
        expect(fills.every(fill => /^#[0-9a-f]{6}$/i.test(fill!))).toBe(true)
        for (const colorMode of ['none', 'truecolor', 'html'] as const) {
          const terminal = renderMermaidASCII(input, { colorMode })
          for (const label of labels) expect(terminal).toContain(label)
          expect(terminal).toContain('████')
        }
      }
    }
  })

  test('authored node names are escaped and bounded in color diagnostics', () => {
    const withControl = verifyMermaid(sankey({ nodeColors: { 'A\nB': 'notacolor' } }))
    const reason = withControl.warnings.find(warning => warning.code === 'RENDER_FAILED')?.reason ?? ''
    expect(reason).toContain('sankey.nodeColors["A\\nB"]: "notacolor"')
    expect(reason).not.toContain('\n')
    const longName = verifyMermaid(sankey({ nodeColors: { ['A'.repeat(10_000)]: 'notacolor' } }))
    const bounded = longName.warnings.find(warning => warning.code === 'RENDER_FAILED')?.reason ?? ''
    expect(bounded).toContain('sankey.nodeColors.')
    expect(bounded).toContain('"notacolor"')
    expect(bounded.length).toBeLessThan(900)
  })
})
