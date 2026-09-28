import { describe, expect, test } from 'bun:test'

import { renderMermaidSVG } from '../index.ts'
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
        code: 'RENDER_FAILED', reason: expect.stringContaining(`${family}.sectionFills[1]: "42"`),
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
