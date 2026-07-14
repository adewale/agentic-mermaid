import { inspectPngColorProfile, inspectPngDimensions, OUTPUT_COLOR_PROFILE } from '../src/output-color-profile.ts'
import { PNG_WASM_RUNTIME } from '../src/png-contract.ts'
import { renderPortablePngGraphicalProjection } from '../src/png-graphical.ts'

const SOURCE = 'flowchart LR\n  A[Start 漢] --> B[Finish]'
const RENDER_OPTIONS = Object.freeze({
  style: ['watercolor', 'paper'],
  seed: 13,
  padding: 19,
  security: 'strict' as const,
})
const OUTPUT_OPTIONS = Object.freeze({
  scale: 0.75,
  background: '#123456',
  fitTo: { width: 96 },
})

interface ToolEnvelope {
  result?: { isError?: boolean; content?: Array<{ text?: string }> }
}

const response = JSON.parse(await Bun.stdin.text()) as ToolEnvelope
if (response.result?.isError) throw new Error('hosted render_png returned an MCP tool error')
const text = response.result?.content?.[0]?.text
if (typeof text !== 'string') throw new Error('hosted render_png returned no textual payload')
const payload = JSON.parse(text) as {
  ok?: boolean
  png_base64?: string
  receipt?: unknown
  runtime?: unknown
  warnings?: Array<{ code?: string; script?: string }>
}
if (!payload.ok || typeof payload.png_base64 !== 'string') throw new Error('hosted render_png returned no PNG artifact')

const png = Uint8Array.from(Buffer.from(payload.png_base64, 'base64'))
const expected = renderPortablePngGraphicalProjection(SOURCE, RENDER_OPTIONS, OUTPUT_OPTIONS)
const dimensions = inspectPngDimensions(png)
if (dimensions.width !== expected.rasterDimensions.width || dimensions.height !== expected.rasterDimensions.height) {
  throw new Error(`hosted WASM dimensions ${dimensions.width}x${dimensions.height} do not match ${expected.rasterDimensions.width}x${expected.rasterDimensions.height}`)
}
if (JSON.stringify(payload.receipt) !== JSON.stringify(expected.receipt)) {
  throw new Error('hosted WASM receipt does not match the portable graphical projection')
}
if (JSON.stringify(payload.runtime) !== JSON.stringify(PNG_WASM_RUNTIME)) {
  throw new Error('hosted render_png did not report the pinned WASM runtime provenance')
}

const profile = inspectPngColorProfile(png)
if (profile.profile !== 'srgb'
  || profile.hasICC
  || profile.sRGBRenderingIntent !== OUTPUT_COLOR_PROFILE.png.sRGBRenderingIntent
  || JSON.stringify(profile.cICP) !== JSON.stringify(OUTPUT_COLOR_PROFILE.png.cICP)) {
  throw new Error(`hosted WASM PNG has the wrong color profile: ${JSON.stringify(profile)}`)
}
if (!payload.warnings?.some(warning => warning.code === 'PNG_FONT_COVERAGE')) {
  throw new Error('hosted WASM PNG did not report missing bundled-font coverage for the Han probe')
}

console.log(`ok   render_png enforces portable WASM parity (${dimensions.width}x${dimensions.height}, sRGB, receipt, runtime, font warning)`)
