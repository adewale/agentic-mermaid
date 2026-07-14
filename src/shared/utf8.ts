/** Exact UTF-8 byte count up to a caller-provided ceiling, without allocating
 * an encoded copy. Returning `limit + 1` means the value exceeded the ceiling
 * and scanning stopped early. */
export function boundedUtf8ByteLength(value: string, limit: number): number {
  let bytes = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4
        index++
      } else bytes += 3
    } else bytes += 3
    if (bytes > limit) return limit + 1
  }
  return bytes
}
