export interface ExecuteOutputLimits {
  readonly maxResultBytes: number
  readonly maxLogEntries: number
  readonly maxLogBytes: number
}

export const DEFAULT_EXECUTE_OUTPUT_LIMITS: Readonly<ExecuteOutputLimits> = Object.freeze({
  maxResultBytes: 2 * 1024 * 1024,
  maxLogEntries: 1_000,
  maxLogBytes: 256 * 1024,
})

export const LOGS_TRUNCATED_MARKER = '…[logs truncated: hosted execute caps console output]'

export function normalizeExecuteOutputLimits(value: Readonly<ExecuteOutputLimits> | undefined): Readonly<ExecuteOutputLimits> {
  if (value === undefined) return DEFAULT_EXECUTE_OUTPUT_LIMITS
  for (const field of ['maxResultBytes', 'maxLogEntries', 'maxLogBytes'] as const) {
    if (!Number.isSafeInteger(value[field]) || value[field] <= 0) {
      throw new TypeError(`Code Mode ${field} must be a positive safe integer`)
    }
  }
  return Object.freeze({ ...value })
}

export function utf8ByteLength(value: string): number {
  let bytes = 0
  for (const char of value) {
    const code = char.codePointAt(0)!
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
  }
  return bytes
}

/** Longest Unicode-code-point-safe prefix within a UTF-8 byte budget. */
export function truncateUtf8(value: string, maximum: number): string {
  if (maximum <= 0) return ''
  let bytes = 0
  let output = ''
  for (const char of value) {
    const code = char.codePointAt(0)!
    const width = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4
    if (bytes + width > maximum) break
    output += char
    bytes += width
  }
  return output
}
