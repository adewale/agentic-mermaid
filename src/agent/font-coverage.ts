// ============================================================================
// Glyph-coverage detection for the PNG raster path (helper owned by png.ts).
//
// renderMermaidPNG rasterizes with bundled fonts and loadSystemFonts: false
// (determinism), so characters no bundled font covers — CJK and most emoji —
// silently draw as tofu boxes. This module reads the cmap tables of the fonts
// resvg will actually see (bundled dir + caller fontDirs) and reports which
// characters of the rendered text have no glyph anywhere in that set, grouped
// by script, so png.ts can warn loudly instead.
//
// A compact cmap reader is deliberate: @resvg/resvg-js exposes no coverage
// API, and a full font library would be a heavy dependency for a yes/no
// lookup. Formats 4 and 12 cover every practically shipped Unicode cmap
// (formats 0 and 6 are handled for tiny legacy faces). TrueType collections
// (.ttc) are unioned across their member fonts.
//
// Determinism: results depend only on the font files and the text; scripts
// and characters are emitted in sorted order.
// ============================================================================

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { decodeXML } from 'entities'

/** Per-font glyph lookup backed by the raw cmap bytes (exact, incl. glyph 0). */
interface CmapLookup { has(cp: number): boolean }

// ---------------------------------------------------------------------------
// sfnt / cmap parsing
// ---------------------------------------------------------------------------

const TAG_TTCF = 0x74746366 // 'ttcf'
const TAG_OTTO = 0x4f54544f // 'OTTO' (CFF-flavored OpenType)
const TAG_TRUE = 0x74727565 // 'true' (legacy Apple)
const TAG_CMAP = 0x636d6170 // 'cmap'

/** Parse one font file (ttf/otf/ttc) into cmap lookups; [] when unparsable. */
function parseFontFile(bytes: Uint8Array): CmapLookup[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (dv.getUint32(0) === TAG_TTCF) {
      const numFonts = dv.getUint32(8)
      const lookups: CmapLookup[] = []
      for (let i = 0; i < numFonts; i++) lookups.push(...parseSfnt(dv, dv.getUint32(12 + i * 4)))
      return lookups
    }
    return parseSfnt(dv, 0)
  } catch {
    return [] // torn/foreign file: treat as covering nothing
  }
}

function parseSfnt(dv: DataView, base: number): CmapLookup[] {
  const version = dv.getUint32(base)
  if (version !== 0x00010000 && version !== TAG_OTTO && version !== TAG_TRUE) return []
  const numTables = dv.getUint16(base + 4)
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16
    // Table offsets are from the start of the file (also inside a .ttc).
    if (dv.getUint32(rec) === TAG_CMAP) return parseCmapTable(dv, dv.getUint32(rec + 8))
  }
  return []
}

function parseCmapTable(dv: DataView, cmap: number): CmapLookup[] {
  const lookups: CmapLookup[] = []
  const numTables = dv.getUint16(cmap + 2)
  for (let i = 0; i < numTables; i++) {
    const rec = cmap + 4 + i * 8
    const platform = dv.getUint16(rec)
    const encoding = dv.getUint16(rec + 2)
    // Unicode-capable subtables only: Unicode platform, or Windows BMP/full.
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue
    const sub = cmap + dv.getUint32(rec + 4)
    const format = dv.getUint16(sub)
    if (format === 4) lookups.push(format4Lookup(dv, sub))
    else if (format === 12) lookups.push(format12Lookup(dv, sub))
    else if (format === 6) lookups.push(format6Lookup(dv, sub))
    else if (format === 0) lookups.push(format0Lookup(dv, sub))
  }
  return lookups
}

/** Format 4 (segment mapping, BMP): exact glyph resolution incl. idRangeOffset. */
function format4Lookup(dv: DataView, sub: number): CmapLookup {
  const segCount = dv.getUint16(sub + 6) / 2
  const endsAt = sub + 14
  const startsAt = endsAt + segCount * 2 + 2
  const deltasAt = startsAt + segCount * 2
  const rangeOffsetsAt = deltasAt + segCount * 2
  return {
    has(cp: number): boolean {
      if (cp > 0xffff) return false
      // Binary search the first segment with endCode >= cp.
      let lo = 0
      let hi = segCount - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (dv.getUint16(endsAt + mid * 2) < cp) lo = mid + 1
        else hi = mid
      }
      if (dv.getUint16(startsAt + lo * 2) > cp || cp === 0xffff) return false
      const rangeOffset = dv.getUint16(rangeOffsetsAt + lo * 2)
      if (rangeOffset === 0) return ((cp + dv.getInt16(deltasAt + lo * 2)) & 0xffff) !== 0
      const glyphAt = rangeOffsetsAt + lo * 2 + rangeOffset + (cp - dv.getUint16(startsAt + lo * 2)) * 2
      if (glyphAt + 2 > dv.byteLength) return false
      const glyph = dv.getUint16(glyphAt)
      return glyph !== 0 && ((glyph + dv.getInt16(deltasAt + lo * 2)) & 0xffff) !== 0
    },
  }
}

/** Format 12 (segmented coverage, full Unicode): binary search the groups. */
function format12Lookup(dv: DataView, sub: number): CmapLookup {
  const numGroups = dv.getUint32(sub + 12)
  const groupsAt = sub + 16
  return {
    has(cp: number): boolean {
      let lo = 0
      let hi = numGroups - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        const at = groupsAt + mid * 12
        if (cp < dv.getUint32(at)) hi = mid - 1
        else if (cp > dv.getUint32(at + 4)) lo = mid + 1
        else return dv.getUint32(at + 8) + (cp - dv.getUint32(at)) !== 0
      }
      return false
    },
  }
}

/** Format 6 (trimmed table). */
function format6Lookup(dv: DataView, sub: number): CmapLookup {
  const first = dv.getUint16(sub + 6)
  const count = dv.getUint16(sub + 8)
  return {
    has: (cp: number) => cp >= first && cp < first + count && dv.getUint16(sub + 10 + (cp - first) * 2) !== 0,
  }
}

/** Format 0 (byte encoding). */
function format0Lookup(dv: DataView, sub: number): CmapLookup {
  return { has: (cp: number) => cp < 256 && dv.getUint8(sub + 6 + cp) !== 0 }
}

// ---------------------------------------------------------------------------
// Directory scanning + caching
// ---------------------------------------------------------------------------

const FONT_EXT = /\.(ttf|otf|ttc|otc)$/i
const fileLookupCache = new Map<string, CmapLookup[]>()

/** Font files under `dir` (sorted, recursive, bounded), mirroring resvg's
 *  recursive fontDirs loading closely enough for a coverage answer. */
function fontFilesUnder(dir: string, depth = 4): string[] {
  if (depth < 0) return []
  let entries: string[]
  try {
    entries = readdirSync(dir).sort()
  } catch {
    return [] // missing/unreadable dir: resvg would load nothing from it too
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry)
    try {
      const stat = statSync(path)
      if (stat.isDirectory()) files.push(...fontFilesUnder(path, depth - 1))
      else if (FONT_EXT.test(entry)) files.push(path)
    } catch {
      // dangling symlink etc. — skip
    }
  }
  return files
}

function lookupsForDirs(dirs: readonly string[]): CmapLookup[] {
  const lookups: CmapLookup[] = []
  for (const dir of dirs) {
    for (const file of fontFilesUnder(dir)) {
      let parsed = fileLookupCache.get(file)
      if (!parsed) {
        try {
          parsed = parseFontFile(readFileSync(file))
        } catch {
          parsed = []
        }
        fileLookupCache.set(file, parsed)
      }
      lookups.push(...parsed)
    }
  }
  return lookups
}

// ---------------------------------------------------------------------------
// SVG text extraction + script classification
// ---------------------------------------------------------------------------

/** Concatenated character content of every <text> element (tspans stripped,
 *  XML entities decoded) — exactly the characters resvg will shape. */
export function extractSvgTextContent(svg: string): string {
  let out = ''
  for (const m of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    out += m[1]!.replace(/<[^>]*>/g, '')
  }
  return decodeXML(out)
}

/** Control/format characters that never need a glyph. */
function isIgnorable(cp: number): boolean {
  return (
    cp <= 0x20 ||
    cp === 0x7f ||
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space/joiners, directional marks
    cp === 0x2028 ||
    cp === 0x2029 ||
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors (emoji presentation)
    cp === 0xfeff
  )
}

/** Coarse script bucket for a codepoint — only used to word the warning. */
function classifyScript(cp: number): string {
  const ranges: ReadonlyArray<readonly [number, number, string]> = [
    [0x0530, 0x058f, 'Armenian'],
    [0x0590, 0x05ff, 'Hebrew'],
    [0x0600, 0x077f, 'Arabic'],
    [0x0900, 0x097f, 'Devanagari'],
    [0x0980, 0x09ff, 'Bengali'],
    [0x0e00, 0x0e7f, 'Thai'],
    [0x10a0, 0x10ff, 'Georgian'],
    [0x1100, 0x11ff, 'CJK'], // Hangul jamo
    [0x2600, 0x27bf, 'emoji'], // misc symbols + dingbats
    [0x2e80, 0x9fff, 'CJK'], // radicals, kana, CJK symbols, unified ideographs
    [0xa960, 0xa97f, 'CJK'],
    [0xac00, 0xd7ff, 'CJK'], // Hangul syllables
    [0xf900, 0xfaff, 'CJK'], // compatibility ideographs
    [0xfe30, 0xfe4f, 'CJK'],
    [0xff00, 0xffef, 'CJK'], // fullwidth/halfwidth forms
    [0x1f1e6, 0x1f1ff, 'emoji'], // regional indicators (flags)
    [0x1f000, 0x1faff, 'emoji'],
    [0x20000, 0x3ffff, 'CJK'], // ideograph extensions
  ]
  for (const [lo, hi, script] of ranges) if (cp >= lo && cp <= hi) return script
  return 'other'
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface UncoveredScript {
  /** Coarse script bucket ('CJK', 'emoji', 'Arabic', … or 'other'). */
  script: string
  /** Unique uncovered characters, ascending codepoint order. */
  chars: string[]
}

/**
 * Which characters of `svg`'s text have no glyph in any font under `fontDirs`?
 * Returns one entry per script bucket, scripts sorted alphabetically —
 * deterministic for identical inputs.
 */
export function findUncoveredScripts(svg: string, fontDirs: readonly string[]): UncoveredScript[] {
  const text = extractSvgTextContent(svg)
  if (!text) return []
  const unique = new Set<number>()
  for (const ch of text) unique.add(ch.codePointAt(0)!)

  // Font files parse once per process (fileLookupCache); per render this is
  // a handful of binary searches per unique codepoint.
  const lookups = lookupsForDirs(fontDirs)
  const byScript = new Map<string, number[]>()
  for (const cp of unique) {
    if (isIgnorable(cp)) continue
    if (lookups.some(l => l.has(cp))) continue
    const script = classifyScript(cp)
    const bucket = byScript.get(script)
    if (bucket) bucket.push(cp)
    else byScript.set(script, [cp])
  }

  return [...byScript.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([script, cps]) => ({ script, chars: cps.sort((a, b) => a - b).map(cp => String.fromCodePoint(cp)) }))
}
