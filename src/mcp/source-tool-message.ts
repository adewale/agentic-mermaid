/** Bound strings before JSON.stringify allocates their escaped representation.
 * These are process-message budgets, separate from diagram/Scene work limits. */
export class SourceToolMessageLimitError extends RangeError {}

function quotedBytes(value: string, remaining: number): number {
  if (value.length > remaining) throw new SourceToolMessageLimitError('Process message exceeds its byte budget')
  let bytes = 2
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) bytes += 2
    else if (code < 32) bytes += 6
    else if (code < 128) bytes++
    else if (code < 2048) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) { bytes += 4; index++ }
      else bytes += 6
    } else bytes += code >= 0xdc00 && code <= 0xdfff ? 6 : 3
    if (bytes > remaining) throw new SourceToolMessageLimitError('Process message exceeds its byte budget')
  }
  return bytes
}

export function sourceToolMessage(value: unknown, maximum: number): string {
  let remaining = maximum
  let nodes = 0
  const ancestors: object[] = []
  let root = true
  const text = JSON.stringify(value, function (key, item: unknown) {
    if (++nodes > 100_000) throw new SourceToolMessageLimitError('Process message exceeds its item budget')
    if (root) root = false
    else if (!Array.isArray(this)) remaining -= quotedBytes(key, remaining) + 1
    if (typeof item === 'string') remaining -= quotedBytes(item, remaining)
    if (remaining < 0) throw new SourceToolMessageLimitError('Process message exceeds its byte budget')
    if (item !== null && typeof item === 'object') {
      while (ancestors.length && ancestors[ancestors.length - 1] !== this) ancestors.pop()
      if (ancestors.length >= 64) throw new SourceToolMessageLimitError('Process message exceeds its nesting budget')
      ancestors.push(item)
    }
    return item
  })
  // Structural punctuation and scalar values are bounded by the item budget;
  // the exact final check also includes those bytes.
  if (text === undefined || Buffer.byteLength(text) > maximum) throw new SourceToolMessageLimitError('Process message exceeds its byte budget')
  return text
}

export interface SourceToolRequest { type: 'request'; id: number; json: string }
export interface SourceToolReply { type: 'result'; id: number; json: string }
