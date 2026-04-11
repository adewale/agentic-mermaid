import { describe, expect, it } from 'bun:test'

import {
  getFrontmatterMap,
  getFrontmatterScalar,
  normalizeMermaidSource,
  preprocessMermaidSource,
} from '../mermaid-source.ts'

describe('preprocessMermaidSource', () => {
  it('parses real YAML frontmatter, including anchors, lists, and block scalars', () => {
    const processed = preprocessMermaidSource(`---
theme: base
themeCSS: |
  .foo { fill: red; }
secure:
  - theme
palette: &palette
  plotColorPalette: "#ff6b6b, #0ea5e9"
themeVariables:
  xyChart: *palette
config:
  xyChart:
    width: 640
---
xychart
x-axis [A]
bar [1]`)

    expect(processed.body).toBe(`xychart
x-axis [A]
bar [1]`)
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['theme'])).toBe('base')
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['themeCSS'])).toContain('.foo { fill: red; }')
    expect(processed.frontmatter.secure).toEqual(['theme'])
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['themeVariables', 'xyChart', 'plotColorPalette']))
      .toBe('#ff6b6b, #0ea5e9')
    expect(getFrontmatterScalar<number>(processed.frontmatter, ['xyChart', 'width'])).toBe(640)
  })

  it('merges init directives before and after the header and strips them from the body', () => {
    const processed = preprocessMermaidSource(`%%{init: { theme: base, config: { xyChart: { width: 640 } } }}%%
xychart
%% regular comment
x-axis [A]
%%{initialize: { fontFamily: 'Fira Code', themeVariables: { primaryTextColor: '#111111' } }}%%
bar [1]`)

    expect(processed.lines).toEqual([
      'xychart',
      'x-axis [A]',
      'bar [1]',
    ])
    expect(processed.body).not.toContain('%%{')
    expect(processed.lines).not.toContain('%% regular comment')
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['theme'])).toBe('base')
    expect(getFrontmatterScalar<number>(processed.frontmatter, ['xyChart', 'width'])).toBe(640)
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['fontFamily'])).toBe('Fira Code')
    expect(getFrontmatterScalar<string>(processed.frontmatter, ['themeVariables', 'primaryTextColor'])).toBe('#111111')
  })
})

describe('normalizeMermaidSource', () => {
  it('merges base config with parsed frontmatter and directive overrides', () => {
    const normalized = normalizeMermaidSource(`---
theme: neutral
timeline:
  disableMulticolor: false
---
%%{init: { timeline: { disableMulticolor: true, sectionColors: ['#111111', '#222222'] } }}%%
timeline
  title Release plan
  section Now
    Ship : Done`, {
      fontFamily: 'IBM Plex Sans',
      timeline: { disableMulticolor: false },
    })

    expect(normalized.text).toBe(`timeline
title Release plan
section Now
Ship : Done`)
    expect(normalized.config.theme).toBe('neutral')
    expect(normalized.config.fontFamily).toBe('IBM Plex Sans')
    expect(normalized.config.timeline?.disableMulticolor).toBe(true)
    expect(normalized.config.timeline?.sectionColours).toEqual(['#111111', '#222222'])
    expect(getFrontmatterMap(normalized.frontmatter, ['timeline'])).toEqual(expect.objectContaining({
      disableMulticolor: true,
    }))
  })
})
