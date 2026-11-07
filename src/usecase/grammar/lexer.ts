// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { isBlank, isDigit, isHex, isLetter, PeleError, written } from './support.ts'
import { T } from './tokens.ts'

export interface Tokens {
  types: number[]
  starts: number[]
  ends: number[]
}

const WORD = 1
const PUNCTUATION = 2

const CLASS = new Uint8Array(128)
for (let c = 48; c <= 57; c++) CLASS[c]! = WORD
for (let c = 65; c <= 90; c++) CLASS[c]! = CLASS[c + 32]! = WORD
CLASS[95]! = WORD
for (const ch of '!#$&*+/=?^|~') CLASS[ch.charCodeAt(0)]! = PUNCTUATION

const KEYWORD_LENGTH = [0, 12, 5, 14, 3, 9, 2, 2, 2, 2, 2, 4, 3, 4, 8, 5, 5, 7, 6, 4, 5]

function isWord(c: number): boolean {
  return c < 128 && (CLASS[c]! & WORD) !== 0
}

// Mermaid's INCLUDE and EXTEND are the only keywords matched without regard to case.
function startsWithNoCase(src: string, at: number, word: string): boolean {
  for (let k = 0; k < word.length; k++) if ((src.charCodeAt(at + k) | 32) !== word.charCodeAt(k)) return false
  return true
}

// The keyword that is a prefix of the text at `at`, tried in the order of Mermaid's token list.
function keywordAt(src: string, at: number, c: number): number {
  switch (c) {
    case 97:
      return src.startsWith('actor', at) ? T.ACTOR : 0
    case 115:
      return src.startsWith('systemBoundary', at) ? T.SYSTEM_BOUNDARY : src.startsWith('style', at) ? T.STYLE : 0
    case 101:
      return src.startsWith('end', at) ? T.END : startsWithNoCase(src, at, 'extend') ? T.EXTEND : 0
    case 69:
      return startsWithNoCase(src, at, 'extend') ? T.EXTEND : 0
    case 100:
      return src.startsWith('direction', at) ? T.DIRECTION : 0
    case 84:
      return src.startsWith('TD', at) ? T.TD : src.startsWith('TB', at) ? T.TB : 0
    case 66:
      return src.startsWith('BT', at) ? T.BT : 0
    case 76:
      return src.startsWith('LR', at) ? T.LR : 0
    case 82:
      return src.startsWith('RL', at) ? T.RL : 0
    case 110:
      return src.startsWith('note', at) ? T.NOTE : 0
    case 102:
      return src.startsWith('for', at) ? T.FOR : src.startsWith('false', at) ? T.FALSE : 0
    case 106:
      return src.startsWith('json', at) ? T.JSON : 0
    case 99:
      return src.startsWith('classDef', at) ? T.CLASS_DEF : src.startsWith('class', at) ? T.CLASS : 0
    case 105:
    case 73:
      return startsWithNoCase(src, at, 'include') ? T.INCLUDE : 0
    case 116:
      return src.startsWith('true', at) ? T.TRUE : 0
    case 117:
      return src.startsWith('usecase-beta', at) ? T.USECASE : 0
    default:
      return 0
  }
}

export function lineColumn(src: string, offset: number): [number, number] {
  ;[src, offset] = written(src, offset)
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset; i++) {
    const c = src.charCodeAt(i)
    if (c !== 10 && c !== 13) continue
    if (c === 13 && i + 1 < offset && src.charCodeAt(i + 1) === 10) i++
    line++
    lineStart = i + 1
  }
  return [line, offset - lineStart + 1]
}

export function locationText(src: string, start: number, end: number): string {
  const [line, column] = lineColumn(src, start)
  return `line ${line}, column ${column} [${written(src, start)[1]!},${written(src, end)[1]!})`
}

// The end of a quoted string that opens at `at`, or -1 when the line ends first.
function stringEnd(src: string, at: number, quote: number): number {
  for (let k = at + 1; k < src.length; k++) {
    const c = src.charCodeAt(k)
    if (c === quote) return k + 1
    if (c === 10 || c === 13) return -1
  }
  return -1
}

function startsToken(src: string, at: number): boolean {
  const c = src.charCodeAt(at)
  if (c !== 34 && c !== 39) return true
  return (c === 34 && src.charCodeAt(at + 1) === 96) || stringEnd(src, at, c) !== -1
}

// Mermaid reports the first character no token starts with, and how many characters its lexer
// skipped before one did.
function lexError(src: string, offset: number, length: number): PeleError {
  const [line, column] = lineColumn(src, offset)
  const [from, to] = [written(src, offset)[1]!, written(src, offset + length)[1]!]
  return new PeleError(`Error lexing usecase diagram: unexpected character: ->${src.charAt(offset)}<- at offset: ${from}, skipped ${to - from} characters. at line ${line}, column ${column} [${from},${to})`, 'syntax', { type: 'usecase', line, column })
}

// Produces the tokens of Mermaid's Chevrotain lexer for use case diagrams: the first pattern in
// its list that matches wins, a keyword gives way to a longer identifier, and `json id@` and `<<`
// switch to modes that read a JSON object and a stereotype.
export function tokenize(src: string): Tokens {
  const types: number[] = []
  const starts: number[] = []
  const ends: number[] = []
  const n = src.length
  let i = 0
  // Whether only blanks came before on this line, where comments and accessibility lines may start.
  let lineStart = true
  let noBrace = false

  while (i < n) {
    const c = src.charCodeAt(i)
    if (c === 32 || c === 9) {
      i++
      continue
    }
    let type: number
    let end = i + 1
    let fresh = false

    if (c < 128 && (CLASS[c]! & WORD) !== 0) {
      type = 0
      if (c === 97 && lineStart && src.startsWith('acc', i)) {
        const descr = src.startsWith('Descr', i + 3)
        if (descr || src.startsWith('Title', i + 3)) {
          let j = i + 8
          while (isBlank(src.charCodeAt(j))) j++
          const next = src.charCodeAt(j)
          if (next === 58) {
            type = descr ? T.ACC_DESCR_LINE : T.ACC_TITLE_LINE
            end = j + 1
            while (end < n && src.charCodeAt(end) !== 10 && src.charCodeAt(end) !== 13) end++
          } else if (next === 123 && descr && !noBrace) {
            const close = src.indexOf('}', j + 1)
            if (close === -1) noBrace = true
            else {
              type = T.ACC_DESCR_BLOCK
              end = close + 1
            }
          }
        }
      } else if (c === 106 && src.startsWith('json', i) && isBlank(src.charCodeAt(i + 4))) {
        let j = i + 5
        while (isBlank(src.charCodeAt(j))) j++
        const id = j
        while (isWord(src.charCodeAt(j))) j++
        if (j > id) {
          while (isBlank(src.charCodeAt(j))) j++
          if (src.charCodeAt(j) === 64) {
            j++
            while (isBlank(src.charCodeAt(j))) j++
            if (src.charCodeAt(j) === 123) {
              types.push(T.JSON_DECLARATION_START)
              starts.push(i)
              ends.push(j)
              i = j
              let depth = 0
              let quoted = false
              let escaped = false
              let k = j
              for (; k < n; k++) {
                const ch = src.charCodeAt(k)
                if (quoted) {
                  if (escaped) escaped = false
                  else if (ch === 92) escaped = true
                  else if (ch === 34) quoted = false
                } else if (ch === 34) quoted = true
                else if (ch === 123) depth++
                else if (ch === 125 && --depth === 0) break
              }
              types.push(k < n ? T.JSON_OBJECT_LITERAL : T.UNCLOSED_JSON_OBJECT_LITERAL)
              starts.push(j)
              i = k < n ? k + 1 : n
              ends.push(i)
              lineStart = false
              continue
            }
          }
        }
      }
      if (type === 0) {
        while (end < n && isWord(src.charCodeAt(end))) end++
        const keyword = keywordAt(src, i, c)
        if (keyword !== 0) {
          // A keyword that is only the start of a longer word is an identifier.
          if (keyword === T.USECASE || end - i === KEYWORD_LENGTH[keyword]!) {
            type = keyword
            end = i + KEYWORD_LENGTH[keyword]!
          } else type = T.IDENTIFIER
        } else if ((c === 111 || c === 120) && src.charCodeAt(i + 1) === 45 && src.charCodeAt(i + 2) === 45) {
          type = c === 111 ? T.BACKWARD_CIRCLE : T.BACKWARD_CROSS
          end = i + 3
        } else if (isDigit(c)) {
          // `1mg` is an identifier, and `1.5px` is a number because the identifier stops at the dot.
          let digits = i + 1
          while (isDigit(src.charCodeAt(digits))) digits++
          if (src.charCodeAt(digits) === 46 && isDigit(src.charCodeAt(digits + 1))) {
            type = T.NUMBER
            end = digits + 2
            while (isDigit(src.charCodeAt(end))) end++
            while (isLetter(src.charCodeAt(end))) end++
          } else type = T.IDENTIFIER
        } else {
          type = T.IDENTIFIER
          while (src.charCodeAt(end) === 45 && isWord(src.charCodeAt(end + 1))) {
            type = T.CSS_IDENTIFIER
            end += 2
            while (isWord(src.charCodeAt(end))) end++
          }
        }
      }
    } else if (c === 10) {
      type = T.NEWLINE
      fresh = true
    } else if (c === 13) {
      type = T.NEWLINE
      fresh = true
      if (src.charCodeAt(end) === 10) end++
    } else if (c === 34 || c === 39) {
      if (c === 34 && src.charCodeAt(i + 1) === 96) {
        const close = src.indexOf('`"', i + 2)
        type = close === -1 ? T.UNCLOSED_MARKDOWN_STRING : T.MARKDOWN_STRING
        end = close === -1 ? n : close + 2
      } else {
        type = T.PLAIN_STRING
        end = stringEnd(src, i, c)
        if (end === -1) {
          let resume = i + 1
          while (resume < n && !startsToken(src, resume)) resume++
          throw lexError(src, i, resume - i)
        }
      }
    } else if (c === 37) {
      if (lineStart && src.charCodeAt(end) === 37) {
        type = T.COMMENT
        while (end < n && src.charCodeAt(end) !== 10 && src.charCodeAt(end) !== 13) end++
      } else type = T.PERCENT
    } else if (c === 45) {
      if (src.charCodeAt(end) !== 45) type = T.DASH
      else {
        while (src.charCodeAt(end) === 45) end++
        const next = src.charCodeAt(end)
        const two = end - i === 2
        if (two && next === 124 && src.charCodeAt(end + 1) === 62) {
          type = T.GENERALIZATION
          end += 2
        } else if (next === 62) {
          type = T.FORWARD_SOLID
          end++
        } else if (two && (next === 111 || next === 120)) {
          type = next === 111 ? T.FORWARD_CIRCLE : T.FORWARD_CROSS
          end++
        } else type = T.MARKERLESS_SOLID
      }
    } else if (c === 46) {
      const next = src.charCodeAt(end)
      if (next === 46 && src.charCodeAt(end + 1) === 62) {
        type = T.DEPENDENCY_ARROW
        end += 2
      } else if (isDigit(next)) {
        type = T.NUMBER
        while (isDigit(src.charCodeAt(end))) end++
        while (isLetter(src.charCodeAt(end))) end++
      } else type = T.DOT
    } else if (c === 60) {
      if (src.charCodeAt(end) === 60) {
        types.push(T.STEREOTYPE_START)
        starts.push(i)
        ends.push(i + 2)
        lineStart = false
        i += 2
        if (i >= n) break
        if (src.charCodeAt(i) === 62 && src.charCodeAt(i + 1) === 62) {
          type = T.STEREOTYPE_END
          end = i + 2
        } else {
          let close = i
          let found = false
          for (; close < n; close++) {
            const ch = src.charCodeAt(close)
            if (ch === 10 || ch === 13) break
            if (ch === 62 && src.charCodeAt(close + 1) === 62) {
              found = true
              break
            }
          }
          if (found && src.slice(i, close).trim() !== '') {
            types.push(T.STEREOTYPE_TEXT)
            starts.push(i)
            ends.push(close)
            type = T.STEREOTYPE_END
            i = close
            end = close + 2
          } else {
            while (close < n && src.charCodeAt(close) !== 10 && src.charCodeAt(close) !== 13) close++
            if (close === i) {
              while (close < n && (src.charCodeAt(close) === 10 || src.charCodeAt(close) === 13)) close++
              throw lexError(src, i, close - i)
            }
            type = T.UNCLOSED_STEREOTYPE_TEXT
            end = close
          }
        }
      } else if (src.charCodeAt(end) === 45 && src.charCodeAt(end + 1) === 45) {
        type = T.BACKWARD_SOLID
        end += 2
        while (src.charCodeAt(end) === 45) end++
      } else type = T.LABEL_PUNCTUATION
    } else if (c === 58) {
      if (src.charCodeAt(end) === 58 && src.charCodeAt(end + 1) === 58) {
        type = T.CLASS_SEPARATOR
        end += 2
      } else type = T.COLON
    } else if (c === 64) {
      if (src.charCodeAt(end) === 123) {
        type = T.METADATA_START
        end++
      } else type = T.AT
    } else if (c === 123) type = T.LBRACE
    else if (c === 125) type = T.RBRACE
    else if (c === 91) type = T.LBRACKET
    else if (c === 93) type = T.RBRACKET
    else if (c === 40) type = T.LPAREN
    else if (c === 41) type = T.RPAREN
    else if (c === 44) type = T.COMMA
    else if (c === 35) {
      while (isHex(src.charCodeAt(end))) end++
      type = end > i + 1 ? T.HASH_COLOR : T.CSS_PUNCTUATION
    } else if (c === 92) {
      if (src.charCodeAt(end) === 44) {
        type = T.CSS_ESCAPED_COMMA
        end++
      } else type = T.LABEL_PUNCTUATION
    } else if (c < 127 && c > 32) {
      type = (CLASS[c]! & PUNCTUATION) !== 0 ? T.CSS_PUNCTUATION : T.LABEL_PUNCTUATION
    } else {
      type = T.LABEL_SYMBOL
      while (end < n) {
        const ch = src.charCodeAt(end)
        if ((ch >= 32 && ch < 127) || ch === 9 || ch === 10 || ch === 13) break
        end++
      }
    }

    types.push(type)
    starts.push(i)
    ends.push(end)
    i = end
    lineStart = fresh
  }

  for (let k = 0; k < 3; k++) {
    types.push(T.EOF)
    starts.push(n)
    ends.push(n)
  }
  return { types, starts, ends }
}
