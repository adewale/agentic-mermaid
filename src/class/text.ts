import type { ClassMember } from './types.ts'
import { normalizeBrTags } from '../multiline-utils.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'
import { encodeMermaidAuthoredEntities, encodeMermaidEntities } from '../shared/mermaid-entities.ts'
import { prepareDisplayText, replaceDisplayTextTokens, type LabelContent } from '../shared/display-text.ts'

const CLASS_TEXT_TOKENS = /&#(?:\d+|[xX][0-9a-fA-F]+);|#\w+;/g
const CLASS_DIRECTION_TOKEN = /direction(?=\s+(?:TB|BT|RL|LR))/
export const hasClassDirectionToken = (text: string): boolean => CLASS_DIRECTION_TOKEN.test(text)
const decodeClassToken = (text: string): string => text.startsWith('&') ? text : decodeMermaidEntities(text, { subject: 'Class text entity', example: 'class A["I #9829; UML"]' })

/** Literal contexts call this only after their own grammar and display
 * punctuation have been read; generated characters cannot become syntax. */
export function decodeClassText(text: string): string {
  return text.replace(CLASS_TEXT_TOKENS, decodeClassToken)
}

/** Class text is lexed before entity expansion. Formatting belongs to the
 * authored payload: an entity-produced tag or asterisk remains literal. */
export function classTextLabel(authored: string, normalize = true, normalizeDisplay = true): { label: string; labelContent?: LabelContent } {
  const normalized = normalize ? normalizeBrTags(authored) : authored
  // XML character references belong to the existing source wrapper; they
  // must not be promoted into the later Mermaid entity layer here.
  const label = decodeClassText(normalized)
  if (!/#\w+;/.test(authored)) return { label }
  const prepared = replaceDisplayTextTokens(prepareDisplayText(normalizeDisplay ? normalizeBrTags(authored) : authored), CLASS_TEXT_TOKENS, decodeClassToken)
  return { label, labelContent: { value: label, prepared, authored } }
}

/** Encode only the grammar layer, retaining the family's existing authored
 * formatting policy. Parsed entity tokens are safe to retain only while the
 * public string still matches their snapshot. */
export function writeClassText(text: string, content?: LabelContent, reserved = '"'): string {
  const authored = content?.value === text ? content.authored : undefined
  return (authored === undefined ? encodeMermaidEntities(text, reserved) : encodeMermaidAuthoredEntities(authored, reserved))
    .replace(/\r\n?|\n/g, '<br/>')
    // Mermaid removes a `%%{…}%%` directive from the source before it reads
    // text; `#123;` reads as the brace.
    .replace(/%%\{/g, '%%#123;')
    // The initial Class lexer greedily takes an entire line containing this
    // token, before it can enter a quoted label or namespace string state.
    .replace(new RegExp(CLASS_DIRECTION_TOKEN.source, 'g'), word => `#${word.codePointAt(0)!};${word.slice(1)}`)
}

/** Convert a class member to its display string */
export function memberToString(m: ClassMember): string {
  if (!m.isMethod && m.sourceText) {
    const visibility = m.visibility && m.sourceText.startsWith(m.visibility) ? m.visibility : ''
    return decodeClassText(visibility + formatGenericMemberText(m.sourceText.slice(visibility.length)))
  }
  const vis = m.visibility ? `${m.visibility} ` : ''
  const name = m.isMethod ? `${m.name}(${m.params || ''})` : m.name
  const type = m.type ? `: ${m.type}` : ''
  return decodeClassText(`${vis}${name}${type}`)
}

/** Match Mermaid's outside-in tilde pairing, including nested generic types. */
function formatGenericMemberText(input: string): string {
  const sets = input.split(/(,)/)
  const output: string[] = []
  // Pair comma-separated generic arguments before formatting. In particular,
  // never pop a formatted output segment based on a raw input index: after one
  // pair is consumed those indexes no longer refer to the same output entry.
  for (let i = 0; i < sets.length; i += 2) {
    let set = sets[i]!
    let tildes = countTildes(set)
    while (tildes % 2 !== 0 && i + 2 < sets.length) {
      const next = sets[i + 2]!
      set += `,${next}`
      tildes += countTildes(next)
      i += 2
    }
    output.push(formatGenericSet(set))
    if (i + 1 < sets.length) output.push(',')
  }
  return output.join('')
}

function countTildes(input: string): number {
  let count = 0
  for (const char of input) if (char === '~') count++
  return count
}

function formatGenericSet(input: string): string {
  const chars = [...input]
  const tildes: number[] = []
  for (let i = 0; i < chars.length; i++) if (chars[i] === '~') tildes.push(i)
  if (tildes.length <= 1) return input
  // A leading odd tilde is UML's private visibility marker, not a bracket.
  const first = tildes.length % 2 !== 0 && chars[0] === '~' ? 1 : 0
  for (let left = first, right = tildes.length - 1; left < right; left++, right--) {
    chars[tildes[left]!] = '<'
    chars[tildes[right]!] = '>'
  }
  return chars.join('')
}
