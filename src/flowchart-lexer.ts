/**
 * The one flowchart lexer: where each string, markdown string, shape text,
 * pipe label, text-arrow label and `@{…}` block of a flowchart line begins
 * and ends, and which `;` ends a statement. The parser, the statement
 * splitter, the opaque/lint gate, action analysis and both source maps read
 * a line through it, so they cannot disagree about a quote or a bracket.
 *
 * The rules are pinned Mermaid 11.16's (`flow.jison`):
 *   - `"` opens a string that the next `"` closes. There are no escapes: `\`
 *     is text, and `'` is never a delimiter.
 *   - `"` followed by a backtick opens a markdown string that a backtick
 *     followed by `"` closes; a `"` inside it opens a string. A lone backtick
 *     is text.
 *   - At statement level, `[`, `(` and `{` open shape text, and so does a `>`
 *     that is not part of a link (`A>x;y]`). Inside shape text they nest, and
 *     `]`, `)` or `}` closes the innermost one.
 *   - At statement level, `|` opens a pipe label, quoted only as a whole
 *     (`pipeLabelEnd`): a stray `"` inside it is text.
 *   - At statement level, `--`, `==` or `-.` that is not a link opens a
 *     text-arrow label, which runs to the link of its stroke that closes it
 *     (`;`, brackets and `|` inside it are text). Where no link of its stroke
 *     follows, ours also closes it with a link of another stroke
 *     (`A -- b ==> B`), which upstream rejects; verify reports that. One that
 *     no link closes runs to the end of the text.
 *   - At statement level, `@{` opens a metadata block, which
 *     shared/metadata-block-scan.ts delimits. A quoted label masks it. Ours
 *     also reads `@ {`, which upstream rejects; verify reports that.
 *   - A `;` at statement level ends a statement.
 */

import { scanMetadataBlock } from './shared/metadata-block-scan.ts'

export interface FlowchartTextRange { start: number; end: number }

export type FlowchartRegionKind = 'string' | 'markdown' | 'shape' | 'pipe' | 'edge-text' | 'metadata'

export interface FlowchartRegion {
  readonly kind: FlowchartRegionKind
  /** The opening delimiter (for edge text, the opening link). */
  readonly start: number
  /** One past the closing delimiter; the text's length when unclosed. */
  readonly end: number
  /** The text between the delimiters; for edge text, the trimmed label. */
  readonly contentStart: number
  readonly contentEnd: number
  readonly closed: boolean
  /** Index of the enclosing region in `regions`, or -1 at statement level. */
  readonly parent: number
}

export interface FlowchartScan {
  /** Every region, in the order it opens. */
  readonly regions: readonly FlowchartRegion[]
  /** For each character, whether it lies at statement level (in no region
   * and not a region delimiter). Links and separators are statement level. */
  readonly topLevel: readonly boolean[]
  /** Offsets of the `;` characters that end statements. */
  readonly separators: readonly number[]
  /** The statement-level links, in order: each link, and the opening and
   * closing link of each text-arrow label. */
  readonly links: readonly FlowchartTextRange[]
  /** The regions still open at the end of the text, outermost first: a
   * line that ends inside one continues on the next. */
  readonly openAtEnd: readonly FlowchartRegionKind[]
}

/** A link operator (Mermaid's LINK token), with an optional leading `<`. */
export const FLOWCHART_LINK_RE = /(<)?(~{3,}|-\.+->|-\.+-|={2,}>|={3,}|o-{2,}o|o-{2,}x|x-{2,}o|x-{2,}x|-{2,}[ox]|-{2,}>|-{3,})/y
const TEXT_ARROW_OPEN_RE = /(<)?(-{2,}|-\.+|={2,})/y

/** A text-arrow label's stroke, which decides the link that can close it;
 * `mixed` is ours alone: a link of any stroke. */
type TextArrowStroke = 'solid' | 'thick' | 'dotted'
type TextArrowCloser = TextArrowStroke | 'mixed'

/** The link that closes a text-arrow label, per stroke, as upstream's edge
 * text states close (`flow.jison`): `--` by `--+[-xo>]`, `==` by
 * `==+[=xo>]`, `-.` by `-?\.+-[xo>]?`. The circle and cross ends of a thick or
 * dotted link are left out: the link grammar (FLOWCHART_LINK_RE) has no
 * spelling for them, so an edge they drew could not be written back. */
const STROKE_CLOSER_SOURCE: Readonly<Record<TextArrowStroke, string>> = {
  solid: '-{2,}[-ox>]',
  thick: '={2,}[=>]',
  dotted: '-?\\.+->?',
}
const TEXT_ARROW_CLOSER_SOURCE: Readonly<Record<TextArrowCloser, string>> = {
  ...STROKE_CLOSER_SOURCE,
  mixed: Object.values(STROKE_CLOSER_SOURCE).join('|'),
}
const TEXT_ARROW_CLOSE_RE = Object.fromEntries(Object.entries(TEXT_ARROW_CLOSER_SOURCE)
  .map(([stroke, source]) => [stroke, new RegExp(`(${source})`, 'y')])) as Record<TextArrowCloser, RegExp>
const TEXT_ARROW_CLOSE_AFTER_SPACE_RE = Object.fromEntries(Object.entries(TEXT_ARROW_CLOSER_SOURCE)
  .map(([stroke, source]) => [stroke, new RegExp(`\\s*(?:${source})`, 'y')])) as Record<TextArrowCloser, RegExp>

function textArrowStroke(openOp: string): TextArrowStroke {
  return openOp.includes('.') ? 'dotted' : openOp.startsWith('=') ? 'thick' : 'solid'
}

function stickyMatch(expression: RegExp, text: string, at: number): RegExpExecArray | null {
  expression.lastIndex = at
  return expression.exec(text)
}

/** The link operator at `at`, or null. */
export function matchFlowchartLink(text: string, at: number): { hasArrowStart: boolean; op: string; end: number } | null {
  const match = stickyMatch(FLOWCHART_LINK_RE, text, at)
  return match ? { hasArrowStart: Boolean(match[1]), op: match[2]!, end: at + match[0].length } : null
}

export interface TextArrowMatch {
  readonly hasArrowStart: boolean
  readonly openOp: string
  readonly closeOp: string
  /** The trimmed label. */
  readonly labelStart: number
  readonly labelEnd: number
  /** A label that is one quoted string: the string's `"` offsets. */
  readonly quote?: { readonly open: number; readonly close: number }
  /** One past the closing link. */
  readonly end: number
  /** The closing link is of another stroke than the opener's (upstream
   * rejects that). */
  readonly mixed?: true
}

/** A label wholly inside `"…"`: its closing quote is the one a closing link
 * follows, so closer-shaped text inside the quotes stays label text. */
function wholeQuotedLabel(text: string, from: number, stroke: TextArrowCloser): { open: number; close: number } | undefined {
  let open = from
  while (open < text.length && /\s/.test(text[open]!)) open++
  if (text[open] !== '"') return undefined
  for (let close = text.indexOf('"', open + 1); close >= 0; close = text.indexOf('"', close + 1)) {
    if (stickyMatch(TEXT_ARROW_CLOSE_AFTER_SPACE_RE[stroke], text, close + 1)) return { open, close }
  }
  return undefined
}

/**
 * The text-arrow link at `at` (`-- label -->`, `-. label .->`,
 * `== label ==>`, compact or spaced): the first link of the opener's stroke
 * after a non-empty label closes it, or where there is none, the first link of
 * any stroke (`mixed`). Null when `at` does not open one.
 */
export function matchTextArrow(text: string, at: number): TextArrowMatch | null {
  const opener = stickyMatch(TEXT_ARROW_OPEN_RE, text, at)
  if (!opener) return null
  return closeTextArrow(text, at, opener, textArrowStroke(opener[2]!)) ?? closeTextArrow(text, at, opener, 'mixed')
}

function closeTextArrow(text: string, at: number, opener: RegExpExecArray, stroke: TextArrowCloser): TextArrowMatch | null {
  const labelFrom = at + opener[0].length
  const quote = wholeQuotedLabel(text, labelFrom, stroke)
  for (let index = quote ? quote.close + 1 : labelFrom; index < text.length; index++) {
    const closer = stickyMatch(TEXT_ARROW_CLOSE_RE[stroke], text, index)
    if (!closer) continue
    const raw = text.slice(labelFrom, index)
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const labelStart = labelFrom + raw.length - raw.trimStart().length
    return {
      hasArrowStart: Boolean(opener[1]),
      openOp: opener[2]!,
      closeOp: closer[1]!,
      labelStart,
      labelEnd: labelStart + trimmed.length,
      ...(quote ? { quote } : {}),
      end: index + closer[0].length,
      ...(stroke === 'mixed' ? { mixed: true as const } : {}),
    }
  }
  return null
}

/**
 * Where the pipe label opening at `at` closes. A label is quoted only as a
 * whole: a `"` that begins it closes at the `"` a `|` follows, and the `|`s
 * inside are text; otherwise the next `|` closes it and a stray `"` is text.
 * (Upstream reads every `"` in a pipe label as a string; this parser keeps the
 * whole-label rule so that a `&quot;` the render path decodes to `"` in an
 * unquoted label, text upstream, still reads as text.)
 */
function pipeLabelEnd(text: string, at: number): { close: number; quote?: { open: number; close: number } } | undefined {
  let open = at + 1
  while (open < text.length && /\s/.test(text[open]!)) open++
  if (text[open] === '"') {
    for (let close = text.indexOf('"', open + 1); close >= 0; close = text.indexOf('"', close + 1)) {
      let pipe = close + 1
      while (pipe < text.length && /\s/.test(text[pipe]!)) pipe++
      if (text[pipe] === '|') return { close: pipe, quote: { open, close } }
    }
  }
  const close = text.indexOf('|', at + 1)
  return close < 0 ? undefined : { close }
}

/** The `{` of a metadata block whose `@` is at `at` (`@{`, or `@ {` as ours
 * also reads it), or -1. */
function metadataBrace(text: string, at: number): number {
  let brace = at + 1
  while (brace < text.length && /\s/.test(text[brace]!)) brace++
  return text[brace] === '{' ? brace : -1
}

const SHAPE_OPENERS = new Set(['[', '(', '{'])
const SHAPE_CLOSERS = new Set([']', ')', '}'])

interface MutableRegion {
  kind: FlowchartRegionKind
  start: number
  end: number
  contentStart: number
  contentEnd: number
  closed: boolean
  parent: number
}

/** Lex one flowchart line (or one statement, or lines a multi-line block
 * joined with `\n`). Linear in the text's length. */
export function scanFlowchart(text: string): FlowchartScan {
  return lex(text, 0, false, false)
}

/** The region that opens at `at` (a `"`, `|`, `[`, `(`, `{` or `>`), lexed
 * only as far as it extends; undefined when nothing opens there. */
export function flowchartRegionAt(text: string, at: number): FlowchartRegion | undefined {
  const region = lex(text, at, true, false).regions[0]
  return region?.start === at ? region : undefined
}

/** `labelStrings`: a `"` in shape text opens a string only where the text
 * begins; elsewhere it is text, as the parser's shape patterns read it. */
function lex(text: string, from: number, single: boolean, labelStrings: boolean): FlowchartScan {
  const regions: MutableRegion[] = []
  // A single region needs no statement-level map, and must not pay for one.
  const topLevel = single ? [] : Array<boolean>(text.length).fill(false)
  const separators: number[] = []
  const links: FlowchartTextRange[] = []
  // Open regions, innermost last (indices into `regions`).
  const stack: number[] = []

  const open = (kind: FlowchartRegionKind, start: number, contentStart: number): void => {
    regions.push({ kind, start, end: text.length, contentStart, contentEnd: text.length, closed: false, parent: stack.at(-1) ?? -1 })
    stack.push(regions.length - 1)
  }
  const close = (contentEnd: number, end: number): void => {
    const region = regions[stack.pop()!]!
    region.contentEnd = contentEnd
    region.end = end
    region.closed = true
  }

  for (let index = from; index < text.length; index++) {
    if (single && regions.length > 0 && stack.length === 0) break
    const char = text[index]!
    const inner = stack.length > 0 ? regions[stack.at(-1)!]! : undefined

    if (inner?.kind === 'string') {
      if (char === '"') close(index, index + 1)
      continue
    }
    if (inner?.kind === 'markdown') {
      if (char === '`' && text[index + 1] === '"') { close(index, index + 2); index++ }
      else if (char === '"') open('string', index, index + 1)
      continue
    }
    if (char === '"' && !(labelStrings && inner?.kind === 'shape' && index !== inner.contentStart)) {
      if (text[index + 1] === '`') { open('markdown', index, index + 2); index++ }
      else open('string', index, index + 1)
      continue
    }
    if (inner?.kind === 'shape') {
      if (SHAPE_OPENERS.has(char)) open('shape', index, index + 1)
      else if (SHAPE_CLOSERS.has(char)) close(index, index + 1)
      continue
    }

    // Statement level.
    const brace = char === '@' ? metadataBrace(text, index) : -1
    if (brace >= 0) {
      const block = scanMetadataBlock(text, brace, 'flowchart')
      if (block.kind === 'closed') {
        regions.push({ kind: 'metadata', start: index, end: block.end + 1, contentStart: brace + 1, contentEnd: block.end, closed: true, parent: -1 })
        index = block.end
        continue
      }
      if (block.kind === 'unclosed') {
        open('metadata', index, brace + 1)
        break
      }
    }
    if (char === '|') {
      const pipe = pipeLabelEnd(text, index)
      if (!pipe) {
        open('pipe', index, index + 1)
        break
      }
      const regionIndex = regions.length
      regions.push({ kind: 'pipe', start: index, end: pipe.close + 1, contentStart: index + 1, contentEnd: pipe.close, closed: true, parent: -1 })
      if (pipe.quote) {
        regions.push({ kind: 'string', start: pipe.quote.open, end: pipe.quote.close + 1, contentStart: pipe.quote.open + 1, contentEnd: pipe.quote.close, closed: true, parent: regionIndex })
      }
      index = pipe.close
      continue
    }
    if (SHAPE_OPENERS.has(char)) { open('shape', index, index + 1); continue }
    if (char === '-' || char === '=' || char === '<' || char === '~') {
      const link = matchFlowchartLink(text, index)
      if (link) {
        links.push({ start: index, end: link.end })
        topLevel.fill(true, index, link.end)
        index = link.end - 1
        continue
      }
      const opener = stickyMatch(TEXT_ARROW_OPEN_RE, text, index)
      const arrow = opener ? matchTextArrow(text, index) : null
      if (arrow) {
        const regionIndex = regions.length
        regions.push({ kind: 'edge-text', start: index, end: arrow.end, contentStart: arrow.labelStart, contentEnd: arrow.labelEnd, closed: true, parent: -1 })
        if (arrow.quote) {
          regions.push({ kind: 'string', start: arrow.quote.open, end: arrow.quote.close + 1, contentStart: arrow.quote.open + 1, contentEnd: arrow.quote.close, closed: true, parent: regionIndex })
        }
        // The operators around the label are statement level; the label is not.
        topLevel.fill(true, index, arrow.labelStart)
        const closeStart = arrow.end - arrow.closeOp.length
        topLevel.fill(true, closeStart, arrow.end)
        if (!single) for (let cursor = arrow.labelEnd; cursor < closeStart; cursor++) topLevel[cursor] = true
        links.push({ start: index, end: index + opener![0].length }, { start: closeStart, end: arrow.end })
        index = arrow.end - 1
        continue
      }
      if (opener) {
        links.push({ start: index, end: index + opener[0].length })
        topLevel.fill(true, index, index + opener[0].length)
        open('edge-text', index, index + opener[0].length)
        break
      }
    }
    // A `>` that no link consumed opens asymmetric shape text (`A>x]`).
    if (char === '>') { open('shape', index, index + 1); continue }
    if (!single) topLevel[index] = true
    if (char === ';') separators.push(index)
  }

  return { regions, topLevel, separators, links, openAtEnd: stack.map(region => regions[region]!.kind) }
}

/** The statements of one line: the text between statement-level `;`, with
 * each statement's trimmed offset. Empty statements are dropped. Upstream's
 * `end` token takes the whitespace after it, so a statement may follow it on
 * its line (`end B`). */
export function flowchartStatementSpans(text: string, scan: FlowchartScan = scanFlowchart(text)): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = []
  let start = 0
  for (const end of [...scan.separators, text.length]) {
    const raw = text.slice(start, end)
    const trimmed = raw.trim()
    const at = start + raw.length - raw.trimStart().length
    const keyword = /^end\s+/.exec(trimmed)
    if (keyword) out.push({ text: 'end', start: at }, { text: trimmed.slice(keyword[0].length), start: at + keyword[0].length })
    else if (trimmed) out.push({ text: trimmed, start: at })
    start = end + 1
  }
  return out
}

/** A statement whose text no link or label continues onto another line. */
const KEYWORD_STATEMENT_RE = /^(?:subgraph|classDef|class|style|linkStyle|click|href|accTitle|accDescr)(?![\w-])/

/**
 * Join physical lines into the statements upstream's lexer reads, for which
 * a line break does not always end one. A line joins the next while it ends
 * inside a `@{…}` block, with `\n`, indentation intact (upstream parses a
 * multi-line body as block YAML, where both matter), or inside a string,
 * markdown string, shape text, pipe label or text-arrow label, with `<br>`,
 * the label pipeline's line break (a space where the break would begin or end
 * the text, which upstream trims). Upstream's link token takes the whitespace
 * around it, line breaks included, so a line that ends with a link joins the
 * next, and one that begins with a link joins the last, with a space and past
 * blank and comment lines. In a keyword statement (`subgraph`, `style`, …) a
 * bracket or a link is text, so only a markdown string or a metadata block
 * continues one. `line` is the 0-based index of each group's first line.
 *
 * Upstream reads a string in shape text only where the text begins
 * (`A["a⏎b"]`) and rejects one opened later. Here such a `"` is text, as the
 * parser's shape patterns read it on one line (`A[x " y]`), so a `&quot;` the
 * render path decodes joins lines as the authored entity does.
 */
export function coalesceFlowchartLines(lines: readonly string[]): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = []
  const scanLine = (text: string): FlowchartScan => lex(text, 0, false, true)
  let group: { text: string; line: number } | undefined
  // The last line of `group` as lexed (behind the openers that put the lexer
  // in the state it began in), and whether its last statement is a keyword
  // statement.
  let scanned = ''
  let scan = scanLine(scanned)
  let keyword = false
  // Of the keyword statements, upstream lexes a subgraph's `id[…]` or `"…"`
  // title as a label, which runs on across lines. Ours carries it on only to
  // a line that closes it, so an unclosed title cannot swallow the diagram.
  let subgraph = false
  let closers: { ']': number[]; '"': number[] } | undefined
  const closedFrom = (index: number, closer: ']' | '"'): boolean => {
    if (!closers) {
      closers = { ']': new Array(lines.length + 1).fill(lines.length), '"': new Array(lines.length + 1).fill(lines.length) }
      for (let at = lines.length - 1; at >= 0; at--) {
        for (const char of [']', '"'] as const) closers[char][at] = lines[at]!.includes(char) ? at : closers[char][at + 1]!
      }
    }
    return closers[closer][index]! < lines.length
  }
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!
    const trimmed = raw.trim()
    const open = scan.openAtEnd
    // Upstream reads a string only where it opens its label (`["a⏎b"]`,
    // `|"a⏎b"|`), and rejects a line with one opened mid-label. Such a line
    // (a string in a markdown string) ends where it ends.
    const midLabelString = scan.regions.some(region => region.kind === 'string' && region.parent >= 0 && region.start !== scan.regions[region.parent]!.contentStart)
    const titleOpen = subgraph ? scan.regions.filter(region => !region.closed) : []
    const subgraphTitle = titleOpen.length > 0
      && titleOpen.every(region => /^(?:\[|")$/.test(scanned.slice(region.start, region.contentStart)))
      && closedFrom(index, titleOpen.at(-1)!.kind === 'string' ? '"' : ']')
    const inRegion = group !== undefined && open.length > 0 && !midLabelString && (open[0] === 'metadata' || open.includes('markdown') || !keyword || subgraphTitle)
    if (!inRegion && (!trimmed || trimmed.startsWith('%%'))) {
      out.push({ text: raw, line: index })
      continue
    }
    let text = trimmed
    let joint: string | undefined
    let lineScan: FlowchartScan
    if (inRegion && open[0] === 'metadata') {
      text = `${scanned}\n${raw}`
      lineScan = scanLine(text)
      joint = '\n'
    } else if (inRegion) {
      const continued = continuationPrefix(scanned, scan)
      text = `${continued.prefix}${trimmed}`
      lineScan = scanLine(text)
      const inner = lineScan.regions[open.length - 1]!
      const blankEnd = inner.closed && text.slice(continued.prefix.length, inner.contentEnd).trim() === ''
      joint = continued.blank || blankEnd ? ' ' : '<br>'
    } else {
      lineScan = scanLine(text)
      const endsWithLink = open.length === 0 && scan.links.at(-1)?.end === scanned.trimEnd().length
      if (group && !keyword && (endsWithLink || lineScan.links[0]?.start === 0)) joint = ' '
    }
    if (joint === undefined) {
      group = { text: raw, line: index }
      out.push(group)
    } else {
      group!.text += `${joint}${joint === '\n' ? raw : trimmed}`
    }
    const last = flowchartStatementSpans(text, lineScan).at(-1)
    if (joint === undefined || (last && last.start > 0)) {
      keyword = last !== undefined && KEYWORD_STATEMENT_RE.test(last.text)
      subgraph = last !== undefined && /^subgraph\s/.test(last.text)
    }
    scanned = text
    scan = lineScan
  }
  return out
}

/** Text that leaves the lexer in the state `scan` ends in: the openers of the
 * regions open at the end of `text`, then, when the innermost holds text, a
 * stand-in for it (its first character for a pipe or text-arrow label, whose
 * quoting and closing depend on it). */
function continuationPrefix(text: string, scan: FlowchartScan): { prefix: string; blank: boolean } {
  const open = scan.regions.filter(region => !region.closed)
  const inner = open.at(-1)!
  const first = text.slice(inner.contentStart).trimStart()[0]
  const standIn = first === undefined ? '' : inner.kind === 'pipe' || inner.kind === 'edge-text' ? `${first} ` : '_ '
  return { prefix: `${open.map(region => text.slice(region.start, region.contentStart)).join('')} ${standIn}`, blank: first === undefined }
}

/** The trimmed text-arrow labels of a line. */
export function flowchartTextArrowLabelRanges(text: string, scan: FlowchartScan = scanFlowchart(text)): FlowchartTextRange[] {
  return scan.regions.filter(region => region.kind === 'edge-text').map(region => ({ start: region.contentStart, end: region.contentEnd }))
}
