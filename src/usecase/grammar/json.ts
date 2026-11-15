// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { isDigit, PeleError, writtenCodes } from './support.ts'

export interface OrderedJson {
  value: Record<string, unknown>
  propertyOrder: Map<string, string[]>
}

// Thrown with the offset of the first character that is not valid JSON.
class WalkError extends Error {
  constructor(readonly offset: number) {
    super('Invalid JSON token')
  }
}

interface Frame {
  object: boolean
  pointer: string
  keys: string[]
  // For each key read so far, the stretch of `created` its value added.
  ranges: Map<string, [number, number]>
  key: string
  from: number
  index: number
}

const enum State {
  Value,
  Key,
  After,
}

// Walks JSON text that JSON.parse has accepted, to recover the order its keys were written in,
// which JSON.parse loses for integer-like keys. On text JSON.parse rejected it finds where.
// Nesting is kept on a stack of its own, so depth is limited by memory and not by the call stack.
function propertyOrder(text: string): Map<string, string[]> {
  const order = new Map<string, string[]>()
  const created: string[] = []
  const stack: Frame[] = []
  const n = text.length
  let at = 0
  let pointer = ''
  let state = State.Value

  const skip = (): void => {
    while (at < n) {
      const c = text.charCodeAt(at)
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) return
      at++
    }
  }

  const readString = (decode: boolean): string => {
    at++
    let value = ''
    while (at < n) {
      const start = at
      const ch = text[at++]!
      if (ch === '"') return value
      if (ch.charCodeAt(0) < 0x20) throw new WalkError(start)
      if (ch !== '\\') {
        if (decode) value += ch
        continue
      }
      const escapeAt = at
      const escape = text[at++]!
      let decoded: string
      if (escape === '"' || escape === '\\' || escape === '/') decoded = escape
      else if (escape === 'b') decoded = '\b'
      else if (escape === 'f') decoded = '\f'
      else if (escape === 'n') decoded = '\n'
      else if (escape === 'r') decoded = '\r'
      else if (escape === 't') decoded = '\t'
      else if (escape === 'u') {
        const unit = text.slice(at, at + 4)
        if (!/^[\dA-Fa-f]{4}$/.test(unit)) throw new WalkError(at)
        decoded = String.fromCharCode(parseInt(unit, 16))
        at += 4
      } else throw new WalkError(escapeAt)
      if (decode) value += decoded
    }
    throw new WalkError(at)
  }

  const literal = (word: string): void => {
    for (let k = 0; k < word.length; k++) if (text[at + k]! !== word[k]!) throw new WalkError(at + k)
    at += word.length
  }

  const number = (): void => {
    if (text.charCodeAt(at) === 45) at++
    if (text.charCodeAt(at) === 48) at++
    else if (isDigit(text.charCodeAt(at))) while (isDigit(text.charCodeAt(at))) at++
    else throw new WalkError(at)
    if (text.charCodeAt(at) === 46) {
      at++
      if (!isDigit(text.charCodeAt(at))) throw new WalkError(at)
      while (isDigit(text.charCodeAt(at))) at++
    }
    if ((text.charCodeAt(at) | 32) === 101) {
      at++
      if (text.charCodeAt(at) === 43 || text.charCodeAt(at) === 45) at++
      if (!isDigit(text.charCodeAt(at))) throw new WalkError(at)
      while (isDigit(text.charCodeAt(at))) at++
    }
  }

  skip()
  for (;;) {
    if (state === State.Value) {
      skip()
      const c = text.charCodeAt(at)
      state = State.After
      if (c === 123) {
        at++
        const keys: string[] = []
        order.set(pointer, keys)
        created.push(pointer)
        skip()
        if (text.charCodeAt(at) === 125) at++
        else {
          stack.push({ object: true, pointer, keys, ranges: new Map(), key: '', from: 0, index: 0 })
          state = State.Key
        }
      } else if (c === 91) {
        at++
        skip()
        if (text.charCodeAt(at) === 93) at++
        else {
          stack.push({ object: false, pointer, keys: [], ranges: new Map(), key: '', from: 0, index: 0 })
          pointer += '/0'
          state = State.Value
        }
      } else if (c === 34) readString(false)
      else if (c === 116) literal('true')
      else if (c === 102) literal('false')
      else if (c === 110) literal('null')
      else if (c === 45 || isDigit(c)) number()
      else throw new WalkError(at)
    } else if (state === State.Key) {
      const frame = stack[stack.length - 1]!
      if (text.charCodeAt(at) !== 34) throw new WalkError(at)
      const key = readString(true)
      const range = frame.ranges.get(key)
      // A repeated key keeps its first place in the order and takes the nested order of its last value.
      if (range === undefined) frame.keys.push(key)
      else for (let k = range[0]!; k < range[1]!; k++) order.delete(created[k]!)
      frame.key = key
      frame.from = created.length
      skip()
      if (text.charCodeAt(at) !== 58) throw new WalkError(at)
      at++
      pointer = `${frame.pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
      state = State.Value
    } else {
      const frame = stack[stack.length - 1]!
      if (frame === undefined) break
      if (frame.object) frame.ranges.set(frame.key, [frame.from, created.length])
      else frame.index++
      skip()
      const c = text.charCodeAt(at)
      if (c === (frame.object ? 125 : 93)) {
        at++
        stack.pop()
      } else if (c !== 44) throw new WalkError(at)
      else {
        at++
        skip()
        pointer = `${frame.pointer}/${frame.index}`
        state = frame.object ? State.Key : State.Value
      }
    }
  }
  skip()
  if (at !== n) throw new WalkError(at)
  return order
}

function locationAt(text: string, offset: number, line: number, column: number): [number, number] {
  const end = Math.min(Math.max(offset, 0), text.length)
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      line++
      column = 1
    } else if (c === 10) {
      if (i === 0 || text.charCodeAt(i - 1) !== 13) {
        line++
        column = 1
      }
    } else column++
  }
  return [line, column]
}

// Engines word JSON.parse errors differently: some give an offset, some a line and column.
function locationFromMessage(message: string, text: string, line: number, column: number): [number, number] | undefined {
  const position = /\bposition (\d+)\b/.exec(message)
  if (position) return locationAt(text, parseInt(position[1]!, 10), line, column)
  const local = /\bline (\d+) column (\d+)\b/.exec(message)
  if (local) {
    const localLine = parseInt(local[1]!, 10)
    const localColumn = parseInt(local[2]!, 10)
    return [line + localLine - 1, localLine === 1 ? column + localColumn - 1 : localColumn]
  }
  if (/unexpected end|end of json input/i.test(message)) return locationAt(text, text.length, line, column)
  return undefined
}

function jsonError(message: string, line: number, column: number): PeleError {
  return new PeleError(`${message} (line ${line}, column ${column})`, 'syntax', { type: 'usecase', line, column })
}

// Parses the body of a `json` node. `origin` gives the line and column the text starts at in the diagram.
export function parseOrderedJson(text: string, origin: () => [number, number]): OrderedJson {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error)
    // Reparse restored entity codes so error messages and positions match the source.
    const shown = writtenCodes(text)
    if (shown !== text) {
      try {
        JSON.parse(shown)
      } catch (again) {
        if (again instanceof Error) message = again.message
      }
    }
    const [line, column] = origin()
    let location = locationFromMessage(message, shown, line, column)
    if (!location) {
      let offset = 0
      try {
        propertyOrder(shown)
      } catch (walk) {
        if (walk instanceof WalkError) offset = walk.offset
      }
      location = locationAt(shown, offset, line, column)
    }
    throw jsonError(`Invalid JSON: ${message}`, location[0]!, location[1]!)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const [line, column] = origin()
    throw jsonError('JSON value must have an object root', line, column)
  }
  return { value: parsed as Record<string, unknown>, propertyOrder: propertyOrder(text) }
}
