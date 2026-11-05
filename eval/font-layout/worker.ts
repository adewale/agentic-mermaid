import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import type { RenderOptions } from '../../src/types.ts'
import type { TextMeasurementProfile } from '../../src/text-measurement-profile.ts'
import { assertLocalMeasurement } from '../trident/prepare.ts'

export interface ObservationInput {
  root: string; mode: 'latency' | 'startup' | 'memory' | 'quality'; out: string; features: string[];
  backend: 'elk' | 'agentic'; repetitions: number; item: { id: string; source: string; family: string };
}
export async function observe(input: ObservationInput) {
assertLocalMeasurement()
const root = resolve(input.root)
const load = (path: string) => import(pathToFileURL(join(root, path)).href)
const beforeImport = process.memoryUsage()
const startImport = performance.now()
const api = await load(input.mode === 'quality' ? 'src/index.ts' : 'dist/index.js')
let profile: TextMeasurementProfile | undefined
if (input.mode === 'quality' && input.features.includes('fonts')) profile = (await load('src/inter-metrics.ts')).BUNDLED_INTER_TEXT_MEASUREMENT
const renderer = api.createMermaidRenderer()
const importMs = performance.now() - startImport
const afterImport = process.memoryUsage()
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
const base = { id: input.item.id, family: input.item.family, backend: input.backend, features: input.features, importMs, firstMs, beforeImport, afterImport, failure }
if (input.mode === 'latency' || input.mode === 'startup') {
  const samples: number[] = []
  if (!failure && input.mode === 'latency') {
    for (let n = 0; n < 3; n++) render()
    for (let n = 0; n < input.repetitions; n++) {
      const start = performance.now(); render(); samples.push(performance.now() - start)
    }
  }
  return { ...base, samples, consumedBytes: held ? Buffer.byteLength(JSON.stringify(held)) : null, sink }
} else if (input.mode === 'memory') {
  const outputHeld = process.memoryUsage()
  Bun.gc(true)
  const heldAfterGc = process.memoryUsage()
  held = undefined
  Bun.gc(true)
  return { ...base, outputHeld, heldAfterGc, releasedAfterGc: process.memoryUsage(), resourceUsage: process.resourceUsage(), sink }
} else if (failure || !held) {
  return base
} else {
  // Quality/raster diagnostics are deliberately outside latency/resource runs.
  const { executeGraphicalRequest } = await load('src/graphical-render.ts')
  const { withRenderStageObserver } = await load('src/render-stages.ts')
  const { assessLayout, hardViolations } = await load('src/layout-rubric.ts')
  const { parseMermaid } = await load('src/parser.ts')
  const { resolveRenderStyle } = await load('src/styles.ts')
  const measurement = await load('src/text-measurement-profile.ts')
  let graphQuality: unknown = null, layout: any, resolvedRequest: any, familyResult: any
  const stages: unknown[] = []
  const result = withRenderStageObserver((sample: unknown) => stages.push(sample), () => executeGraphicalRequest(input.item.source, options, 'svg', undefined, { onConfigDiagnostic: () => {} }, {
    validate() {}, consume(request: unknown, positioned: any) {
      resolvedRequest = request; familyResult = positioned
      layout = positioned.positioned
      if (input.item.family === 'flowchart') {
        graphQuality = measurement.withTextMeasurementExecution(measurement.createTextMeasurementExecution(profile, 'Inter'), () => {
          const assessed = assessLayout(parseMermaid(input.item.source), layout, resolveRenderStyle(options))
          return { metrics: assessed.metrics, hardViolations: hardViolations(assessed), certification: layout.certification }
        })
      }
    },
  }))
  const svg = result.svg
  let familyQuality: unknown = null
  try {
    const { projectResolvedFamilyLayout } = await load('src/agent/family-layouts.ts')
    const { assessRenderedLayout, familyHardViolations } = await load('src/family-rubric.ts')
    const projected = projectResolvedFamilyLayout(resolvedRequest, familyResult)
    if (projected) {
      const assessed = assessRenderedLayout(projected)
      familyQuality = { metrics: assessed.metrics, hardViolations: familyHardViolations(assessed) }
    }
  } catch (error) { familyQuality = { unavailable: String(error) } }
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
    const { decodeXML } = await import('entities')
    // The generated SVG carries authored node identity. Follow its element
    // nesting, never guess an owner by matching potentially duplicate labels.
    const owners: Array<string | undefined> = [], stack: Array<string | undefined> = []
    for (const tag of svg.matchAll(/<\/?([A-Za-z][\w:-]*)\b[^>]*>/g)) {
      const raw = tag[0]
      if (raw.startsWith('</')) { stack.pop(); continue }
      let owner = stack.at(-1)
      if (tag[1] === 'g' && /\bclass="[^\"]*\bnode\b/.test(raw)) owner = decodeXML(raw.match(/\bdata-id="([^\"]*)"/)?.[1] ?? '') || owner
      if (tag[1] === 'text') owners.push(owner)
      if (!raw.endsWith('/>')) stack.push(owner)
    }
    const nodes = Array.isArray(layout.nodes) ? new Map(layout.nodes.map((node: any) => [node.id, node])) : new Map()
    const containment = census.texts.flatMap((text: any, index: number) => {
      const owner = owners[index], node: any = nodes.get(owner), box = text.box
      if (!owner || !node || !box) return []
      const overflow = Math.max(0, node.x - box.x, node.y - box.y, box.x + box.width - node.x - node.width, box.y + box.height - node.y - node.height)
      return [{ owner, textIndex: index, overflowPx: overflow, outsideBox: overflow > 0.75 }]
    })
    const wasm = await load('node_modules/@resvg/resvg-wasm/index.mjs')
    const fontBuffers = readdirSync(join(root, 'assets/fonts')).filter(name => name.endsWith('.ttf')).map(name => readFileSync(join(root, 'assets/fonts', name)))
    const image = new wasm.Resvg(svg, { font: { fontBuffers, defaultFontFamily: 'Inter', loadSystemFonts: false } })
    const rendered = image.render(), png = rendered.asPng()
    writeFileSync(join(input.out, `${safe}.png`), png)
    raster = { width: rendered.width, height: rendered.height, rgbaBytes: rendered.width * rendered.height * 4, pngBytes: png.length,
      texts: census.texts.map((text: any) => ({ content: text.content, fontSize: text.fontSize, pixels: text.pixels, offCanvasPixels: text.offCanvasPixels, box: text.box })),
      offCanvasPixels: census.texts.reduce((sum: number, text: any) => sum + text.offCanvasPixels, 0),
      nodeTextContainment: { measured: containment.length, outsideBoxes: containment.filter((row: any) => row.outsideBox).length, rows: containment, limitation: 'Actual glyph ink bounds versus owning node bounding box; does not prove containment in curved outlines.' },
      minimumFittedFontPx: viewportScale === null ? null : Math.min(...census.texts.map((text: any) => text.fontSize)) * viewportScale,
    }
    rendered.free(); image.free()
  } catch (error) { raster = { failure: String(error) } }
  return { ...base, width, height, viewportScale, graphQuality, familyQuality, stages, raster,
    svgBytes: Buffer.byteLength(svg), svgGzipBytes: gzipSync(svg).length, svgBrotliBytes: brotliCompressSync(svg).length,
    receiptBytes: Buffer.byteLength(JSON.stringify(result.receipt)), receipt: result.receipt,
    lineCount: (svg.match(/<tspan\b[^>]*\sdy=/g) ?? []).length,
  }
}
}
if (import.meta.main) console.log(JSON.stringify(await observe(JSON.parse(readFileSync(0, 'utf8')))))
