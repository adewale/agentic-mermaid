import { describe, expect, test } from 'bun:test'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { renderMermaidSVG, validateStyleSpec } from '../index.ts'

const FAMILY_STYLE_STACK = ['publication-figure', 'github-light'] as const

const SUPPORTED_FAMILIES = [
  'Flowchart',
  'State',
  'Architecture',
  'Sequence',
  'Class',
  'ER',
  'Timeline',
  'Journey',
  'XY Chart',
  'Pie',
  'Quadrant',
  'Gantt',
]

describe('Style + Palette contract', () => {
  test('public style specs reject removed role-style keys', () => {
    for (const key of ['text', 'node', 'edge', 'group']) {
      expect(validateStyleSpec({ [key]: {} }), key).toContain(`unknown field "${key}"`)
    }
  })

  test('shared editor examples cover every supported family', () => {
    expect(EDITOR_EXAMPLES.map(example => example.diagramType).sort()).toEqual([...SUPPORTED_FAMILIES].sort())
    expect(EDITOR_EXAMPLES.some(example => example.category === 'Role style presets')).toBe(false)
  })

  test('one Style + Palette stack renders every supported family example', () => {
    for (const example of EDITOR_EXAMPLES) {
      const svg = renderMermaidSVG(example.source, {
        style: [...FAMILY_STYLE_STACK],
        seed: 2,
        interactive: Boolean(example.options?.interactive),
        security: 'strict',
        compact: true,
        embedFontImport: false,
        idPrefix: `style-audit-${example.id}-`,
      })
      expect(svg.startsWith('<svg'), example.id).toBe(true)
      expect(svg).toContain('</svg>')
    }
  })
})
