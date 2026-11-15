import { describe, expect, test } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { serializeMermaid } from '../agent/serialize.ts'
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
  { family: 'sankey', section: 'sankey', source: 'sankey-beta\n  A,B,10\n  B,C,4', invalidKey: 'nodeWidth', invalidValue: 'bad' },
  { family: 'c4', section: 'c4', source: 'C4Context\n  System(a,"A")\n  System(b,"B")\n  Rel(a,b,"Uses")', invalidKey: 'c4ShapeInRow', invalidValue: 'bad' },
  { family: 'packet', section: 'packet', source: 'packet\n+8: "Byte"', invalidKey: 'bitsPerRow', invalidValue: 'bad' },
  { family: 'kanban', section: 'kanban', source: 'kanban\n  todo[To do]\n    task[Build]', invalidKey: 'sectionWidth', invalidValue: 'bad' },
  { family: 'requirement', section: 'requirement', source: 'requirementDiagram\nrequirement r {\ntext: "Preserve meaning"\n}', invalidKey: 'fontSize', invalidValue: 'bad' },
  { family: 'treemap', section: 'treemap', source: 'treemap\n"Build": 60\n"Learn": 40', invalidKey: 'nodeWidth', invalidValue: 'bad' },
  { family: 'ishikawa', section: 'ishikawa', source: 'ishikawa\nSlow release\nTooling\n  Slow builds', invalidKey: 'diagramPadding', invalidValue: 'bad' },
  { family: 'block', section: 'block', source: 'block\ncolumns 2\nA["API"] B["DB"]\nA --> B', invalidKey: 'padding', invalidValue: 'bad' },
]

function configured(section: string, source: string): string {
  return `---\nconfig:\n  ${section}:\n    madeUpKey: 7\n---\n${source}`
}

describe('family config is exhaustive wire-or-warn', () => {
  for (const entry of CASES) {
    test(`${entry.family}: unknown keys never disappear silently`, () => {
      const parsed = parseMermaid(configured(entry.section, entry.source))
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const warning = verifyMermaid(parsed.value).warnings.find(item => item.code === 'INEFFECTIVE_CONFIG' && item.field === `${entry.section}.madeUpKey`)
      expect(warning).toBeDefined()
    })
  }

  test('init directives use the same classifier', () => {
    const parsed = parseMermaid('%%{init: {"flowchart": {"madeUpKey": 7}}}%%\nflowchart LR\n  A --> B')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(verifyMermaid(parsed.value).warnings).toContainEqual(
      expect.objectContaining({
        code: 'INEFFECTIVE_CONFIG',
        field: 'flowchart.madeUpKey',
      }),
    )
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

  test('C4 official font settings remain preserved and explicitly ineffective', () => {
    const source = CASES.find(entry => entry.family === 'c4')!.source
    const config = { systemFontFamily: 'monospace', external_container_dbFont: 'ignored', messageFontSize: 48, messageFontWeight: 'bold' }
    const authored = `%%{init: ${JSON.stringify({ c4: config })}}%%\n${source}`
    const parsed = parseMermaid(authored)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(serializeMermaid(parsed.value)).toBe(authored)
    for (const key of Object.keys(config)) {
      const warning = verifyMermaid(parsed.value).warnings.find(item => item.code === 'INEFFECTIVE_CONFIG' && item.field === `c4.${key}`)
      if (warning?.code !== 'INEFFECTIVE_CONFIG') throw new Error(`Missing C4 compatibility diagnostic for ${key}`)
      expect(warning.message).toContain('compatibility')
      expect(warning.message).not.toContain('unknown')
    }
    const diagnostics: string[] = []
    expect(renderMermaidSVG(source, { embedFontImport: false, mermaidConfig: { c4: config }, onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field) })).toBe(renderMermaidSVG(source, { embedFontImport: false }))
    expect(diagnostics.sort()).toEqual(
      Object.keys(config)
        .map(key => `c4.${key}`)
        .sort(),
    )
  })

  test('invalid C4 dimensions, row counts and typography warn and retain default geometry', () => {
    const source = CASES.find(entry => entry.family === 'c4')!.source
    const baseline = renderMermaidSVG(source, { embedFontImport: false })
    for (const config of [
      { maxWidth: 0 },
      { maxWidth: 10001 },
      { compact: 'true' },
      { typeLegend: 'false' },
      { width: 23 },
      { diagramMarginX: -1 },
      { c4ShapePadding: 3 },
      { c4ShapeInRow: 1.5 },
      { c4BoundaryInRow: 10001 },
      { wrap: 'false' },
      { systemFontSize: 'bad' },
      { systemFontWeight: 'bold' },
      { systemFontWeight: 1001 },
      { systemFontWeight: '10000' },
    ]) {
      const diagnostics: string[] = []
      const output = renderMermaidSVG(source, { embedFontImport: false, mermaidConfig: { c4: config } as MermaidRuntimeConfig, onConfigDiagnostic: diagnostic => diagnostics.push(diagnostic.field) })
      expect(diagnostics).toEqual(Object.keys(config).map(key => `c4.${key}`))
      expect(output).toBe(baseline)
    }
  })
})
