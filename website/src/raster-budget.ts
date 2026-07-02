// Pixel budget for hosted render_png. Rasterization memory is ~4 bytes per
// output pixel, and output pixels = SVG bounds × scale², so a modest source
// with a large scale (or a huge diagram at the default scale) can demand far
// more memory than the 64KB source cap suggests. Kept renderer-agnostic and
// import-clean so it unit-tests in bun (png-wasm.ts itself needs workerd's
// wasm/data module rules).

/** ~16.7 megapixels ≈ 4096×4096 ≈ 64MB of RGBA — well inside Worker memory. */
export const MAX_PNG_PIXELS = 16_777_216

/**
 * Throws when rendering `svg` at `scale` would exceed the pixel budget.
 * The SVG comes from renderMermaidSVG, whose root carries the layout bounds
 * in viewBox="0 0 w h"; an unparseable root is rejected rather than trusted.
 */
export function assertRasterBudget(svg: string, scale: number): void {
  const viewBox = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/)
  const w = Number(viewBox?.[1])
  const h = Number(viewBox?.[2])
  if (!viewBox || !Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error('could not determine SVG bounds for rasterization')
  }
  const pixels = w * scale * h * scale
  if (pixels > MAX_PNG_PIXELS) {
    throw new Error(`output would be ${Math.round(pixels / 1_000_000)}MP; the hosted cap is ${Math.round(MAX_PNG_PIXELS / 1_000_000)}MP — reduce scale or diagram size, or render locally`)
  }
}
