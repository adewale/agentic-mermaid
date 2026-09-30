/**
 * Mermaid entity codes (`#name;`, `#123;`), faithful to pinned Mermaid 11.16.
 *
 * Upstream runs `encodeEntities` over the whole source before any grammar
 * sees it (`utils.ts`, called from `Diagram.fromText`): it strips the last `;`
 * of qualifying `style`/`classDef` lines, then rewrites each `#\w+;` into an
 * opaque marker (`ﬂ°name¶ß`, or `ﬂ°°123¶ß` for digits). Grammars see markers
 * as ordinary text, so an entity code never closes a string, starts a comment
 * or separates statements. Only the final SVG resolves them: `decodeEntities`
 * turns markers into `&name;` / `&#123;` and the browser's HTML parser expands
 * those, so `#lt;` displays a literal `<`, never a tag.
 *
 * The layers, in upstream order:
 *   mermaidEntityPrepass(line)   the `style`/`classDef` semicolon strip
 *   toEntityMarkers(text)        `#…;` → markers; the form upstream's DB keys
 *   projectEntityMarkers(text)   markers → displayed characters
 *   decodeMermaidEntities(text)  toEntityMarkers, then projectEntityMarkers
 *   encodeMermaidEntities(text)  the writer: decodeMermaidEntities inverts it
 * The two display functions live in ./mermaid-entity-display.ts, which loads
 * the HTML5 named-reference table; this module (markers and the writer) does
 * not, so grammars can use it without pulling the table into their bundle.
 */

/** Characters an entity must never produce (C0 controls, DEL and C1). */
export const TERMINAL_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/

const ENTITY_CODE_RE = /#\w+;/g
/** Upstream's markers: `ﬂ°°123¶ß` (digits) or `ﬂ°name¶ß`. */
export const ENTITY_MARKER_RE = /ﬂ°°(\d+)¶ß|ﬂ°(\w+)¶ß/g

/**
 * Upstream's first `encodeEntities` step, per physical line: strip the last
 * `;` of a line where `style`/`classDef` precedes a `:` whose non-space run
 * reaches a `#` before that semicolon (`/style.*:\S*#.*;/`). It applies to any
 * line, quoted label text included, so identity must observe it.
 */
export function mermaidEntityPrepass(line: string): string {
  // The upstream greedy regex backtracks catastrophically on repeated
  // keyword/hash text. Its effect on one physical line is simply to strip
  // the last semicolon if a qualifying keyword/colon/hash chain exists.
  // JavaScript's `.` stops at all four line terminators, including U+2028
  // and U+2029 that can appear inside a quoted label without a physical LF.
  return line.replace(/[^\r\n\u2028\u2029]+/g, segment =>
    stripEntityPrepassSemicolon(stripEntityPrepassSemicolon(segment, 'style'), 'classDef'))
}

function stripEntityPrepassSemicolon(line: string, keyword: string): string {
  const lastSemicolon = line.lastIndexOf(';')
  if (lastSemicolon < 0 || !line.includes(keyword)) return line
  const viableFrom = new Uint8Array(line.length + 1)
  let nextHash = -1
  let viable = false
  for (let i = line.length - 1; i >= 0; i--) {
    const character = line[i]!
    if (/\s/.test(character)) nextHash = -1
    else if (character === '#') nextHash = i
    if (character === ':' && nextHash >= 0 && nextHash < lastSemicolon) viable = true
    viableFrom[i] = viable ? 1 : 0
  }
  for (let start = line.indexOf(keyword); start >= 0; start = line.indexOf(keyword, start + keyword.length)) {
    if (viableFrom[start + keyword.length] === 1) {
      return line.slice(0, lastSemicolon) + line.slice(lastSemicolon + 1)
    }
  }
  return line
}

/** Rewrite each `#name;` / `#123;` code to upstream's opaque marker. Two
 * spellings with one marker (`#35;` and a literal `ﬂ°°35¶ß`) are one key
 * upstream, so identity comparisons use this form. */
export function toEntityMarkers(text: string): string {
  return text.replace(ENTITY_CODE_RE, token => {
    const inner = token.slice(1, -1)
    return /^\+?\d+$/.test(inner) ? `ﬂ°°${inner}¶ß` : `ﬂ°${inner}¶ß`
  })
}

/** Spell markers back as the `#…;` codes they came from, for a grammar that
 * must read markers (YAML, where a bare `#` starts a comment) but hands the
 * text on in authored form. */
export function fromEntityMarkers(text: string): string {
  return text.replace(ENTITY_MARKER_RE, (_token, numeric: string | undefined, named: string | undefined) => `#${numeric ?? named};`)
}

const NAMED_ENTITY: Readonly<Record<string, string>> = { '"': 'quot', '&': 'amp', '<': 'lt', '>': 'gt' }

function entityFor(character: string): string {
  const named = NAMED_ENTITY[character]
  return named ? `#${named};` : `#${character.codePointAt(0)!};`
}

const WORD_RE = /\w/

/**
 * Write `text` so that `decodeMermaidEntities` reads it back exactly, and so
 * that upstream's own prepass and display do too. The encoding is canonical:
 * one spelling per text, and `text` itself when nothing needs escaping.
 *
 * Always escaped, because the entity layer would otherwise misread them:
 *   - a `#` that would start an entity code (`#\w+;`) → `#35;`;
 *   - `ﬂ` before `°` → `#64258;`, and `¶` before `ß` → `#182;`, so no marker
 *     is spelled literally (upstream replaces even lone `ﬂ°` and `¶ß` pieces).
 * `reserved` lists characters the grammar context cannot hold literally
 * (`"` in a quoted flowchart label, `;` or `#` in a sequence message). They
 * are written as entities: `#quot;`, `#amp;`, `#lt;`, `#gt;`, else `#<code>;`.
 * Upstream's prepass turns every entity into a marker before any grammar
 * runs, so an entity spelling never reintroduces a reserved character.
 * Terminal controls cannot be reserved: projection refuses their entities.
 */
export function encodeMermaidEntities(text: string, reserved = ''): string {
  const reservedSet = new Set(reserved)
  for (const character of reservedSet) {
    const code = character.codePointAt(0)!
    if (TERMINAL_CONTROL_RE.test(character) || (code >= 0xd800 && code <= 0xdfff)) {
      throw new RangeError(`encodeMermaidEntities cannot reserve U+${code.toString(16).toUpperCase().padStart(4, '0')}: no entity displays it`)
    }
  }
  const characters = [...text]
  const literal = (index: number): string | undefined => {
    const character = characters[index]
    return character !== undefined && !reservedSet.has(character) ? character : undefined
  }
  // Does the unreserved run after `#` at `index` read as `\w+;`?
  const startsEntityCode = (index: number): boolean => {
    let next = index + 1
    while (literal(next) !== undefined && WORD_RE.test(literal(next)!)) next++
    return next > index + 1 && literal(next) === ';'
  }
  let out = ''
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!
    if (reservedSet.has(character)) out += entityFor(character)
    else if (character === '#' && startsEntityCode(index)) out += entityFor('#')
    else if ((character === 'ﬂ' && literal(index + 1) === '°') || (character === '¶' && literal(index + 1) === 'ß')) out += entityFor(character)
    else out += character
  }
  return out
}
