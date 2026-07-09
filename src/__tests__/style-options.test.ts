import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG, validateStyleSpec } from '../index.ts'

const FLOW = `flowchart TD
  subgraph Team [Team]
    A[Plan] -->|ship| B[Launch]
  end`

describe('RenderOptions style surface', () => {
  test('named Style + Palette stacks render without changing Mermaid source', () => {
    const svg = renderMermaidSVG(FLOW, {
      style: ['publication-figure', 'github-light'],
      seed: 2,
      embedFontImport: false,
      security: 'strict',
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('EB Garamond')
    expect(svg).toContain('Plan')
    expect(svg).toContain('Launch')
  })

  test('hand-drawn style adds deterministic backdrop and honors seed', () => {
    const a = renderMermaidSVG(FLOW, { style: 'hand-drawn', seed: 4, embedFontImport: false })
    const b = renderMermaidSVG(FLOW, { style: 'hand-drawn', seed: 4, embedFontImport: false })
    const c = renderMermaidSVG(FLOW, { style: 'hand-drawn', seed: 5, embedFontImport: false })

    expect(a).toContain('data-backdrop="paper-ruled"')
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  test('custom public style fragments validate and render', () => {
    const spec = {
      colors: { bg: '#fffdf7', fg: '#1f2937', line: '#2563eb', accent: '#dc2626' },
      stroke: 'jittered' as const,
      roughness: 0.4,
      fill: 'none' as const,
      strokeWidth: 1.8,
    }
    expect(validateStyleSpec(spec)).toEqual([])
    const svg = renderMermaidSVG(FLOW, { style: spec, seed: 1, embedFontImport: false })
    expect(svg).toContain('--bg:#fffdf7')
    expect(svg).toContain('<svg')
  })

  test('removed role-style keys are rejected at validation and render boundaries', () => {
    for (const key of ['text', 'node', 'edge', 'group']) {
      expect(validateStyleSpec({ [key]: {} }), key).toContain(`unknown field "${key}"`)
      expect(() => renderMermaidSVG(FLOW, { style: { [key]: {} } as any })).toThrow(/Invalid style spec/)
    }
  })
})
