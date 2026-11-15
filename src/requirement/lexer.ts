// Adapted from Pele (458322a5b8abb1ae57ddf127c32017ab9fb14a92), copyright (c) 2026 kepano.
// MIT license; see pele-license.txt in this directory.
import { KEYWORDS, T } from './tokens.ts'
import { isLineEnd, isSpace, isWord } from './chars.ts'
import { mermaidLineEnd } from '../shared/mermaid-cleanup.ts'
export interface Tokens {
  types: number[]
  texts: string[]
  starts: number[]
}

/** Characters the pin can produce as styleComponent tokens. Its style
 * state has no quoted-string, parenthesis, decimal-point or Unicode token;
 * a Mermaid entity marker cannot supply one after preprocessing. Commas
 * separate declarations and ASCII spaces are skipped by that lexer. */
export function requirementStyleTextCanSerialize(source: string): boolean {
  for (let p = 0; p < source.length; p++) {
    const c = source.charCodeAt(p)
    if (isWord(c)) continue
    switch (c) {
      case 32: case 35: case 44: case 45: case 58: case 59:
        continue
      default:
        return false
    }
  }
  return true
}
const enum S {
  INITIAL,
  string,
  style,
  acc_title,
  acc_descr,
  acc_descr_multiline,
}
const RE_ACC_TITLE = /accTitle\s*:\s*/iy
const RE_ACC_DESCR = /accDescr\s*:\s*/iy
const RE_ACC_DESCR_ML = /accDescr\s*\{\s*/iy
const RE_DIRECTION = /direction\s+(?:(TB)|(BT)|(RL)|LR)/gi
const RE_LINE_END = /[\n\r\u2028\u2029]/g
const LONGEST_KEYWORD = 22
// Characters that end an unquoted string: `:,{<>-=` and line breaks.
const STOP = new Uint8Array(128)
for (const ch of ':,\r\n{<>-=') STOP[ch.charCodeAt(0)]! = 1
// Produces the token stream of Mermaid's requirement lexer. Its rules are tried in order and
// the first match wins, so a line that holds a direction statement anywhere is one token.
export function tokenize(src: string, onComment?: (start: number, end: number) => void): Tokens {
  const n = src.length
  const types: number[] = []
  const texts: string[] = []
  const starts: number[] = []
  const stack: number[] = []
  let state: number = S.INITIAL
  let styleValue = false
  let p = 0
  // Where each kind of direction statement starts and where its keyword ends, found in one pass.
  const dirStarts: number[][] = [[], [], [], []]
  const dirEnds: number[][] = [[], [], [], []]
  const dirSeen = [0, 0, 0, 0]
  let anyDir = false
  let lineEnd = -1
  RE_DIRECTION.lastIndex = 0
  for (let m = RE_DIRECTION.exec(src); m !== null; m = RE_DIRECTION.exec(src)) {
    const kind = m[1]! !== undefined ? 0 : m[2]! !== undefined ? 1 : m[3]! !== undefined ? 2 : 3
    dirStarts[kind]!.push(m.index)
    dirEnds[kind]!.push(RE_DIRECTION.lastIndex)
    anyDir = true
  }
  const emit = (type: number, s: number, e: number): void => {
    types.push(type)
    texts.push(src.slice(s, e))
    starts.push(s)
    p = e
  }
  const push = (s: number): void => {
    stack.push(state)
    state = s
  }
  const pop = (): void => {
    if (stack.length > 0) state = stack.pop()!
  }
  const at = (re: RegExp, q: number): number => {
    re.lastIndex = q
    return re.test(src) ? re.lastIndex : -1
  }
  const lineBreak = (q: number): number => {
    const e = mermaidLineEnd(src, q)
    return e === -1 ? n : e
  }
  // `.*direction\s+XX[^\n]*`: the last such statement that starts on this line decides the token.
  const direction = (): boolean => {
    if (lineEnd < p) {
      RE_LINE_END.lastIndex = p
      lineEnd = RE_LINE_END.test(src) ? RE_LINE_END.lastIndex - 1 : n
      for (let k = 0; k < 4; k++) {
        const list = dirStarts[k]!
        let j = dirSeen[k]!
        while (j < list.length && list[j]! <= lineEnd) j++
        dirSeen[k]! = j
      }
    }
    for (let k = 0; k < 4; k++) {
      const j = dirSeen[k]! - 1
      if (j >= 0 && dirStarts[k]![j]! >= p) {
        emit(T.direction_tb + k, p, lineBreak(dirEnds[k]![j]!))
        return true
      }
    }
    return false
  }
  const initial = (c: number): boolean => {
    const lower = c | 32
    if (lower === 116 && src.slice(p + 1, p + 5).toLowerCase() === 'itle' && isSpace(src.charCodeAt(p + 5))) {
      let q = p + 6
      while (q < n) {
        const d = src.charCodeAt(q)
        if (d === 35 || d === 10 || d === 13 || d === 59) break
        q++
      }
      if (q > p + 6) {
        emit(T.title, p, q)
        return true
      }
    }
    if (lower === 97 && (src.charCodeAt(p + 1) | 32) === 99 && (src.charCodeAt(p + 2) | 32) === 99) {
      let e: number
      if ((e = at(RE_ACC_TITLE, p)) >= 0) {
        push(S.acc_title)
        emit(T.acc_title, p, e)
        return true
      }
      if ((e = at(RE_ACC_DESCR, p)) >= 0) {
        push(S.acc_descr)
        emit(T.acc_descr, p, e)
        return true
      }
      if ((e = at(RE_ACC_DESCR_ML, p)) >= 0) {
        push(S.acc_descr_multiline)
        p = e
        return true
      }
    }
    if (anyDir && !isLineEnd(c) && direction()) return true
    if (c === 10 || c === 13) {
      let q = p
      while (q < n) {
        const d = src.charCodeAt(q)
        if (d === 10) q++
        else if (d === 13) q += src.charCodeAt(q + 1) === 10 ? 2 : 1
        else break
      }
      emit(T.NEWLINE, p, q)
      return true
    }
    if (isSpace(c)) {
      p++
      while (p < n && isSpace(src.charCodeAt(p)) && !isLineEnd(src.charCodeAt(p))) p++
      return true
    }
    if (c === 35 || c === 37) {
      if (src.startsWith('%%', p)) onComment?.(p, lineBreak(p))
      p = lineBreak(p)
      return true
    }
    if (isWord(c)) {
      let q = p + 1
      while (q < n && isWord(src.charCodeAt(q))) q++
      if (q - p <= LONGEST_KEYWORD) {
        const keyword = KEYWORDS.get(src.slice(p, q).toLowerCase())
        if (keyword !== undefined) {
          if (keyword === T.STYLE || keyword === T.CLASSDEF || keyword === T.CLASS) {
            styleValue = false
            push(S.style)
          }
          emit(keyword, p, q)
          return true
        }
      }
      while (q < n) {
        const d = src.charCodeAt(q)
        if (d < 128 && STOP[d]! === 1) break
        q++
      }
      types.push(T.unqString)
      texts.push(src.slice(p, q).trim())
      starts.push(p)
      p = q
      return true
    }
    switch (c) {
      case 123:
        emit(T.STRUCT_START, p, p + 1)
        return true
      case 125:
        emit(T.STRUCT_STOP, p, p + 1)
        return true
      case 58:
        if (src.charCodeAt(p + 1) === 58 && src.charCodeAt(p + 2) === 58) emit(T.STYLE_SEPARATOR, p, p + 3)
        else emit(T.COLONSEP, p, p + 1)
        return true
      case 60:
        if (src.charCodeAt(p + 1) !== 45) return false
        emit(T.END_ARROW_L, p, p + 2)
        return true
      case 45:
        if (src.charCodeAt(p + 1) === 62) emit(T.END_ARROW_R, p, p + 2)
        else emit(T.LINE, p, p + 1)
        return true
      case 34:
        push(S.string)
        p++
        return true
      case 44:
        emit(T.COMMA, p, p + 1)
        return true
    }
    return false
  }
  const style = (c: number): boolean => {
    if (isWord(c)) {
      let q = p + 1
      while (q < n && isWord(src.charCodeAt(q))) q++
      // Preserve a functional style value up to its next declaration. The
      // color grammar owns malformed spacing or parentheses; the target-id
      // grammar before a property's colon remains unchanged.
      let functionStart = q
      while (functionStart < n && isSpace(src.charCodeAt(functionStart)) && !isLineEnd(src.charCodeAt(functionStart))) functionStart++
      if (styleValue && src.charCodeAt(functionStart) === 40) {
        q = functionStart
        let depth = 0
        while (q < n) {
          const next = src.charCodeAt(q)
          if (isLineEnd(next) || (depth === 0 && (next === 44 || next === 59))) break
          if (next === 40) depth++
          else if (next === 41) depth = Math.max(0, depth - 1)
          q++
        }
      }
      emit(T.ALPHA, p, q)
      return true
    }
    switch (c) {
      case 58:
        styleValue = true
        emit(T.COLON, p, p + 1)
        return true
      case 59:
        styleValue = false
        emit(T.SEMICOLON, p, p + 1)
        return true
      case 37:
        emit(T.PERCENT, p, p + 1)
        return true
      case 45:
        emit(T.MINUS, p, p + 1)
        return true
      case 35:
        emit(T.BRKT, p, p + 1)
        return true
      case 32:
        p++
        return true
      case 34:
        push(S.string)
        p++
        return true
      case 10:
        pop()
        p++
        return true
      case 13:
        pop()
        p += src.charCodeAt(p + 1) === 10 ? 2 : 1
        return true
      case 44:
        styleValue = false
        emit(T.COMMA, p, p + 1)
        return true
    }
    return false
  }
  while (p < n) {
    const c = src.charCodeAt(p)
    let ok = true
    switch (state) {
      case S.INITIAL:
        ok = initial(c)
        break
      case S.style:
        ok = style(c)
        break
      case S.string:
        if (c === 34) {
          pop()
          p++
        } else {
          const e = src.indexOf('"', p)
          emit(T.qString, p, e === -1 ? n : e)
        }
        break
      case S.acc_title:
        pop()
        emit(T.acc_title_value, p, lineBreak(p))
        break
      case S.acc_descr:
        pop()
        emit(T.acc_descr_value, p, lineBreak(p))
        break
      case S.acc_descr_multiline:
        if (c === 125) {
          pop()
          p++
        } else {
          const e = src.indexOf('}', p)
          emit(T.acc_descr_multiline_value, p, e === -1 ? n : e)
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
  // At the end of input Jison still tries the rules that can match nothing, once.
  const last = state === S.INITIAL ? T.EOF : state === S.string ? T.qString : state === S.acc_title ? T.acc_title_value : state === S.acc_descr ? T.acc_descr_value : state === S.acc_descr_multiline ? T.acc_descr_multiline_value : -1
  if (last !== -1) emit(last, n, n)
  emit(T.END, n, n)
  return { types, texts, starts }
}

/** Universal directives inside a native quoted token belong to that token. */
export function requirementStatementEnds(lines: readonly string[]): readonly number[] {
  const ends = lines.map((_, index) => index)
  if (!lines.length) return ends
  const source = ['requirementDiagram', ...lines.slice(1)].join('\n')
  const positions = [0]
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') positions.push(i + 1)
  try {
    const tokens = tokenize(source)
    let row = 0
    for (let i = 0; i < tokens.types.length; i++) {
      if (tokens.types[i] !== T.qString) continue
      const start = tokens.starts[i]!, end = start + tokens.texts[i]!.length
      while (row + 1 < positions.length && positions[row + 1]! <= start) row++
      let last = row
      while (last + 1 < positions.length && positions[last + 1]! <= end) last++
      ends[row] = Math.max(ends[row]!, last)
      row = last
    }
  } catch {
    // Invalid source still uses the ordinary physical-row envelope fallback.
  }
  return ends
}
