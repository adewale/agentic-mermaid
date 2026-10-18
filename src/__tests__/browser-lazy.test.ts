import { describe, expect, test } from 'bun:test'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import { BrowserFamilyDetectionError, renderMermaidSVGAsync } from '../browser-lazy.ts'
import { detectBrowserBuiltinFamilyFromFirstLine } from '../browser-lazy/generated/catalog.ts'
import { renderMermaidSVG } from '../index.ts'
import { detectDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import type { ConfigDiagnostic } from '../types.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'

describe('async browser SVG entry', () => {
  test('loads descriptor diagnostics without the complete registry and matches explicit synchronous output', async () => {
    const cases = [
      { id: 'state', config: { state: { nodeSpacing: -1, defaultRenderer: 'dagre' } }, fields: ['state.defaultRenderer', 'state.nodeSpacing'] },
      { id: 'radar', config: { radar: { axisScaleFactor: 0 }, themeVariables: { radar: { curveOpacity: 3 } } }, fields: ['radar.axisScaleFactor', 'themeVariables.radar.curveOpacity'] },
      { id: 'xychart', config: { xyChart: { xAxis: { labelRotation: 30, labelFontSize: 0 } } }, fields: ['xyChart.xAxis.labelFontSize', 'xyChart.xAxis.labelRotation'] },
      { id: 'mindmap', config: { layout: 'unsupported', mindmap: { padding: -1 } }, fields: ['layout', 'mindmap.padding'] },
      { id: 'sankey', config: { sankey: { width: 0.5, nodeWidth: 0.5 } }, fields: ['sankey.nodeWidth', 'sankey.width'] },
    ].map(entry => ({ ...entry, source: getFamily(entry.id)!.example }))
    const child = Bun.spawn([process.execPath, '-e', `
      import { renderMermaidSVGAsync } from ${JSON.stringify(new URL('../browser-lazy.ts', import.meta.url).pathname)};
      const results = [];
      for (const entry of ${JSON.stringify(cases)}) {
        const diagnostics = [];
        const svg = await renderMermaidSVGAsync(entry.source, { mermaidConfig: entry.config, onConfigDiagnostic: item => diagnostics.push(item) });
        results.push({ svg, diagnostics });
      }
      console.log(JSON.stringify(results));
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [text, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(exitCode, stderr).toBe(0)
    const results = JSON.parse(text) as Array<{ svg: string; diagnostics: ConfigDiagnostic[] }>
    for (const [index, entry] of cases.entries()) {
      const diagnostics: ConfigDiagnostic[] = []
      const svg = renderMermaidSVG(entry.source, {
        mermaidConfig: entry.config as MermaidRuntimeConfig, onConfigDiagnostic: item => diagnostics.push(item),
      })
      expect(diagnostics.map(item => item.field)).toEqual(entry.fields)
      expect(results[index]).toEqual({ svg, diagnostics })
    }
  })

  test('renders every enrolled family with byte-exact synchronous parity', async () => {
    const families = knownBuiltinFamilies()
    expect(families.length).toBeGreaterThan(10)
    for (const id of families) {
      const source = getFamily(id)!.example
      expect(await renderMermaidSVGAsync(source, { security: 'strict' }), id)
        .toBe(renderMermaidSVG(source, { security: 'strict' }))
    }
  })

  test('keeps all families identical with non-default layout and Style options', async () => {
    const options = {
      style: 'hand-drawn',
      security: 'strict',
      padding: 31,
      nodeSpacing: 47,
      layerSpacing: 53,
      shadow: true,
    } as const
    for (const id of knownBuiltinFamilies()) {
      const source = getFamily(id)!.example
      expect(await renderMermaidSVGAsync(source, options), id)
        .toBe(renderMermaidSVG(source, options))
    }
  })

  test('keeps concurrently loaded graph-family parser routes additive', async () => {
    const sources = ['flowchart LR\n  A --> B', 'stateDiagram-v2\n  [*] --> Ready'] as const
    const results = await Promise.all(sources.map(source => renderMermaidSVGAsync(source)))
    expect(results[0]).toBe(renderMermaidSVG(sources[0]))
    expect(results[1]).toBe(renderMermaidSVG(sources[1]))
  })

  test('keeps the generated built-in detector aligned with canonical routing', () => {
    const candidates = new Set<string>()
    for (const id of knownBuiltinFamilies()) {
      const family = getFamily(id)!
      candidates.add(family.example.split(/\r?\n/, 1)[0]!)
      for (const header of [...family.headers, ...family.aliases]) {
        candidates.add(header)
        candidates.add(`  ${header.toUpperCase()}  `)
        candidates.add(`${header}; ignored suffix`)
        candidates.add(`${header} unexpected`)
        candidates.add(`${header}V2`)
      }
    }
    for (const firstLine of candidates) {
      const browser: string | null = detectBrowserBuiltinFamilyFromFirstLine(firstLine)
      const canonical: string | null = detectDiagramTypeFromFirstLine(firstLine)
      expect(browser, firstLine).toBe(canonical)
    }
  })

  test('normalizes BOM, frontmatter, init directives, and comments before loading', async () => {
    const source = `\uFEFF---
config:
  theme: base
---
%%{init: {"theme":"base"}}%%
%% wrapper comment
timeline
  title Wrapped
  2026 : Ship`
    expect(await renderMermaidSVGAsync(source, { security: 'strict' }))
      .toBe(renderMermaidSVG(source, { security: 'strict' }))
  })

  test('rejects an unknown family before downloading a runtime', async () => {
    try {
      await renderMermaidSVGAsync('not-a-mermaid-family\n  A --> B')
      throw new Error('expected renderMermaidSVGAsync to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(BrowserFamilyDetectionError)
      expect((error as BrowserFamilyDetectionError).code).toBe('UNSUPPORTED_FAMILY')
    }
  })
})
