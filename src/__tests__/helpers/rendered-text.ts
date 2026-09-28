// Measures every text element of a rendered SVG the way a reader sees it:
// rasterized by resvg with the bundled fonts, so a check built on it cannot
// agree with a wrong layout estimate. For each <text> it reports
//   - how many glyph pixels land on the canvas and how many outside it, and
//   - the contrast between the glyph ink and the pixels immediately around the
//     glyphs (the surface the reader sees the letters against: a node fill, a
//     hatch, the page, or the page-colored halo the sketch looks draw).
//
// Glyph ownership comes from a second raster of the same SVG in which every
// non-text mark is hidden and each text is filled with its own id color. That
// raster is aliased: an antialiased edge shared by two labels would blend two
// id colors into a third label's id. The canvas is enlarged by a margin so
// glyphs drawn off the canvas still raster and can be counted.
//
// The rasterizer is resvg's WebAssembly build, whose images are freed
// explicitly: the native binding's images are never reclaimed under Bun, and a
// census of every family in every style rasters thousands of them.
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import { decodeXML } from 'entities'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const FONT_DIR = join(import.meta.dir, '..', '..', '..', 'assets', 'fonts')
const FONT_BUFFERS = readdirSync(FONT_DIR)
  .filter(name => name.endsWith('.ttf'))
  .sort()
  .map(name => new Uint8Array(readFileSync(join(FONT_DIR, name))))

let ready: Promise<void> | undefined

/** Resolves once the rasterizer is loaded; await it before measuring. */
export function renderedTextReady(): Promise<void> {
  ready ??= initWasm(readFileSync(join(import.meta.dir, '..', '..', '..', 'node_modules', '@resvg', 'resvg-wasm', 'index_bg.wasm')))
    .catch((error: unknown) => {
      if (!/already initialized/i.test(String(error))) throw error
    })
  return ready
}

/** Device pixels per user unit. Two keeps glyph stems of 11px text at least
 * one fully covered pixel wide, so the most common glyph color is the ink. */
const SCALE = 2
/** User units of canvas added on every side to catch glyphs drawn outside. */
const MARGIN = 48
/** The surround is sampled within this many user units of a glyph. */
const SURROUND = 1
/** The share of surround pixels allowed below the required contrast: a stray
 * edge or tick passing close to a label must not fail it, a surface must. */
const SURROUND_PERCENTILE = 0.1
/** Antialiasing may put a glyph's edge pixels this far (user units) past the
 * canvas edge without the glyph being cut. */
const EDGE_TOLERANCE = 0.75

export interface RenderedText {
  /** Position of the element among the SVG's <text> elements. */
  index: number
  content: string
  fontSize: number
  fontWeight: number
  /** WCAG "large text": at least 24px, or at least 18.66px and bold. */
  large: boolean
  /** Glyph pixels on the enlarged canvas (0: the text draws nothing near the canvas). */
  pixels: number
  /** Glyph pixels outside the SVG's viewBox. */
  offCanvasPixels: number
  /** Bounds of the drawn glyphs in user units. */
  box?: { x: number; y: number; width: number; height: number }
  /** Dominant ink of the fully covered glyph pixels, as drawn. */
  ink?: string
  /** The surround color at the reported percentile. */
  surround?: string
  /** WCAG contrast of the ink against its surround at the reported percentile. */
  contrast?: number
}

export interface RenderedTextCensus {
  page: string
  width: number
  height: number
  texts: RenderedText[]
}

/** WCAG 1.4.3 minimum contrast for this text. */
export function requiredContrast(text: Pick<RenderedText, 'large'>): number {
  return text.large ? 3 : 4.5
}

interface TextElement { start: number; end: number; open: string; content: string }

/** A tspan that sets its own x or dy starts a new line of the same text. */
const LINE_TSPAN = /<tspan\b[^>]*\s(?:x|dy)="[^"]*"[^>]*>/g

function textElements(svg: string): TextElement[] {
  return [...svg.matchAll(/<text\b[^>]*>[\s\S]*?<\/text>/g)].map(match => ({
    start: match.index!,
    end: match.index! + match[0].length,
    open: match[0].match(/^<text\b[^>]*>/)![0],
    content: decodeXML(match[0].replace(/^<text\b[^>]*>/, '').replace(LINE_TSPAN, ' ').replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim(),
  }))
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
    ?? tag.match(new RegExp(`\\sstyle="[^"]*(?:^|[;\\s"])${name}\\s*:\\s*([^;"]+)`))?.[1]?.trim()
}

function fontWeightOf(value: string | undefined): number {
  if (value === undefined || value === 'normal') return 400
  if (value === 'bold' || value === 'bolder') return 700
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 400
}

const hex2 = (value: number): string => value.toString(16).padStart(2, '0')

/** Id colors are 15 apart per channel, far beyond resvg's rounding. */
function idColor(index: number): [number, number, number] {
  return [16 + (index & 15) * 15, 16 + ((index >> 4) & 15) * 15, 16 + ((index >> 8) & 15) * 15]
}

function decodeId(r: number, g: number, b: number): number {
  const channel = (value: number): number => {
    const step = Math.round((value - 16) / 15)
    return step >= 0 && step < 16 && Math.abs(16 + step * 15 - value) <= 4 ? step : -1
  }
  const [cr, cg, cb] = [channel(r), channel(g), channel(b)]
  return cr < 0 || cg < 0 || cb < 0 ? -1 : cr | (cg << 4) | (cb << 8)
}

function withStyle(tag: string, declarations: string): string {
  return /\sstyle="/.test(tag)
    ? tag.replace(/\sstyle="([^"]*)"/, (_match, existing: string) => ` style="${existing};${declarations}"`)
    : tag.replace(/^<(\w+)/, `<$1 style="${declarations}"`)
}

/** Every text filled with its id color, unstroked and opaque; every other mark hidden. */
function idVariant(svg: string, elements: readonly TextElement[]): string {
  let out = ''
  let cursor = 0
  elements.forEach((element, index) => {
    out += svg.slice(cursor, element.start)
    const [r, g, b] = idColor(index)
    const declarations = `fill:#${hex2(r)}${hex2(g)}${hex2(b)};fill-opacity:1;stroke:none;opacity:1`
    out += svg.slice(element.start, element.end).replace(/<(?:text|tspan)\b[^>]*>/g, tag => withStyle(tag, declarations))
    cursor = element.end
  })
  out += svg.slice(cursor)
  return out
    .replace(/<(rect|path|circle|ellipse|line|polyline|polygon|image|use)\b/g, '<$1 visibility="hidden"')
    .replace(/(\s)opacity="[^"]*"/g, '$1opacity="1"')
    .replace(/(^|[^-\w])opacity\s*:\s*[^;"}]+/g, '$1opacity:1')
}

function viewBoxOf(svg: string): [number, number, number, number] {
  const values = svg.match(/<svg\b[^>]*\sviewBox="([^"]+)"/)![1]!.trim().split(/[\s,]+/).map(Number)
  return values as [number, number, number, number]
}

function enlarged(svg: string, box: readonly [number, number, number, number]): string {
  const [x, y, width, height] = box
  const w = width + 2 * MARGIN
  const h = height + 2 * MARGIN
  return svg.replace(/<svg\b[^>]*>/, root => {
    let tag = root.replace(/\sviewBox="[^"]*"/, ` viewBox="${x - MARGIN} ${y - MARGIN} ${w} ${h}"`)
    tag = /\swidth="/.test(tag) ? tag.replace(/\swidth="[^"]*"/, ` width="${w}"`) : tag.replace(/^<svg/, `<svg width="${w}"`)
    tag = /\sheight="/.test(tag) ? tag.replace(/\sheight="[^"]*"/, ` height="${h}"`) : tag.replace(/^<svg/, `<svg height="${h}"`)
    return tag
  })
}

/** The page color the SVG declares for its canvas (resvg does not paint CSS backgrounds). */
export function pageColorOf(svg: string): string {
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? ''
  return root.match(/background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6})\b/)?.[1]
    ?? root.match(/--bg\s*:\s*(#[0-9a-fA-F]{6})\b/)?.[1]
    ?? '#ffffff'
}

function raster(svg: string, options: { background?: string; aliased?: boolean } = {}): { data: Uint8Array; width: number; height: number } {
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: SCALE },
    font: { fontBuffers: FONT_BUFFERS, defaultFontFamily: 'Inter' },
    ...(options.background ? { background: options.background } : {}),
    // optimizeSpeed turns antialiasing off for shapes and glyphs.
    ...(options.aliased ? { shapeRendering: 0 as const, textRendering: 0 as const } : {}),
  })
  try {
    const image = renderer.render()
    try {
      return { data: image.pixels, width: image.width, height: image.height }
    } finally {
      image.free()
    }
  } finally {
    renderer.free()
  }
}

const LINEAR = Float64Array.from({ length: 256 }, (_unused, value) => {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

function luminance(data: Uint8Array, offset: number): number {
  return 0.2126 * LINEAR[data[offset]!]! + 0.7152 * LINEAR[data[offset + 1]!]! + 0.0722 * LINEAR[data[offset + 2]!]!
}

function hexAt(data: Uint8Array, offset: number): string {
  return `#${hex2(data[offset]!)}${hex2(data[offset + 1]!)}${hex2(data[offset + 2]!)}`
}

export function measureRenderedText(svg: string): RenderedTextCensus {
  const elements = textElements(svg)
  const box = viewBoxOf(svg)
  const page = pageColorOf(svg)
  const full = raster(enlarged(svg, box), { background: page })
  const ids = raster(enlarged(idVariant(svg, elements), box), { aliased: true })
  const { width, height } = full
  const size = width * height
  const owned: number[][] = elements.map(() => [])
  // Glyph pixels plus a one-pixel fringe: the antialiased raster the reader
  // sees paints partial ink just outside the aliased glyph.
  const covered = new Uint8Array(size)
  for (let pixel = 0; pixel < size; pixel++) {
    const offset = pixel * 4
    if (ids.data[offset + 3]! !== 255) continue
    const index = decodeId(ids.data[offset]!, ids.data[offset + 1]!, ids.data[offset + 2]!)
    if (index < 0 || index >= elements.length) continue
    owned[index]!.push(pixel)
    const x = pixel % width
    const y = Math.floor(pixel / width)
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) covered[ny * width + nx] = 1
      }
    }
  }

  const left = MARGIN * SCALE
  const top = MARGIN * SCALE
  const right = left + box[2] * SCALE
  const bottom = top + box[3] * SCALE
  const slack = EDGE_TOLERANCE * SCALE
  const onCanvas = (x: number, y: number): boolean => x >= left - slack && x < right + slack && y >= top - slack && y < bottom + slack
  // The fringe takes the first pixel; the surround is what lies just past it,
  // inside the 1.5-unit halo the sketch looks paint.
  const radius = Math.max(2, Math.round(SURROUND * SCALE))
  const mark = new Int32Array(size)

  const texts = elements.map((element, index): RenderedText => {
    const fontSize = Number(attribute(element.open, 'font-size') ?? '16') || 16
    const fontWeight = fontWeightOf(attribute(element.open, 'font-weight'))
    const pixels = owned[index]!
    let offCanvasPixels = 0
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const pixel of pixels) {
      const x = pixel % width
      const y = Math.floor(pixel / width)
      if (!onCanvas(x, y)) offCanvasPixels++
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const text: RenderedText = {
      index,
      content: element.content,
      fontSize,
      fontWeight,
      large: fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700),
      pixels: pixels.length,
      offCanvasPixels,
      ...(pixels.length > 0
        ? { box: { x: box[0] + minX / SCALE - MARGIN, y: box[1] + minY / SCALE - MARGIN, width: (maxX + 1 - minX) / SCALE, height: (maxY + 1 - minY) / SCALE } }
        : {}),
    }
    if (pixels.length === 0) return text
    // Fully covered glyph pixels all carry the exact ink, so it is the mode.
    const inks = new Map<string, number>()
    for (const pixel of pixels) {
      const ink = hexAt(full.data, pixel * 4)
      inks.set(ink, (inks.get(ink) ?? 0) + 1)
    }
    const ink = [...inks.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0]
    const inkPixel = pixels.find(pixel => hexAt(full.data, pixel * 4) === ink)!
    const inkLuminance = luminance(full.data, inkPixel * 4)

    const surround: Array<{ ratio: number; pixel: number }> = []
    const generation = index + 1
    for (const pixel of pixels) {
      const x = pixel % width
      const y = Math.floor(pixel / width)
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy
        if (ny < top || ny >= bottom) continue
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx
          if (nx < left || nx >= right) continue
          const neighbor = ny * width + nx
          if (covered[neighbor] || mark[neighbor] === generation) continue
          mark[neighbor] = generation
          const backdrop = luminance(full.data, neighbor * 4)
          const ratio = (Math.max(inkLuminance, backdrop) + 0.05) / (Math.min(inkLuminance, backdrop) + 0.05)
          surround.push({ ratio, pixel: neighbor })
        }
      }
    }
    text.ink = ink
    if (surround.length === 0) return text
    surround.sort((a, b) => a.ratio - b.ratio)
    const at = surround[Math.floor(surround.length * SURROUND_PERCENTILE)]!
    text.surround = hexAt(full.data, at.pixel * 4)
    text.contrast = at.ratio
    return text
  })
  return { page, width: box[2], height: box[3], texts }
}
