declare module 'am-standalone-brotli' {
  export default function decompress(input: Uint8Array, expectedBytes: number): Uint8Array<ArrayBuffer>
}

declare module 'am-standalone-crc32' {
  export default function crc32(crc: number, bytes: Uint8Array, length: number, offset: number): number
}
