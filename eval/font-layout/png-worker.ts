import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertLocalMeasurement } from '../trident/prepare.ts'

assertLocalMeasurement()
const input = JSON.parse(readFileSync(0, 'utf8')) as { root: string; features: string[]; backend: 'elk' | 'agentic'; mode: string; item: { id: string; source: string } }
const beforeImport = process.memoryUsage(), start = performance.now()
const api = await import(pathToFileURL(join(input.root, 'dist/agent.js')).href)
const renderer = api.createMermaidPNGRenderer()
const importMs = performance.now() - start, afterImport = process.memoryUsage()
const options = { embedFontImport: false, security: 'strict', ...(input.features.includes('fonts') ? { fontMetrics: 'bundled-inter' } : {}), graphLayout: {
  backend: input.backend, fallback: input.backend === 'elk' ? 'none' : 'elk',
  ...(input.features.includes('elk-order') && input.backend === 'elk' || input.features.includes('ports') && input.backend === 'agentic' ? { quality: 'balanced' } : {}),
  ...(input.features.includes('wrap') ? { viewport: { width: 800, height: 600 } } : {}),
} }
let held: { png: Uint8Array; receipt: unknown } | undefined, sink = 0
const render = () => {
  held = renderer.renderMermaidPNGWithReceipt(input.item.source, options)
  for (const byte of held!.png) sink = (sink + byte) >>> 0
  sink ^= JSON.stringify(held!.receipt).length
}
let failure: string | undefined
const firstStart = performance.now()
try { render() } catch (error) { failure = String(error) }
const firstMs = performance.now() - firstStart, outputHeld = process.memoryUsage()
const samples: number[] = []
if (!failure && input.mode === 'png-latency') {
  render()
  for (let i = 0; i < 3; i++) { const begin = performance.now(); render(); samples.push(performance.now() - begin) }
}
const image = held ? Buffer.from(held.png) : undefined
const dimensions = image ? { width: image.readUInt32BE(16), height: image.readUInt32BE(20), pngBytes: image.length } : null
if (input.mode === 'png-memory') Bun.gc(true)
const heldAfterGc = process.memoryUsage()
held = undefined
if (input.mode === 'png-memory') Bun.gc(true)
console.log(JSON.stringify({ id: input.item.id, backend: input.backend, features: input.features, failure, importMs, firstMs, samples, beforeImport, afterImport, outputHeld, heldAfterGc,
  releasedAfterGc: process.memoryUsage(), resourceUsage: process.resourceUsage(), dimensions, sink,
  limitation: 'Public native PNG API; lifetime RSS includes native rasterizer and font resources. Buffer used for dimension inspection remains held until exit.',
}))
