// Hosted render_png: resvg-wasm (pinned to the same version as the local napi
// build) with the repo's bundled Inter (the text-metrics model) + DejaVu
// fallback fonts plus the built-in style faces, mirroring src/agent/png.ts
// option-for-option. The wasm rasterizer is not guaranteed byte-identical to
// the napi build, so hosted PNG is a convenience surface, not part of the
// byte-determinism contract (see docs/quality.md "PNG determinism").
//
// Worker-only module: the .wasm/.ttf imports resolve via wrangler bundling
// rules. build.ts copies the artifacts into ./generated/.

import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasmModule from './generated/resvg.wasm'
import fontInterRegular from './generated/Inter-Regular.ttf'
import fontInterMedium from './generated/Inter-Medium.ttf'
import fontInterSemiBold from './generated/Inter-SemiBold.ttf'
import fontInterBold from './generated/Inter-Bold.ttf'
import fontRegular from './generated/DejaVuSans.ttf'
import fontBold from './generated/DejaVuSans-Bold.ttf'
import fontCaveat from './generated/Caveat.ttf'
import fontEbGaramond from './generated/EBGaramond.ttf'
import fontArchitectsDaughter from './generated/ArchitectsDaughter.ttf'
import fontShareTechMono from './generated/ShareTechMono.ttf'
import { inlineFontVarForRaster } from '../../src/theme.ts'
import { findUncoveredScriptsFromBuffers } from '../../src/agent/font-coverage-core.ts'
import { buildPngFontWarnings, type PngRasterResult } from '../../src/shared/png-font-warnings.ts'
import type { RenderOptions } from '../../src/types.ts'
import { applyPngColorProfile, inspectPngDimensions } from '../../src/output-color-profile.ts'
import {
  MAX_HOSTED_PNG_BYTES,
  assertHostedPngRasterBudget,
  omitPngOutputOptions,
  PNG_WASM_RUNTIME,
  prepareSvgForPngRasterization,
  projectPortablePngOutputOptions,
  type PortablePngOutputOptions,
} from '../../src/png-contract.ts'
import { renderPortablePngGraphicalProjection } from '../../src/png-graphical.ts'
import { hostedFontResource } from '../../src/font-manifest.ts'
import { verifyResourceBytes } from '../../src/resource-manifest.ts'

let ready: Promise<void> | undefined

const FONT_INPUTS = Object.freeze([
  { entry: hostedFontResource('Inter-Regular.ttf'), bytes: new Uint8Array(fontInterRegular) },
  { entry: hostedFontResource('Inter-Medium.ttf'), bytes: new Uint8Array(fontInterMedium) },
  { entry: hostedFontResource('Inter-SemiBold.ttf'), bytes: new Uint8Array(fontInterSemiBold) },
  { entry: hostedFontResource('Inter-Bold.ttf'), bytes: new Uint8Array(fontInterBold) },
  { entry: hostedFontResource('DejaVuSans.ttf'), bytes: new Uint8Array(fontRegular) },
  { entry: hostedFontResource('DejaVuSans-Bold.ttf'), bytes: new Uint8Array(fontBold) },
  { entry: hostedFontResource('Caveat.ttf'), bytes: new Uint8Array(fontCaveat) },
  { entry: hostedFontResource('EBGaramond.ttf'), bytes: new Uint8Array(fontEbGaramond) },
  { entry: hostedFontResource('ArchitectsDaughter.ttf'), bytes: new Uint8Array(fontArchitectsDaughter) },
  { entry: hostedFontResource('ShareTechMono.ttf'), bytes: new Uint8Array(fontShareTechMono) },
])

async function initializeRasterResources(): Promise<void> {
  await Promise.all(FONT_INPUTS.map(({ entry, bytes }) => verifyResourceBytes(entry, bytes)))
  await initWasm(resvgWasmModule)
}

export async function renderMermaidPNGWasm(source: string, opts: RenderOptions & PortablePngOutputOptions = {}): Promise<PngRasterResult> {
  // Integrity checks and initWasm each run once per isolate.
  ready ??= initializeRasterResources()
  await ready
  const outputOptions = projectPortablePngOutputOptions(opts as Readonly<Record<string, unknown>>)
  const renderOptions = omitPngOutputOptions(opts as Readonly<Record<string, unknown>>) as RenderOptions
  const graphical = renderPortablePngGraphicalProjection(source, renderOptions, outputOptions)
  assertHostedPngRasterBudget(graphical.rasterDimensions)
  const outputPolicy = graphical.outputPolicy
  const svg = prepareSvgForPngRasterization(
    inlineFontVarForRaster(graphical.svg),
    graphical.rasterDimensions,
  )
  const fontBuffers = FONT_INPUTS.map(({ bytes }) => bytes)
  const warnings = buildPngFontWarnings(findUncoveredScriptsFromBuffers(svg, fontBuffers))
  const resvg = new Resvg(svg, {
    background: graphical.rasterBackground,
    fitTo: { mode: 'zoom', value: 1 },
    font: {
      loadSystemFonts: outputPolicy.fonts.loadSystemFonts,
      fontBuffers,
      defaultFontFamily: outputPolicy.fonts.defaultFamily,
    },
  })
  const png = applyPngColorProfile(resvg.render().asPng())
  if (png.byteLength > MAX_HOSTED_PNG_BYTES) {
    throw new RangeError(`hosted PNG output exceeds the ${MAX_HOSTED_PNG_BYTES}-byte response cap`)
  }
  const actualDimensions = inspectPngDimensions(png)
  if (actualDimensions.width !== graphical.rasterDimensions.width
    || actualDimensions.height !== graphical.rasterDimensions.height) {
    throw new Error(
      `hosted PNG rasterizer returned ${actualDimensions.width}×${actualDimensions.height}; `
      + `expected ${graphical.rasterDimensions.width}×${graphical.rasterDimensions.height}`,
    )
  }
  return {
    png,
    warnings,
    receipt: graphical.receipt,
    runtime: PNG_WASM_RUNTIME,
  }
}
