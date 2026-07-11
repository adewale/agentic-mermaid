// Runtime-neutral sfnt cmap coverage used by both Node and workerd PNG paths.
import { decodeXML } from 'entities'
import { graphemes } from '../shared/graphemes.ts'

interface Lookup { has(codepoint: number): boolean }
type Face = Lookup[]
const CMAP = 0x636d6170
const TTCF = 0x74746366
const OTTO = 0x4f54544f
const TRUE = 0x74727565

function parseFont(bytes: Uint8Array): Face[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    if (view.getUint32(0) === TTCF) {
      const faces: Face[] = []
      for (let i = 0; i < view.getUint32(8); i++) faces.push(parseSfnt(view, view.getUint32(12 + i * 4)))
      return faces.filter(face => face.length > 0)
    }
    const face = parseSfnt(view, 0)
    return face.length > 0 ? [face] : []
  } catch {
    return []
  }
}

function parseSfnt(view: DataView, base: number): Face {
  const version = view.getUint32(base)
  if (version !== 0x00010000 && version !== OTTO && version !== TRUE) return []
  const tables = view.getUint16(base + 4)
  for (let i = 0; i < tables; i++) {
    const record = base + 12 + i * 16
    if (view.getUint32(record) === CMAP) return parseCmap(view, view.getUint32(record + 8))
  }
  return []
}

function parseCmap(view: DataView, offset: number): Lookup[] {
  const lookups: Lookup[] = []
  const count = view.getUint16(offset + 2)
  for (let i = 0; i < count; i++) {
    const record = offset + 4 + i * 8
    const platform = view.getUint16(record)
    const encoding = view.getUint16(record + 2)
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue
    const subtable = offset + view.getUint32(record + 4)
    const format = view.getUint16(subtable)
    if (format === 4) lookups.push(format4(view, subtable))
    else if (format === 12) lookups.push(format12(view, subtable))
    else if (format === 6) lookups.push(format6(view, subtable))
    else if (format === 0) lookups.push(format0(view, subtable))
  }
  return lookups
}

function format4(view: DataView, subtable: number): Lookup {
  const count = view.getUint16(subtable + 6) / 2
  const ends = subtable + 14
  const starts = ends + count * 2 + 2
  const deltas = starts + count * 2
  const offsets = deltas + count * 2
  return { has(codepoint) {
    if (codepoint > 0xffff) return false
    let low = 0, high = count - 1
    while (low < high) {
      const mid = (low + high) >> 1
      if (view.getUint16(ends + mid * 2) < codepoint) low = mid + 1
      else high = mid
    }
    if (view.getUint16(starts + low * 2) > codepoint || codepoint === 0xffff) return false
    const rangeOffset = view.getUint16(offsets + low * 2)
    if (rangeOffset === 0) return ((codepoint + view.getInt16(deltas + low * 2)) & 0xffff) !== 0
    const glyphOffset = offsets + low * 2 + rangeOffset + (codepoint - view.getUint16(starts + low * 2)) * 2
    if (glyphOffset + 2 > view.byteLength) return false
    const glyph = view.getUint16(glyphOffset)
    return glyph !== 0 && ((glyph + view.getInt16(deltas + low * 2)) & 0xffff) !== 0
  } }
}

function format12(view: DataView, subtable: number): Lookup {
  const count = view.getUint32(subtable + 12)
  const groups = subtable + 16
  return { has(codepoint) {
    let low = 0, high = count - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const at = groups + mid * 12
      if (codepoint < view.getUint32(at)) high = mid - 1
      else if (codepoint > view.getUint32(at + 4)) low = mid + 1
      else return view.getUint32(at + 8) + codepoint - view.getUint32(at) !== 0
    }
    return false
  } }
}

function format6(view: DataView, subtable: number): Lookup {
  const first = view.getUint16(subtable + 6)
  const count = view.getUint16(subtable + 8)
  return { has: codepoint => codepoint >= first && codepoint < first + count && view.getUint16(subtable + 10 + (codepoint - first) * 2) !== 0 }
}

function format0(view: DataView, subtable: number): Lookup {
  return { has: codepoint => codepoint < 256 && view.getUint8(subtable + 6 + codepoint) !== 0 }
}

export function extractSvgTextContent(svg: string): string {
  let text = ''
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) text += match[1]!.replace(/<[^>]*>/g, '')
  return decodeXML(text)
}

function ignorable(codepoint: number): boolean {
  return codepoint <= 0x20 || codepoint === 0x7f ||
    (codepoint >= 0x200b && codepoint <= 0x200f) || codepoint === 0x2028 || codepoint === 0x2029 ||
    (codepoint >= 0xfe00 && codepoint <= 0xfe0f) || codepoint === 0xfeff
}

function script(codepoint: number): string {
  if ((codepoint >= 0x2e80 && codepoint <= 0x9fff) || (codepoint >= 0xac00 && codepoint <= 0xd7ff) || (codepoint >= 0xf900 && codepoint <= 0xfaff) || (codepoint >= 0x20000 && codepoint <= 0x3ffff)) return 'CJK'
  if ((codepoint >= 0x2600 && codepoint <= 0x27bf) || (codepoint >= 0x1f000 && codepoint <= 0x1faff)) return 'emoji'
  if (codepoint >= 0x0590 && codepoint <= 0x05ff) return 'Hebrew'
  if (codepoint >= 0x0600 && codepoint <= 0x077f) return 'Arabic'
  if (codepoint >= 0x0900 && codepoint <= 0x097f) return 'Devanagari'
  return 'other'
}

export interface UncoveredScript { script: string; chars: string[] }

/** Require every non-format scalar in one grapheme cluster to exist in one
 * face. This avoids incorrectly certifying a cluster by unioning unrelated
 * fallback faces. ZWJ/combining clusters remain conservatively unverified. */
export function findUncoveredScriptsFromBuffers(svg: string, fontBuffers: readonly Uint8Array[]): UncoveredScript[] {
  const faces = fontBuffers.flatMap(parseFont)
  const byScript = new Map<string, Set<number>>()
  for (const cluster of graphemes(extractSvgTextContent(svg))) {
    const codepoints = [...cluster].map(char => char.codePointAt(0)!).filter(codepoint => !ignorable(codepoint))
    if (codepoints.length === 0) continue
    const oneFaceCovers = faces.some(face => codepoints.every(codepoint => face.some(lookup => lookup.has(codepoint))))
    const shapingUncertain = cluster.includes('\u200d') || /\p{Mark}/u.test(cluster)
    if (oneFaceCovers && !shapingUncertain) continue
    for (const codepoint of codepoints) {
      const bucket = byScript.get(script(codepoint)) ?? new Set<number>()
      bucket.add(codepoint)
      byScript.set(script(codepoint), bucket)
    }
  }
  return [...byScript].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, values]) => ({
    script: name,
    chars: [...values].sort((a, b) => a - b).map(codepoint => String.fromCodePoint(codepoint)),
  }))
}
