// CommonMark fenced-code scanner for `am render-markdown`.
//
// A Markdown document's Mermaid diagrams are its fenced code blocks whose info
// string starts with the word `mermaid` (compared case-insensitively). The
// scanner follows the CommonMark block structure that decides which lines are
// fences: backtick and tilde fences of three or more characters, closing fences
// of the same character and at least the opening length, up to three columns of
// indentation relative to the enclosing container, block-quote and list-item
// containers (including lazy paragraph continuation), and the leaf blocks whose
// contents are never fences (indented code, HTML blocks, other fences). A fence
// left open runs to the end of its container or of the document.
//
// Not modelled: HTML block type 7 (a lone arbitrary tag line), link reference
// definitions, and the rule that a list item may begin with at most one blank
// line. None of them can turn a fence line into prose or vice versa except in
// contrived documents.

export interface MarkdownMermaidFence {
  /** Fence content with container prefixes and fence indentation removed. */
  source: string
  /** 1-based source line of the opening fence. */
  line: number
}

type Container = { kind: 'quote' } | { kind: 'item'; width: number }

type OpenLeaf =
  | { kind: 'fence'; depth: number; char: string; length: number; indent: number; mermaid: boolean; line: number; body: string[] }
  | { kind: 'html'; depth: number; end: RegExp | 'blank' }

/** A position within one line, tracking virtual columns so tabs expand to the
 * next multiple of four exactly as CommonMark specifies, including a tab that
 * is only partly consumed by a container or fence indentation. */
interface Cursor {
  text: string
  pos: number
  col: number
  partial: boolean
}

const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/
const SETEXT_EQUALS = /^=+[ \t]*$/
const LIST_MARKER = /^(?:[-+*]|(\d{1,9})[.)])(?=[ \t]|$)/
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/
const HTML_BLOCK_STARTS: ReadonlyArray<readonly [RegExp, RegExp | 'blank']> = [
  [/^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, /<\/(?:script|pre|style|textarea)>/i],
  [/^<!--/, /-->/],
  [/^<\?/, /\?>/],
  [/^<![A-Za-z]/, />/],
  [/^<!\[CDATA\[/, /\]\]>/],
  [/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/i, 'blank'],
]

function indentation(c: Cursor): { columns: number; next: number } {
  let pos = c.pos
  let col = c.col
  while (pos < c.text.length) {
    const ch = c.text[pos]
    if (ch === ' ') col++
    else if (ch === '\t') col += 4 - (col % 4)
    else break
    pos++
  }
  return { columns: col - c.col, next: pos }
}

function advanceColumns(c: Cursor, columns: number): void {
  while (columns > 0 && c.pos < c.text.length) {
    const ch = c.text[c.pos]
    if (ch === '\t') {
      const width = 4 - (c.col % 4)
      if (width <= columns) {
        c.pos++
        c.col += width
        columns -= width
        c.partial = false
      } else {
        c.col += columns
        columns = 0
        c.partial = true
      }
    } else if (ch === ' ') {
      c.pos++
      c.col++
      columns--
      c.partial = false
    } else break
  }
}

function advanceChars(c: Cursor, count: number): void {
  c.pos += count
  c.col += count
  c.partial = false
}

function rest(c: Cursor): string {
  return c.partial ? ' '.repeat(4 - (c.col % 4)) + c.text.slice(c.pos + 1) : c.text.slice(c.pos)
}

function isBlank(c: Cursor): boolean {
  return /^[ \t]*$/.test(c.text.slice(c.pos))
}

function continues(container: Container, c: Cursor): boolean {
  const ind = indentation(c)
  if (container.kind === 'quote') {
    if (ind.columns > 3 || c.text[ind.next] !== '>') return false
    advanceColumns(c, ind.columns)
    advanceChars(c, 1)
    if (c.text[c.pos] === ' ' || c.text[c.pos] === '\t') advanceColumns(c, 1)
    return true
  }
  if (isBlank(c)) {
    advanceColumns(c, ind.columns)
    return true
  }
  if (ind.columns < container.width) return false
  advanceColumns(c, container.width)
  return true
}

function fenceOpening(text: string): { char: string; length: number; info: string } | undefined {
  const match = FENCE_OPEN.exec(text)
  if (!match) return undefined
  const run = match[1]!
  const info = match[2]!
  // A backtick fence's info string may not contain a backtick (that line is an
  // inline code span instead).
  if (run[0] === '`' && info.includes('`')) return undefined
  return { char: run[0]!, length: run.length, info: info.trim() }
}

function htmlBlockEnd(text: string): RegExp | 'blank' | undefined {
  for (const [start, end] of HTML_BLOCK_STARTS) if (start.test(text)) return end
  return undefined
}

/** Whether a line that failed to continue the open containers is a lazy
 * continuation of their open paragraph rather than the start of a new block. */
function isLazyContinuation(c: Cursor): boolean {
  if (isBlank(c)) return false
  const ind = indentation(c)
  if (ind.columns >= 4) return true
  const text = c.text.slice(ind.next)
  return !fenceOpening(text) && !THEMATIC_BREAK.test(text) && !ATX_HEADING.test(text) && !SETEXT_EQUALS.test(text) && htmlBlockEnd(text) === undefined
}

/** Every fenced code block whose info string's first word is `mermaid`, in
 * document order, with its content and opening-fence line. */
export function extractMermaidFences(markdown: string): MarkdownMermaidFence[] {
  const lines = markdown.split(/\r\n|\r|\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const fences: MarkdownMermaidFence[] = []
  const stack: Container[] = []
  let paragraph = false
  let leaf: OpenLeaf | undefined
  const closeLeaf = () => {
    if (leaf?.kind === 'fence' && leaf.mermaid) fences.push({ source: leaf.body.join('\n'), line: leaf.line })
    leaf = undefined
  }

  for (let index = 0; index < lines.length; index++) {
    const c: Cursor = { text: lines[index]!, pos: 0, col: 0, partial: false }
    let matched = 0
    while (matched < stack.length && continues(stack[matched]!, c)) matched++

    if (leaf) {
      if (matched < leaf.depth) {
        // The fence's container ended; so does the fence (no lazy continuation
        // for code). The line itself is ordinary content at the outer level.
        closeLeaf()
      } else if (leaf.kind === 'fence') {
        const ind = indentation(c)
        const close = ind.columns <= 3 ? FENCE_CLOSE.exec(c.text.slice(ind.next)) : null
        if (close && close[1]![0] === leaf.char && close[1]!.length >= leaf.length) closeLeaf()
        else {
          advanceColumns(c, Math.min(ind.columns, leaf.indent))
          leaf.body.push(rest(c))
        }
        continue
      } else if (leaf.end === 'blank') {
        if (!isBlank(c)) continue
        leaf = undefined
      } else {
        if (leaf.end.test(rest(c))) leaf = undefined
        continue
      }
    }

    const allMatched = matched === stack.length
    // A list item interrupting a paragraph may not be empty or start at a
    // number other than 1; that line stays paragraph text.
    let interrupting = allMatched && paragraph
    const opened: Container[] = []
    for (;;) {
      const ind = indentation(c)
      if (ind.columns > 3) break
      const text = c.text.slice(ind.next)
      if (text[0] === '>') {
        advanceColumns(c, ind.columns)
        advanceChars(c, 1)
        if (c.text[c.pos] === ' ' || c.text[c.pos] === '\t') advanceColumns(c, 1)
        opened.push({ kind: 'quote' })
        interrupting = false
        continue
      }
      if (THEMATIC_BREAK.test(text)) break
      const marker = LIST_MARKER.exec(text)
      if (!marker) break
      const blankItem = /^[ \t]*$/.test(text.slice(marker[0].length))
      if (interrupting && (blankItem || (marker[1] !== undefined && Number(marker[1]) !== 1))) break
      advanceColumns(c, ind.columns)
      advanceChars(c, marker[0].length)
      const markerColumns = ind.columns + marker[0].length
      let width = markerColumns + 1
      if (!blankItem) {
        const spaces = indentation(c).columns
        // Five or more spaces start an indented code block one column in.
        if (spaces >= 5) advanceColumns(c, 1)
        else {
          width = markerColumns + spaces
          advanceColumns(c, spaces)
        }
      }
      opened.push({ kind: 'item', width })
      interrupting = false
    }

    if (opened.length === 0 && !allMatched && paragraph && isLazyContinuation(c)) continue
    stack.length = matched
    stack.push(...opened)
    if (opened.length > 0 || !allMatched) paragraph = false

    if (isBlank(c)) {
      paragraph = false
      continue
    }
    const ind = indentation(c)
    // Four or more columns: indented code, or paragraph continuation text.
    // Neither can open a fence.
    if (ind.columns >= 4) continue
    const text = c.text.slice(ind.next)
    const fence = fenceOpening(text)
    if (fence) {
      leaf = {
        kind: 'fence',
        depth: stack.length,
        char: fence.char,
        length: fence.length,
        indent: ind.columns,
        mermaid: fence.info.split(/[ \t]/, 1)[0]!.toLowerCase() === 'mermaid',
        line: index + 1,
        body: [],
      }
      paragraph = false
      continue
    }
    const htmlEnd = htmlBlockEnd(text)
    if (htmlEnd !== undefined) {
      paragraph = false
      if (htmlEnd === 'blank' || !htmlEnd.test(text)) leaf = { kind: 'html', depth: stack.length, end: htmlEnd }
      continue
    }
    if (ATX_HEADING.test(text) || THEMATIC_BREAK.test(text) || (paragraph && SETEXT_EQUALS.test(text))) {
      paragraph = false
      continue
    }
    paragraph = true
  }
  closeLeaf()
  return fences
}
