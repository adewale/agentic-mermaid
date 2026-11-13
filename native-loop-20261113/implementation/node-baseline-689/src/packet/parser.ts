import type { Accessibility } from '../agent/types.ts'
import { scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { observeParserMutation, observeParserStatement, parserObservationActive } from '../shared/parser-observation.ts'
import { syntaxError } from '../shared/syntax-error.ts'
import { stripTrailingComment } from '../shared/trailing-comment.ts'
import type { PacketBody } from './types.ts'

/** Packet's grammar is intentionally independent of its word projection.
 * Inclusive authored ranges remain whole fields even when a field spans rows. */
export function parsePacketDiagram(input: readonly string[] | string, accessibility: Accessibility = {}): PacketBody {
  const scan = scanAccessibilityDirectives(typeof input === 'string' ? input.split(/\r?\n/) : [...input])
  const lines = [...scan.familyLines]
  while (lines.length && (!lines[0]!.trim() || lines[0]!.trim().startsWith('%%'))) lines.shift()
  const header = lines.shift() ?? ''
  observeParserStatement('packet', 'header', header, { line: 1, unit: 'normalized' })
  if (!/^packet(?:-beta)?\s*$/i.test(stripTrailingComment(header).trim())) throw syntaxError({ what: 'Invalid packet header', expectedForm: 'packet', example: 'packet\n+8: "Byte"' })
  const body: PacketBody = { kind: 'packet', fields: [], accessibilityTitle: accessibility.title ?? scan.accessibility.title, accessibilityDescription: accessibility.descr ?? scan.accessibility.descr }
  // STRING in the pinned Langium grammar accepts both quoting styles and escapes.
  const source = lines.join('\n')
  const token = /(?:title(?:[ \t]+([^\n]*))?(?:\n|$)|(\+)?(0|[1-9]\d*)[ \t]*(?:-[ \t]*(0|[1-9]\d*))?[ \t]*:[ \t]*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')[ \t]*(?:%%[^\n]*)?(?:\n|$))/gy
  let offset = 0,
    lastBit = -1,
    observationOffset = 0,
    observationLine = 2
  while (offset < source.length) {
    const trivia = /^(?:\s+|%%[^\n]*(?:\n|$))/.exec(source.slice(offset))
    if (trivia) {
      offset += trivia[0].length
      continue
    }
    token.lastIndex = offset
    const match = token.exec(source)
    if (!match) {
      if (!source.slice(offset).trim()) break
      throw syntaxError({ what: `Invalid packet statement: ${source.slice(offset).split('\n')[0]}`, expectedForm: 'start-end: "label" or +bits: "label"', example: '+16: "Source Port"' })
    }
    offset = token.lastIndex
    if (parserObservationActive('packet')) {
      // Observe each source character at most once, including quoted newlines.
      for (; observationOffset < match.index; observationOffset++) if (source.charCodeAt(observationOffset) === 10) observationLine++
      observeParserStatement('packet', match[2] === undefined && match[3] === undefined ? 'title' : 'field', match[0], { line: observationLine, offset: match.index, endOffset: token.lastIndex, unit: 'normalized' })
    }
    if (match[2] === undefined && match[3] === undefined) {
      body.title = stripTrailingComment(match[1] ?? '').trim()
      observeParserMutation('packet', 'set-title', body.title)
      continue
    }
    const number = Number(match[3]),
      relative = match[2] === '+'
    const start = relative ? lastBit + 1 : number
    const end = relative ? start + number - 1 : match[4] === undefined ? start : Number(match[4])
    if ((relative && match[4] !== undefined) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw syntaxError({ what: `Invalid packet bit range ${start}-${end}`, expectedForm: 'a positive bit count or increasing inclusive bit range', example: '+8: "Byte"' })
    if (start !== lastBit + 1) throw syntaxError({ what: `Packet block ${start}-${end} is not contiguous; it must start from ${lastBit + 1}`, expectedForm: `a field starting at ${lastBit + 1}`, example: `+8: "Next byte"` })
    let label = match[5]!.slice(1, -1)
    label = label.replace(/\\([\s\S])/g, (_all, character: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' })[character] ?? character)
    const field = { id: `field-${body.fields.length}`, start, end, label }
    body.fields.push(field)
    observeParserMutation('packet', 'add-field', field)
    assertDiagramWorkLimit('nodes', body.fields.length)
    lastBit = end
  }
  return body
}
