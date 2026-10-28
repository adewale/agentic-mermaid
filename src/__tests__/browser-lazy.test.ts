import { describe, expect, test } from 'bun:test'
import { getFamily, knownBuiltinFamilies } from '../agent/families.ts'
import type { FamilyDescriptor } from '../agent/families.ts'
import { BrowserFamilyDetectionError, renderMermaidSVGAsync } from '../browser-lazy.ts'
import { detectBrowserBuiltinFamilyFromFirstLine } from '../browser-lazy/generated/catalog.ts'
import { renderLoadedFamilySvg, renderLoadedFamilySvgWithReceipt } from '../browser-lazy/render-core.ts'
import { registerStyle } from '../scene/style-registry.ts'
import { renderMermaidSVG } from '../index.ts'
import { DeferredDependencyError, LayoutCertificationError } from '../layout/certification-error.ts'
import { DeferredDependencyError as BackendDeferredDependencyError } from '../layout/backend.ts'
import { HtmlEntityTableNotLoadedError } from '../shared/html-entity-table.ts'
import { detectDiagramTypeFromFirstLine } from '../mermaid-source.ts'
import type { ConfigDiagnostic } from '../types.ts'
import type { MermaidRuntimeConfig } from '../mermaid-source.ts'

describe('async browser SVG entry', () => {
  test.each(['Agentic layout', 'Forest layout'])('replays YAML, %s, ELK and entities without changing the admitted request', async producer => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    const source = 'pie\n "One" : 1'
    const expected = await renderLoadedFamilySvgWithReceipt(source, {}, descriptor)
    const loaded: string[] = []
    const names = ['YAML', producer, 'ELK', 'HTML entities']
    const dependencies = names.map(name => {
      const load = async () => { loaded.push(name) }
      return name === 'HTML entities' ? new HtmlEntityTableNotLoadedError('&hearts;', load)
        : new BackendDeferredDependencyError(name, load)
    })
    const suspended: FamilyDescriptor = { ...descriptor, layout: context => {
      if (loaded.length < dependencies.length) {
        const dependency = dependencies[loaded.length]!
        throw loaded.length === 1 ? new Error('family layout suspended', { cause: dependency }) : dependency
      }
      return descriptor.layout!(context)
    } }
    expect(await renderLoadedFamilySvgWithReceipt(source, {}, suspended)).toEqual(expected)
    expect(loaded).toEqual(names)
  })

  test('propagates acquisition failure and permits a new explicit request to retry', async () => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    const source = 'pie\n "One" : 1'
    const expected = await renderLoadedFamilySvgWithReceipt(source, {}, descriptor)
    const failure = new Error('provider download failed')
    let loads = 0, ready = false
    const load = async () => {
      if (++loads === 1) throw failure
      ready = true
    }
    const suspended: FamilyDescriptor = { ...descriptor, layout: context => {
      if (!ready) throw new BackendDeferredDependencyError('Forest layout', load)
      return descriptor.layout!(context)
    } }
    await expect(renderLoadedFamilySvgWithReceipt(source, {}, suspended)).rejects.toBe(failure)
    expect(loads).toBe(1)
    expect(await renderLoadedFamilySvgWithReceipt(source, {}, suspended)).toEqual(expected)
    expect(loads).toBe(2)
  })

  test.each(['unknown provider', 'reused loader'])('bounds replay for %s', async mode => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    let loads = 0
    const load = async () => { loads++ }
    const first = new DeferredDependencyError(mode === 'unknown provider' ? 'Unexpected provider' : 'YAML', load)
    const repeated = new DeferredDependencyError('ELK', load)
    const suspended: FamilyDescriptor = { ...descriptor, layout: () => { throw loads ? repeated : first } }
    await expect(renderLoadedFamilySvg('pie\n "One" : 1', {}, suspended)).rejects.toBe(mode === 'unknown provider' ? first : repeated)
    expect(loads).toBe(mode === 'unknown provider' ? 0 : 1)
  })

  test.each([
    ['state', 'stateDiagram-v2\n  state "x\naccTitle: y" as A\n  A --> B'],
    ['flowchart', 'flowchart TD\n  A["x\naccTitle: y"] --> B'],
  ])('%s preserves quoted accessibility-shaped text on the first family load and when warm', async (family, source) => {
    const child = Bun.spawn([process.execPath, '-e', `
      import { getInstalledFamilyDescriptor } from ${JSON.stringify(new URL('../agent/family-router.ts', import.meta.url).pathname)};
      import { normalizeMermaidSource } from ${JSON.stringify(new URL('../mermaid-source.ts', import.meta.url).pathname)};
      import { renderMermaidSVGWithReceiptAsync } from ${JSON.stringify(new URL('../browser-lazy.ts', import.meta.url).pathname)};
      const unloaded = getInstalledFamilyDescriptor(${JSON.stringify(family)}) === undefined;
      const source = ${JSON.stringify(source)};
      const options = { security: 'strict', embedFontImport: false };
      const cold = await renderMermaidSVGWithReceiptAsync(source, options);
      const warm = await renderMermaidSVGWithReceiptAsync(source, options);
      const normalized = normalizeMermaidSource(source, {}, 'render');
      console.log(JSON.stringify({ unloaded, accessibility: normalized.accessibility, body: normalized.familyBody, cold, warm }));
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(exitCode, stderr).toBe(0)
    const actual = JSON.parse(stdout)
    expect(actual.unloaded).toBe(true)
    expect(actual.accessibility).toEqual({})
    expect(actual.body).toContain('accTitle: y')
    expect(actual.cold.svg).toContain('accTitle: y')
    expect(actual.warm).toEqual(actual.cold)
  })

  test('refuses another loader for a provider that already completed its dependency await', async () => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    let firstLoads = 0, repeatedLoads = 0
    const first = new DeferredDependencyError('YAML', async () => { firstLoads++ })
    const repeated = new DeferredDependencyError('YAML', async () => { repeatedLoads++ })
    const stalled: FamilyDescriptor = { ...descriptor, layout: () => { throw firstLoads ? repeated : first } }
    await expect(renderLoadedFamilySvg('pie\n "One" : 1', {}, stalled)).rejects.toBe(repeated)
    expect(firstLoads).toBe(1)
    expect(repeatedLoads).toBe(0)
  })
  test('retains the admitted named style and its receipt through an async registry replacement', async () => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    const style = 'look:test/async-registry-snapshot'
    const source = 'pie\n "One" : 1'
    const dispose = registerStyle({ formatVersion: 1, name: style, stroke: 'jittered' })
    let replacement: (() => void) | undefined
    try {
      const expected = await renderLoadedFamilySvgWithReceipt(source, { style }, descriptor)
      const pending = renderLoadedFamilySvgWithReceipt(source, { style }, descriptor)
      dispose()
      replacement = registerStyle({ formatVersion: 1, name: style, stroke: 'freehand', colors: { fg: '#ff0000' } })
      expect(await pending).toEqual(expected)
      expect((await renderLoadedFamilySvgWithReceipt(source, { style }, descriptor)).svg).not.toBe(expected.svg)
    } finally { replacement?.(); dispose() }
  })
  test('retains captured options, style and callback while a layout provider loads', async () => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    const style = 'palette:test/provider-registry-snapshot'
    const source = 'pie\n "One" : 1'
    const dispose = registerStyle({ formatVersion: 1, name: style, colors: { fg: '#0000ff' } })
    let replacement: (() => void) | undefined
    let release!: () => void, started!: () => void, ready = false
    const waiting = new Promise<void>(resolve => { release = resolve })
    const loading = new Promise<void>(resolve => { started = resolve })
    const load = async () => { started(); await waiting; ready = true }
    const suspended: FamilyDescriptor = { ...descriptor, layout: context => {
      if (!ready) throw new BackendDeferredDependencyError('Agentic layout', load)
      return descriptor.layout!(context)
    } }
    const diagnostics: ConfigDiagnostic[] = []
    let reads = 0
    const options = { get style() { reads++; return style }, mermaidConfig: { pie: { textPosition: 2 } },
      onConfigDiagnostic: (value: ConfigDiagnostic) => diagnostics.push(value) }
    try {
      const expected = await renderLoadedFamilySvgWithReceipt(source, { ...options, onConfigDiagnostic: () => {} }, descriptor)
      reads = 0
      const pending = renderLoadedFamilySvgWithReceipt(source, options, suspended)
      await loading
      dispose()
      replacement = registerStyle({ formatVersion: 1, name: style, colors: { fg: '#ff0000' } })
      options.mermaidConfig.pie.textPosition = 0.5
      options.onConfigDiagnostic = () => { throw new Error('replacement callback must not run') }
      release()
      expect(await pending).toEqual(expected)
      expect(reads).toBe(1)
      expect(diagnostics.map(value => value.field)).toEqual(['pie.textPosition'])
      expect((await renderLoadedFamilySvgWithReceipt(source, { style }, descriptor)).svg).not.toBe(expected.svg)
    } finally { release(); replacement?.(); dispose() }
  })
  test('palette-only styles keep optional sketch backends unloaded', async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import { renderMermaidSVGAsync } from ${JSON.stringify(new URL('../browser-lazy.ts', import.meta.url).pathname)};
      import { knownBackendDescriptors } from ${JSON.stringify(new URL('../scene/backend.ts', import.meta.url).pathname)};
      await renderMermaidSVGAsync('pie\\n "One" : 1', { style: ['crisp', 'paper'], security: 'strict' });
      console.log(JSON.stringify(knownBackendDescriptors().map(value => value.inputName)));
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual(['default'])
  })
  test('captures accessor options once before optional-backend loading', async () => {
    const { default: descriptor } = await import('../browser-lazy/families/pie.ts')
    let reads = 0
    const options = Object.freeze({ get style() { reads++; return 'hand-drawn' } })
    const source = 'pie\n "One" : 1'
    expect(await renderLoadedFamilySvg(source, options, descriptor)).toBe(renderMermaidSVG(source, { style: 'hand-drawn' }))
    expect(reads).toBe(1)
  })
  test('loads descriptor diagnostics without the complete registry and matches explicit synchronous output', async () => {
    const cases = [
      { id: 'state', config: { state: { nodeSpacing: -1, defaultRenderer: 'dagre' } }, fields: ['state.defaultRenderer', 'state.nodeSpacing'] },
      { id: 'radar', config: { radar: { axisScaleFactor: 0 }, themeVariables: { radar: { curveOpacity: 3 } } }, fields: ['radar.axisScaleFactor', 'themeVariables.radar.curveOpacity'] },
      { id: 'xychart', config: { xyChart: { xAxis: { labelRotation: 30, labelFontSize: 0 } } }, fields: ['xyChart.xAxis.labelFontSize', 'xyChart.xAxis.labelRotation'] },
      { id: 'mindmap', config: { layout: 'unsupported', mindmap: { padding: -1 } }, fields: ['layout', 'mindmap.padding'] },
      { id: 'sankey', config: { sankey: { width: 0.5, nodeWidth: 0.5 } }, fields: ['sankey.nodeWidth', 'sankey.width'] },
      { id: 'c4', config: { c4: { c4ShapeInRow: 1.5, systemFontWeight: '1001', messageFontSize: 48 } }, fields: ['c4.c4ShapeInRow', 'c4.messageFontSize', 'c4.systemFontWeight'] },
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

  test('rejects invalid browser-only final geometry before lowering', async () => {
    const { default: descriptor } = await import('../browser-lazy/families/timeline.ts')
    let layoutCalls = 0
    let loweringCalls = 0
    const invalid: FamilyDescriptor = {
      ...descriptor,
      layout: context => {
        layoutCalls++
        const result = descriptor.layout!(context)
        const positioned = 'positioned' in result ? result.positioned : result
        return { positioned: { ...positioned, width: 1, height: 1 } }
      },
      lowerScene: context => {
        loweringCalls++
        return descriptor.lowerScene!(context)
      },
    }
    await expect(renderLoadedFamilySvg('timeline\n2026 : Launch', {}, invalid)).rejects.toBeInstanceOf(LayoutCertificationError)
    expect(layoutCalls).toBe(1)
    expect(loweringCalls).toBe(0)
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
        candidates.add(`${header} %% Header comment`)
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

  test.each([
    ['wrapper', `\uFEFF---
config:
  theme: base
---
%%{init: {"theme":"base"}}%%
%% wrapper comment
timeline
  title Wrapped
  2026 : Ship`, 'Ship'],
    ['header comment', 'packet %% Header comment\n0-7: "Header"', 'Header'],
    ['encoded header and comment', 'sequence&#68;iagram %% Header comment\nAlice->>Bob: Decoded once', 'Decoded once'],
    ['ignored directive before header', '%%{config: {}}%%packet\n0-7: "Header"', 'Header'],
    ['ignored directive within header', 'pa%%{config: {}}%%cket\n0-7: "Header"', 'Header'],
  ])('normalizes %s before loading', async (_name, source, label) => {
    const svg = await renderMermaidSVGAsync(source, { security: 'strict' })
    expect(svg).toContain(label)
    expect(svg)
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
