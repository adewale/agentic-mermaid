import type { SourceSpan, SourceSpanPoint } from '../agent/types.ts'

export function sourceLineStarts(source: string): readonly number[] {
  const starts = [0]
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 13) {
      if (source.charCodeAt(index + 1) === 10) index++
      starts.push(index + 1)
    } else if (source.charCodeAt(index) === 10) starts.push(index + 1)
  }
  return starts
}

export function sourcePointAt(lineStarts: readonly number[], offset: number): SourceSpanPoint {
  let low = 0
  let high = lineStarts.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (lineStarts[middle]! <= offset) low = middle + 1
    else high = middle
  }
  const lineIndex = Math.max(0, low - 1)
  return Object.freeze({ offset, line: lineIndex + 1, col: offset - lineStarts[lineIndex]! + 1 })
}

export function sourceSpan(lineStarts: readonly number[], start: number, end: number): SourceSpan {
  return Object.freeze({ start: sourcePointAt(lineStarts, start), end: sourcePointAt(lineStarts, end) })
}

