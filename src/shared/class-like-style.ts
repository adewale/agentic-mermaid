import { tryParseCssColor } from './color-math.ts'
import { projectEntityMarkers } from './mermaid-entity-display.ts'
import { encodeMermaidEntities, toEntityMarkers } from './mermaid-entities.ts'
import { projectStyleDeclarations, type StyleDeclaration } from './style-props.ts'

const PAINT_PREFIX = /^\s*(?:fill|stroke|color)\s*:\s*$/

/** Class/State delimiters are classified before entities become payload.
 * Native CSS's trailing semicolon on a complete hex paint remains a CSS
 * delimiter; writers protect literal entity text so this is unambiguous. */
function classLikeStyleFields(source: string): string[] {
  const fields: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!
    // The global entity prepass precedes CSS escapes and quotes. Even an
    // escaped hash becomes a marker, and its semicolon is never punctuation.
    if (char === '#') {
      const entity = /^#\w+;/.exec(source.slice(index))?.[0]
      if (entity && !(PAINT_PREFIX.test(source.slice(start, index)) && tryParseCssColor(entity.slice(0, -1)) !== null)) {
        index += entity.length - 1
        escaped = false
        continue
      }
    }
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if ((char === ',' || char === ';') && depth === 0) { fields.push(source.slice(start, index)); start = index + 1 }
  }
  fields.push(source.slice(start))
  return fields
}

export function classLikeStyleHasValueCommas(source: string): boolean {
  return classLikeStyleFields(source).some(field => field.slice(field.indexOf(':') + 1).includes(','))
}

export function parseClassLikeStyleProps(source: string): Record<string, string> {
  return projectStyleDeclarations(parseClassLikeStyleDeclarations(source))
}

export function parseClassLikeStyleDeclarations(source: string): StyleDeclaration[] {
  const props: StyleDeclaration[] = []
  const read = (text: string) => projectEntityMarkers(toEntityMarkers(text), { subject: 'Style text entity', example: 'font-family: Inter#44;serif' })
  for (const field of classLikeStyleFields(source)) {
    const colon = field.indexOf(':')
    if (colon <= 0) continue
    const name = read(field.slice(0, colon).trim())
    const value = read(field.slice(colon + 1).trim().replace(/\\,/g, ','))
    if (name && value) props.push([name, value])
  }
  return props
}

/** Entity projection cannot retain these characters through an SVG attribute.
 * Refusal is a domain boundary, rather than a partial property rewrite. */
export function portableClassLikeStyleProps(style: Readonly<Record<string, string>>, declarations?: readonly StyleDeclaration[]): Record<string, string> | undefined {
  if (declarations !== undefined) {
    if (!Array.isArray(declarations) || declarations.some(entry => !Array.isArray(entry) || entry.length !== 2 || entry.some(text => typeof text !== 'string' || !text.trim()))) return
    const projected = Object.entries(projectStyleDeclarations(declarations))
    const entries = Object.entries(style)
    if (entries.length !== projected.length || entries.some(([key, value], index) => key !== projected[index]![0] || value !== projected[index]![1])) return
  }
  for (const [name, value] of declarations ?? Object.entries(style)) {
    for (const text of [name, value]) {
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff\r\n]/.test(text)) return
      for (const character of text) {
        const code = character.codePointAt(0)!
        if (code >= 0xd800 && code <= 0xdfff) return
      }
    }
  }
  return { ...style }
}

function writeStyleText(value: string): string {
  const text = encodeMermaidEntities(value, ',:;<>&%"\'\\\u2028\u2029')
  // Both lexers recognize this complete-line production before STYLE and
  // CLASSDEF, even when "direction" begins inside another word or value.
  return text.replace(/direction(?=\s+(?:TB|BT|RL|LR))/gi, word => `#${word.codePointAt(0)!};${word.slice(1)}`)
}

/** When any field needs entities, every syntax colon needs a space barrier:
 * an earlier plain hex paint can otherwise reach a later field's semicolon. */
export function serializeClassLikeStyleProps(style: Readonly<Record<string, string>>, emptyClassPrologue = false, declarations?: readonly StyleDeclaration[]): string {
  if (!portableClassLikeStyleProps(style, declarations)) throw new Error('Style contains unrepresentable text or inconsistent ordered declarations')
  const entries = (declarations ?? Object.entries(style)).map(([key, value]): StyleDeclaration => [key, value])
  // Class needs a word token before its first colon. An empty ordinary CSS
  // declaration sets no property; the complete authored sequence follows.
  if (emptyClassPrologue) entries.unshift(['style', ''])
  const fields = entries.map(([name, value]) => ({ name, value, key: writeStyleText(name), text: writeStyleText(value) }))
  const colon = fields.some(field => field.key !== field.name || field.text !== field.value) ? ': ' : ':'
  return fields.map(field => `${field.key}${colon}${field.text}`).join(',')
}

/** The family supplies a grammar-valid target; payload encoding and colon
 * barriers keep the complete statement unchanged by the global prepass. */
export function classLikeStyleStatement(prefix: string, style: Readonly<Record<string, string>>, emptyClassPrologue = false, declarations?: readonly StyleDeclaration[]): string {
  return prefix + serializeClassLikeStyleProps(style, emptyClassPrologue, declarations)
}
