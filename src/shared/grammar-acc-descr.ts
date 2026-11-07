// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { ACC_DESCR, type Scanner, type TokenType } from './grammar-reader.ts'

const RE_HEAD = /[\t ]*accDescr(?:[\t ]*:(?:[^\n\r]*?(?=%%)|[^\n\r]*)|\s*({))/y

// The braced form scans for its closing brace. Once none is found there is none further on,
// so later braced descriptions fail without scanning the rest of the text again.
function scanner(): Scanner {
  let unclosed = false
  return (src, at) => {
    RE_HEAD.lastIndex = at
    const m = RE_HEAD.exec(src)
    if (m === null) return -1
    const end = RE_HEAD.lastIndex
    if (m[1] === undefined) return end
    if (unclosed) return -1
    const close = src.indexOf('}', end)
    unclosed = close === -1
    return close + 1 || -1
  }
}

// The common accDescr terminal for grammars where lexing goes on after an `accDescr {` that never
// closes, because `accDescr` is also a name there. Each one would otherwise read to the end of the text.
export function accDescr(name = 'ACC_DESCR'): TokenType {
  return { ...ACC_DESCR, name, scanner }
}
