// ============================================================================
// Declared graphical output color profile.
//
// SVG/CSS colors and raster samples are interpreted as sRGB. PNG carries both
// the long-established sRGB chunk and PNG Third Edition cICP signalling. iCCP
// is intentionally absent: the PNG specification recommends that sRGB and
// iCCP not coexist, while cICP has the highest decoder precedence.
// ============================================================================

export const OUTPUT_COLOR_PROFILE = Object.freeze({
  version: 1,
  id: 'srgb',
  svgColorInterpolation: 'sRGB',
  gamutMapping: 'clip-to-srgb',
  png: Object.freeze({
    sRGBRenderingIntent: 0,
    // H.273: BT.709/sRGB primaries, IEC 61966-2-1 transfer, RGB matrix,
    // full range. See PNG Third Edition §11.3.2.6.
    cICP: Object.freeze([0x01, 0x0d, 0x00, 0x01] as const),
    iCCP: 'absent-when-sRGB-is-present',
    precedence: Object.freeze(['cICP', 'iCCP', 'sRGB', 'gAMA+cHRM'] as const),
  }),
})

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const COLOR_CHUNKS = new Set(['cICP', 'iCCP', 'sRGB', 'gAMA', 'cHRM'])

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function uint32(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0)
  return out
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type)
  return concat([uint32(data.length), typeBytes, data, uint32(crc32(concat([typeBytes, data])))])
}

function assertPng(bytes: Uint8Array): void {
  if (bytes.length < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('Expected a PNG byte stream')
  }
}

interface PngChunk { type: string; bytes: Uint8Array; data: Uint8Array }

function chunksOf(bytes: Uint8Array): PngChunk[] {
  assertPng(bytes)
  const chunks: PngChunk[] = []
  let offset = PNG_SIGNATURE.length
  let ended = false
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated PNG chunk header')
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error('Truncated PNG chunk')
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8))
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('Invalid PNG chunk type')
    const typeAndData = bytes.subarray(offset + 4, offset + 8 + length)
    const actualCrc = new DataView(bytes.buffer, bytes.byteOffset + offset + 8 + length, 4).getUint32(0)
    if (actualCrc !== crc32(typeAndData)) throw new Error(`Invalid PNG CRC for ${type}`)
    const entry = { type, bytes: bytes.slice(offset, end), data: bytes.slice(offset + 8, offset + 8 + length) }
    chunks.push(entry)
    offset = end
    if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG IEND must be empty')
      ended = true
      break
    }
  }
  if (offset !== bytes.length) throw new Error('PNG contains trailing bytes after IEND')
  if (!ended) throw new Error('PNG is missing IEND')
  const ihdr = chunks[0]
  if (ihdr?.type !== 'IHDR' || ihdr.data.length !== 13) throw new Error('PNG IHDR must be first and contain 13 bytes')
  if (chunks.filter(entry => entry.type === 'IHDR').length !== 1) throw new Error('PNG must contain exactly one IHDR')
  const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength)
  if (ihdrView.getUint32(0) === 0 || ihdrView.getUint32(4) === 0) throw new Error('PNG dimensions must be non-zero')
  if (!chunks.some(entry => entry.type === 'IDAT')) throw new Error('PNG is missing IDAT image data')
  return chunks
}

export interface PngColorProfileReceipt {
  chunks: readonly string[]
  sRGBRenderingIntent?: number
  cICP?: readonly number[]
  hasICC: boolean
  profile: typeof OUTPUT_COLOR_PROFILE.id
}

export interface PngDimensions {
  readonly width: number
  readonly height: number
}

/** Read validated PNG IHDR dimensions. The whole stream is checked first. */
export function inspectPngDimensions(bytes: Uint8Array): PngDimensions {
  const ihdr = chunksOf(bytes)[0]!
  const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength)
  return Object.freeze({ width: view.getUint32(0), height: view.getUint32(4) })
}

export function inspectPngColorProfile(bytes: Uint8Array): PngColorProfileReceipt {
  const chunks = chunksOf(bytes)
  const srgb = chunks.find(entry => entry.type === 'sRGB')
  const cicp = chunks.find(entry => entry.type === 'cICP')
  return {
    chunks: chunks.map(entry => entry.type),
    sRGBRenderingIntent: srgb?.data[0],
    cICP: cicp ? [...cicp.data] : undefined,
    hasICC: chunks.some(entry => entry.type === 'iCCP'),
    profile: OUTPUT_COLOR_PROFILE.id,
  }
}

export function applyPngColorProfile(bytes: Uint8Array): Uint8Array {
  const existing = chunksOf(bytes)
  const ihdr = existing[0]
  if (ihdr?.type !== 'IHDR') throw new Error('PNG IHDR must be first')
  const rest = existing.slice(1).filter(entry => !COLOR_CHUNKS.has(entry.type)).map(entry => entry.bytes)
  return concat([
    PNG_SIGNATURE,
    ihdr.bytes,
    chunk('sRGB', new Uint8Array([OUTPUT_COLOR_PROFILE.png.sRGBRenderingIntent])),
    chunk('cICP', new Uint8Array(OUTPUT_COLOR_PROFILE.png.cICP)),
    ...rest,
  ])
}
