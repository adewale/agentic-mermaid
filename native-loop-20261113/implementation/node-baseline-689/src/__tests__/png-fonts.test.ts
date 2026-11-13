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
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createMermaidPNGRenderer, renderMermaidPNG, type PngFontWarning } from '../agent/png.ts'
import { createMermaidRenderer, DefaultBackend, registerBackend, renderMermaidSVG } from '../index.ts'
import { KNOWN_EXTENSION_CONTRACT_VERSIONS } from '../shared/extension-identity.ts'
import { runCli } from '../cli/index.ts'
import { PNG_NAPI_RUNTIME, PNG_WASM_RUNTIME, pngNapiRuntimeProvenance } from '../png-contract.ts'
import { decodePng, inkColumns } from './helpers/png-pixels.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()

const JOURNEY_LONG_LABEL = `journey
  title Onboarding
  section Signup
    Complete the extremely long registration questionnaire form: 3: User
`

describe('PNG font provenance', () => {
  test('distinguishes verified, caller-directory, system, and buffer inputs', () => {
    expect(PNG_NAPI_RUNTIME.fontSources).toEqual(['verified-files'])
    expect(PNG_WASM_RUNTIME.fontSources).toEqual(['verified-buffers'])
    expect(PNG_NAPI_RUNTIME.reproducibility).toBe('content-addressed')
    expect(PNG_WASM_RUNTIME.reproducibility).toBe('content-addressed')
    expect(pngNapiRuntimeProvenance({ callerDirectories: ['/host/fonts'] }).fontSources)
      .toEqual(['verified-files', 'caller-directories'])
    expect(pngNapiRuntimeProvenance({ callerDirectories: ['/host/fonts'] }).reproducibility)
      .toBe('host-dependent')
    expect(pngNapiRuntimeProvenance({ loadSystemFonts: true }).fontSources)
      .toEqual(['verified-files', 'system-fonts'])
    expect(pngNapiRuntimeProvenance({ callerDirectories: ['/host/fonts'], loadSystemFonts: true }).fontSources)
      .toEqual(['verified-files', 'caller-directories', 'system-fonts'])
  })
})

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

// CI installs WenQuanYi; local hosts may select another CJK-capable font directory.
const CJK_FONT_DIR = process.env.AM_CJK_FONT_DIR ?? '/usr/share/fonts/truetype/wqy'
const HAS_CJK_FONT = existsSync(CJK_FONT_DIR)
if (process.env.CI === 'true' && !HAS_CJK_FONT) throw new Error('CI requires a CJK font: install fonts-wqy-zenhei or set AM_CJK_FONT_DIR')

function collectWarnings(source: string, opts: Parameters<typeof renderMermaidPNG>[1] = {}): { png: Uint8Array; warnings: PngFontWarning[] } {
  const warnings: PngFontWarning[] = []
  const png = renderMermaidPNG(source, { ...opts, onWarning: w => { if (w.code === 'PNG_FONT_COVERAGE') warnings.push(w) } })
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
  test.skipIf(!HAS_CJK_FONT)('explicit CJK fallback paints the authored glyph shapes through both graphical writers', () => {
    // 一 is a horizontal stroke; 口 encloses a clear center. Positive tofu
    // pixels and merely different PNG bytes do not establish either shape.
    const id = 'backend:test/cjk-fallback'
    let sceneCalls = 0
    const unregister = registerBackend({
      ...DefaultBackend, id, capabilities: DefaultBackend.capabilities.map(claim => ({ ...claim, target: id })),
      render(doc, context) { sceneCalls++; return DefaultBackend.render(doc, context) },
    }, { compatibility: { core: KNOWN_EXTENSION_CONTRACT_VERSIONS.core, scene: '^2.0.0' } })
    try {
      const sceneSvg = createMermaidRenderer({ backendPolicy: { selectBackend: () => id } })
      const scenePng = createMermaidPNGRenderer({ backendPolicy: { selectBackend: () => id } })
      for (const backend of ['agentic', 'elk'] as const) {
        for (const writer of ['default', 'explicit-scene'] as const) {
          for (const char of ['一', '口']) {
            const source = `flowchart LR\nA[${char}]`
            const graphLayout = { backend }
            const warnings: PngFontWarning[] = []
            const svgRenderer = writer === 'default' ? { renderMermaidSVG } : sceneSvg
            const pngRenderer = writer === 'default' ? { renderMermaidPNG } : scenePng
            const before = sceneCalls
            const svg = svgRenderer.renderMermaidSVG(source, { graphLayout, embedFontImport: false })
            const rect = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"[^>]*data-id="node-shape:A"/)
            expect(rect, `${backend}/${writer}/${char}: owned node rectangle`).not.toBeNull()
            const [x, y, width, height] = rect!.slice(1).map(Number) as [number, number, number, number]
            const scale = 3
            const image = decodePng(pngRenderer.renderMermaidPNG(source, {
              graphLayout, scale, fontDirs: [CJK_FONT_DIR],
              onWarning: warning => { if (warning.code === 'PNG_FONT_COVERAGE') warnings.push(warning) },
            }))
            expect(warnings.filter(w => w.script === 'CJK'), `${backend}/${writer}/${char}`).toEqual([])
            if (writer === 'explicit-scene') expect(sceneCalls - before).toBe(2)
            const points: { x: number; y: number }[] = []
            // The inset excludes the node stroke; only actual glyph ink is dark.
            for (let py = Math.ceil((y + 4) * scale); py < Math.floor((y + height - 4) * scale); py++) {
              for (let px = Math.ceil((x + 4) * scale); px < Math.floor((x + width - 4) * scale); px++) {
                const at = (py * image.width + px) * 4
                if ((image.rgba[at]! + image.rgba[at + 1]! + image.rgba[at + 2]!) / 3 < 100) points.push({ x: px, y: py })
              }
            }
            expect(points.length, `${backend}/${writer}/${char}: actual glyph ink`).toBeGreaterThan(0)
            const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x))
            const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y))
            const aspect = (right - left + 1) / (bottom - top + 1)
            if (char === '一') expect(aspect, `${backend}/${writer}: horizontal stroke`).toBeGreaterThan(4)
            else {
              expect(aspect, `${backend}/${writer}: enclosure proportions`).toBeGreaterThan(0.5)
              expect(aspect).toBeLessThan(1.5)
              const centerInk = points.filter(p => p.x > left + (right - left) / 3 && p.x < right - (right - left) / 3
                && p.y > top + (bottom - top) / 3 && p.y < bottom - (bottom - top) / 3)
              expect(centerInk, `${backend}/${writer}: clear enclosed center`).toEqual([])
            }
          }
        }
      }
    } finally { unregister() }
  }, 30_000)
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
  try {
    const result = runCli(argv)
    if (typeof result !== 'number') throw new Error('Expected a synchronous command')
    code = result
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = origOut
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stderr as any).write = origErr
  }
  return { code, out: outChunks.join(''), err: errChunks.join('') }
}

function tmpPngRun(source: string, extraFlags: string[] = []): { code: number; out: string; err: string; outFile: string } {
  const dir = temp.dir('am-png-fonts-')
  const inFile = join(dir, 'in.mmd')
  const outFile = join(dir, 'out.png')
  writeFileSync(inFile, source)
  const r = captureCli(['render', inFile, '--format', 'png', '--output', outFile, ...extraFlags])
  return { ...r, outFile }
}

describe('am render --format png font flags', () => {
  test('PNG-only controls are rejected for non-PNG formats', () => {
    const dir = temp.dir('am-png-only-flags-')
    const input = join(dir, 'in.mmd')
    writeFileSync(input, 'flowchart LR\n  A --> B')
    for (const flag of [['--scale', '2'], ['--bg', '#fff'], ['--fit-width', '64'], ['--system-fonts']]) {
      const { code, err } = captureCli(['render', input, '--format', 'svg', ...flag])
      expect(code).toBe(2)
      expect(err).toContain('valid only with --format png')
    }
  })

  test('fit dimensions are integer pixels', () => {
    const { code, err } = tmpPngRun('flowchart LR\n  A --> B', ['--fit-width', '96.5'])
    expect(code).toBe(2)
    expect(err).toContain('positive integer pixel value')
  })

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

  test.skipIf(!HAS_CJK_FONT)('--font-dirs silences the CJK warning', () => {
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
