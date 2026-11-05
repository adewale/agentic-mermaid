// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { syntaxError } from './grammar-reader-error.ts'

// Tokenizer for the diagram types Mermaid defines with Langium grammars. Token types are tried
// in order and the first match wins, as in Chevrotain; the tables in each diagram's folder are
// checked against Mermaid's generated lexers by the tests.

export interface TokenType {
  name: string
  // A literal string, or a regular expression with the sticky flag.
  pattern: string | RegExp
  hidden?: boolean
  // Start of a construct that needs a closer. When this matches but the whole pattern does not,
  // no closer exists in the rest of the text, so the pattern is not tried again.
  opener?: RegExp
  // Every ASCII character a match of a regular expression can start with, when that is known.
  // The type is then tried only at those characters and at characters outside ASCII.
  first?: string
  // Chevrotain's LONGER_ALT. When this type matches, these are tried at the same place, and the
  // first one that matches more text becomes the token.
  longer?: readonly TokenType[]
  // Makes a matcher that answers as `pattern` does, for a pattern that could rescan the text.
  // It is called once per text, so the matcher may remember what it has scanned. The matcher
  // returns the end of the match, or -1.
  scanner?: () => Scanner
  // Matches in place of the pattern, for a pattern that would rescan text from every position
  // or that depends on the token before it. Returns the end of the match, or -1.
  match?: Scanner
}

// `previous` is the last visible token's type index, or -1 at the start.
export type Scanner = (src: string, at: number, previous: number) => number

export interface Tokens {
  kinds: number[]
  starts: number[]
  ends: number[]
  src: string
}

interface Table {
  // For each ASCII character, the token types that can start with it, in matching order.
  starting: number[][]
  every: number[]
  longer: (number[] | undefined)[]
}

const tables = new WeakMap<readonly TokenType[], Table>()

function prepare(types: readonly TokenType[]): Table {
  const every = types.map((_, k) => k)
  const starting: number[][] = []
  for (let c = 0; c < 128; c++) {
    const ch = String.fromCharCode(c)
    starting.push(
      every.filter(k => {
        const { pattern, first } = types[k]!
        return typeof pattern === 'string' ? pattern[0] === ch : first === undefined || first.includes(ch)
      }),
    )
  }
  const table = { starting, every, longer: types.map(type => type.longer?.map(alt => types.indexOf(alt))) }
  tables.set(types, table)
  return table
}

export function tokenize(src: string, types: readonly TokenType[], diagram: string): Tokens {
  const kinds: number[] = []
  const starts: number[] = []
  const ends: number[] = []
  const dead = new Uint8Array(types.length)
  const { starting, every, longer } = tables.get(types) ?? prepare(types)
  const scanners: (Scanner | undefined)[] = []
  const n = src.length

  const match = (k: number, p: number): number => {
    if (dead[k]) return -1
    const type = types[k]!
    if (type.match !== undefined) return type.match(src, p, kinds[kinds.length - 1] ?? -1)
    if (type.scanner !== undefined) return (scanners[k] ??= type.scanner())(src, p, kinds[kinds.length - 1] ?? -1)
    const pattern = type.pattern
    if (typeof pattern === 'string') return src.startsWith(pattern, p) ? p + pattern.length : -1
    pattern.lastIndex = p
    if (pattern.test(src)) return pattern.lastIndex
    if (type.opener !== undefined) {
      type.opener.lastIndex = p
      if (type.opener.test(src)) dead[k] = 1
    }
    return -1
  }

  let p = 0
  scan: while (p < n) {
    const c = src.charCodeAt(p)
    for (const k of c < 128 ? starting[c]! : every) {
      let end = match(k, p)
      if (end <= p) continue
      let kind = k
      const alts = longer[k]
      if (alts !== undefined) {
        for (const alt of alts) {
          const altEnd = match(alt, p)
          if (altEnd > end) {
            kind = alt
            end = altEnd
            break
          }
        }
      }
      if (!types[kind]!.hidden) {
        kinds.push(kind)
        starts.push(p)
        ends.push(end)
      }
      p = end
      continue scan
    }
    throw syntaxError(diagram, src, p, '', true)
  }
  kinds.push(-1)
  starts.push(n)
  ends.push(n)
  return { kinds, starts, ends, src }
}

export const ACC_DESCR: TokenType = {
  name: 'ACC_DESCR',
  pattern: /[\t ]*accDescr(?:[\t ]*:([^\n\r]*?(?=%%)|[^\n\r]*)|\s*{([^}]*)})/y,
  first: '\t a',
}
export const ACC_TITLE: TokenType = {
  name: 'ACC_TITLE',
  pattern: /[\t ]*accTitle[\t ]*:(?:[^\n\r]*?(?=%%)|[^\n\r]*)/y,
  first: '\t a',
}
export const TITLE: TokenType = {
  name: 'TITLE',
  pattern: /[\t ]*title(?:[\t ][^\n\r]*?(?=%%)|[\t ][^\n\r]*|)/y,
  first: '\t t',
}
// `rest` matches a name suffix so `title` does not split longer names.
export function titleBefore(rest: string): TokenType {
  return { ...TITLE, pattern: new RegExp(String.raw`[\t ]*title(?:[\t ][^\n\r]*?(?=%%)|[\t ][^\n\r]*|(?!${rest}))`, 'y') }
}
export const STRING: TokenType = { name: 'STRING', pattern: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/y, first: `"'` }
export const NEWLINE: TokenType = { name: 'NEWLINE', pattern: /\r?\n/y, first: '\r\n' }
export const WHITESPACE: TokenType = { name: 'WHITESPACE', pattern: /[\t ]+/y, hidden: true, first: '\t ' }
export const YAML: TokenType = {
  name: 'YAML',
  pattern: /---[\t ]*\r?\n(?:[\S\s]*?\r?\n)?---(?:\r?\n|(?!\S))/y,
  hidden: true,
  opener: /---[\t ]*\r?\n/y,
  first: '-',
}
export const DIRECTIVE: TokenType = {
  name: 'DIRECTIVE',
  pattern: /[\t ]*%%{[\S\s]*?}%%(?:\r?\n|(?!\S))/y,
  hidden: true,
  opener: /[\t ]*%%{/y,
  first: '\t %',
}
export const SINGLE_LINE_COMMENT: TokenType = {
  name: 'SINGLE_LINE_COMMENT',
  pattern: /[\t ]*%%[^\n\r]*/y,
  first: '\t %',
  hidden: true,
}

// Mermaid ends a keyword only at whitespace, a comment, or the end of input.
export function keyword(word: string): TokenType {
  return {
    name: word,
    pattern: new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:(?=%%)|(?!\\S))', 'y'),
    first: word[0],
  }
}

const RE_ACC_DESCR = /accDescr(?:[\t ]*:([^\n\r]*)|\s*{([^}]*)})/
const RE_ACC_TITLE = /accTitle[\t ]*:([^\n\r]*)/
const RE_TITLE = /title([\t ][^\n\r]*|)/

function single(text: string): string {
  return text.trim().replace(/[\t ]{2,}/gm, ' ')
}

export function titleValue(text: string): string {
  return single(RE_TITLE.exec(text)![1]!)
}

export function accTitleValue(text: string): string {
  return single(RE_ACC_TITLE.exec(text)![1]!)
}

export function accDescrValue(text: string): string {
  const m = RE_ACC_DESCR.exec(text)!
  if (m[1] !== undefined) return single(m[1])
  return m[2]!
    .replace(/^\s*/gm, '')
    .replace(/\s+$/gm, '')
    .replace(/[\t ]{2,}/gm, ' ')
    .replace(/[\n\r]{2,}/gm, '\n')
}

const ESCAPES = new Map([
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['v', '\v'],
  ['0', '\0'],
])

export function stringValue(text: string): string {
  if (!text.includes('\\')) return text.slice(1, -1)
  let out = ''
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i]!
    if (c === '\\') {
      const next = text[++i]!
      out += ESCAPES.get(next) ?? next
    } else {
      out += c
    }
  }
  return out
}

// Reads tokens for a hand-written parser, with Chevrotain-style messages on failure.
export class Reader {
  i = 0
  readonly kinds: number[]

  constructor(
    readonly tokens: Tokens,
    readonly types: readonly TokenType[],
    readonly diagram: string,
  ) {
    this.kinds = tokens.kinds
  }

  get kind(): number {
    return this.kinds[this.i] ?? -1
  }

  text(index = this.i): string {
    return this.tokens.src.slice(this.tokens.starts[index], this.tokens.ends[index])
  }

  take(): string {
    return this.text(this.i++)
  }

  accept(kind: number): boolean {
    if (this.kinds[this.i] !== kind) return false
    this.i++
    return true
  }

  expect(kind: number): string {
    if (this.kinds[this.i] !== kind) this.fail(`token of type '${this.types[kind]!.name}'`)
    return this.take()
  }

  fail(expected: string): never {
    const found = this.kind === -1 ? 'end of input' : `\`${this.text()}\``
    const { src, starts, ends } = this.tokens
    let at = starts[this.i]!
    if (this.kind === -1) {
      // Locate EOF errors after the last token, before trailing line breaks and hidden comments.
      let k = this.i
      while (k > 0 && src.slice(starts[k - 1], ends[k - 1]).trim() === '') k--
      if (k > 0) at = ends[k - 1]!
    }
    throw syntaxError(this.diagram, src, at, `Expecting ${expected} but found ${found}.`)
  }
}
