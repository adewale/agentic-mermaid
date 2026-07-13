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
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import type { ValidDiagram } from './types.ts'
import type { RenderOptions } from '../types.ts'
import { serializeMermaid } from './serialize.ts'
import type { RenderRequestReceipt } from '../render-contract.ts'
import { inlineFontVarForRaster } from '../theme.ts'
import { findUncoveredScripts } from './font-coverage.ts'
import { buildPngFontWarnings } from '../shared/png-font-warnings.ts'
import { safeCssColor } from '../shared/css-color.ts'
import type { PngFontWarning } from '../shared/png-font-warnings.ts'
import { applyPngColorProfile } from '../output-color-profile.ts'
import {
  pngNapiRuntimeProvenance,
  type PngRuntimeProvenance,
} from '../png-contract.ts'
import { renderPngGraphicalProjection } from '../png-graphical.ts'
import { RESOURCE_MANIFEST } from '../font-manifest.ts'
import { NodeResourceResolver } from '../node-resource-resolver.ts'
export type { PngFontWarning } from '../shared/png-font-warnings.ts'

export interface PngOptions extends RenderOptions {
  /** Output scale multiplier (default 2 — retina). */
  scale?: number
  /** Background override. By default the final SVG background is used, then white. */
  background?: string
  /** Constrain output dimensions; otherwise honors scale on the SVG bounds. */
  fitTo?: { width?: number; height?: number }
  /** Extra font directories searched in addition to the bundled ones —
   *  the escape hatch for custom styles that reference unbundled families
   *  and for scripts the bundled fonts don't cover (CJK, emoji). */
  fontDirs?: string[]
  /** Also load the OS's installed fonts (default false). Opting in trades
   *  cross-machine determinism for coverage. Known bundled/caller-font gaps
   *  still warn, qualified because an installed face may cover them. */
  loadSystemFonts?: boolean
  /** Receives glyph-coverage warnings instead of the default stderr write.
   *  Warnings never change the PNG bytes; identical inputs render
   *  identically whether or not a handler is installed. */
  onWarning?: (warning: PngFontWarning) => void
}

/**
 * Locate and integrity-check the installed font manifest. Rasterization gets
 * the exact verified file set rather than trusting every file in a directory.
 */
interface BundledFonts {
  readonly snapshotDirectory: string
  readonly buffers: readonly Uint8Array[]
  readonly files: readonly string[]
}

let cachedBundledFonts: BundledFonts | undefined
let cleanupRegistered = false

function materializeVerifiedFontSnapshot(
  resources: ReturnType<NodeResourceResolver['verifyInstalled']>['resources'],
): BundledFonts {
  // resvg's synchronous N-API binding accepts paths rather than font buffers.
  // Materialize private files from the verified snapshots, never from the
  // original package paths; coverage continues to consume the buffers below.
  const snapshotDirectory = mkdtempSync(join(tmpdir(), 'agentic-mermaid-fonts-'))
  try {
    const buffers = resources.map(resource => resource.readBytes())
    const files = buffers.map((bytes, index) => {
      const file = join(snapshotDirectory, `${index}-${basename(resources[index]!.entry.path)}`)
      writeFileSync(file, bytes, { flag: 'wx', mode: 0o400 })
      return file
    })
    return Object.freeze({
      snapshotDirectory,
      buffers: Object.freeze(buffers),
      files: Object.freeze(files),
    })
  } catch (error) {
    try { rmSync(snapshotDirectory, { recursive: true, force: true }) } catch { /* retain the original materialization error */ }
    throw error
  }
}

function resolveBundledFonts(): BundledFonts {
  if (cachedBundledFonts) return cachedBundledFonts
  // import.meta.url works under Bun + Node ESM
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const here = typeof (import.meta as any).url === 'string' ? fileURLToPath((import.meta as any).url) : __filename
  let dir = dirname(here)
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'assets', 'fonts')
    if (existsSync(candidate)) {
      const verified = new NodeResourceResolver(dir, RESOURCE_MANIFEST).verifyInstalled()
      cachedBundledFonts = materializeVerifiedFontSnapshot(verified.resources)
      if (!cleanupRegistered) {
        cleanupRegistered = true
        process.once('exit', () => {
          try {
            if (cachedBundledFonts) rmSync(cachedBundledFonts.snapshotDirectory, { recursive: true, force: true })
          } catch {
            // Process exit must not be made exceptional by best-effort cleanup.
          }
        })
      }
      return cachedBundledFonts
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('RESOURCE_MISSING: required bundled font manifest could not be located')
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
  return renderMermaidPNGWithReceipt(input, opts).png
}

export interface RenderedPng {
  png: Uint8Array
  receipt: RenderRequestReceipt
  /** Artifact/runtime provenance; deliberately excluded from request digests. */
  runtime: PngRuntimeProvenance
}

export function renderMermaidPNGWithReceipt(input: ValidDiagram | string, opts: PngOptions = {}): RenderedPng {
  // SVG input: embedFontImport=false so resvg doesn't try to fetch from
  // Google Fonts during rasterization. CSS-variable fonts (Loop 8 M2) means
  // the SVG still declares its font-family preference via --font.
  const source = typeof input === 'string' ? input : serializeMermaid(input)
  const {
    scale,
    background,
    fitTo,
    fontDirs: callerFontDirs = [],
    loadSystemFonts = false,
    onWarning,
    ...renderOptions
  } = opts
  const graphical = renderPngGraphicalProjection(source, renderOptions, {
    scale,
    background,
    fitTo,
    fontDirs: callerFontDirs,
    loadSystemFonts,
  })
  const outputPolicy = graphical.outputPolicy
  const svg = inlineFontVarForRaster(graphical.svg)

  const bundledFonts = resolveBundledFonts()

  // Surface known coverage/shaping uncertainty before bytes ship. System
  // fonts broaden the rasterizer's set but are machine-dependent, so they
  // qualify the warning rather than turning an unknown outcome into silence.
  const emit = onWarning ?? ((w: PngFontWarning) => process.stderr.write(`agentic-mermaid renderMermaidPNG: warning ${w.code}: ${w.message}\n`))
  for (const warning of buildPngFontWarnings(findUncoveredScripts(
    svg,
    outputPolicy.fonts.callerDirectories,
    bundledFonts.buffers,
  ), { systemFontsMayCover: outputPolicy.fonts.loadSystemFonts })) emit(warning)

  // Raster background follows the final graphical artifact, including any
  // family projection. This is deliberately output-generic: PNG no longer
  // reparses source or owns an XY-specific appearance resolver.
  const artifactBackground = safeCssColor(svg.match(/--bg\s*:\s*([^;"']+)/i)?.[1]?.trim())
  const resvgOpts: ConstructorParameters<typeof Resvg>[1] = {
    background: outputPolicy.background.mode === 'explicit'
      ? outputPolicy.background.value
      : artifactBackground ?? outputPolicy.background.fallback,
    fitTo: { ...outputPolicy.fitTo },
    font: {
      loadSystemFonts: outputPolicy.fonts.loadSystemFonts,
      // These private files were materialized from the exact verified byte
      // snapshots. Explicit caller directories remain a host-controlled input.
      fontFiles: [...bundledFonts.files],
      fontDirs: [...outputPolicy.fonts.callerDirectories],
      // Inter is the metrics font: src/text-metrics.ts is calibrated for it
      // and the SVG @import requests it, so rasterizing with anything else
      // (DejaVu is ~14% wider) pushes long labels outside their measured
      // boxes. resvg falls back per-glyph across every loaded font, so
      // DejaVu still covers glyphs Inter lacks (arrows, math, Armenian, …).
      defaultFontFamily: outputPolicy.fonts.defaultFamily,
    },
  }

  const resvg = new Resvg(svg, resvgOpts)
  const png = applyPngColorProfile(resvg.render().asPng())
  // resvg returns Buffer in Node; ensure we surface Uint8Array consistently.
  return {
    png: new Uint8Array(png.buffer, png.byteOffset, png.byteLength),
    receipt: graphical.receipt,
    runtime: pngNapiRuntimeProvenance(outputPolicy.fonts),
  }
}
