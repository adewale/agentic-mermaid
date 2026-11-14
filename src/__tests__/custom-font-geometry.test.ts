import { KNOWN_EXTENSION_CONTRACT_VERSIONS } from '../shared/extension-identity.ts'
import { describe, expect, test } from 'bun:test'
import { createMermaidRenderer, DefaultBackend, registerBackend, renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { fitUncalibratedSvgText } from '../custom-font-geometry.ts'
import { HOSTED_FONT_RESOURCES } from '../font-manifest.ts'
import { measureFormattedTextWidth, measureMonospaceTextWidth, measureTextWidth } from '../text-metrics.ts'
import { decodePng, inkColumns } from './helpers/png-pixels.ts'
import { createTextMeasurementExecution, withTextMeasurementExecution } from '../text-measurement-profile.ts'
import { Resvg } from '@resvg/resvg-js'
import { join } from 'node:path'
import { withRenderStageObserver } from '../render-stages.ts'
import { useTestChildren } from './helpers/test-child.ts'

const BUNDLED_FONT_FAMILIES = [...new Set(HOSTED_FONT_RESOURCES.map(resource => resource.family))]
const runChild = useTestChildren(20_000)

describe('deterministic custom-font geometry', () => {
  test.each([
    ['jAlphabetf', 24, 400], ['jAlphabetf', 48, 500], ['jAlphabetf', 72, 600],
    ['jjjjjj', 48, 700], ['<b>jjjjjj</b>', 48, 400], ['jAlpha<b>f</b>', 24, 400],
  ].flatMap(([label, size, weight]) => (['agentic', 'elk'] as const).flatMap(backend => (['native', 'scene'] as const).map(mode => ({ label: String(label), size: Number(size), weight: Number(weight), backend, mode })))))('bundled Inter outlines survive zero padding: $label/$size/$weight/$backend/$mode', async ({ label, size, weight, backend, mode }) => {
    const source = `flowchart LR\nA["${label}"]\nstyle A fill:none,stroke:none`
    const options = { font: 'Inter', padding: 0, embedFontImport: false, graphLayout: { backend, fallback: 'none' as const },
      style: { roles: { node: { fontSize: size, fontWeight: weight, paddingX: 0, paddingY: 0 } } } }
    let result: ReturnType<typeof renderMermaidSVGWithReceipt>
    if (mode === 'native') {
      const child = await runChild(process.execPath, ['-e', `
        import { renderMermaidSVGWithReceipt } from './src/index.ts'
        import { withRenderStageObserver } from './src/render-stages.ts'
        const stages = [], result = withRenderStageObserver(s => stages.push(s.stage), () => renderMermaidSVGWithReceipt(${JSON.stringify(source)}, ${JSON.stringify(options)}))
        console.log(JSON.stringify({ result, stages }))
      `], { cwd: `${import.meta.dir}/../..`, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0', AGENTIC_MERMAID_ELK_CACHE: '0' } })
      expect(child.status, child.stderr).toBe(0)
      const packet = JSON.parse(child.stdout)
      expect(packet.stages).toContain('drawing'); expect(packet.stages).not.toContain('scene')
      result = packet.result
    } else {
      const stages: string[] = []
      result = withRenderStageObserver(s => stages.push(s.stage), () => renderMermaidSVGWithReceipt(source, { ...options, layoutSafety: 'strict' }))
      expect(stages).toContain('scene')
    }
    expect(result.receipt.layoutCertification?.status).toBe('passed')
    const root = result.svg.match(/<svg\b[^>]*>/)![0], text = result.svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g)!
    expect(text).toHaveLength(1)
    const view = root.match(/viewBox="([^"]+)"/)![1]!.split(/\s+/).map(Number)
    const width = Number(root.match(/width="([^"]+)"/)![1]), height = Number(root.match(/height="([^"]+)"/)![1])
    // Reveal any clipped ink with a viewport-only change. All text bytes,
    // shaping, fitting and coordinates remain those of the returned SVG.
    const expandedRoot = root.replace(/width="[^"]+"/, `width="${width * (view[2]! + 40) / view[2]!}"`)
      .replace(/height="[^"]+"/, `height="${height * (view[3]! + 40) / view[3]!}"`)
      .replace(/viewBox="[^"]+"/, `viewBox="${view[0]! - 20} ${view[1]! - 20} ${view[2]! + 40} ${view[3]! + 40}"`)
    const expanded = result.svg.replace(root, expandedRoot)
    const font = { fontFiles: HOSTED_FONT_RESOURCES.filter(face => face.family === 'Inter').map(face => join(import.meta.dirname, '../..', face.path)), loadSystemFonts: false, defaultFontFamily: 'Inter' }
    const raster = new Resvg(expanded, { font }).render(), pixels = raster.pixels
    const absent = new Resvg(expanded.replace(text[0]!, ''), { font }).render().pixels
    let changed = 0, outside = 0
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) {
      const offset = (y * raster.width + x) * 4
      if (pixels.subarray(offset, offset + 4).equals(absent.subarray(offset, offset + 4))) continue
      changed++
      const wx = view[0]! - 20 + (x + .5) * (view[2]! + 40) / raster.width, wy = view[1]! - 20 + (y + .5) * (view[3]! + 40) / raster.height
      if (wx < view[0]! || wx >= view[0]! + view[2]! || wy < view[1]! || wy >= view[1]! + view[3]!) outside++
    }
    expect(changed).toBeGreaterThan(0)
    expect(outside).toBe(0)
  })

  test('trusted metrics receive inherited SVG fonts and keep their advances separate', () => {
    const fonts: string[] = []
    const execution = createTextMeasurementExecution({
      id: 'test:svg-fonts', version: '1.0.0',
      measure(input) {
        fonts.push(input.fontFamily)
        return input.text.length * (input.fontFamily === 'Georgia' ? 30 : input.monospace ? 20 : 10)
      },
    }, 'Inter')
    const projected = withTextMeasurementExecution(execution, () => fitUncalibratedSvgText(
      '<svg><g font-family="Georgia"><text font-size="12">Header</text></g><text font-size="12">Header</text><text class="mono" font-size="12">Header</text></svg>',
      'Inter',
    ))
    expect(fonts).toEqual(['Georgia', 'Inter', 'JetBrains Mono'])
    expect(projected.match(/textLength="\d+"/g)).toEqual(['textLength="180"', 'textLength="60"', 'textLength="120"'])
  })

  test('host backend text remains fitted through the public bound renderer', () => {
    const id = 'backend:test/unfitted-host-text'
    let raw = ''
    const unregister = registerBackend({
      ...DefaultBackend, id, capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc, context) {
        raw = DefaultBackend.render(doc, context).replace(/\s(?:data-prepared-text|textLength|lengthAdjust|data-font-metrics)="[^"]*"/g, '')
        return raw
      },
    }, { compatibility: { core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core, scene: '^2.0.0' } })
    try {
      const renderer = createMermaidRenderer({
        backendPolicy: { selectBackend: () => id },
        textMeasurement: { id: 'test:host-font-fit', version: '1.0.0', measure: input => input.text.length * 10 },
      })
      const svg = renderer.renderMermaidSVG('flowchart LR\nA[Alpha] --> B[Beta]', { style: { font: 'Acme Wide' } })
      const unfitted = raw.match(/<text\b([^>]*)>Alpha<\/text>/)?.[1]
      const fitted = svg.match(/<text\b([^>]*)>Alpha<\/text>/)?.[1]
      expect(unfitted).toBeDefined()
      expect(unfitted).not.toContain('textLength=')
      expect(unfitted).not.toContain('data-prepared-text=')
      expect(fitted).toContain('textLength="50"')
      expect(fitted).toContain('lengthAdjust="spacingAndGlyphs"')
      expect(fitted).toContain('data-font-metrics="deterministic-fit"')
    } finally { unregister() }
  })

  test('resource availability never masquerades as metric calibration', () => {
    const svg = '<svg><text font-size="14">Natural</text></svg>'
    for (const family of BUNDLED_FONT_FAMILIES) {
      const projected = fitUncalibratedSvgText(svg, family)
      expect(projected, family).toContain('data-font-metrics="deterministic-fit"')
      expect(projected, family).toContain('lengthAdjust="spacingAndGlyphs"')
    }
  })

  test('every face paints at the exact deterministic width used by layout', () => {
    const source = 'flowchart LR\n  A[Wide custom label] --> B[Done]'
    for (const font of [...BUNDLED_FONT_FAMILIES, 'Acme Wide']) {
      const options = { style: { font } } as const
      const svg = renderMermaidSVG(source, options)
      const label = svg.match(/<text\b([^>]*)>Wide custom label<\/text>/)
      expect(label, font).not.toBeNull()
      const expected = measureFormattedTextWidth('Wide custom label', 13, 500)
      expect(label![1], font).toContain(`textLength="${Math.round(expected * 1000) / 1000}"`)
      expect(label![1], font).toContain('lengthAdjust="spacingAndGlyphs"')
      expect(label![1], font).toContain('data-font-metrics="deterministic-fit"')
      expect(renderMermaidSVG(source, options)).toBe(svg)
    }
  })

  test('positioned lines and monospace semantic text use their layout measurement authorities', () => {
    const projected = fitUncalibratedSvgText(
      '<svg><text font-size="12" font-weight="600"><tspan x="0">Alpha</tspan><tspan x="0" dy="14">Beta</tspan></text><text class="mono" font-size="11">code()</text></svg>',
      'Acme Wide',
    )
    expect(projected.match(/lengthAdjust="spacingAndGlyphs"/g)).toHaveLength(3)
    expect(projected).toContain(`class="mono" font-size="11" textLength="${measureMonospaceTextWidth('code()', 11)}"`)
  })

  test('mixed plain and formatted content is fitted as one continuous painted advance', () => {
    const fitted = fitUncalibratedSvgText(
      '<svg><text font-size="13" font-weight="500">plain <tspan font-weight="bold">bold</tspan> tail</text></svg>',
      'Acme Wide',
    )
    const expected = Math.round((
      measureFormattedTextWidth('plain ', 13, 500)
      + measureFormattedTextWidth('bold', 13, 700)
      + measureFormattedTextWidth(' tail', 13, 500)
    ) * 1000) / 1000
    expect(fitted).toContain(`<text font-size="13" font-weight="500" textLength="${expected}"`)
    expect(fitted).toContain('plain <tspan font-weight="bold">bold</tspan> tail')
    expect(fitUncalibratedSvgText(fitted, 'Acme Wide')).toBe(fitted)
  })

  test('literal Pie text fits the authored glyphs instead of reparsing markup-like characters', () => {
    const literal = 'T<b>itle</b>'
    const fitted = fitUncalibratedSvgText(
      `<svg><text font-size="18" font-weight="600" data-literal-text="true">T&lt;b&gt;itle&lt;/b&gt;</text></svg>`,
      'Acme Wide',
    )
    const width = Math.round(measureTextWidth(literal, 18, 600) * 1000) / 1000
    expect(fitted).toContain(`textLength="${width}"`)
    expect(width).toBeGreaterThan(measureFormattedTextWidth(literal, 18, 600))
    expect(fitUncalibratedSvgText(fitted, 'Acme Wide')).toBe(fitted)
  })

  test('multiline formatted content fits each positioned line without scaling the parent', () => {
    const fitted = fitUncalibratedSvgText(
      '<svg><text font-size="13"><tspan x="10" y="20">plain <tspan font-weight="bold">bold</tspan></tspan><tspan x="10" dy="16">tail</tspan></text></svg>',
      'Acme Wide',
    )
    expect(fitted.match(/data-font-metrics="deterministic-fit"/g)).toHaveLength(2)
    expect(fitted).toMatch(/<text font-size="13"><tspan x="10" y="20" textLength=/)
    expect(fitted).toMatch(/<tspan x="10" dy="16" textLength=/)
  })

  test('symbolic tspan weights resolve before deterministic width measurement', () => {
    const roundedWidth = (text: string, weight: number) =>
      Math.round(measureFormattedTextWidth(text, 13, weight) * 1000) / 1000
    const fitted = fitUncalibratedSvgText(
      '<svg><text font-size="13" font-weight="500"><tspan x="0" font-weight="bold">world</tspan><tspan x="0" font-weight="bolder">heavy</tspan><tspan x="0" font-weight="lighter">light</tspan><tspan x="0" font-weight="625">numeric</tspan></text><text font-size="13" font-weight="700"><tspan x="0" font-weight="normal">plain</tspan><tspan x="0" font-weight="bolder">heavier</tspan><tspan x="0" font-weight="lighter">lighter</tspan></text></svg>',
      'Acme Wide',
    )
    expect(fitted).toContain(`<tspan x="0" font-weight="bold" textLength="${roundedWidth('world', 700)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="bolder" textLength="${roundedWidth('heavy', 700)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="lighter" textLength="${roundedWidth('light', 100)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="625" textLength="${roundedWidth('numeric', 625)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="normal" textLength="${roundedWidth('plain', 400)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="bolder" textLength="${roundedWidth('heavier', 900)}"`)
    expect(fitted).toContain(`<tspan x="0" font-weight="lighter" textLength="${roundedWidth('lighter', 400)}"`)
  })

  test('role-local font families are fitted through the same projection as the global face', () => {
    const svg = renderMermaidSVG('flowchart LR\n  subgraph G[Group]\n    A[Alpha]\n  end', {
      style: { roles: { group: { fontFamily: 'Acme Wide' } } },
    })
    expect(svg).toMatch(/<text[^>]*font-family="Acme Wide"[^>]*data-font-metrics="deterministic-fit"[^>]*>Group<\/text>/)
    expect(svg).toMatch(/<text[^>]*data-font-metrics="deterministic-fit"[^>]*>Alpha<\/text>/)
  })

  test('quoted stacks and inline style attributes resolve deterministic metrics', () => {
    const svg = '<svg><text style="font-family: Acme Wide; font-size: 20; font-weight: 700; letter-spacing: 2">Wide</text></svg>'
    const fitted = fitUncalibratedSvgText(svg, '"Fallback Face", sans-serif')
    expect(fitted).toContain(`textLength="${measureFormattedTextWidth('Wide', 20, 700, 2)}"`)
    expect(fitted).toContain('lengthAdjust="spacingAndGlyphs"')
  })

  test('existing explicit geometry remains emitter-owned while nested text inherits deterministic fitting', () => {
    const existing = '<svg><text font-size="14" textLength="99">Owned</text></svg>'
    expect(fitUncalibratedSvgText(existing, 'Acme Wide')).toBe(existing)
    const missingSize = '<svg><text>Unknown size</text></svg>'
    expect(fitUncalibratedSvgText(missingSize, 'Acme Wide')).toBe(missingSize)
    const empty = '<svg><text font-size="14"></text></svg>'
    expect(fitUncalibratedSvgText(empty, 'Acme Wide')).toBe(empty)
    const nested = '<svg><text font-size="14"><a href="#local">Linked</a></text></svg>'
    // Measured on the visible text "Linked", not on the <a> markup around it.
    const linked = Math.round(measureFormattedTextWidth('Linked', 14, 400) * 1000) / 1000
    expect(fitUncalibratedSvgText(nested, 'Acme Wide')).toContain(`<text font-size="14" textLength="${linked}"`)
  })

  test('repeated wide glyphs remain inside estimator-sized node geometry for every bundled face', () => {
    const text = 'Wm'.repeat(22)
    const source = `flowchart LR\n  A[${text}]`
    for (const font of BUNDLED_FONT_FAMILIES) {
      const options = { style: { font }, embedFontImport: false } as const
      const svg = renderMermaidSVG(source, options)
      const rect = [...svg.matchAll(/<rect[^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*>/g)][0]
      expect(rect, font).toBeDefined()
      const [x, y, width, height] = rect!.slice(1, 5).map(Number)
      const scale = 2
      const image = decodePng(renderMermaidPNG(source, { ...options, scale, onWarning: () => {} }))
      const leftOverflow = inkColumns(image, 0, (x! - 2) * scale, (y! + 4) * scale, (y! + height! - 4) * scale)
      const rightOverflow = inkColumns(image, (x! + width! + 2) * scale, image.width, (y! + 4) * scale, (y! + height! - 4) * scale)
      expect({ font, leftOverflow, rightOverflow }).toEqual({ font, leftOverflow: [], rightOverflow: [] })
    }
  })
})
