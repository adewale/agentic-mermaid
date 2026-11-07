import decompress from 'am-standalone-brotli'
import crc32 from 'am-standalone-crc32'
import { chargeCodecLoop, limitCodecOutput, withCodecBudget } from './browser-standalone-budget.ts'

declare const AM_STANDALONE_PACKED_LENGTH: number
declare const AM_STANDALONE_PACKED_CRC32: number
declare const AM_STANDALONE_WORKER_LENGTH: number
declare const AM_STANDALONE_WORKER_CRC32: number

/** Decode only the build-owned payload captured by the standalone bootstrap.
 * Lengths and CRCs describe bytes we ship; CRC is accidental-corruption
 * detection, not authentication or admission of arbitrary compressed input. */
export function standaloneWorkerPayload(encoded: string, cancelled: () => boolean): Blob {
  return withCodecBudget(() => {
    const packedLength = limitCodecOutput(AM_STANDALONE_PACKED_LENGTH)
    const workerLength = limitCodecOutput(AM_STANDALONE_WORKER_LENGTH)
    const encodedLength = Math.ceil(packedLength / 3) * 4
    if (encoded.length > encodedLength + 2) throw new Error('Packed background renderer has an invalid encoded length')
    const text = encoded.trim()
    if (text.length !== encodedLength) throw new Error('Packed background renderer has an invalid encoded length')
    const binary = atob(text)
    if (binary.length !== packedLength) throw new Error('Packed background renderer has an invalid byte length')
    const input = new Uint8Array(packedLength)
    for (let index = 0; index < input.length; index++) {
      chargeCodecLoop()
      input[index] = binary.charCodeAt(index)
    }
    if ((crc32(0, input, input.length, 0) >>> 0) !== AM_STANDALONE_PACKED_CRC32) {
      throw new Error('Packed background renderer failed its checksum')
    }
    const output = decompress(input, workerLength)
    if (!(output instanceof Uint8Array) || output.byteLength !== workerLength) {
      throw new Error('Background renderer has an invalid decoded length')
    }
    if ((crc32(0, output, output.length, 0) >>> 0) !== AM_STANDALONE_WORKER_CRC32) {
      throw new Error('Background renderer failed its decoded checksum')
    }
    return new Blob([output], { type: 'text/javascript' })
  }, cancelled)
}
