/** Request-local SVG output. Limits count the UTF-8 encoding of the joined
 * string, including surrogate pairs split between writes; no byte buffers. */
export interface SvgWriterOptions {
  readonly maxBytes?: number
  readonly mode?: 'string' | 'chunks' | 'count'
}

export type SvgAttributeEscape = 'attribute' | 'xml' | 'safe'

interface WriterState {
  readonly maxBytes: number
  readonly mode: 'string' | 'chunks' | 'count'
  value: string
  chunks: string[]
  bytes: number
  highSurrogate: boolean
}

export class SvgWriter {
  private readonly state: WriterState
  private readonly parent?: SvgWriter
  private destination?: SvgWriter
  private readonly indentation: string
  private lineStart = true

  constructor(options: SvgWriterOptions = {}, parent?: SvgWriter, indentation = '') {
    const maxBytes = options.maxBytes ?? 5_000_000
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('SVG byte limit must be a non-negative safe integer')
    if (options.mode !== undefined && options.mode !== 'string' && options.mode !== 'chunks' && options.mode !== 'count') throw new TypeError('Unknown SVG writer mode')
    this.parent = parent
    this.indentation = indentation
    this.state = parent?.state ?? { maxBytes, mode: options.mode ?? 'string', value: '', chunks: [], bytes: 0, highSurrogate: false }
  }

  get bytes(): number { return this.state.bytes }

  write(value: string): void {
    if (typeof value !== 'string') throw new TypeError('SVG output chunks must be strings')
    if (this.parent) {
      if (this.lineStart) { this.parent.write(this.indentation); this.lineStart = false }
      let start = 0
      for (;;) {
        const end = value.indexOf('\n', start)
        if (end < 0) { this.parent.write(value.slice(start)); return }
        this.parent.write(value.slice(start, end + 1))
        this.parent.write(this.indentation)
        start = end + 1
      }
    }
    const state = this.state
    let bytes = state.bytes
    let high = state.highSurrogate
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (high && code >= 0xdc00 && code <= 0xdfff) bytes += 1
      else if (code <= 0x7f) bytes += 1
      else if (code <= 0x7ff) bytes += 2
      else bytes += 3
      high = code >= 0xd800 && code <= 0xdbff
      if (bytes > state.maxBytes) throw new RangeError(`SVG serialization exceeds ${state.maxBytes} bytes`)
    }
    // A node scope checks its unindented bytes before the outer sink receives
    // anything. The destination can itself be an indented/group scope view.
    if (this.destination) this.destination.write(value)
    state.bytes = bytes
    state.highSurrogate = high
    if (state.mode === 'chunks') { if (value) state.chunks.push(value) }
    else if (state.mode === 'string') state.value += value
  }

  /** Escape content, with attribute whitespace references when requested. */
  text(value: string, attribute = false): void {
    let start = 0
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      const replacement = code === 38 ? '&amp;' : code === 60 ? '&lt;' : code === 62 ? '&gt;' : code === 34 ? '&quot;' : code === 39 ? '&#39;'
        : attribute && code === 9 ? '&#9;' : attribute && code === 10 ? '&#10;' : attribute && code === 13 ? '&#13;' : undefined
      if (replacement !== undefined) {
        this.write(value.slice(start, index))
        this.write(replacement)
        start = index + 1
      }
    }
    this.write(value.slice(start))
  }

  /** Names are checked by the closed emission vocabulary before this call. */
  attribute(name: string, value: string, escape: SvgAttributeEscape = 'attribute'): void {
    this.write(` ${name}="`)
    this.attributeValue(value, escape)
    this.write('"')
  }

  /** The safe lexical profile preserves legacy validated root CSS exactly.
   * It cannot contain XML delimiters, and is not an unescaped-markup slot. */
  attributeValue(value: string, escape: SvgAttributeEscape = 'attribute'): void {
    if (escape === 'safe') {
      if (/[&<>"]/.test(value)) throw new TypeError('Safe SVG attribute values must not contain XML delimiters')
      this.write(value)
    } else if (escape === 'attribute' || escape === 'xml') this.text(value, escape === 'attribute')
    else throw new TypeError('Unsupported SVG attribute escaping')
  }

  /** A view sharing this request's sink and byte budget. Its first write and
   * every newline receive exactly the old indentLines prefix. */
  indented(spaces: number): SvgWriter {
    if (!Number.isSafeInteger(spaces) || spaces < 0 || spaces > 1_000_000) throw new TypeError('Invalid SVG indentation')
    return spaces === 0 ? this : new SvgWriter({}, this, ' '.repeat(spaces))
  }

  /** Count this node independently without retaining its string. Apply after
   * an indentation view so the node's cap excludes its parent's added spaces;
   * outer group/document scopes still count those actual emitted spaces. */
  scoped(maxBytes: number): SvgWriter {
    const scope = new SvgWriter({ maxBytes, mode: 'count' })
    scope.destination = this
    return scope
  }

  finish(): string {
    const state = this.state
    if (state.mode === 'count') throw new TypeError('A counting SVG writer has no retained output')
    return state.mode === 'chunks' ? state.chunks.join('') : state.value
  }
}
