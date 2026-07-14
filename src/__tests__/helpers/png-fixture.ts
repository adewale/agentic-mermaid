const ONE_PIXEL_PNG = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
))

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Structurally valid PNG fixture with selectable IHDR dimensions. Its tiny
 * IDAT is intentionally not decoded by contract tests; raster hosts are
 * responsible for pixels while the adapter validates transport structure.
 */
export function pngFixture(width: number, height: number): Uint8Array {
  const png = ONE_PIXEL_PNG.slice()
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  view.setUint32(16, width)
  view.setUint32(20, height)
  view.setUint32(29, crc32(png.subarray(12, 29)))
  return png
}
