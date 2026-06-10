// ============================================================================
// renderMermaidPNG — rasterize a Mermaid diagram to a PNG byte array.
//
// Uses @resvg/resvg-js (napi-rs build, pinned 2.6.2) for deterministic
// rasterization. Critical choices from the Loop 8 5-critic plan-hardening:
//
// - napi-rs build (NOT WASM) — same prebuilt .node binary under Bun and
//   Node via N-API compat, eliminates WASM-init differences.
// - loadSystemFonts: false + bundled DejaVu Sans fonts in assets/fonts/ —
//   without this, fontconfig differences between OSes and CI images would
//   collapse cross-runtime parity.
// - SVG input rendered with embedFontImport: false so resvg doesn't fetch
//   from Google Fonts at rasterization time (offline / CSP / sandbox safe).
// - PNG bytes returned as Uint8Array (runtime-neutral, Code Mode friendly).
//
// What's tested: in-process determinism (5x same-input SHA-256 stable),
// cross-runtime determinism (bun ≡ node on same-machine x86_64/ARM64 when
// Node + built dist are present), basic PNG validity.
// What's NOT tested: direct x86_64-vs-ARM64 byte equality, resvg version drift
// across npm install runs. See docs/quality.md "PNG determinism".
// ============================================================================

import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import type { ValidDiagram } from './types.ts'
import { serializeMermaid } from './serialize.ts'
import { renderMermaidSVG } from '../index.ts'

export interface PngOptions {
  /** Output scale multiplier (default 2 — retina). */
  scale?: number
  /** Background color, any CSS color string (default 'white'). */
  background?: string
  /** Constrain output dimensions; otherwise honors scale on the SVG bounds. */
  fitTo?: { width?: number; height?: number }
}

/**
 * Resolve the bundled-fonts directory. Walks up from this module path until
 * it finds `assets/fonts/`. Caches the result so it's only resolved once.
 */
let cachedFontDir: string | null = null
function resolveFontDir(): string | null {
  if (cachedFontDir !== null) return cachedFontDir
  // import.meta.url works under Bun + Node ESM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const here = typeof (import.meta as any).url === 'string' ? fileURLToPath((import.meta as any).url) : __filename
  let dir = dirname(here)
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'assets', 'fonts')
    if (existsSync(candidate)) { cachedFontDir = candidate; return candidate }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Don't crash if not found — resvg will fall back to its default fonts.
  // Cross-runtime determinism may weaken in that case; documented gap.
  cachedFontDir = ''
  return null
}

/**
 * Render a Mermaid diagram (source string or ValidDiagram) to a PNG byte array.
 * Deterministic within one runtime; cross-runtime parity is guarded for
 * same-machine Bun ≡ Node on x86_64/ARM64 when Node + built dist are present.
 *
 * Synchronous: resvg's `.render()` is native-sync, and static import keeps
 * the CLI/MCP integration straightforward. Library consumers can wrap in
 * `Promise.resolve()` if they want async semantics.
 */
export function renderMermaidPNG(input: ValidDiagram | string, opts: PngOptions = {}): Uint8Array {
  // SVG input: embedFontImport=false so resvg doesn't try to fetch from
  // Google Fonts during rasterization. CSS-variable fonts (Loop 8 M2) means
  // the SVG still declares its font-family preference via --font.
  const source = typeof input === 'string' ? input : serializeMermaid(input)
  const svg = renderMermaidSVG(source, { embedFontImport: false })

  const scale = opts.scale ?? 2
  const fontDir = resolveFontDir()

  const resvgOpts: ConstructorParameters<typeof Resvg>[1] = {
    background: opts.background ?? 'white',
    fitTo: opts.fitTo?.width
      ? { mode: 'width' as const, value: opts.fitTo.width }
      : opts.fitTo?.height
        ? { mode: 'height' as const, value: opts.fitTo.height }
        : { mode: 'zoom' as const, value: scale },
    font: {
      loadSystemFonts: false,
      // Bundled fonts (DejaVu Sans + Bold) for cross-runtime determinism.
      // Falls back to resvg's built-in fonts if directory not found.
      fontDirs: fontDir ? [fontDir] : [],
      defaultFontFamily: 'DejaVu Sans',
    },
  }

  const resvg = new Resvg(svg, resvgOpts)
  const png = resvg.render().asPng()
  // resvg returns Buffer in Node; ensure we surface Uint8Array consistently.
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength)
}
