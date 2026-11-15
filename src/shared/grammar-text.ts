import { encodeMermaidEntities, fromEntityMarkers } from './mermaid-entities.ts'
import { decodeXML } from 'entities'

/** Read XML transport references inside a classified field, before its
 * formatting reader. Protected Mermaid escapes expand later, exactly once. */
export function readGrammarAuthoredText(value: string): string {
  return decodeXML(fromEntityMarkers(value))
}

// These characters cannot introduce our formatting tags, emphasis or line
// breaks. Decode them only after the owning grammar and formatting reader.
const NEUTRAL = new Set([...`#&:;,%{}"'\\\``, 'ﬂ', '¶'])
const NAMES: Readonly<Record<string, string>> = { amp: '&', quot: '"', apos: "'" }

export function readGrammarText(source: string, additionalEscapes = ''): string {
  const authored = fromEntityMarkers(source)
  return authored.replace(/#(\w+);/g, (token, code: string, offset: number) => {
    if (offset > 0 && authored[offset - 1] === '&') return token
    const value = NAMES[code] ?? (/^\d+$/.test(code) && Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : undefined)
    return value && (NEUTRAL.has(value) || additionalEscapes.includes(value) || offset === 0 && /^[A-Za-z]$/.test(value)) ? value : token
  })
}

/** Field punctuation is escaped independently of statement construction.
 * Existing entity-looking text is literal too: #35; must survive one read. */
export function writeGrammarText(value: string, reserved = '', keyword?: RegExp, additionalEscapes = ''): string {
  for (const character of reserved) if (!NEUTRAL.has(character) && !additionalEscapes.includes(character)) throw new TypeError('Grammar text escapes must be formatting-neutral or owned by the family text reader')
  let written = encodeMermaidEntities(value, '#&:' + reserved)
  if (keyword?.test(written)) written = `#${written.codePointAt(0)!};${written.slice(1)}`
  return written
}

export function readGrammarAccessibility(value: { title?: string; descr?: string }): { title?: string; descr?: string } {
  return {
    ...(value.title !== undefined ? { title: readGrammarText(value.title) } : {}),
    ...(value.descr !== undefined ? { descr: readGrammarText(value.descr) } : {}),
  }
}

export function readAuthoredGrammarAccessibility(value: { title?: string; descr?: string }): { title?: string; descr?: string } {
  return readGrammarAccessibility({
    ...(value.title !== undefined ? { title: readGrammarAuthoredText(value.title) } : {}),
    ...(value.descr !== undefined ? { descr: readGrammarAuthoredText(value.descr) } : {}),
  })
}

export function grammarAccessibilityFields(value: { accessibilityTitle?: string; accessibilityDescription?: string }) {
  return {
    ...(value.accessibilityTitle !== undefined ? { title: value.accessibilityTitle } : {}),
    ...(value.accessibilityDescription !== undefined ? { descr: value.accessibilityDescription } : {}),
  }
}
