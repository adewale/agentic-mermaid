// Hosted render_png: resvg-wasm (pinned to the same version as the local napi
// build) with the repo's bundled DejaVu fonts plus the built-in style faces,
// mirroring src/agent/png.ts
// option-for-option. The wasm rasterizer is not guaranteed byte-identical to
// the napi build, so hosted PNG is a convenience surface, not part of the
// byte-determinism contract (see docs/quality.md "PNG determinism").
//
// Worker-only module: the .wasm/.ttf imports resolve via wrangler bundling
// rules. build.ts copies the artifacts into ./generated/.

import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasmModule from './generated/resvg.wasm'
import fontRegular from './generated/DejaVuSans.ttf'
import fontBold from './generated/DejaVuSans-Bold.ttf'
import fontCaveat from './generated/Caveat.ttf'
import fontEbGaramond from './generated/EBGaramond.ttf'
import fontArchitectsDaughter from './generated/ArchitectsDaughter.ttf'
import fontShareTechMono from './generated/ShareTechMono.ttf'
import { renderMermaidSVG } from '../../src/index.ts'
import { inlineFontVarForRaster } from '../../src/theme.ts'
import { assertRasterBudget } from './raster-budget.ts'

let ready: Promise<void> | undefined

export async function renderMermaidPNGWasm(source: string, opts: { scale?: number; background?: string; style?: unknown; seed?: number } = {}): Promise<Uint8Array> {
  // initWasm throws if called twice; keep a single init promise per isolate.
  ready ??= Promise.resolve(initWasm(resvgWasmModule))
  await ready
  const svg = inlineFontVarForRaster(
    renderMermaidSVG(source, { embedFontImport: false, style: opts.style as never, seed: opts.seed }),
  )
  assertRasterBudget(svg, opts.scale ?? 2)
  const resvg = new Resvg(svg, {
    background: opts.background ?? 'white',
    fitTo: { mode: 'zoom', value: opts.scale ?? 2 },
    font: {
      loadSystemFonts: false,
      fontBuffers: [
        new Uint8Array(fontRegular),
        new Uint8Array(fontBold),
        new Uint8Array(fontCaveat),
        new Uint8Array(fontEbGaramond),
        new Uint8Array(fontArchitectsDaughter),
        new Uint8Array(fontShareTechMono),
      ],
      defaultFontFamily: 'DejaVu Sans',
    },
  })
  return resvg.render().asPng()
}
