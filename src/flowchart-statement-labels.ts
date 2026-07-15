export interface FlowchartTextRange { start: number; end: number }

/** Mask syntax nested inside node shapes, quoted strings, and pipe labels while
 * retaining source offsets. Bare text-arrow labels live at grammar level; the
 * statement splitter handles the masked constructs with its own state. */
function topLevelText(line: string): string {
  const visible = Array<string>(line.length).fill(' ')
  let depth = 0
  let quote: '"' | "'" | '`' | undefined
  let pipeLabel = false
  let escaped = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '|' && depth === 0) { pipeLabel = !pipeLabel; continue }
    if (pipeLabel) continue
    if (char === '[' || char === '(' || char === '{') { depth++; continue }
    if (char === ']' || char === ')' || char === '}') { depth = Math.max(0, depth - 1); continue }
    if (depth === 0) visible[index] = char
  }
  return visible.join('')
}

function edgeIdEndsAt(text: string, at: number): boolean {
  if (at <= 0 || text[at - 1] !== '@') return false
  let cursor = at - 2
  while (cursor >= 0 && /[\p{L}\p{N}_-]/u.test(text[cursor]!)) cursor--
  return cursor < at - 2 && (cursor < 0 || /\s/.test(text[cursor]!))
}

function openerEndAt(text: string, at: number): number {
  if (at > 0 && !/\s/.test(text[at - 1]!) && !edgeIdEndsAt(text, at)) return -1
  let cursor = at
  if (text[cursor] === '<') cursor++
  if (text[cursor] === '-') {
    if (text[cursor + 1] === '-') {
      cursor += 2
      while (text[cursor] === '-') cursor++
    } else if (text[cursor + 1] === '.') {
      cursor += 2
      while (text[cursor] === '.') cursor++
    } else return -1
  } else if (text[cursor] === '=' && text[cursor + 1] === '=') {
    cursor += 2
    while (text[cursor] === '=') cursor++
  } else return -1
  return /\s/.test(text[cursor] ?? '') ? cursor : -1
}

function closerEndAt(text: string, at: number): number {
  if (at > 0 && !/\s/.test(text[at - 1]!)) return -1
  if (text[at] === '.') {
    let cursor = at
    while (text[cursor] === '.') cursor++
    return text[cursor] === '-' && text[cursor + 1] === '>' ? cursor + 2 : -1
  }
  if (text[at] === '-') {
    if (text[at + 1] === '.') {
      let cursor = at + 1
      while (text[cursor] === '.') cursor++
      if (text[cursor] !== '-') return -1
      return text[cursor + 1] === '>' ? cursor + 2 : cursor + 1
    }
    let cursor = at
    while (text[cursor] === '-') cursor++
    const length = cursor - at
    if (length < 2) return -1
    if (text[cursor] === '>' || text[cursor] === 'o' || text[cursor] === 'x') return cursor + 1
    return length >= 3 ? cursor : -1
  }
  if (text[at] === '=') {
    let cursor = at
    while (text[cursor] === '=') cursor++
    const length = cursor - at
    if (length < 2) return -1
    if (text[cursor] === '>') return cursor + 1
    return length >= 3 ? cursor : -1
  }
  return -1
}

/** Return whitespace-delimited bare text-arrow label ranges in one linear scan.
 * These ranges let every consumer preserve label semicolons without repeatedly
 * slicing and rescanning the remaining physical line. */
export function flowchartTextArrowLabelRanges(line: string): FlowchartTextRange[] {
  const text = topLevelText(line)
  const ranges: FlowchartTextRange[] = []
  let openerEnd = -1
  for (let index = 0; index < text.length; index++) {
    if (openerEnd < 0) {
      const end = openerEndAt(text, index)
      if (end >= 0) { openerEnd = end; index = end - 1 }
      continue
    }
    const closerEnd = closerEndAt(text, index)
    if (closerEnd < 0) continue
    const rawLabel = line.slice(openerEnd, index)
    const leading = rawLabel.length - rawLabel.trimStart().length
    const trimmed = rawLabel.trim()
    if (trimmed) {
      const start = openerEnd + leading
      ranges.push({ start, end: start + trimmed.length })
    }
    openerEnd = -1
    index = closerEnd - 1
  }
  return ranges
}
