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
 *     no link closes runs to the end of the text. A `--` (`==`) inside a
 *     solid (thick) label that does not close it is no token upstream: such
 *     a label does not close, and what follows its opener is lexed as
 *     written.
 *   - At statement level, `@{` opens a metadata block, which
 *     shared/metadata-block-scan.ts delimits. A quoted label masks it. Ours
 *     also reads `@ {`, which upstream rejects; verify reports that.
 *   - A `;` at statement level ends a statement.
 */

import { decodeXML } from 'entities'
import { parseAccessibilityDirective } from './shared/accessibility-directives.ts'
import { scanMetadataBlock } from './shared/metadata-block-scan.ts'
import { TERMINAL_CONTROL_RE } from './shared/mermaid-entities.ts'
import { syntaxError } from './shared/syntax-error.ts'

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

/** A link operator (Mermaid's LINK token), with an optional leading `<`. A
 * dotted one may leave out its leading `-` (`A .-> B`). Any stroke may end
 * in a cross or a circle (`-.-x`, `==o`), and start with one where it ends
 * in one (`o-.-o`, `x==o`). */
const FLOWCHART_LINK_BODY = String.raw`~{3,}|[xo]-?\.+-[xo]|-?\.+-[>xo]?|[xo]={2,}[xo]|={2,}[>xo]|={3,}|o-{2,}o|o-{2,}x|x-{2,}o|x-{2,}x|-{2,}[ox]|-{2,}>|-{3,}`
export const FLOWCHART_LINK_RE = new RegExp(`(<)?(${FLOWCHART_LINK_BODY})`, 'y')
/** The link grammar as a pattern without groups, to build other expressions on. */
export const FLOWCHART_LINK_SOURCE = `<?(?:${FLOWCHART_LINK_BODY})`
/**
 * An edge id before its `@` (upstream's LINK_ID `[^\s"]+@`), as a pattern:
 * a run of anything but whitespace and `"`. Ours leaves out the characters
 * that open or close a region here (`[](){}|<>`), `;`, which ends a
 * statement, and `@`, which upstream reads out of the id (`e1@x@` is
 * `e1x@` there), and an id that begins with a link or a text-arrow opener,
 * an `x` or `o` start marker included, which upstream reads as one after a
 * blank (`x--e1@--x` is the label `e1@` between `x--` and `--x` there).
 */
export const FLOWCHART_EDGE_ID_SOURCE = String.raw`(?!${FLOWCHART_LINK_SOURCE}|[xo]?(?:-{2,}|-\.|={2,}))[^\s"@[\](){}|<>;]+`
/** A text-arrow label's opening link, with its start marker (`<`, or `x` or
 * `o` in upstream's `x-- a --x`). */
const TEXT_ARROW_OPEN_RE = /([<xo])?(-{2,}|-\.+|={2,})/y

/** A text-arrow label's stroke, which decides the link that can close it;
 * `mixed` is ours alone: a link of any stroke. */
type TextArrowStroke = 'solid' | 'thick' | 'dotted'
type TextArrowCloser = TextArrowStroke | 'mixed'

/** The link that closes a text-arrow label, per stroke, as upstream's edge
 * text states close (`flow.jison`): `--` by `--+[-xo>]`, `==` by
 * `==+[=xo>]`, `-.` by `-?\.+-[xo>]?`. */
const STROKE_CLOSER_SOURCE: Readonly<Record<TextArrowStroke, string>> = {
  solid: '-{2,}[-ox>]',
  thick: '={2,}[=>xo]',
  dotted: '-?\\.+-[>xo]?',
}
const TEXT_ARROW_CLOSER_SOURCE: Readonly<Record<TextArrowCloser, string>> = {
  ...STROKE_CLOSER_SOURCE,
  mixed: Object.values(STROKE_CLOSER_SOURCE).join('|'),
}
const TEXT_ARROW_CLOSE_RE = Object.fromEntries(Object.entries(TEXT_ARROW_CLOSER_SOURCE)
  .map(([stroke, source]) => [stroke, new RegExp(`(${source})`, 'y')])) as Record<TextArrowCloser, RegExp>
const TEXT_ARROW_CLOSE_AFTER_SPACE_RE = Object.fromEntries(Object.entries(TEXT_ARROW_CLOSER_SOURCE)
  .map(([stroke, source]) => [stroke, new RegExp(`\\s*(?:${source})`, 'y')])) as Record<TextArrowCloser, RegExp>

/** What upstream's edge text cannot hold, per stroke: its link character
 * doubled, unless that begins the link that closes it (`flow.jison` lexes the
 * second `--` of `-- x -- y -->` as no token). In a dotted label, `.-` always
 * begins a link. */
const TEXT_ARROW_STRAY_RE: Readonly<Record<TextArrowStroke, RegExp | undefined>> = {
  solid: /--/y,
  thick: /==/y,
  dotted: undefined,
}

function textArrowStroke(openOp: string): TextArrowStroke {
  return openOp.includes('.') ? 'dotted' : openOp.startsWith('=') ? 'thick' : 'solid'
}

function stickyMatch(expression: RegExp, text: string, at: number): RegExpExecArray | null {
  expression.lastIndex = at
  return expression.exec(text)
}

/** A character of upstream's node string (`flow.jison` NODE_STRING) other
 * than `-`: a letter or digit of any script, `_`, or one of `!"#$%&'*+.`?\/`. */
const NODE_STRING_CHAR_RE = /[\p{L}\p{N}_!"#$%&'*+.`?\\/]/u

/**
 * The length of the node id at `at`, as upstream's lexer reads one: a run of
 * node-string characters, and `:`, which its id grammar also takes in, where
 *   - `"` belongs to the id only after its first character (where an id
 *     would begin, it opens a string);
 *   - `&` begins an id (`&a`, and a lone `&`, as upstream's AMP token is an
 *     id token); a `&` after a node is read first as joining a `&` list;
 *   - `:` belongs to it unless `:::`, a class, begins there;
 *   - `-` belongs to it unless `-` or `.` follows (a link begins), so `A--x`
 *     and `A-.->` end the id before it, `A.-B` is one id, and so is the
 *     `odd-` of `odd->x]` (upstream's node string ends before `->`, and its
 *     id grammar takes the `-` in before the `>` that opens shape text).
 * An `x` or `o` in the run is a letter: `Go--xH` is `Go --x H`. Upstream's
 * `,` is left out, which `style` and `class` here read as a list separator,
 * and `=`, which upstream's lexer rejects in an id.
 */
export function flowchartNodeIdLength(text: string, at = 0): number {
  let end = at
  for (; end < text.length; end++) {
    const char = text[end]!
    if (char === '-') {
      const next = text[end + 1]
      if (next === '-' || next === '.') break
      continue
    }
    if (end === at && char === '"') break
    if (char === ':') {
      if (text.startsWith(':::', end)) break
      continue
    }
    if (!NODE_STRING_CHAR_RE.test(char)) break
  }
  return end - at
}

/** What pinned Mermaid's lexer reads as a delimiter in unquoted label text,
 * per context: its `text` state (shape text, a pipe label, a subgraph's
 * bracket title) ends text at any of `[](){}|"`; its trapezoid text, whose
 * runs take in `|` and a `"`, at a bracket; and its edge text (a text-arrow
 * label), lexed a character at a time, at a `"`, which opens a string. */
const LABEL_TEXT_DELIMITER_RE = {
  text: /[[\](){}|"]/,
  trapezoid: /[[\](){}]/,
  'edge-text': /"/,
} as const

export type FlowchartLabelContext = keyof typeof LABEL_TEXT_DELIMITER_RE

/**
 * Whether label text, as authored between its delimiters, holds a character
 * pinned Mermaid's lexer reads as a delimiter in that context, where upstream
 * rejects the label. Upstream's label may begin with a quoted (or markdown)
 * string, and then holds none of them; a string it leaves unclosed is
 * reported as an unclosed quote instead.
 */
export function labelTextHoldsDelimiter(raw: string, context: FlowchartLabelContext): boolean {
  let rest = raw
  if (raw.startsWith('"')) {
    const markdown = raw.startsWith('"`')
    const close = markdown ? raw.indexOf('`"', 2) : raw.indexOf('"', 1)
    if (close < 0) return false
    rest = raw.slice(close + (markdown ? 2 : 1))
  }
  return LABEL_TEXT_DELIMITER_RE[context].test(rest)
}

/** The characters pinned Mermaid's lexer reads in a subgraph title written
 * without quotes or brackets (its textNoTags): letters, ASCII digits,
 * blanks and `!"#$%&'*+-./:?\^_` and the backtick. */
const TITLE_TEXT_RE = /^[\p{L}0-9\s!"#$%&'*+\-./:?\\^_`]*$/u
/** What ends such a title there: a string opened inside it (a `"` that
 * begins a word), a link or link-label opener, and a class (`:::`). */
const TITLE_TOKEN_RE = /(?:^|\s)(?:"|\.+-)|--|-\.|->|:::/

/**
 * Whether a subgraph title written without a bracket title (`id[…]`) holds
 * what pinned Mermaid's lexer cannot read there, where upstream rejects the
 * statement: a leading quoted (or markdown) string it leaves unclosed, or,
 * after that string, text TITLE_TEXT_RE leaves out or TITLE_TOKEN_RE finds.
 */
export function subgraphTitleUnreadable(title: string): boolean {
  let rest = title
  if (title.startsWith('"')) {
    const markdown = title.startsWith('"`')
    const close = markdown ? title.indexOf('`"', 2) : title.indexOf('"', 1)
    if (close < 0) return true
    rest = title.slice(close + (markdown ? 2 : 1))
  }
  return !TITLE_TEXT_RE.test(rest) || TITLE_TOKEN_RE.test(rest)
}

/** Whether the `,` at `at` comes right after node id characters, where
 * upstream's id grammar takes it into the id (`A,B` is one node there).
 * Ours reads no `,` in a node id, since `style` and `class` read it as a
 * list separator. */
export function commaInNodeId(text: string, at: number): boolean {
  const before = text[at - 1]
  return text[at] === ',' && before !== undefined && (before === '-' || before === ':' || NODE_STRING_CHAR_RE.test(before))
}

/** Whether the `.` or `"` at `at` continues the node id before it, as
 * upstream's node string takes it in (`A.-B` and `` C`" `` are one id there,
 * `A .-> B` a link). Such a `.` begins no link, and such a `"` no string. */
export function continuesNodeId(text: string, at: number): boolean {
  return (text[at] === '.' || text[at] === '"') && at > 0 && NODE_STRING_CHAR_RE.test(text[at - 1]!)
}

/** The link operator at `at`, or null. */
export function matchFlowchartLink(text: string, at: number): { hasArrowStart: boolean; op: string; end: number } | null {
  const match = stickyMatch(FLOWCHART_LINK_RE, text, at)
  return match ? { hasArrowStart: Boolean(match[1]), op: match[2]!, end: at + match[0].length } : null
}

export interface TextArrowMatch {
  readonly hasArrowStart: boolean
  /** The opener's start marker: `<`, or upstream's `x` or `o`. */
  readonly startMark?: '<' | 'x' | 'o'
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
 * any stroke (`mixed`). Null when `at` does not open one, or when nothing
 * closes it (findTextArrow tells these apart).
 */
export function matchTextArrow(text: string, at: number): TextArrowMatch | null {
  const found = findTextArrow(text, at)
  return found && 'end' in found ? found : null
}

/**
 * matchTextArrow's link, or where upstream's lexer rejects the label before
 * any link closes it, the offset of the doubled link character it cannot hold
 * (TEXT_ARROW_STRAY_RE): `--` in `A -- x -- y --> B`, `A -- x;A-- y --> B` or
 * a label run on across lines into `A-- y`. Such a label does not close.
 */
export function findTextArrow(text: string, at: number): TextArrowMatch | { readonly stray: number } | null {
  const opener = stickyMatch(TEXT_ARROW_OPEN_RE, text, at)
  if (!opener) return null
  const own = closeTextArrow(text, at, opener, textArrowStroke(opener[2]!))
  return own && 'end' in own ? own : closeTextArrow(text, at, opener, 'mixed')
}

function textArrowStrays(text: string): boolean {
  const found = findTextArrow(text, 0)
  return found !== null && 'stray' in found
}

function closeTextArrow(text: string, at: number, opener: RegExpExecArray, stroke: TextArrowCloser): TextArrowMatch | { stray: number } | null {
  const labelFrom = at + opener[0].length
  const quote = wholeQuotedLabel(text, labelFrom, stroke)
  const stray = TEXT_ARROW_STRAY_RE[textArrowStroke(opener[2]!)]
  for (let index = quote ? quote.close + 1 : labelFrom; index < text.length; index++) {
    const closer = stickyMatch(TEXT_ARROW_CLOSE_RE[stroke], text, index)
    if (!closer) {
      if (stray && stickyMatch(stray, text, index)) return { stray: index }
      continue
    }
    const raw = text.slice(labelFrom, index)
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const labelStart = labelFrom + raw.length - raw.trimStart().length
    return {
      hasArrowStart: Boolean(opener[1]),
      ...(opener[1] ? { startMark: opener[1] as '<' | 'x' | 'o' } : {}),
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
 * begins; elsewhere it is text, as the parser's shape patterns read it. A
 * `"` at `textQuote` is text wherever it is. */
function lex(text: string, from: number, single: boolean, labelStrings: boolean, textQuote = -1): FlowchartScan {
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
    if (char === '"' && index !== textQuote && !(labelStrings && inner?.kind === 'shape' && index !== inner.contentStart) && !(inner === undefined && continuesNodeId(text, index))) {
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
    if (char === '-' || char === '=' || char === '<' || char === '~' || (char === '.' && !continuesNodeId(text, index))) {
      const link = matchFlowchartLink(text, index)
      if (link) {
        links.push({ start: index, end: link.end })
        topLevel.fill(true, index, link.end)
        index = link.end - 1
        continue
      }
      const opener = stickyMatch(TEXT_ARROW_OPEN_RE, text, index)
      const found = opener ? findTextArrow(text, index) : null
      const arrow = found && 'end' in found ? found : null
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
        // A label upstream rejects (findTextArrow) neither closes nor runs on
        // to the next line: what follows its opener is lexed as written.
        if (found) {
          index += opener[0].length - 1
          continue
        }
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

/** A statement whose operand is style properties. */
const STYLE_STATEMENT_RE = /^(?:style|classDef|linkStyle)\s/

/** Property text uses Mermaid's styleComponent tokens, not CSS's identifier
 * grammar. In particular backslashes, punctuation and whitespace can be text.
 * Scan in lexer order: `1class` is NUM then CLASS, while `xclass` is one
 * NODE_STRING. The appended colon supplies the actual declaration boundary. */
function portableStyleProperty(name: string): boolean {
  return !!name.trim() && !/[\r\n:;,]/.test(name) && portableStyleComponents(`${name}:`)
}

/** The inline style grammar consumes styleComponent tokens, not arbitrary
 * CSS text. Parentheses introduce shape text there; even a valid CSS color
 * function has no lossless inline-style spelling in this grammar. */
export function flowchartStyleValueCanSerialize(value: string, classDefinition = false): boolean {
  // Only classDef's DB constructor rejoins style fragments and resolves `\,`.
  // Direct node/link styles retain the split fragments as separate properties.
  const parts = classDefinition ? value.split(',') : [value]
  return !!value.trim() && !value.startsWith('::') && !/[\r\n]/.test(value) && parts.every(part => !!part.trim() && portableStyleComponents(part))
}

function portableStyleComponents(value: string): boolean {
  if (/direction\s+(?:TB|BT|RL|LR|TD)|:::/.test(value)) return false
  let rest = value
  while (rest) {
    // These earlier lexer rules produce statement/link/string tokens, which
    // styleComponent cannot consume. Accessibility requires its own colon;
    // `accTitle-color` is ordinary text, unlike `class-color`.
    if (/^(?:acc(?:Title|Descr)\s*:|(?:call|href|click)\s|(?:classDef|class|linkStyle|default|end|graph|flowchart|subgraph|swimlane-beta|interpolate|_self|_blank|_parent|_top|v)\b|["&*]|[xo]?(?:--|-\.)|[xo]?-?\.+-)/.test(rest)) return false
    const token = /^(?:style\b|[0-9]+|[:#]|[^\S\r\n]+)/.exec(rest)
      ?? /^(?:[A-Za-z0-9!"#$%&'*+.`?\\_/]|-(?=[^>\-.]))+/.exec(rest)
    if (!token) return false
    rest = rest.slice(token[0].length)
  }
  return true
}

/** Shared by source admission, typed style edits and Flowchart serialization. */
export function checkedFlowchartStyleProps<T extends Readonly<Record<string, string>>>(style: T): T {
  for (const name of Object.keys(style)) {
    if (!portableStyleProperty(name)) throw syntaxError({
      what: `Invalid style property name ${JSON.stringify(name)}`,
      expectedForm: 'property text that does not introduce Mermaid statements, links or shape delimiters',
      example: 'style A background:#bbb,border:1px solid red',
    })
  }
  return style
}
/** Text that is style properties alone (`stroke:#0a0, stroke-width:2px`):
 * a property name and `:` first, and no link, class, `&` list, metadata,
 * shape text or string. */
const STYLE_PROPERTIES_RE = new RegExp(String.raw`^[a-zA-Z][\w-]*\s*:(?!:)(?:(?!${FLOWCHART_LINK_SOURCE}|:::)[^&@"[\]{}|])*$`)

/** The statements of one line: the text between statement-level `;`, with
 * each statement's trimmed offset. Empty statements are dropped. Upstream's
 * `end` token takes the whitespace after it, so a statement may follow it on
 * its line (`end B`). A `;` between style properties (`style A fill:#f9f;
 * stroke:#0a0`) separates them, as in CSS, and ends no statement; upstream
 * ends the statement there, and reads what follows as a node, or, after a
 * `#` color, as more of that color. */
export function flowchartStatementSpans(text: string, scan: FlowchartScan = scanFlowchart(text)): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = []
  let start = 0
  for (const end of [...scan.separators, text.length]) {
    const raw = text.slice(start, end)
    const trimmed = raw.trim()
    const at = start + raw.length - raw.trimStart().length
    const keyword = /^end\s+/.exec(trimmed)
    const last = out.at(-1)
    if (keyword) out.push({ text: 'end', start: at }, { text: trimmed.slice(keyword[0].length), start: at + keyword[0].length })
    else if (trimmed && last && STYLE_STATEMENT_RE.test(last.text) && STYLE_PROPERTIES_RE.test(trimmed)) last.text = text.slice(last.start, at + trimmed.length)
    else if (trimmed) out.push({ text: trimmed, start: at })
    start = end + 1
  }
  return out
}

/** Physical lines read as one statement group. */
export interface FlowchartLineGroup {
  text: string
  /** The 0-based index of the group's first line, which `text` begins with
   * whole. */
  line: number
  /** Each later line joined on: where its text begins in `text`, its index,
   * and the column it begins at in that line. */
  joined?: Array<{ at: number; line: number; col: number }>
  /** An accTitle/accDescr directive, which source normalization reads: no
   * flowchart statement. */
  directive?: true
}

/** The 0-based line and column a group's `offset` came from. An offset in
 * the text joining two lines (`<br>`) is placed after the first. */
export function flowchartGroupPosition(group: FlowchartLineGroup, offset: number): { line: number; col: number } {
  const joined = group.joined ?? []
  let low = 0
  let high = joined.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (joined[middle]!.at <= offset) low = middle + 1
    else high = middle
  }
  const piece = low === 0 ? { at: 0, line: group.line, col: 0 } : joined[low - 1]!
  return { line: piece.line, col: piece.col + offset - piece.at }
}

/** Upstream nests no shape text, so the most regions a line it reads leaves
 * open is a triple delimiter (`(((`), a markdown string and a string in it.
 * A line left deeper ends where it ends, which keeps the openers carried on
 * to each next line (continuationPrefix) few. */
const MAX_CONTINUED_REGIONS = 5

/** A statement whose text no link or label continues onto another line, and
 * which a link on the line before does not take in (upstream lexes `end`,
 * `subgraph`, … there as keywords, not as a node). */
const KEYWORD_STATEMENT_RE = /^(?:(?:end|subgraph|classDef|class|style|linkStyle|click|href|accTitle|accDescr)(?![\w-])|direction\s)/

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
 * continues one, or a string in a `click` or `href` statement (its link or
 * tooltip). `line` is the 0-based index of each group's first line.
 *
 * Upstream's lexer reads `accTitle:` to the end of its line and `accDescr {`
 * to its `}`, whatever they hold. A line that begins a statement with one of
 * the directives source normalization reads (shared/accessibility-directives.ts)
 * is a group of its own, `\n`-joined across a block, that nothing continues.
 *
 * Upstream reads a string in shape text only where the text begins
 * (`A["a⏎b"]`) and rejects one opened later. Here such a `"` is text, as the
 * parser's shape patterns read it on one line (`A[x " y]`), so a `&quot;` the
 * render path decodes joins lines as the authored entity does.
 */
export function coalesceFlowchartLines(lines: readonly string[]): FlowchartLineGroup[] {
  const out: FlowchartLineGroup[] = []
  const scanLine = (text: string): FlowchartScan => lex(text, 0, false, true)
  let group: FlowchartLineGroup | undefined
  // The last line of `group` as lexed (behind the openers that put the lexer
  // in the state it began in), and whether its last statement is a keyword
  // statement.
  let scanned = ''
  let scan = scanLine(scanned)
  let keyword = false
  // Of the keyword statements, upstream lexes a `click` or `href` statement's
  // strings (its link, its tooltip) as strings, which run on across lines.
  let clickString = false
  // Of the keyword statements, upstream lexes a subgraph's `id[…]` or `"…"`
  // title as a label, which runs on across lines to its closer. Ours carries
  // it on only when the first later line to hold one of its delimiters closes
  // it there, with nothing after but a `;`: an unclosed title cannot take in
  // the statements after it, nor close on a node's `]`.
  let title: SubgraphTitle | undefined
  const titleCloses = new Map<SubgraphTitle, Uint8Array>()
  const titleClosesFrom = (index: number, kind: SubgraphTitle): boolean => {
    let closes = titleCloses.get(kind)
    if (!closes) {
      // Once per kind, from the last line back.
      const { delimiter, closer, after } = SUBGRAPH_TITLE_RULES[kind]
      closes = new Uint8Array(lines.length + 1)
      for (let at = lines.length - 1; at >= 0; at--) {
        const line = lines[at]!
        const found = line.search(delimiter)
        closes[at] = found < 0 ? closes[at + 1]! : Number(line[found] === closer && after.test(line.slice(found + 1)))
      }
      titleCloses.set(kind, closes)
    }
    return closes[index] === 1
  }
  // Upstream reads a string where shape text begins (`A["a⏎b"]`) across
  // lines to the next `"`. Ours carries one on only when the first later line
  // holding a `"` closes it there, before a shape closer; otherwise its `"`
  // is text, as a `"` later in the label is, and the label runs on to the
  // shape's closer. So a `&quot;` the render path decodes where a label
  // begins joins lines as the authored entity does.
  let labelStringCloses: Uint8Array | undefined
  const labelStringClosesFrom = (index: number): boolean => {
    if (!labelStringCloses) {
      labelStringCloses = new Uint8Array(lines.length + 1)
      for (let at = lines.length - 1; at >= 0; at--) {
        const line = lines[at]!
        const found = line.indexOf('"')
        labelStringCloses[at] = found < 0 ? labelStringCloses[at + 1]! : Number(/^\s*[\])}]/.test(line.slice(found + 1)))
      }
    }
    return labelStringCloses[index] === 1
  }
  // The last line of the accessibility directive starting at `index`. Once
  // one `accDescr {` is unclosed, no later line holds a `}`: a later opener
  // is not scanned to the end again.
  let unclosedDescription = false
  const directiveEnd = (index: number): number | undefined => {
    const line = lines[index]!
    if (!/^\s*acc(?:Title|Descr)/i.test(line) || (unclosedDescription && /^\s*accDescr\s*:?\s*\{[^}]*$/i.test(line))) return undefined
    const directive = parseAccessibilityDirective(lines, index)
    if (directive === undefined) unclosedDescription = true
    return directive?.endIndex
  }
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!
    const trimmed = raw.trim()
    const open = scan.openAtEnd
    // Upstream reads a string only where it opens its label (`["a⏎b"]`,
    // `|"a⏎b"|`), and rejects a line with one opened mid-label. Such a line
    // (a string in a markdown string) ends where it ends.
    const midLabelString = scan.regions.some(region => region.kind === 'string' && region.parent >= 0 && region.start !== scan.regions[region.parent]!.contentStart)
    const subgraphTitle = title !== undefined && titleClosesFrom(index, title)
    const inRegion = group !== undefined && open.length > 0 && open.length <= MAX_CONTINUED_REGIONS && !midLabelString
      && (open[0] === 'metadata' || open.includes('markdown') || !keyword || subgraphTitle || (clickString && open.length === 1 && open[0] === 'string'))
      // Upstream's lexer rejects a text-arrow label that takes in a `--`
      // (`==`) that does not close it (findTextArrow): a line that would put
      // one in is no part of the label.
      && !(open[0] === 'edge-text' && textArrowStrays(`${continuationPrefix(scanned, scan).prefix}${trimmed}`))
    if (!inRegion && (!trimmed || trimmed.startsWith('%%'))) {
      out.push({ text: raw, line: index })
      continue
    }
    const directive = inRegion ? undefined : directiveEnd(index)
    if (directive !== undefined) {
      group = { text: raw, line: index, directive: true }
      out.push(group)
      for (let at = index + 1; at <= directive; at++) {
        ;(group.joined ??= []).push({ at: group.text.length + 1, line: at, col: 0 })
        group.text += `\n${lines[at]!}`
      }
      index = directive
      scanned = ''
      scan = scanLine(scanned)
      keyword = true
      clickString = false
      title = undefined
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
      if (group && !keyword && ((endsWithLink && !KEYWORD_STATEMENT_RE.test(trimmed)) || lineScan.links[0]?.start === 0)) joint = ' '
    }
    const leading = leadingLabelString(lineScan)
    if (leading !== undefined && !labelStringClosesFrom(index + 1)) lineScan = lex(text, 0, false, true, leading)
    if (joint === undefined) {
      group = { text: raw, line: index }
      out.push(group)
    } else {
      const piece = joint === '\n' ? raw : trimmed
      const col = joint === '\n' ? 0 : raw.length - raw.trimStart().length
      ;(group!.joined ??= []).push({ at: group!.text.length + joint.length, line: index, col })
      group!.text += `${joint}${piece}`
    }
    const last = flowchartStatementSpans(text, lineScan).at(-1)
    if (joint === undefined || (last && last.start > 0)) {
      keyword = last !== undefined && KEYWORD_STATEMENT_RE.test(last.text)
      clickString = last !== undefined && /^(?:click|href)\s/.test(last.text)
      title = last !== undefined && /^subgraph\s/.test(last.text) ? subgraphTitleAt(text, lineScan, last) : undefined
    }
    scanned = text
    scan = lineScan
  }
  return out
}

/**
 * For each of `lines`, the last line of the statement that starts there, as
 * the parser joins them (coalesceFlowchartLines). The parser reads the lines
 * trimmed, without blank and `%%` lines, so this does too; such a line between
 * a statement's first and last line is inside it.
 */
export function flowchartStatementEnds(lines: readonly string[]): number[] {
  const ends = lines.map((_, index) => index)
  const read: number[] = []
  const texts: string[] = []
  lines.forEach((line, index) => {
    const text = line.trim()
    if (text && !text.startsWith('%%')) { read.push(index); texts.push(text) }
  })
  for (const group of coalesceFlowchartLines(texts)) {
    const last = group.joined?.at(-1)?.line
    if (last !== undefined) ends[read[group.line]!] = read[last]!
  }
  return ends
}

/** The offset of a string left open at the end of `scan` where its shape
 * text begins (`A["a`), or undefined. */
function leadingLabelString(scan: FlowchartScan): number | undefined {
  const inner = scan.regions.filter(region => !region.closed).at(-1)
  const shape = inner && inner.parent >= 0 ? scan.regions[inner.parent] : undefined
  return inner?.kind === 'string' && shape?.kind === 'shape' && inner.start === shape.contentStart ? inner.start : undefined
}

/** An open subgraph title: `id[…`, `"…` where the title begins, or `id["…`. */
type SubgraphTitle = 'bracket' | 'string' | 'bracketString'

/** Per title, the characters that end its text on a later line (a `"` is
 * text in shape text there), the one of them that closes it, and what may
 * follow the closer on its line. */
const SUBGRAPH_TITLE_RULES: Readonly<Record<SubgraphTitle, { delimiter: RegExp; closer: string; after: RegExp }>> = {
  bracket: { delimiter: /[[\](){}]/, closer: ']', after: /^\s*(?:;|$)/ },
  string: { delimiter: /"/, closer: '"', after: /^\s*(?:;|$)/ },
  bracketString: { delimiter: /"/, closer: '"', after: /^\s*\]\s*(?:;|$)/ },
}

/** The title a `subgraph` statement leaves open at the end of `text`, where
 * upstream reads one: a string only where the title begins, not after other
 * title text (`subgraph X "a`), which upstream rejects. */
function subgraphTitleAt(text: string, scan: FlowchartScan, statement: { text: string; start: number }): SubgraphTitle | undefined {
  const open = scan.regions.filter(region => !region.closed)
  const [outer, inner] = open
  const titleStart = statement.start + /^subgraph\s+/.exec(statement.text)![0].length
  if (open.length === 1 && outer!.kind === 'string' && outer!.start === titleStart) return 'string'
  if (outer?.kind !== 'shape' || text[outer.start] !== '[' || /[[\]"]/.test(text.slice(titleStart, outer.start))) return undefined
  if (open.length === 1) return 'bracket'
  return open.length === 2 && inner!.kind === 'string' && inner!.start === outer.contentStart ? 'bracketString' : undefined
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
  // A text-arrow label's closer depends only on its stroke: a long opener
  // (`-.......`) is not carried on to each line.
  const opener = (region: FlowchartRegion): string => region.kind === 'edge-text'
    ? TEXT_ARROW_OPENER[textArrowStroke(text.slice(region.start, region.contentStart).replace(/^</, ''))]
    : text.slice(region.start, region.contentStart)
  return { prefix: `${open.map(opener).join('')} ${standIn}`, blank: first === undefined }
}

const TEXT_ARROW_OPENER: Readonly<Record<TextArrowStroke, string>> = { solid: '--', thick: '==', dotted: '-.' }

/** An XML character reference, as the render path decodes one. */
const XML_REFERENCE_RE = /&(?:(quot|amp|lt|gt|apos)|#(\d+)|#[xX]([0-9a-fA-F]+));/g

/**
 * A flowchart's lines with each XML character reference in label text (a
 * string, shape text, a pipe or text-arrow label, a metadata block) written
 * as the Mermaid entity code for its character (`&quot;` as `#quot;`,
 * `&#x22;` as `#34;`), which the label shows as that character and the lexer
 * reads as text. A reference elsewhere stays as written, where Mermaid's
 * parser reads it as text and `;` (`subgraph &quot;x` is the title `&quot`).
 * A code point no label may show (a control), and any reference in a
 * `click` or `href` statement, is decoded, as the render path decodes it;
 * the writers report and replace a control.
 */
export function labelReferencesAsEntityCodes(text: string): string {
  if (!text.includes('&')) return text
  const lines = text.split('\n')
  // Per line, the references to rewrite, last first.
  const edits = new Map<number, Array<{ col: number; length: number; code: string }>>()
  for (const group of coalesceFlowchartLines(lines)) {
    if (group.directive || !group.text.includes('&')) continue
    const scan = scanFlowchart(group.text)
    // A `click` or `href` statement holds a link and a tooltip, no label: it
    // reads its references decoded, as the render path decodes them.
    const interactions = flowchartStatementSpans(group.text, scan).filter(statement => /^(?:click|href)\s/i.test(statement.text))
    for (const match of group.text.matchAll(XML_REFERENCE_RE)) {
      const at = match.index
      const interaction = interactions.some(statement => at >= statement.start && at < statement.start + statement.text.length)
      if (!interaction && !scan.regions.some(region => at >= region.contentStart && at + match[0].length <= region.contentEnd)) continue
      const point = match[1] === undefined ? (match[2] !== undefined ? Number(match[2]) : Number.parseInt(match[3]!, 16)) : undefined
      const shown = !interaction && (point === undefined || (point > 0 && point <= 0x10ffff && (point < 0xd800 || point > 0xdfff) && !TERMINAL_CONTROL_RE.test(String.fromCodePoint(point))))
      const { line, col } = flowchartGroupPosition(group, at)
      const list = edits.get(line) ?? []
      list.unshift({ col, length: match[0].length, code: shown ? `#${match[1] ?? point};` : decodeXML(match[0]) })
      edits.set(line, list)
    }
  }
  for (const [line, list] of edits) {
    let written = lines[line]!
    for (const { col, length, code } of list) written = written.slice(0, col) + code + written.slice(col + length)
    lines[line] = written
  }
  return lines.join('\n')
}

/** The trimmed text-arrow labels of a line. */
export function flowchartTextArrowLabelRanges(text: string, scan: FlowchartScan = scanFlowchart(text)): FlowchartTextRange[] {
  return scan.regions.filter(region => region.kind === 'edge-text').map(region => ({ start: region.contentStart, end: region.contentEnd }))
}
