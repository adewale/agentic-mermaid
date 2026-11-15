// Adapted from Pele (458322a5b8abb1ae57ddf127c32017ab9fb14a92), copyright (c) 2026 kepano.
// MIT license; see pele-license.txt in this directory.
import { T } from './tokens.ts'
import { isSpace, isWord } from './chars.ts'
export interface Tokens {
  types: number[]
  texts: string[]
  starts: number[]
}
const enum S {
  INITIAL,
  string,
  md_string,
  NODE,
  BLOCK_ARROW,
  ARROW_DIR,
  LLABEL,
  CLASSDEF,
  CLASSDEFID,
  CLASS,
  CLASS_STYLE,
  STYLE_STMNT,
  STYLE_DEFINITION,
  acc_title,
  acc_descr,
  acc_descr_multiline,
}
const DIRECTIONS = ['right', 'left', 'x', 'y', 'up', 'down']
// Characters that end a node id: ( ) [ { } < > - : = and whitespace.
const ID_STOP = new Uint8Array(128)
for (const c of [9, 10, 11, 12, 13, 32, 40, 41, 45, 58, 60, 61, 62, 91, 123, 125]) ID_STOP[c]! = 1
export function tokenize(src: string, onComment?: (start: number, end: number) => void): Tokens {
  const n = src.length
  const types: number[] = []
  const texts: string[] = []
  const starts: number[] = []
  const stack: number[] = []
  let state: number = S.INITIAL
  let p = 0
  const put = (type: number, text: string, end: number): true => {
    types.push(type)
    texts.push(text)
    starts.push(p)
    p = end
    return true
  }
  const emit = (type: number, end: number): true => put(type, src.slice(p, end), end)
  const push = (s: number): void => {
    stack.push(state)
    state = s
  }
  const pop = (): void => {
    if (stack.length > 0) state = stack.pop()!
  }
  const ws = (q: number): number => {
    while (q < n && isSpace(src.charCodeAt(q))) q++
    return q
  }
  const digits = (q: number): number => {
    while (q < n) {
      const c = src.charCodeAt(q)
      if (c < 48 || c > 57) break
      q++
    }
    return q
  }
  const word = (q: number): number => {
    while (q < n && isWord(src.charCodeAt(q))) q++
    return q
  }
  const keyword = (text: string): boolean => src.startsWith(text, p) && !isWord(src.charCodeAt(p + text.length))
  const quote = (): true => {
    if (src.charCodeAt(p + 1) === 96) {
      push(S.md_string)
      p += 2
    } else {
      push(S.string)
      p++
    }
    return true
  }
  // End of `.+-[xo>]?` at q, or -1.
  const dotted = (q: number): number => {
    if (src.charCodeAt(q) !== 46) return -1
    do q++
    while (src.charCodeAt(q) === 46)
    if (src.charCodeAt(q) !== 45) return -1
    const c = src.charCodeAt(q + 1)
    return c === 120 || c === 111 || c === 62 ? q + 2 : q + 1
  }
  // End of a complete link at q, before its trailing whitespace, or -1.
  const linkEnd = (q: number): number => {
    const c = src.charCodeAt(q)
    if (c === 120 || c === 111 || c === 60) q++
    const line = src.charCodeAt(q)
    if (line === 46) return dotted(q)
    if (line !== 45 && line !== 61) return -1
    let k = q + 1
    while (src.charCodeAt(k) === line) k++
    if (k - q === 1) return line === 45 ? dotted(k) : -1
    const head = src.charCodeAt(k)
    if (head === 120 || head === 111 || head === 62) return k + 1
    return k - q >= 3 ? k : -1
  }
  const link = (): boolean => {
    const e = linkEnd(p)
    if (e >= 0) return emit(T.LINK, ws(e))
    const q = src.charCodeAt(p) === 60 ? p + 1 : p
    const a = src.charCodeAt(q)
    const b = src.charCodeAt(q + 1)
    if ((a === 45 && (b === 45 || b === 46)) || (a === 61 && b === 61)) {
      push(S.LLABEL)
      return emit(T.START_LINK, ws(q + 2))
    }
    return false
  }
  const lineState = (type: number): true => {
    let e = src.indexOf('\n', p)
    if (e === -1) e = n
    pop()
    return emit(type, e)
  }
  // `\w+(,\s*\w+)*`
  const idList = (type: number, next: number): boolean => {
    let k = word(p)
    if (k === p) return false
    while (src.charCodeAt(k) === 44) {
      const from = ws(k + 1)
      const to = word(from)
      if (to === from) break
      k = to
    }
    state = next
    return emit(type, k)
  }
  const initial = (c: number): boolean => {
    if (c === 37 && src.charCodeAt(p + 1) === 37) {
      const end = src.indexOf('\n', p + 2)
      onComment?.(p, end < 0 ? n : end)
      p = end < 0 ? n : end
      return true
    }
    if (isSpace(c)) {
      p = ws(p + 1)
      return true
    }
    let q: number
    switch (c) {
      case 98:
        if (src.startsWith('block', p)) {
          if (keyword('block-beta')) return emit(T.KEY, p + 10)
          if (src.charCodeAt(p + 5) === 58) return emit(T.ID_BLOCK, p + 6)
          if (!isWord(src.charCodeAt(p + 5))) return emit(T.KEY, p + 5)
        }
        break
      case 99:
        if (src.startsWith('columns', p)) {
          q = ws(p + 7)
          if (q > p + 7) {
            if (src.startsWith('auto', q) && !isWord(src.charCodeAt(q + 4))) return put(T.COLUMNS, '-1', q + 4)
            const e = digits(q)
            if (e > q) return put(T.COLUMNS, src.slice(q, e), e)
          }
        } else if (src.startsWith('class', p)) {
          const def = src.startsWith('Def', p + 5)
          const from = def ? p + 8 : p + 5
          q = ws(from)
          if (q > from) {
            push(def ? S.CLASSDEF : S.CLASS)
            return emit(def ? T.CLASSDEF : T.CLASS, q)
          }
        }
        break
      case 34:
        return quote()
      case 115:
        if (src.startsWith('space', p)) {
          if (src.charCodeAt(p + 5) === 58) {
            const e = digits(p + 6)
            if (e > p + 6) return put(T.SPACE_BLOCK, src.slice(p + 6, e), e)
          }
          if (!isWord(src.charCodeAt(p + 5))) return put(T.SPACE_BLOCK, '1', p + 5)
        } else if (src.startsWith('style', p)) {
          q = ws(p + 5)
          if (q > p + 5) {
            push(S.STYLE_STMNT)
            return emit(T.STYLE, q)
          }
        }
        break
      case 100:
        if (keyword('default')) return emit(T.DEFAULT, p + 7)
        break
      case 108:
        if (keyword('linkStyle')) return emit(T.LINKSTYLE, p + 9)
        break
      case 105:
        if (keyword('interpolate')) return emit(T.INTERPOLATE, p + 11)
        break
      case 97:
        if (src.startsWith('accTitle', p)) {
          q = ws(p + 8)
          if (src.charCodeAt(q) === 58) {
            push(S.acc_title)
            return emit(T.acc_title, ws(q + 1))
          }
        } else if (src.startsWith('accDescr', p)) {
          q = ws(p + 8)
          const d = src.charCodeAt(q)
          if (d === 58) {
            push(S.acc_descr)
            return emit(T.acc_descr, ws(q + 1))
          }
          if (d === 123) {
            push(S.acc_descr_multiline)
            p = ws(q + 1)
            return true
          }
        }
        break
      case 101:
        if (keyword('end')) return emit(T.end, ws(p + 3))
        break
      case 45:
        if (src.charCodeAt(p + 1) === 41) {
          push(S.NODE)
          return emit(T.NODE_DSTART, p + 2)
        }
        return link()
      case 61:
        return link()
      case 60:
        if (src.charCodeAt(p + 1) === 91) {
          push(S.BLOCK_ARROW)
          return emit(T.BLOCK_ARROW_START, p + 2)
        }
        return link()
      case 40: {
        const d = src.charCodeAt(p + 1)
        const len = d === 45 || d === 91 ? 2 : d === 40 ? (src.charCodeAt(p + 2) === 40 ? 3 : 2) : 1
        push(S.NODE)
        return emit(T.NODE_DSTART, p + len)
      }
      case 41:
      case 123:
        push(S.NODE)
        return emit(T.NODE_DSTART, src.charCodeAt(p + 1) === c ? p + 2 : p + 1)
      case 62:
        push(S.NODE)
        return emit(T.NODE_DSTART, p + 1)
      case 91: {
        const d = src.charCodeAt(p + 1)
        push(S.NODE)
        return emit(T.NODE_DSTART, d === 91 || d === 124 || d === 40 || d === 92 || d === 47 ? p + 2 : p + 1)
      }
      case 58: {
        const e = digits(p + 1)
        if (e > p + 1) return put(T.SIZE, src.slice(p + 1, e), e)
        return false
      }
    }
    q = p
    while (q < n) {
      const ch = src.charCodeAt(q)
      if (ch < 128 ? ID_STOP[ch]! === 1 : isSpace(ch)) break
      q++
    }
    return q > p && emit(T.NODE_ID, q)
  }
  const nodeEnd = (c: number): boolean => {
    const d = src.charCodeAt(p + 1)
    let len = 0
    switch (c) {
      case 34:
        return quote()
      case 40:
        len = d === 45 ? 2 : d === 40 ? (src.charCodeAt(p + 2) === 40 ? 3 : 2) : 1
        break
      case 41:
        len = d === 41 ? (src.charCodeAt(p + 2) === 41 ? 3 : 2) : d === 93 ? 2 : 1
        break
      case 125:
        len = d === 125 ? 2 : 1
        break
      case 45:
        len = d === 41 ? 2 : 0
        break
      case 93:
        len = d === 93 || d === 41 || d === 62 ? 2 : 1
        break
      case 92:
      case 47:
        len = d === 93 ? 2 : 0
        break
    }
    if (len === 0) return false
    pop()
    return emit(T.NODE_DEND, p + len)
  }
  const arrowDir = (c: number): boolean => {
    if (c === 41) {
      pop()
      pop()
      return put(T.BLOCK_ARROW_END, ']>', ws(p + 1))
    }
    const from = ws(c === 44 ? p + 1 : p)
    for (const dir of DIRECTIONS) {
      if (src.startsWith(dir, from)) {
        const e = ws(from + dir.length)
        return put(T.DIR, src.slice(c === 44 ? from : p, e), e)
      }
    }
    return false
  }
  while (true) {
    if (p >= n) {
      let type = -1
      switch (state) {
        case S.INITIAL:
          type = T.EOF
          break
        case S.string:
          type = T.STR
          break
        case S.CLASSDEFID:
          type = T.CLASSDEF_STYLEOPTS
          break
        case S.CLASS_STYLE:
          type = T.STYLECLASS
          break
        case S.STYLE_DEFINITION:
          type = T.STYLE_DEFINITION_DATA
          break
        case S.acc_title:
          type = T.acc_title_value
          break
        case S.acc_descr:
          type = T.acc_descr_value
          break
        case S.acc_descr_multiline:
          type = T.acc_descr_multiline_value
          break
      }
      p = n
      if (type !== -1) put(type, '', n)
      break
    }
    const c = src.charCodeAt(p)
    let ok = true
    switch (state) {
      case S.INITIAL:
        ok = initial(c)
        break
      case S.string:
        if (c === 34) {
          pop()
          p++
        } else {
          const e = src.indexOf('"', p)
          emit(T.STR, e === -1 ? n : e)
        }
        break
      case S.md_string:
        if (c === 96) {
          ok = src.charCodeAt(p + 1) === 34
          if (ok) {
            pop()
            p += 2
          }
        } else if (c === 34) {
          ok = false
        } else {
          let q = p + 1
          while (q < n) {
            const ch = src.charCodeAt(q)
            if (ch === 96 || ch === 34) break
            q++
          }
          emit(T.MD_STR, q)
        }
        break
      case S.NODE:
        ok = nodeEnd(c)
        break
      case S.BLOCK_ARROW:
        if (c === 34) {
          quote()
        } else if (c === 93 && src.charCodeAt(p + 1) === 62) {
          const q = ws(p + 2)
          ok = src.charCodeAt(q) === 40
          if (ok) {
            push(S.ARROW_DIR)
            p = q + 1
          }
        } else {
          ok = false
        }
        break
      case S.ARROW_DIR:
        ok = arrowDir(c)
        break
      case S.LLABEL:
        if (c === 34) {
          if (src.charCodeAt(p + 1) === 96) {
            quote()
          } else {
            emit(T.LINK_LABEL, p + 1)
            push(S.string)
          }
        } else {
          const e = linkEnd(ws(p))
          ok = e >= 0
          if (ok) {
            pop()
            emit(T.LINK, ws(e))
          }
        }
        break
      case S.CLASSDEF: {
        let type = T.DEFAULT_CLASSDEF_ID
        let k = src.startsWith('DEFAULT', p) ? p + 7 : p
        let q = ws(k)
        if (k === p || q === k) {
          type = T.CLASSDEF_ID
          k = word(p)
          q = ws(k)
        }
        ok = k > p && q > k
        if (ok) {
          state = S.CLASSDEFID
          emit(type, q)
        }
        break
      }
      case S.CLASSDEFID:
        lineState(T.CLASSDEF_STYLEOPTS)
        break
      case S.CLASS:
        ok = idList(T.CLASSENTITY_IDS, S.CLASS_STYLE)
        break
      case S.CLASS_STYLE:
        lineState(T.STYLECLASS)
        break
      case S.STYLE_STMNT:
        ok = idList(T.STYLE_ENTITY_IDS, S.STYLE_DEFINITION)
        break
      case S.STYLE_DEFINITION:
        lineState(T.STYLE_DEFINITION_DATA)
        break
      case S.acc_title:
        lineState(T.acc_title_value)
        break
      case S.acc_descr:
        lineState(T.acc_descr_value)
        break
      case S.acc_descr_multiline:
        if (c === 125) {
          pop()
          p++
        } else {
          const e = src.indexOf('}', p)
          emit(T.acc_descr_multiline_value, e === -1 ? n : e)
        }
        break
    }
    if (!ok) {
      types.push(T.ERROR)
      texts.push('')
      starts.push(p)
      return { types, texts, starts }
    }
  }
  types.push(T.END)
  texts.push('')
  starts.push(n)
  return { types, texts, starts }
}
