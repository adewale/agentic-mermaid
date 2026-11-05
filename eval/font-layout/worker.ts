import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import type { RenderOptions } from '../../src/types.ts'
import type { TextMeasurementProfile } from '../../src/text-measurement-profile.ts'

const input = JSON.parse(readFileSync(0, 'utf8')) as {
  root: string; mode: 'latency' | 'memory' | 'quality'; out: string; features: string[];
  backend: 'elk' | 'agentic'; repetitions: number; item: { id: string; source: string; family: string };
}
const root = resolve(input.root)
const load = (path: string) => import(pathToFileURL(join(root, path)).href)
const beforeImport = process.memoryUsage()
const startImport = performance.now()
const api = await load('src/index.ts')
let profile: TextMeasurementProfile | undefined
if (input.features.includes('fonts')) profile = (await load('src/inter-metrics.ts')).BUNDLED_INTER_TEXT_MEASUREMENT
const renderer = api.createMermaidRenderer()
const importMs = performance.now() - startImport
const graphFamily = ['flowchart', 'state', 'class', 'er', 'requirement', 'architecture'].includes(input.item.family)
const options: RenderOptions = {
  security: 'strict', embedFontImport: false,
  ...(input.features.includes('fonts') ? { fontMetrics: 'bundled-inter' } : {}),
  ...(graphFamily ? { graphLayout: { backend: input.backend, fallback: input.backend === 'agentic' ? 'elk' : 'none',
    ...(input.features.includes('elk-order') && input.backend === 'elk' || input.features.includes('ports') && input.backend === 'agentic' ? { quality: 'balanced' } : {}),
    ...(input.features.includes('wrap') && input.item.family === 'flowchart' ? { viewport: { width: 800, height: 600 } } : {}),
  } } : {}),
}
let held: { svg: string; receipt: unknown } | undefined
let sink = 0
const render = () => {
  held = renderer.renderMermaidSVGWithReceipt(input.item.source, options)
  const consumed = JSON.stringify(held)
  sink ^= consumed.length
  return consumed.length
}
const firstStart = performance.now()
let failure: string | undefined
try { render() } catch (error) { failure = String(error) }
const firstMs = performance.now() - firstStart
const base = { id: input.item.id, family: input.item.family, backend: input.backend, features: input.features, importMs, firstMs, beforeImport, failure }
if (input.mode === 'latency') {
  const samples: number[] = []
  if (!failure) {
    for (let n = 0; n < 3; n++) render()
    for (let n = 0; n < input.repetitions; n++) {
      const start = performance.now(); render(); samples.push(performance.now() - start)
    }
  }
  console.log(JSON.stringify({ ...base, samples, consumedBytes: held ? Buffer.byteLength(JSON.stringify(held)) : null, sink }))
} else if (input.mode === 'memory') {
  const outputHeld = process.memoryUsage()
  Bun.gc(true)
  const heldAfterGc = process.memoryUsage()
  held = undefined
  Bun.gc(true)
  console.log(JSON.stringify({ ...base, outputHeld, heldAfterGc, releasedAfterGc: process.memoryUsage(), resourceUsage: process.resourceUsage(), sink }))
} else if (failure || !held) {
  console.log(JSON.stringify(base))
} else {
  // Quality/raster diagnostics are deliberately outside latency/resource runs.
  const { executeGraphicalRequest } = await load('src/graphical-render.ts')
  const { withRenderStageObserver } = await load('src/render-stages.ts')
  const { assessLayout, hardViolations } = await load('src/layout-rubric.ts')
  const { parseMermaid } = await load('src/parser.ts')
  const { resolveRenderStyle } = await load('src/styles.ts')
  const measurement = await load('src/text-measurement-profile.ts')
  let graphQuality: unknown = null, layout: any
  const stages: unknown[] = []
  const result = withRenderStageObserver((sample: unknown) => stages.push(sample), () => executeGraphicalRequest(input.item.source, options, 'svg', undefined, { onConfigDiagnostic: () => {} }, {
    validate() {}, consume(_request: unknown, positioned: any) {
      layout = positioned.positioned
      if (input.item.family === 'flowchart') {
        graphQuality = measurement.withTextMeasurementExecution(measurement.createTextMeasurementExecution(profile, 'Inter'), () => {
          const assessed = assessLayout(parseMermaid(input.item.source), layout, undefined, undefined, resolveRenderStyle(options))
          return { metrics: assessed.metrics, hardViolations: hardViolations(assessed), certification: layout.certification }
        })
      }
    },
  }))
  const svg = result.svg
  const viewBox = svg.match(/viewBox="([^\"]+)"/)?.[1]?.split(/\s+/).map(Number)
  const width = viewBox?.[2] ?? null, height = viewBox?.[3] ?? null
  const viewportScale = width && height ? Math.min(1, 800 / width, 600 / height) : null
  const safe = input.item.id.replace(/[^A-Za-z0-9_-]/g, '_')
  mkdirSync(input.out, { recursive: true })
  writeFileSync(join(input.out, `${safe}.svg`), svg)
  let raster: unknown = null
  try {
    const censusApi = await load('src/__tests__/helpers/rendered-text.ts')
    await censusApi.renderedTextReady()
    const census = censusApi.measureRenderedText(svg)
    const wasm = await load('node_modules/@resvg/resvg-wasm/index.mjs')
    const fontBuffers = readdirSync(join(root, 'assets/fonts')).filter(name => name.endsWith('.ttf')).map(name => readFileSync(join(root, 'assets/fonts', name)))
    const image = new wasm.Resvg(svg, { font: { fontBuffers, defaultFontFamily: 'Inter', loadSystemFonts: false } })
    const rendered = image.render(), png = rendered.asPng()
    writeFileSync(join(input.out, `${safe}.png`), png)
    raster = { width: rendered.width, height: rendered.height, rgbaBytes: rendered.width * rendered.height * 4, pngBytes: png.length,
      texts: census.texts.map((text: any) => ({ content: text.content, fontSize: text.fontSize, pixels: text.pixels, offCanvasPixels: text.offCanvasPixels, box: text.box })),
      offCanvasPixels: census.texts.reduce((sum: number, text: any) => sum + text.offCanvasPixels, 0),
    }
    rendered.free(); image.free()
  } catch (error) { raster = { failure: String(error) } }
  console.log(JSON.stringify({ ...base, width, height, viewportScale, graphQuality, stages, raster,
    svgBytes: Buffer.byteLength(svg), svgGzipBytes: gzipSync(svg).length, svgBrotliBytes: brotliCompressSync(svg).length,
    receiptBytes: Buffer.byteLength(JSON.stringify(result.receipt)), receipt: result.receipt,
    lineCount: (svg.match(/<tspan\b[^>]*\sdy=/g) ?? []).length,
  }))
}
