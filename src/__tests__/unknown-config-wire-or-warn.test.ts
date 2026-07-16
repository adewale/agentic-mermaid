import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { renderMermaidSVG } from '../index.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'

const CASES: Array<{ family: string; section: string; source: string; invalidKey: string; invalidValue: unknown }> = [
  { family: 'flowchart', section: 'flowchart', source: 'flowchart LR\n  A --> B', invalidKey: 'nodeSpacing', invalidValue: 'bad' },
  { family: 'state', section: 'state', source: 'stateDiagram-v2\n  A --> B', invalidKey: 'nodeSpacing', invalidValue: 'bad' },
  { family: 'sequence', section: 'sequence', source: 'sequenceDiagram\n  A->>B: hi', invalidKey: 'actorMargin', invalidValue: 'bad' },
  { family: 'timeline', section: 'timeline', source: 'timeline\n  2026 : Event', invalidKey: 'disableMulticolor', invalidValue: 'bad' },
  { family: 'journey', section: 'journey', source: 'journey\n  Task: 3: Me', invalidKey: 'maxLabelWidth', invalidValue: 'bad' },
  { family: 'class', section: 'class', source: 'classDiagram\n  class A', invalidKey: 'hierarchicalNamespaces', invalidValue: 'bad' },
  { family: 'er', section: 'er', source: 'erDiagram\n  A', invalidKey: 'layoutDirection', invalidValue: 'SIDEWAYS' },
  { family: 'architecture', section: 'architecture', source: 'architecture-beta\n  service a(server)[A]', invalidKey: 'nodeSeparation', invalidValue: 'bad' },
  { family: 'xychart', section: 'xyChart', source: 'xychart-beta\n  bar [1, 2]', invalidKey: 'plotReservedSpacePercent', invalidValue: 1000 },
  { family: 'pie', section: 'pie', source: 'pie\n  "A" : 1', invalidKey: 'textPosition', invalidValue: 'bad' },
  { family: 'quadrant', section: 'quadrantChart', source: 'quadrantChart\n  A: [0.5, 0.5]', invalidKey: 'chartWidth', invalidValue: 'bad' },
  { family: 'gantt', section: 'gantt', source: 'gantt\n  dateFormat YYYY-MM-DD\n  A :a, 2026-01-01, 1d', invalidKey: 'displayMode', invalidValue: 'wide' },
  { family: 'mindmap', section: 'mindmap', source: 'mindmap\n  Root\n    Child', invalidKey: 'padding', invalidValue: 'bad' },
  { family: 'gitgraph', section: 'gitGraph', source: 'gitGraph\n  commit', invalidKey: 'showBranches', invalidValue: 'bad' },
  { family: 'radar', section: 'radar', source: 'radar-beta\n  axis a, b, c\n  curve x{1, 2, 3}\n  max 5', invalidKey: 'curveTension', invalidValue: 5 },
]

function configured(section: string, source: string): string {
  return `---\nconfig:\n  ${section}:\n    madeUpKey: 7\n---\n${source}`
}

describe('family config is exhaustive wire-or-warn', () => {
  test('the config-honesty matrix enrolls every built-in family exactly once', () => {
    expect(CASES.map(entry => entry.family).sort()).toEqual(BUILTIN_FAMILY_METADATA.map(entry => entry.id).sort())
    expect(new Set(CASES.map(entry => entry.family)).size).toBe(CASES.length)
  })

  for (const entry of CASES) {
    test(`${entry.family}: unknown keys never disappear silently`, () => {
      const parsed = parseMermaid(configured(entry.section, entry.source))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const warning = verifyMermaid(parsed.value).warnings.find(item =>
        item.code === 'INEFFECTIVE_CONFIG' && item.field === `${entry.section}.madeUpKey`)
      expect(warning).toBeDefined()
    })
  }

  test('init directives use the same classifier', () => {
    const parsed = parseMermaid('%%{init: {"flowchart": {"madeUpKey": 7}}}%%\nflowchart LR\n  A --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({
      code: 'INEFFECTIVE_CONFIG', field: 'flowchart.madeUpKey',
    }))
  })

  for (const entry of CASES) {
    test(`${entry.family}: explicit RenderOptions config reports unknown keys without changing bytes`, () => {
      const diagnostics: string[] = []
      const mermaidConfig = { [entry.section]: { madeUpKey: 7 } } as MermaidRuntimeConfig
      const configuredSvg = renderMermaidSVG(entry.source, {
        embedFontImport: false,
        mermaidConfig,
        onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field),
      })
      expect(diagnostics).toEqual([`${entry.section}.madeUpKey`])
      expect(configuredSvg).toBe(renderMermaidSVG(entry.source, { embedFontImport: false }))
    })
  }

  for (const entry of CASES) {
    test(`${entry.family}: invalid documented values warn through source and explicit config`, () => {
      const field = `${entry.section}.${entry.invalidKey}`
      const source = `%%{init: ${JSON.stringify({ [entry.section]: { [entry.invalidKey]: entry.invalidValue } })}}%%\n${entry.source}`
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(verifyMermaid(parsed.value).warnings).toContainEqual(expect.objectContaining({ code: 'INEFFECTIVE_CONFIG', field }))

      const diagnostics: string[] = []
      const configuredSvg = renderMermaidSVG(entry.source, {
        embedFontImport: false,
        mermaidConfig: { [entry.section]: { [entry.invalidKey]: entry.invalidValue } } as MermaidRuntimeConfig,
        onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field),
      })
      expect(diagnostics).toContain(field)
      expect(configuredSvg).toBe(renderMermaidSVG(entry.source, { embedFontImport: false }))
    })
  }

  test('nested XY axis keys and non-object sections are diagnosed', () => {
    const diagnostics: string[] = []
    renderMermaidSVG(CASES.find(entry => entry.family === 'xychart')!.source, {
      mermaidConfig: { xyChart: { xAxis: { labelFontSize: 'bad' as never, madeUp: 1 } } },
      onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field),
    })
    expect(diagnostics.sort()).toEqual(['xyChart.xAxis.labelFontSize', 'xyChart.xAxis.madeUp'])

    const sectionDiagnostics: string[] = []
    renderMermaidSVG(CASES[0]!.source, {
      mermaidConfig: { flowchart: 'bad' as never },
      onConfigDiagnostic: diagnostic => sectionDiagnostics.push(diagnostic.field),
    })
    expect(sectionDiagnostics).toEqual(['flowchart'])
  })

  test('explicit documented no-op keys report through the same callback', () => {
    const diagnostics: string[] = []
    const configuredSvg = renderMermaidSVG(CASES[0]!.source, {
      embedFontImport: false,
      mermaidConfig: { flowchart: { curve: 'basis' } },
      onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field),
    })
    expect(diagnostics).toEqual(['flowchart.curve'])
    expect(configuredSvg).toBe(renderMermaidSVG(CASES[0]!.source, { embedFontImport: false }))
  })
})
