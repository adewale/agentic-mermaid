// PNG font fidelity — the raster font must BE the metrics font.
//
// Text metrics (src/text-metrics.ts) model Inter, and the SVG output requests
// Inter; if the rasterizer draws with a wider face (DejaVu Sans is ~14% wider)
// long labels escape the boxes that were sized for them. The discriminating
// test renders a journey with a long task label and pixel-scans the decoded
// PNG: no glyph ink may appear beyond the task box's right border. Nothing
// legitimate renders right of a single-section, single-task journey box, so
// any ink there is label overflow.

import { describe, test, expect } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { renderMermaidPNG, type PngFontWarning } from '../agent/png.ts'
import { renderMermaidSVG } from '../index.ts'
import { runCli } from '../cli/index.ts'
import { decodePng, inkColumns } from './helpers/png-pixels.ts'

const JOURNEY_LONG_LABEL = `journey
  title Onboarding
  section Signup
    Complete the extremely long registration questionnaire form: 3: User
`

/** The journey task box rect carries explicit geometry in the SVG output. */
function taskBox(svg: string): { x: number; y: number; w: number; h: number } {
  const m = svg.match(/<rect class="journey-task-box" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/)
  if (!m) throw new Error('journey-task-box rect not found in SVG output')
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) }
}

describe('PNG raster font matches the metrics font', () => {
  test('long journey task label rasterizes inside its measured task box', () => {
    // Same geometry as the PNG path (embedFontImport only toggles CSS).
    const svg = renderMermaidSVG(JOURNEY_LONG_LABEL, { embedFontImport: false })
    const box = taskBox(svg)

    const scale = 2
    const img = decodePng(renderMermaidPNG(JOURNEY_LONG_LABEL, { scale }))

    // Scan strictly right of the box (3 CSS px of slack for the border stroke
    // and its antialiasing), within the box's rows. The actor legend sits LEFT
    // of the box, so only the right side is unambiguous.
    const pad = 3 * scale
    const overflow = inkColumns(
      img,
      (box.x + box.w) * scale + pad,
      img.width,
      box.y * scale + pad,
      (box.y + box.h) * scale - pad,
    )
    expect({ overflowColumns: overflow.length, firstColumns: overflow.slice(0, 5) })
      .toEqual({ overflowColumns: 0, firstColumns: [] })
  })
})

// ---------------------------------------------------------------------------
// Glyph-coverage warnings — CJK/emoji must be loud, never silent tofu.
// ---------------------------------------------------------------------------

const CJK_SRC = 'flowchart LR\n  A[日本語のラベル] --> B[漢字]'
const EMOJI_SRC = 'flowchart LR\n  A[🚀 Launch] --> B[Done]'

/** A CJK-capable font directory available on many Linux CI images; the
 *  escape-hatch tests skip (with the plumbing still covered by the warning
 *  tests) when it is absent. */
const CJK_FONT_DIR = '/usr/share/fonts/truetype/wqy'

function collectWarnings(source: string, opts: Parameters<typeof renderMermaidPNG>[1] = {}): { png: Uint8Array; warnings: PngFontWarning[] } {
  const warnings: PngFontWarning[] = []
  const png = renderMermaidPNG(source, { ...opts, onWarning: w => warnings.push(w) })
  return { png, warnings }
}

describe('PNG glyph-coverage warnings', () => {
  test('CJK text without a covering font warns, naming the script and the escape hatch', () => {
    const { png, warnings } = collectWarnings(CJK_SRC)
    expect(png.length).toBeGreaterThan(100)
    const cjk = warnings.find(w => w.script === 'CJK')
    expect(cjk?.code).toBe('PNG_FONT_COVERAGE')
    expect(cjk?.chars).toContain('日')
    expect(cjk?.message).toContain('CJK')
    expect(cjk?.message).toContain('--font-dirs')
    expect(cjk?.message).toContain('fontDirs')
  })

  test('uncovered emoji warns with the emoji script bucket', () => {
    const { warnings } = collectWarnings(EMOJI_SRC)
    const emoji = warnings.find(w => w.script === 'emoji')
    expect(emoji?.code).toBe('PNG_FONT_COVERAGE')
    expect(emoji?.chars).toContain('🚀')
  })

  test('Latin labels plus DejaVu-covered symbols produce no warning', () => {
    // ∮ is missing from Inter but present in bundled DejaVu Sans — the
    // coverage check must honor the whole bundled fallback chain.
    const { warnings } = collectWarnings('flowchart LR\n  A[Contour ∮ integral] --> B[plain]')
    expect(warnings).toEqual([])
  })

  test('loadSystemFonts: true keeps a qualified known-font warning', () => {
    const { png, warnings } = collectWarnings(CJK_SRC, { loadSystemFonts: true })
    expect(png.length).toBeGreaterThan(100)
    expect(warnings.some(w => w.script === 'CJK')).toBe(true)
    expect(warnings[0]!.message).toContain('installed system font may cover')
    expect(warnings[0]!.message).not.toContain('will draw as')
  })

  test('warnings are deterministic across identical renders', () => {
    const a = collectWarnings(CJK_SRC)
    const b = collectWarnings(CJK_SRC)
    expect(a.warnings).toEqual(b.warnings)
    const hash = (png: Uint8Array) => createHash('sha256').update(png).digest('hex')
    expect(hash(a.png)).toBe(hash(b.png))
  })
})

describe('fontDirs escape hatch', () => {
  test.skipIf(!existsSync(CJK_FONT_DIR))('a CJK-capable fontDirs clears the warning and changes the rendered bytes', () => {
    const bare = collectWarnings(CJK_SRC)
    const withFonts = collectWarnings(CJK_SRC, { fontDirs: [CJK_FONT_DIR] })
    expect(withFonts.warnings.filter(w => w.script === 'CJK')).toEqual([])
    // Real glyphs instead of tofu — the extra directory reached the rasterizer.
    expect(Buffer.compare(Buffer.from(bare.png), Buffer.from(withFonts.png))).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// CLI plumbing: --font-dirs / --system-fonts and the stderr warning channel.
// ---------------------------------------------------------------------------

function captureCli(argv: string[]): { code: number; out: string; err: string } {
  const outChunks: string[] = []
  const errChunks: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (s: unknown) => { outChunks.push(String(s)); return true }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stderr as any).write = (s: unknown) => { errChunks.push(String(s)); return true }
  let code: number
  try { code = runCli(argv) } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = origOut
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stderr as any).write = origErr
  }
  return { code, out: outChunks.join(''), err: errChunks.join('') }
}

function tmpPngRun(source: string, extraFlags: string[] = []): { code: number; out: string; err: string; outFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'am-png-fonts-'))
  const inFile = join(dir, 'in.mmd')
  const outFile = join(dir, 'out.png')
  writeFileSync(inFile, source)
  const r = captureCli(['render', inFile, '--format', 'png', '--output', outFile, ...extraFlags])
  return { ...r, outFile }
}

describe('am render --format png font flags', () => {
  test('CJK render warns on stderr and reports warnings in the --json envelope', () => {
    const { code, out, err, outFile } = tmpPngRun(CJK_SRC, ['--json'])
    expect(code).toBe(0)
    expect(existsSync(outFile)).toBe(true)
    expect(err).toContain('PNG_FONT_COVERAGE')
    expect(err).toContain('--font-dirs')
    const payload = JSON.parse(out) as { ok: boolean; warnings: PngFontWarning[] }
    expect(payload.ok).toBe(true)
    expect(payload.warnings.map(w => w.script)).toContain('CJK')
  })

  test('pure-Latin render prints no coverage warning', () => {
    const { code, err } = tmpPngRun('flowchart LR\n  A --> B')
    expect(code).toBe(0)
    expect(err).not.toContain('PNG_FONT_COVERAGE')
  })

  test.skipIf(!existsSync(CJK_FONT_DIR))('--font-dirs silences the CJK warning', () => {
    const { code, err, outFile } = tmpPngRun(CJK_SRC, ['--font-dirs', CJK_FONT_DIR])
    expect(code).toBe(0)
    expect(err).not.toContain('PNG_FONT_COVERAGE')
    expect(readFileSync(outFile).length).toBeGreaterThan(100)
  })

  test('--system-fonts keeps a qualified bundled-font coverage warning', () => {
    const { code, err, outFile } = tmpPngRun(CJK_SRC, ['--system-fonts'])
    expect(code).toBe(0)
    expect(err).toContain('PNG_FONT_COVERAGE')
    expect(err).toContain('installed system font may cover')
    expect(readFileSync(outFile).length).toBeGreaterThan(100)
  })
})
