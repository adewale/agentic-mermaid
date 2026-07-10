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
import type { StyleInput } from '../scene/style-registry.ts'
import { serializeMermaid } from './serialize.ts'
import { renderMermaidSVG } from '../index.ts'
import { inlineFontVarForRaster } from '../theme.ts'
import { findUncoveredScripts } from './font-coverage.ts'

/**
 * Loud-tofu guard: emitted when rendered text contains characters no loaded
 * font covers (they would silently rasterize as empty boxes). Delivered to
 * `PngOptions.onWarning` when provided, otherwise written to stderr — never
 * silent either way.
 */
export interface PngFontWarning {
  code: 'PNG_FONT_COVERAGE'
  /** Coarse script bucket of the uncovered characters ('CJK', 'emoji', …). */
  script: string
  /** The uncovered characters, unique, ascending codepoint order. */
  chars: string[]
  /** Human-readable summary naming the script and the escape hatches. */
  message: string
}

export interface PngOptions {
  /** Output scale multiplier (default 2 — retina). */
  scale?: number
  /** Background color, any CSS color string (default 'white'). */
  background?: string
  /** Constrain output dimensions; otherwise honors scale on the SVG bounds. */
  fitTo?: { width?: number; height?: number }
  /** Style name | spec | stack, same as RenderOptions.style. Faces referenced
   *  by the built-in looks are bundled in assets/fonts/; other families use
   *  Inter with DejaVu per-glyph fallback unless supplied via fontDirs. */
  style?: StyleInput | StyleInput[]
  /** Ink-wobble seed for styled looks, same as RenderOptions.seed. */
  seed?: number
  /** Extra font directories searched in addition to the bundled ones —
   *  the escape hatch for custom styles that reference unbundled families
   *  and for scripts the bundled fonts don't cover (CJK, emoji). */
  fontDirs?: string[]
  /** Also load the OS's installed fonts (default false). Opting in trades
   *  cross-machine determinism for coverage — useful when the diagram needs
   *  CJK/emoji glyphs and a system font provides them. Coverage warnings are
   *  skipped in this mode: the system font set is unknown to the checker. */
  loadSystemFonts?: boolean
  /** Receives glyph-coverage warnings instead of the default stderr write.
   *  Warnings never change the PNG bytes; identical inputs render
   *  identically whether or not a handler is installed. */
  onWarning?: (warning: PngFontWarning) => void
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
  const svg = inlineFontVarForRaster(
    renderMermaidSVG(source, { embedFontImport: false, style: opts.style, seed: opts.seed }),
  )

  const scale = opts.scale ?? 2
  const fontDir = resolveFontDir()
  const loadSystemFonts = opts.loadSystemFonts ?? false
  const fontDirs = [...(fontDir ? [fontDir] : []), ...(opts.fontDirs ?? [])]

  // Loud-tofu guard: characters no loaded font covers rasterize as empty
  // boxes, so surface them BEFORE the bytes ship. Skipped with system fonts
  // (their coverage is unknown to the cmap checker). Warnings never affect
  // the rendered bytes.
  if (!loadSystemFonts) {
    const emit = opts.onWarning ?? ((w: PngFontWarning) => process.stderr.write(`agentic-mermaid renderMermaidPNG: warning ${w.code}: ${w.message}\n`))
    for (const { script, chars } of findUncoveredScripts(svg, fontDirs)) {
      const examples = chars.slice(0, 5).join(' ')
      emit({
        code: 'PNG_FONT_COVERAGE',
        script,
        chars,
        message:
          `no bundled font covers ${chars.length} ${script} character${chars.length === 1 ? '' : 's'} (${examples}); ` +
          `they will draw as empty tofu boxes. Point fontDirs (CLI: --font-dirs <dir>) at a font that covers them, ` +
          `or opt in to system fonts with loadSystemFonts: true (CLI: --system-fonts).`,
      })
    }
  }

  const resvgOpts: ConstructorParameters<typeof Resvg>[1] = {
    background: opts.background ?? 'white',
    fitTo: opts.fitTo?.width
      ? { mode: 'width' as const, value: opts.fitTo.width }
      : opts.fitTo?.height
        ? { mode: 'height' as const, value: opts.fitTo.height }
        : { mode: 'zoom' as const, value: scale },
    font: {
      loadSystemFonts,
      // Bundled fonts (Inter + DejaVu Sans + the faces built-in styles
      // reference) for cross-runtime determinism, plus caller-supplied
      // directories. Falls back to resvg's built-in fonts if nothing is found.
      fontDirs,
      // Inter is the metrics font: src/text-metrics.ts is calibrated for it
      // and the SVG @import requests it, so rasterizing with anything else
      // (DejaVu is ~14% wider) pushes long labels outside their measured
      // boxes. resvg falls back per-glyph across every loaded font, so
      // DejaVu still covers glyphs Inter lacks (arrows, math, Armenian, …).
      defaultFontFamily: 'Inter',
    },
  }

  const resvg = new Resvg(svg, resvgOpts)
  const png = resvg.render().asPng()
  // resvg returns Buffer in Node; ensure we surface Uint8Array consistently.
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength)
}
