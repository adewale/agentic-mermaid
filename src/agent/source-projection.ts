// ============================================================================
// Source projection: a typed edit to a structured body, written as the
// smallest change to the source it was read from.
//
// The canonical writer is a function of the typed model, so the line
// difference between canonical(before) and canonical(after) is exactly what
// the edit changed. Each canonical statement of `before` is traced to the
// authored line that produced it: the line the family source map locates for
// the same identity, else a line already in canonical spelling, else the line
// whose isolated reading (the family parser and writer on that line alone)
// contains it; respelled block contents pair by order. The difference is then
// replayed on the authored lines: a changed token is spliced into the line
// that spells it, a line whose every statement goes away is deleted (with any
// declaration folded into them), and a new statement is written in canonical,
// portable spelling beside its neighbour, indented like its authored
// siblings. Every other line is copied byte for byte.
//
// The projection only proposes. A few placement variants are tried, those
// that rewrite the fewest authored lines first (ties in a fixed order), and
// a candidate is returned only when the shared parser reads it back as the
// same diagram as the canonical result: the same facts and the same canonical
// statements (whose incidental order may follow the authored order). When no
// candidate does, a second pass traces statements written over several
// physical lines as one authored line, and traces a statement the parser
// merges from several declarations (a label given again, a class named by
// each `Class : member` line, a block opened twice) to every line it is read
// from: a change is spliced into each line that spells it, a removal takes
// every line that declares nothing else, and a new member of a block written
// as separate lines is spelled like its authored siblings. The caller
// otherwise writes the canonical source and says why: the closest
// candidate's misreading, or the statement that could not be placed.
// ============================================================================

import { describeMermaidFacts } from './facts.ts'
import { parseRegisteredMermaid } from './parse.ts'
import { serializeBodyStatements, wrapperPrefix } from './serialize.ts'
import { sameSourceMeaning } from './source-mutation.ts'
import type { DiagramBody, ParsedDiagram, Result, SourceMap } from './types.ts'
import { err, ok } from './types.ts'
import { getFamily } from './families.ts'

/** How a source-preserving edit of a structured body was written. */
export interface SourceEditPreservation {
  /** `local`: every authored line the edit does not touch is copied byte for
   * byte. `canonical`: no local splice reproduced the edit, so the whole
   * diagram was re-serialized canonically (comments and spelling may change). */
  readonly method: 'local' | 'canonical'
  /** Why the local projection was not used, for `canonical`. */
  readonly reason?: string
}

interface AuthoredLine { readonly text: string; readonly eol: string }

/** Authored lines are skipped as owners: they hold no family statement. */
const inert = (text: string) => !text.trim() || text.trim().startsWith('%%')
const leading = (text: string) => /^[ \t]*/.exec(text)![0]
/** Canonical nesting depth; a verbatim tab counts as one two-space level. */
const depthOf = (text: string) => leading(text).replace(/\t/g, '  ').length
const WORDS = /[\p{L}\p{N}_]+/gu
const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char)
const MAX_DIFF_CELLS = 4_000_000

function splitLines(text: string): AuthoredLine[] {
  const lines: AuthoredLine[] = []
  const pattern = /\r\n|\n|\r/g
  let start = 0
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    lines.push({ text: text.slice(start, match.index), eol: match[0] })
    start = match.index + match[0].length
  }
  if (start < text.length) lines.push({ text: text.slice(start), eol: '' })
  return lines
}

/** Canonical statements of a structured diagram, header first. */
function statements(d: ParsedDiagram): string[] | undefined {
  if (d.body.kind === 'opaque' || d.body.kind === 'preserved' || d.body.kind === 'extension') return undefined
  try {
    return serializeBodyStatements(d).replace(/\n+$/, '').split('\n')
  } catch {
    return undefined
  }
}

function counts(lines: readonly string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const line of lines) if (line.trim()) result.set(line.trim(), (result.get(line.trim()) ?? 0) + 1)
  return result
}

/** The same diagram: identical facts (which carry every ordered meaning) and
 * the same canonical statements, whose incidental order may differ. */
export function sameProjectedDiagram(candidate: ParsedDiagram, expected: ParsedDiagram, expectedFacts = describeMermaidFacts(expected), expectedLines = statements(expected)): boolean {
  if (candidate.kind !== expected.kind || candidate.body.kind !== expected.body.kind || !expectedLines) return false
  const lines = statements(candidate)
  if (!lines) return false
  const sorted = (values: readonly string[]) => [...values].sort()
  if (!sameSourceMeaning(sorted(describeMermaidFacts(candidate)), sorted(expectedFacts))) return false
  // A segment kept verbatim and the same statements written canonically differ
  // only in spacing; the facts above still compare every label exactly.
  const spelled = (values: readonly string[]) => sorted(values.map(line => line.replace(/\s+/g, '')).filter(Boolean))
  if (!sameSourceMeaning(spelled(lines), spelled(expectedLines))) return false
  const meta = (d: ParsedDiagram) => ({ frontmatter: d.meta.frontmatter, accessibility: d.meta.accessibility, init: d.meta.initDirectives.map(layer => layer.parsed) })
  return sameSourceMeaning(meta(candidate), meta(expected))
}

interface Trace {
  /** The authored line that produced each canonical statement, or -1. */
  readonly owner: number[]
  /** Authored lines that produce no canonical statement of their own, with
   * the statements the writer folds their reading into (a declaration the
   * writer writes inline on an edge). */
  readonly folded: ReadonlyMap<number, readonly number[]>
  /** Structural pass: every authored line each traced statement is read from,
   * its owner first: lines that redeclare it (a class named again by each
   * `Class : member` line, an entity block opened twice), lines folded into
   * it, and the closers of redeclared blocks. */
  readonly parts?: ReadonlyMap<number, readonly number[]>
  /** Structural pass: canonical block openers no authored block spells (a
   * class whose members are `Class : member` lines). */
  readonly implicit?: ReadonlySet<number>
  /** Structural pass: each authored line's isolated reading. */
  readonly readings?: ReadonlyArray<ReadonlyMap<string, number>>
}

interface LineReader {
  /** The canonical statements an authored statement reads as on its own (the
   * family parser and writer on it alone under the header, closing a block it
   * opens), less the header's own and block closers; undefined when it does
   * not parse alone. */
  isolated(text: string): Map<string, number> | undefined
  /** Whether an authored statement opens a block that a later `end` or `}`
   * line closes: it reads only with that closer, or reads as a block both
   * alone and with it. */
  opens(text: string): boolean
  /** Whether a statement reads as the diagram's statements on its own (a
   * message or node does; a branch line like `else` or a member does not). */
  alone(text: string): boolean
}

const closesBlock = (statement: string) => statement.trim() === 'end' || statement.trim() === '}'

/** Isolated readings, cached by text: a fallback pass re-reads the same lines. */
function lineReader(wrapper: string, header: string): LineReader {
  const cache = new Map<string, Map<string, number> | undefined>()
  const sources = new Map<string, Map<string, number> | undefined>()
  const read = (source: string): Map<string, number> | undefined => {
    if (!sources.has(source)) {
      const parsed = parseRegisteredMermaid(source)
      const found = parsed.ok ? statements(parsed.value) : undefined
      sources.set(source, found ? counts(found.slice(1)) : undefined)
    }
    return sources.get(source)
  }
  let base: Map<string, number> | undefined
  const isolated = (text: string): Map<string, number> | undefined => {
    base ??= read(`${wrapper}${header}\n`) ?? new Map<string, number>()
    for (const closer of ['', '\nend', '\n}']) {
      const reading = read(`${wrapper}${header}\n${text}${closer}`)
      if (!reading) continue
      const found = new Map(reading)
      // A block closer is its own authored line, never part of another.
      for (const [line, count] of [...base, ['end', Infinity], ['}', Infinity]] as const) {
        const left = (found.get(line) ?? 0) - count
        if (left > 0) found.set(line, left)
        else found.delete(line)
      }
      return found
    }
    return undefined
  }
  const block = (reading: ReadonlyMap<string, number>) => [...reading.keys()].some(closesBlock)
  return {
    isolated(text) {
      if (!cache.has(text)) cache.set(text, isolated(text))
      return cache.get(text)
    },
    alone(text) {
      return read(`${wrapper}${header}\n${text.trim()}`) !== undefined
    },
    opens(text) {
      const alone = read(`${wrapper}${header}\n${text}`)
      if (alone && !block(alone)) return false
      return ['\nend', '\n}'].some(closer => {
        const closed = read(`${wrapper}${header}\n${text}${closer}`)
        return closed !== undefined && (!alone || block(closed))
      })
    },
  }
}

/** A value may continue on later physical lines (a quoted label written over
 * several lines, an edge whose target is on the next line). A line that does
 * not read alone is joined with the lines after it until the joined text
 * reads as statements of the diagram; the joined lines are then one authored
 * statement, edited, kept or removed together. */
const MAX_SPLIT_LINES = 12
function joinSplitValues(lines: readonly AuthoredLine[], c0: readonly string[], reader: LineReader): AuthoredLine[] {
  const canonical = counts(c0.slice(1))
  const joined: AuthoredLine[] = []
  for (let at = 0; at < lines.length; at++) {
    let line = lines[at]!
    const trimmed = line.text.trim()
    if (at > 0 && !inert(line.text) && !canonical.has(trimmed) && !reader.isolated(trimmed)) {
      let { text, eol } = line
      for (let next = at + 1; next < lines.length && next - at <= MAX_SPLIT_LINES; next++) {
        text += eol + lines[next]!.text
        eol = lines[next]!.eol
        const found = reader.isolated(text.trim())
        if (found?.size && [...found.keys()].every(statement => canonical.has(statement))) { line = { text, eol }; at = next; break }
      }
    }
    joined.push(line)
  }
  return joined
}

/** Which authored line produced each canonical statement of `before`: the
 * statement the family's source map locates for the same identity, else a
 * line already in canonical spelling, else the line whose own canonical
 * reading contains it. Nearby lines win ties, so repeated text stays in order. */
function traceOwners(wrapper: string, lines: readonly AuthoredLine[], c0: readonly string[], before: ParsedDiagram, reader: LineReader, structural = false): Trace {
  const owner = c0.map(() => -1)
  const folded = new Map<number, number[]>()
  if (!lines.length) return { owner, folded }
  owner[0] = 0
  const starts: number[] = []
  let offset = wrapper.length
  for (const line of lines) { starts.push(offset); offset += line.text.length + line.eol.length }
  const lineAt = (at: number) => {
    let low = 0, high = starts.length - 1
    while (low < high) { const mid = (low + high + 1) >> 1; if (starts[mid]! <= at) low = mid; else high = mid - 1 }
    return low
  }
  const spans = before.source.spans
  let located: SourceMap | undefined
  try { located = spans ? getFamily(before.kind)?.buildSourceMap?.(before.body as DiagramBody, c0.join('\n') + '\n') : undefined } catch { located = undefined }
  if (spans && located) {
    for (const collection of ['edges', 'groups', 'nodes'] as const) {
      for (const [key, location] of located[collection]) {
        const span = spans[collection].get(key), index = location.line - 1
        if (!span || index <= 0 || index >= c0.length || owner[index]! >= 0 || span.start.offset < wrapper.length) continue
        const line = lineAt(span.start.offset)
        if (line > 0 && !inert(lines[line]!.text)) owner[index] = line
      }
    }
  }
  const canonical = counts(c0.slice(1))
  const readings = lines.map(({ text }, index) => {
    const trimmed = text.trim()
    // A family that keeps comments as verbatim segments writes them back.
    if (index === 0 || !trimmed || (inert(text) && !canonical.has(trimmed))) return new Map<string, number>()
    if (canonical.has(trimmed)) return new Map([[trimmed, 1]])
    return reader.isolated(trimmed) ?? new Map([[trimmed, 1]])
  })
  const remaining = readings.map(reading => new Map(reading))
  let last = 0
  for (let index = 1; index < c0.length; index++) {
    const wanted = c0[index]!.trim()
    if (owner[index]! >= 0) { last = owner[index]!; continue }
    if (!wanted) continue
    for (let step = 0; step < lines.length; step++) {
      const candidate = (last + step) % lines.length
      const left = remaining[candidate]!.get(wanted) ?? 0
      if (left <= 0) continue
      remaining[candidate]!.set(wanted, left - 1)
      owner[index] = candidate
      last = candidate
      break
    }
  }
  // Statements respelled inside a block (attributes the writer quotes, say)
  // keep their order: a run of untraced statements between two traced ones
  // pairs with the same number of untraced authored lines between their owners.
  const owning = new Set(owner)
  for (let start = 1; start < c0.length;) {
    if (owner[start]! >= 0 || !c0[start]!.trim()) { start++; continue }
    let end = start
    while (end < c0.length && owner[end]! < 0 && c0[end]!.trim()) end++
    const from = owner[start - 1]!, to = end < c0.length ? owner[end]! : lines.length
    const free = from >= 0 && to > from ? lines.slice(from + 1, to).flatMap((line, offset) => !inert(line.text) && !owning.has(from + 1 + offset) ? [from + 1 + offset] : []) : []
    if (free.length === end - start) free.forEach((line, offset) => { owner[start + offset] = line })
    start = end
  }
  const blocks = structural ? traceBlocks(lines, c0, owner, remaining, reader) : undefined
  const traced = new Set(owner)
  readings.forEach((reading, line) => {
    if (traced.has(line) || inert(lines[line]!.text)) return
    const into = c0.flatMap((statement, index) => index > 0 && [...reading.keys()].some(read => read !== statement.trim() && containsToken(statement, read)) ? [index] : [])
    if (into.length) folded.set(line, into)
  })
  if (!blocks) return { owner, folded }
  // Every authored line a statement is read from: its owner, lines whose
  // reading repeats it (attached to the nearest such statement before them),
  // lines folded into it, and the closers of blocks that redeclare it.
  const parts = new Map<number, number[]>()
  owner.forEach((line, index) => { if (index > 0 && line >= 0) parts.set(index, [line]) })
  const byText = new Map<string, number[]>()
  for (const index of parts.keys()) byText.set(c0[index]!.trim(), [...byText.get(c0[index]!.trim()) ?? [], index])
  readings.forEach((reading, line) => {
    for (const read of reading.keys()) {
      const indices = byText.get(read)
      if (!indices || indices.some(index => owner[index] === line)) continue
      const target = indices.filter(index => owner[index]! < line).at(-1) ?? indices[0]!
      parts.get(target)!.push(line)
    }
  })
  for (const [line, into] of folded) for (const index of into) parts.get(index)?.push(line)
  for (const [line, indices] of blocks.redeclares) if (!folded.has(line)) for (const index of indices) parts.get(index)?.push(line)
  // A line whose reading spells words none of its own statements carry (a
  // label the writer moves to the node's first mention) is read into the
  // statements that carry them all.
  const carried = c0.map(statement => new Set(statement.match(WORDS) ?? []))
  const ownWords = new Map<number, Set<string>>()
  owner.forEach((line, index) => {
    if (index === 0 || line < 0) return
    const own = ownWords.get(line) ?? new Set<string>()
    for (const word of carried[index]!) own.add(word)
    ownWords.set(line, own)
  })
  for (const [line, own] of ownWords) {
    const surplus = [...readings[line]!.keys()].flatMap(read => read.match(WORDS) ?? []).filter(word => !own.has(word))
    if (!surplus.length) continue
    c0.forEach((statement, index) => {
      if (index === 0 || owner[index]! < 0 || owner[index] === line || closesBlock(statement)) return
      if (surplus.every(word => carried[index]!.has(word)) && !parts.get(index)!.includes(line)) parts.get(index)!.push(line)
    })
  }
  // The closer of an authored block goes with what it closes: the canonical
  // closer, for a block that redeclares another, else the statement its
  // opener is read as (`class A {` and `}` read as a bare `class A`).
  const owners = new Set(owner)
  for (const [index, list] of parts) {
    const closer = blocks.closerOf.get(index)
    for (const line of [...list]) {
      const close = blocks.authoredCloser.get(line)
      if (close === undefined) continue
      if (closer !== undefined) { if (line !== list[0] && !parts.get(closer)!.includes(close)) parts.get(closer)!.push(close) }
      else if (!owners.has(close) && !list.includes(close)) list.push(close)
    }
  }
  return { owner, folded, parts, implicit: blocks.implicit, readings }
}

/**
 * The structural pass's tracing of redeclared statements and of blocks.
 * A statement still untraced is owned by the authored line whose unread
 * reading is most like it (a participant declared again with another
 * label: the canonical writer writes the last label on both); identical
 * statements take their owners in authored order. A canonical block closer
 * is owned by the authored closer of its opener's authored block; a block
 * no authored line opens (members written as `Class : member` lines) has an
 * implicit closer, so it never takes another block's.
 */
function traceBlocks(lines: readonly AuthoredLine[], c0: readonly string[], owner: number[], remaining: ReadonlyArray<ReadonlyMap<string, number>>, reader: LineReader): { closerOf: Map<number, number>; authoredCloser: Map<number, number>; implicit: Set<number>; redeclares: Map<number, number[]> } {
  const words = (text: string) => new Set(text.match(WORDS) ?? [])
  const opens = (line: number) => line > 0 && !inert(lines[line]!.text) && !closesBlock(lines[line]!.text) && reader.opens(lines[line]!.text.trim())
  const nextStatement = (index: number) => {
    let next = index + 1
    while (next < c0.length && !c0[next]!.trim()) next++
    return next < c0.length ? next : -1
  }
  // A canonical opener: the next statement is deeper, or closes it at once.
  const opensBlock = (index: number) => {
    const next = nextStatement(index)
    return next >= 0 && !closesBlock(c0[index]!) && (depthOf(c0[next]!) > depthOf(c0[index]!) || (depthOf(c0[next]!) === depthOf(c0[index]!) && closesBlock(c0[next]!)))
  }
  // How much of a line's unread reading a statement repeats: the share of
  // its words the statement has, averaged with the share of text kept by the
  // smallest change between them. Openers only match openers.
  const likeness = (index: number, line: number): number => {
    if (opens(line) !== opensBlock(index)) return 0
    const wanted = c0[index]!.trim(), wantedWords = words(wanted)
    let best = 0
    for (const read of remaining[line]!.keys()) {
      if (closesBlock(read)) continue
      const readWords = [...words(read)], { removed, kept } = changedTokens(wanted, read)
      if (removed) best = Math.max(best, (readWords.filter(word => wantedWords.has(word)).length / Math.max(1, readWords.length) + kept / Math.max(wanted.length, read.length)) / 2)
    }
    return best
  }
  const LIKE = 0.5
  const owning = new Set(owner)
  const orphan = (line: number) => line > 0 && !owning.has(line) && !inert(lines[line]!.text) && !closesBlock(lines[line]!.text)
  for (let index = 1; index < c0.length; index++) {
    if (owner[index]! >= 0 || !c0[index]!.trim() || closesBlock(c0[index]!)) continue
    let best = -1, bestScore = LIKE
    lines.forEach((_, line) => {
      const score = orphan(line) ? likeness(index, line) : 0
      if (score > bestScore) { best = line; bestScore = score }
    })
    if (best >= 0) { owner[index] = best; owning.add(best) }
  }
  // A line still owning nothing redeclares the statement most like it, else
  // every statement that names all the words of its reading the diagram
  // still has (`A[First]` before `A(Second) --> B`: the label it gave lost).
  const redeclares = new Map<number, number[]>()
  const known = new Set(c0.flatMap(statement => statement.match(WORDS) ?? []))
  lines.forEach((_, line) => {
    if (!orphan(line)) return
    let best = -1, bestScore = LIKE
    for (let index = 1; index < c0.length; index++) {
      const score = owner[index]! >= 0 && !closesBlock(c0[index]!) ? likeness(index, line) : 0
      if (score > bestScore) { best = index; bestScore = score }
    }
    if (best >= 0) { redeclares.set(line, [best]); return }
    const names = [...new Set([...remaining[line]!.keys()].flatMap(read => read.match(WORDS) ?? []))].filter(word => known.has(word))
    const naming = names.length ? c0.flatMap((statement, index) => index > 0 && owner[index]! >= 0 && !closesBlock(statement) && names.every(word => words(statement).has(word)) ? [index] : []) : []
    if (naming.length) redeclares.set(line, naming)
  })
  const sameText = new Map<string, number[]>()
  owner.forEach((line, index) => { if (index > 0 && line >= 0 && !closesBlock(c0[index]!)) sameText.set(c0[index]!.trim(), [...sameText.get(c0[index]!.trim()) ?? [], index]) })
  for (const indices of sameText.values()) {
    const lineOrder = indices.map(index => owner[index]!).sort((a, b) => a - b)
    indices.forEach((index, at) => { owner[index] = lineOrder[at]! })
  }
  const authoredCloser = new Map<number, number>()
  const stack: number[] = []
  lines.forEach(({ text }, line) => {
    if (closesBlock(text) && line > 0) { const open = stack.pop(); if (open !== undefined) authoredCloser.set(open, line) }
    else if (opens(line)) stack.push(line)
  })
  const closerFor = (index: number) => {
    const depth = depthOf(c0[index]!)
    for (let at = index + 1; at < c0.length; at++) {
      if (!c0[at]!.trim() || depthOf(c0[at]!) > depth) continue
      if (depthOf(c0[at]!) < depth) return -1
      // Same-depth statements between an opener and its closer are branches
      // (`else`, `and`).
      if (closesBlock(c0[at]!)) return at
    }
    return -1
  }
  const closerOf = new Map<number, number>(), claimed = new Map<number, number>(), implicit = new Set<number>()
  for (const authored of [true, false]) {
    for (let index = 1; index < c0.length; index++) {
      const line = owner[index]!
      if (line < 0 || !opensBlock(index) || authoredCloser.has(line) !== authored || (!authored && opens(line))) continue
      const closer = closerFor(index)
      if (closer < 0 || claimed.has(closer)) continue
      claimed.set(closer, authored ? authoredCloser.get(line)! : -1)
      if (authored) closerOf.set(index, closer)
      else implicit.add(index)
    }
  }
  const used = new Set(claimed.values())
  c0.forEach((statement, index) => {
    if (!closesBlock(statement)) return
    if (claimed.has(index)) owner[index] = claimed.get(index)!
    else if (used.has(owner[index]!)) owner[index] = -1
  })
  return { closerOf, authoredCloser, implicit, redeclares }
}

/** Whether `text` contains `part` starting and ending at word boundaries. */
function containsToken(text: string, part: string): boolean {
  for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) {
    if (!(isWord(part[0]) && isWord(text[at - 1])) && !(isWord(part.at(-1)) && isWord(text[at + part.length]))) return true
  }
  return false
}

type DiffOp = { kind: 'eq'; a: number; b: number } | { kind: 'del'; a: number } | { kind: 'ins'; a: number; b: number }

/** Line diff of comparison keys after trimming the common ends; undefined
 * when too large. */
function diffLines(a: readonly string[], b: readonly string[]): DiffOp[] | undefined {
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return undefined
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = a[prefix + i] === b[prefix + j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const ops: DiffOp[] = []
  for (let k = 0; k < prefix; k++) ops.push({ kind: 'eq', a: k, b: k })
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[prefix + i] === b[prefix + j]) { ops.push({ kind: 'eq', a: prefix + i, b: prefix + j }); i++; j++ }
    else if (j < m && (i === n || table[i]![j + 1]! >= table[i + 1]![j]!)) { ops.push({ kind: 'ins', a: prefix + i, b: prefix + j }); j++ }
    else { ops.push({ kind: 'del', a: prefix + i }); i++ }
  }
  for (let k = 0; k < suffix; k++) ops.push({ kind: 'eq', a: a.length - suffix + k, b: b.length - suffix + k })
  return ops
}

/** The changed middle of two canonical lines, widened to whole words. */
function changedTokens(before: string, after: string): { removed: string; added: string; kept: number } {
  const a = before.trim(), b = after.trim()
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++
  const kept = prefix + suffix
  while (prefix > 0 && isWord(a[prefix - 1]) && (isWord(a[prefix]) || isWord(b[prefix]))) prefix--
  while (suffix > 0 && isWord(a[a.length - suffix]) && (isWord(a[a.length - suffix - 1]) || isWord(b[b.length - suffix - 1]))) suffix--
  // A pure insertion is placed after the word that precedes it.
  if (prefix + suffix === a.length && prefix > 0) {
    prefix--
    while (prefix > 0 && !isWord(a[prefix])) prefix--
    while (prefix > 0 && isWord(a[prefix - 1])) prefix--
  }
  return { removed: a.slice(prefix, a.length - suffix), added: b.slice(prefix, b.length - suffix), kept }
}

/** Canonical writers spell some characters as Mermaid entity codes. */
const ENTITY_SPELLINGS: ReadonlyArray<readonly [string, string]> = [['#lt;', '<'], ['#gt;', '>'], ['#quot;', '"'], ['#amp;', '&'], ['#35;', '#'], ['#59;', ';']]
const authoredSpellings = (text: string): string[] => {
  let decoded = text
  for (const [code, char] of ENTITY_SPELLINGS) decoded = decoded.split(code).join(char)
  return decoded === text ? [text] : [text, decoded]
}

/** Where `spelling` occurs in `text` at word boundaries, as [start, end]. A
 * statement joined from several physical lines spells a canonical line break
 * as the authored line break (the reader drops the indentation around it). */
function occurrences(text: string, spelling: string): Array<[number, number]> {
  const found: Array<[number, number]> = []
  const bounded = (at: number, end: number) => !(isWord(spelling[0]) && isWord(text[at - 1])) && !(isWord(spelling.at(-1)) && isWord(text[end]))
  if (/[\r\n]/.test(text) && /<br\s*\/?>/i.test(spelling)) {
    const pattern = new RegExp(spelling.split(/<br\s*\/?>/i).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(?:<br\\s*/?>|[ \\t]*(?:\\r\\n|\\n|\\r)[ \\t]*)'), 'gi')
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (bounded(match.index, match.index + match[0].length)) found.push([match.index, match.index + match[0].length])
      pattern.lastIndex = match.index + 1
    }
    return found
  }
  for (let at = text.indexOf(spelling); at >= 0; at = text.indexOf(spelling, at + 1)) if (bounded(at, at + spelling.length)) found.push([at, at + spelling.length])
  return found
}

/** Replace the one authored occurrence of a changed canonical token run. */
function spliceLine(text: string, before: string, after: string): string | undefined {
  const { removed, added } = changedTokens(before, after)
  if (!removed) return undefined
  for (const spelling of authoredSpellings(removed)) {
    const found = occurrences(text, spelling)
    if (found.length > 1) return undefined
    if (!found.length) continue
    let [start, end] = found[0]!, replacement = added
    const quoted = (value: string) => value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    // Keep the authored quoting around a replaced quoted token.
    if (text[start - 1] === '"' && text[end] === '"' && quoted(added)) { start--; end++ }
    else if (quoted(spelling) && !added.includes('"')) replacement = `"${added}"`
    return text.slice(0, start) + replacement + text.slice(end)
  }
  return undefined
}

/** Plans are tried in order until one reads back as the edited diagram. */
interface Variant {
  /** Edit changed tokens inside their authored line instead of rewriting it. */
  readonly splice: boolean
  /** Compare statements ignoring whitespace, so a respaced verbatim segment
   * does not read as changed. */
  readonly loose: boolean
  /** Prefer placing a new statement after the one before it. */
  readonly previous: boolean
  /** Write a statement the canonical text only reorders at its new place;
   * otherwise it stays where it was authored. */
  readonly move: boolean
  /** Pair a removed statement with a similar new one elsewhere (a renamed or
   * relabelled statement the writer reorders), editing it in place. */
  readonly pair: boolean
  /** Structural pass: rewrite a kept statement in canonical spelling when a
   * line that redeclares it goes with another statement. */
  readonly rewrite?: boolean
}
const VARIANTS: readonly Variant[] = [
  ...[false, true].flatMap(loose => [true, false].flatMap(splice => [true, false].map(previous => ({ splice, loose, previous, move: false, pair: true })))),
  ...[false, true].flatMap(loose => [true, false].map(previous => ({ splice: true, loose, previous, move: true, pair: true }))),
  ...[false, true].flatMap(loose => [true, false].map(previous => ({ splice: true, loose, previous, move: true, pair: false }))),
]

const STRUCTURAL_VARIANTS: readonly Variant[] = [...VARIANTS, ...VARIANTS.map(variant => ({ ...variant, rewrite: true }))]

interface Plan {
  readonly removed: Set<number>
  readonly text: Map<number, string>
  readonly before: Map<number, string[]>
  readonly after: Map<number, string[]>
}

/** The canonical line diff a variant reads: exact, or ignoring whitespace. */
function canonicalDiff(c0: readonly string[], c1: readonly string[], loose: boolean): DiffOp[] | undefined {
  const key = loose ? (line: string) => line.replace(/\s+/g, '') : (line: string) => line
  return diffLines(c0.map(key), c1.map(key))
}

function planEdit(lines: readonly AuthoredLine[], c0: readonly string[], c1: readonly string[], ops: readonly DiffOp[] | undefined, { owner, folded, parts, implicit, readings }: Trace, variant: Variant, reader: LineReader): Plan | string {
  if (!ops) return 'the edit changes too many lines to compare'
  const plan: Plan = { removed: new Set(), text: new Map(), before: new Map(), after: new Map() }
  const partsOf = (index: number): readonly number[] => parts?.get(index) ?? (owner[index]! >= 0 ? [owner[index]!] : [])
  let stranded: string | undefined
  // The statements each authored line is read into.
  const roles = new Map<number, number[]>()
  if (parts) for (const [index, list] of parts) for (const line of list) roles.set(line, [...roles.get(line) ?? [], index])
  // Insertions are collected with their position in the edited canonical
  // text, so statements written at one authored line keep that order.
  const placed = { before: new Map<number, Array<[number, string]>>(), after: new Map<number, Array<[number, string]>>() }
  // A moved statement keeps its authored line when that line held only it;
  // the line it was written from also gives its new neighbours their
  // indentation (a family that writes block bodies at the opener's depth
  // marks nothing else as their sibling).
  const moved = new Map<string, number[]>(), writtenFrom = new Map<number, number>()
  const push = (where: 'before' | 'after', at: number, index: number, indent?: string) => {
    const list = placed[where].get(at) ?? []
    const from = moved.get(c1[index]!.trim())?.shift()
    if (from !== undefined) writtenFrom.set(index, from)
    list.push([index, from !== undefined ? lines[from]!.text : analogous(index) ?? (indent ?? indentFor(index)) + c1[index]!.trimStart()])
    placed[where].set(at, list)
  }
  // A new statement inside a block no authored line opens is written like
  // an authored sibling (`Class : member`), that line with its changed
  // tokens replaced.
  const analogous = (index: number): string | undefined => {
    if (!implicit?.size) return undefined
    const depth = depthOf(c1[index]!)
    let open = index - 1
    while (open > 0 && (!c1[open]!.trim() || depthOf(c1[open]!) >= depth)) open--
    const opener = sourceOf.get(open)
    if (opener === undefined || !implicit.has(opener)) return undefined
    let end = open + 1
    while (end < c1.length && (!c1[end]!.trim() || depthOf(c1[end]!) > depthOf(c1[open]!))) end++
    const siblings = Array.from({ length: end - open - 1 }, (_, offset) => open + 1 + offset).filter(at => at !== index && depthOf(c1[at]!) === depth && (sourceOf.get(at) ?? -1) >= 0 && owner[sourceOf.get(at)!]! >= 0).sort((a, b) => Math.abs(a - index) - Math.abs(b - index))
    for (const at of siblings) {
      const line = owner[sourceOf.get(at)!]!, written = spliceLine(plan.text.get(line) ?? lines[line]!.text, c0[sourceOf.get(at)!]!, c1[index]!)
      if (written !== undefined) return written
    }
    stranded ??= `the new statement ${quote(c1[index]!)} belongs to a block written as separate lines, and no authored sibling line can be respelled for it`
    return undefined
  }
  // Each kept or edited C1 statement knows the C0 statement it continues.
  const sourceOf = new Map<number, number>(), keptAs = new Map<number, number>()
  const hunks: Array<{ dels: number[]; ins: number[]; at: number }> = []
  for (let index = 0; index < ops.length;) {
    const op = ops[index]!
    if (op.kind === 'eq') { sourceOf.set(op.b, op.a); keptAs.set(op.a, op.b); index++; continue }
    const hunk = { dels: [] as number[], ins: [] as number[], at: op.a }
    for (; index < ops.length && ops[index]!.kind !== 'eq'; index++) {
      const change = ops[index]!
      // A statement no authored line spells (a writer default) is implicit:
      // its replacement is a plain insertion.
      if (change.kind === 'del' && c0[change.a]!.trim() && owner[change.a]! >= 0) hunk.dels.push(change.a)
      if (change.kind === 'ins' && c1[change.b]!.trim()) hunk.ins.push(change.b)
    }
    hunks.push(hunk)
  }
  // Pair each changed canonical line with its replacement: positionally
  // inside an equal-length change, else by shared text (a reordered rename).
  const pairOf = new Map<number, number>(), pairedIns = new Set<number>()
  for (const hunk of hunks) {
    if (hunk.dels.length !== hunk.ins.length) continue
    hunk.dels.forEach((del, index) => { pairOf.set(del, hunk.ins[index]!); pairedIns.add(hunk.ins[index]!) })
  }
  const looseIns = hunks.flatMap(hunk => hunk.ins).filter(index => !pairedIns.has(index))
  for (const del of variant.pair ? hunks.flatMap(hunk => hunk.dels) : []) {
    if (pairOf.has(del)) continue
    let best = -1, bestScore = 0.4
    for (const ins of looseIns) {
      // The same statement elsewhere is a move: delete it here, write it there.
      if (pairedIns.has(ins) || depthOf(c0[del]!) !== depthOf(c1[ins]!) || (variant.move && c0[del]!.trim() === c1[ins]!.trim())) continue
      const { removed, kept } = changedTokens(c0[del]!, c1[ins]!)
      const score = kept / Math.max(c0[del]!.trim().length, c1[ins]!.trim().length)
      if (removed && score > bestScore) { best = ins; bestScore = score }
    }
    if (best >= 0) { pairOf.set(del, best); pairedIns.add(best) }
  }
  const pairedFrom = new Map<number, number>()
  for (const [del, ins] of pairOf) { sourceOf.set(ins, del); pairedFrom.set(ins, del) }
  // Token splices keep the authored line; anything else replaces it whole.
  const whole = new Set<number>()
  const spliced = new Map<number, Set<string>>()
  for (const [del, ins] of pairOf) {
    if (owner[del]! < 0) return `the changed statement ${quote(c0[del]!)} was not traced to an authored line`
    const { removed, added } = changedTokens(c0[del]!, c1[ins]!), change = `${removed}\u0000${added}`
    if (variant.splice && spliced.get(owner[del]!)?.has(change)) continue
    const splice = (line: number) => spliceLine(plan.text.get(line) ?? lines[line]!.text, c0[del]!, c1[ins]!)
    let line = owner[del]!, edited = variant.splice ? splice(line) : undefined
    // A value written on a later statement than the one the writer folds it
    // into (a label given where a node is redeclared) is edited where it is
    // spelled, when exactly one authored line spells it.
    if (edited === undefined && variant.splice) {
      const elsewhere = lines.flatMap((_, index) => index !== line && !inert(lines[index]!.text) && splice(index) !== undefined ? [index] : [])
      if (elsewhere.length === 1) { line = elsewhere[0]!; edited = splice(line) }
    }
    // A value composed from several lines (descriptions a state accumulates)
    // is written on its first line, in that line's own spelling: the line's
    // reading respelled as the edited statement. The lines that only added
    // to it go.
    if (edited === undefined && parts && variant.splice) {
      line = owner[del]!
      const text = plan.text.get(line) ?? lines[line]!.text
      edited = [...readings?.[line]?.keys() ?? []].map(read => spliceLine(text, read, c1[ins]!)).find(respelled => respelled !== undefined)
      if (edited !== undefined) for (const part of partsOf(del).slice(1)) if (roles.get(part)!.every(index => index === del)) plan.removed.add(part)
    }
    if (edited === undefined) { whole.add(del); continue }
    plan.text.set(line, edited)
    spliced.set(owner[del]!, (spliced.get(owner[del]!) ?? new Set()).add(change))
    // A statement read from several lines (a class named by each of its
    // `Class : member` lines) changes on every line that spells the change.
    if (!parts || !variant.splice) continue
    spliced.set(line, (spliced.get(line) ?? new Set()).add(change))
    for (const part of partsOf(del)) {
      if (part === line || spliced.get(part)?.has(change)) continue
      const more = splice(part)
      if (more === undefined) continue
      plan.text.set(part, more)
      spliced.set(part, (spliced.get(part) ?? new Set()).add(change))
    }
  }
  const gone = new Set<number>([...whole])
  for (const hunk of hunks) for (const del of hunk.dels) if (!pairOf.has(del)) gone.add(del)
  for (const del of gone) {
    const line = owner[del]!
    if (line < 0) return `the removed statement ${quote(c0[del]!)} was not traced to an authored line`
    plan.removed.add(line)
  }
  // A declaration folded into statements that all go away goes with them.
  for (const [line, into] of folded) if (into.every(index => gone.has(index))) plan.removed.add(line)
  // So does every line a removed statement is read from that reads nothing
  // else that stays.
  for (const del of parts ? gone : []) for (const line of partsOf(del)) if (roles.get(line)!.every(index => gone.has(index))) plan.removed.add(line)
  // A kept statement whose redeclaring line goes is rewritten whole, in the
  // rewriting variant.
  const rewritten = new Set<number>()
  if (variant.rewrite) {
    for (const [index, list] of parts ?? []) {
      if (gone.has(index) || !list.slice(1).some(line => plan.removed.has(line))) continue
      rewritten.add(index)
      for (const line of list) if ((roles.get(line) ?? []).every(other => gone.has(other) || other === index)) plan.removed.add(line)
      plan.removed.add(list[0]!)
    }
  }
  for (const line of plan.removed) if (plan.text.has(line)) return 'one authored line would be both edited and removed'
  const ownedLine = new Map<number, number>()
  owner.forEach(line => ownedLine.set(line, (ownedLine.get(line) ?? 0) + 1))
  const unit = indentUnit(lines)
  // A new statement takes the authored indentation of its nearest sibling
  // in the edited canonical text, or of its enclosing block plus one step.
  // The body of a new block has no authored sibling or opener, so it takes
  // the indentation of the nearest authored statement at its depth (another
  // block's body), else its new opener's indentation plus one step.
  const authoredIndent = (at: number) => {
    const from = sourceOf.get(at)
    if (from !== undefined && owner[from]! >= 0) return leading(lines[owner[from]!]!.text)
    const line = writtenFrom.get(at)
    return line !== undefined ? leading(lines[line]!.text) : undefined
  }
  // A sibling is a statement at the same canonical depth. A statement that
  // cannot stand alone (a branch line like `else`, a member) only takes the
  // indentation of another such statement, so a new branch never takes a
  // message's indentation in a family that writes block bodies at the
  // opener's depth.
  const standsAlone = (text: string) => reader.alone(text) || reader.opens(text.trim())
  const sibling = (at: number, index: number) => depthOf(c1[at]!) === depthOf(c1[index]!) && (standsAlone(c1[index]!) || !standsAlone(c1[at]!))
  // A block line at a body's own depth (an opener or a branch line like
  // `else`, written by a family that does not indent block bodies): it
  // does not read alone or opens a block, and a closer follows at its depth.
  const blockLine = (at: number) => {
    if (closesBlock(c1[at]!) || (reader.alone(c1[at]!) && !reader.opens(c1[at]!.trim()))) return false
    for (let next = at + 1; next < c1.length; next++) {
      if (!c1[next]!.trim() || depthOf(c1[next]!) > depthOf(c1[at]!)) continue
      if (depthOf(c1[next]!) < depthOf(c1[at]!)) return false
      if (closesBlock(c1[next]!)) return true
    }
    return false
  }
  const previousStatement = (index: number) => {
    let at = index - 1
    while (at > 0 && !c1[at]!.trim()) at--
    return at
  }
  // How far authored bodies sit inside such block lines: the first authored
  // statement written right after one, else one indentation step.
  const stepIntoBody = (): string => {
    for (let at = 1; at < c1.length; at++) {
      const before = previousStatement(at)
      if (!c1[at]!.trim() || before <= 0 || !blockLine(before) || !standsAlone(c1[at]!)) continue
      const outer = authoredIndent(before), inner = authoredIndent(at)
      if (outer !== undefined && inner !== undefined && inner.length > outer.length && inner.startsWith(outer)) return inner.slice(outer.length)
    }
    return unit
  }
  const peerIndent = (index: number, target: number): string | undefined => {
    for (let distance = 1; index - distance >= 0 || index + distance < c1.length; distance++) {
      for (const at of [index - distance, index + distance]) {
        if (at < 0 || at >= c1.length || !c1[at]!.trim() || depthOf(c1[at]!) !== target) continue
        const indent = authoredIndent(at)
        if (indent !== undefined) return indent
      }
    }
    return undefined
  }
  const indents = new Map<number, string>()
  const indentFor = (index: number): string => {
    const known = indents.get(index)
    if (known !== undefined) return known
    const target = depthOf(c1[index]!)
    const resolve = (): string => {
      // The first statement of a body whose block line is at its own depth
      // (an `else` branch or `loop`) takes the indentation of the body
      // statement after it, else steps into that block line.
      const before = previousStatement(index)
      if (before > 0 && depthOf(c1[before]!) === target && standsAlone(c1[index]!) && blockLine(before)) {
        let next = index + 1
        while (next < c1.length && !c1[next]!.trim()) next++
        const following = next < c1.length && depthOf(c1[next]!) === target && !blockLine(next) && !closesBlock(c1[next]!) ? authoredIndent(next) : undefined
        if (following !== undefined) return following
        const indent = authoredIndent(before)
        if (indent !== undefined) return indent + stepIntoBody()
      }
      let opener: string | undefined
      for (let at = index - 1; at >= 0; at--) {
        if (!c1[at]!.trim()) continue
        const depth = depthOf(c1[at]!), indent = authoredIndent(at)
        if (indent !== undefined && sibling(at, index)) return indent
        if (depth < target) {
          opener = indent !== undefined ? indent + unit : peerIndent(index, target) ?? indentFor(at) + unit
          break
        }
      }
      for (let at = index + 1; at < c1.length; at++) {
        if (!c1[at]!.trim()) continue
        const depth = depthOf(c1[at]!), indent = authoredIndent(at)
        if (indent !== undefined && sibling(at, index)) return indent
        if (depth < target) break
      }
      return opener ?? leading(c1[index]!)
    }
    const indent = resolve()
    indents.set(index, indent)
    return indent
  }
  const owned = (from: number, step: 1 | -1): number => {
    for (let index = from; index >= 0 && index < c0.length; index += step) if (c0[index]!.trim() && owner[index]! >= 0) return index
    return -1
  }
  for (const del of gone) {
    if (pairOf.has(del) || ownedLine.get(owner[del]!) !== 1) continue
    const list = moved.get(c0[del]!.trim()) ?? []
    list.push(owner[del]!)
    moved.set(c0[del]!.trim(), list)
  }
  // A removed line that also carried surviving statements is rewritten as
  // those statements in canonical spelling, where it stood and indented as
  // it was.
  for (let index = 0; index < c0.length; index++) {
    if (!c0[index]!.trim() || gone.has(index) || !plan.removed.has(owner[index]!)) continue
    // Another authored line still declares it.
    if (!rewritten.has(index) && partsOf(index).some(line => !plan.removed.has(line))) continue
    const kept = keptAs.get(index) ?? pairOf.get(index)
    if (kept === undefined) return `${quote(c0[index]!)} shares a removed authored line and has no counterpart in the edit`
    push('before', owner[index]!, kept, leading(lines[owner[index]!]!.text))
  }
  for (const hunk of hunks) {
    const replaced = hunk.dels.find(del => gone.has(del))
    const previous = owned(hunk.at - 1, -1), next = owned(hunk.at, 1)
    // Prefer the neighbour that is a statement of its own, not a line that
    // also carries other statements.
    const alone = (index: number) => index >= 0 && ownedLine.get(owner[index]!) === 1
    const afterPrevious = next < 0 || (previous >= 0 && (alone(previous) || !alone(next)) === variant.previous)
    for (const ins of hunk.ins) {
      const del = pairedFrom.get(ins)
      if (del !== undefined && !whole.has(del)) continue
      const at = del ?? replaced
      // A statement written in place of a removed one at its depth keeps
      // that line's indentation.
      if (at !== undefined) push('before', owner[at]!, ins, plan.removed.has(owner[at]!) && depthOf(c0[at]!) === depthOf(c1[ins]!) ? leading(lines[owner[at]!]!.text) : undefined)
      else if (afterPrevious && previous >= 0) push('after', owner[previous]!, ins)
      else if (next >= 0) push('before', owner[next]!, ins)
      else return `the new statement ${quote(c1[ins]!)} has no authored neighbour to stand beside`
    }
  }
  if (stranded) return stranded
  for (const where of ['before', 'after'] as const) for (const list of placed[where].values()) list.sort((a, b) => a[0] - b[0])
  // Mermaid reads some statements only after what they name (a `class`
  // line before its node is dropped), so new statements that share a word
  // keep their canonical order.
  const written = lines.flatMap((_, line) => [...placed.before.get(line) ?? [], ...placed.after.get(line) ?? []].map(([index]) => index))
  const words = (index: number) => new Set(c1[index]!.match(/[\p{L}\p{N}_]+/gu) ?? [])
  for (let at = 1; at < written.length; at++) {
    for (let earlier = 0; earlier < at; earlier++) {
      if (written[earlier]! < written[at]!) continue
      const shared = words(written[at]!)
      if ([...words(written[earlier]!)].some(word => shared.has(word))) return `the new statements ${quote(c1[written[earlier]!]!)} and ${quote(c1[written[at]!]!)} would be written out of canonical order`
    }
  }
  for (const where of ['before', 'after'] as const) for (const [line, list] of placed[where]) plan[where].set(line, list.map(([, text]) => text))
  return plan
}

/** The authored step between nesting levels: a tab, or the smallest indent. */
function indentUnit(lines: readonly AuthoredLine[]): string {
  let smallest = Infinity
  for (const { text } of lines.slice(1)) {
    if (inert(text)) continue
    const indent = leading(text)
    if (indent.startsWith('\t')) return '\t'
    if (indent.length) smallest = Math.min(smallest, indent.length)
  }
  return Number.isFinite(smallest) ? ' '.repeat(smallest) : ''
}

function renderPlan(lines: readonly AuthoredLine[], plan: Plan, eol: string): string {
  const out: string[] = []
  let pending = ''
  const emit = (text: string, end: string) => { out.push(pending, text); pending = end || eol }
  lines.forEach((line, index) => {
    for (const text of plan.before.get(index) ?? []) emit(text, eol)
    if (!plan.removed.has(index)) emit(plan.text.get(index) ?? line.text, line.eol)
    for (const text of plan.after.get(index) ?? []) emit(text, eol)
  })
  const last = lines.at(-1)
  return out.join('') + (last && last.eol === '' && !plan.after.get(lines.length - 1)?.length && !plan.removed.has(lines.length - 1) ? '' : pending)
}

/**
 * Write `after` (the canonical result of a typed edit) as a local change to
 * `authored`, the exact source `before` was parsed from. Returns the edited
 * source and its parse, or why no local change reproduces `after`.
 */
export function projectStructuredEdit(authored: string, before: ParsedDiagram, after: ParsedDiagram): Result<{ source: string; diagram: ParsedDiagram }, string> {
  const wrapper = before.meta.wrapperSource ?? ''
  if (!authored.startsWith(wrapper)) return err('the authored wrapper could not be located')
  const c0 = statements(before), c1 = statements(after)
  if (!c0 || !c1) return err('the diagram has no structured statements to project')
  // The wrapper is rewritten only when the edit changes what the canonical
  // writer puts there (a frontmatter title, for example).
  const canonicalWrapper = (d: ParsedDiagram, lines: readonly string[]) => wrapperPrefix(d.meta, 'verbatim', lines.join('\n') + '\n', d.kind)
  const written = canonicalWrapper(before, c0)
  let nextWrapper = wrapper
  if (written !== canonicalWrapper(after, c1)) {
    // Directives authored after the header stay where they are; the writer
    // would also have copied them into its wrapper.
    const moved = written.startsWith(wrapper) ? written.slice(wrapper.length) : ''
    nextWrapper = after.meta.wrapperSource ?? wrapper
    if (moved && nextWrapper.endsWith(moved)) nextWrapper = nextWrapper.slice(0, -moved.length)
  }
  const lines = splitLines(authored.slice(wrapper.length))
  const eol = /\r\n/.test(authored) ? '\r\n' : '\n'
  const reader = lineReader(wrapper, lines[0]?.text ?? '')
  const facts = describeMermaidFacts(after)
  const tried = new Set<string>()
  // The diff depends only on whether whitespace counts, so the variants
  // share two.
  const diffs = new Map<boolean, DiffOp[] | undefined>()
  const diffFor = (loose: boolean) => {
    if (!diffs.has(loose)) diffs.set(loose, canonicalDiff(c0, c1, loose))
    return diffs.get(loose)
  }
  let unplanned: string | undefined, closest: { size: number; reason: string } | undefined
  const attempt = (authoredLines: readonly AuthoredLine[], trace: Trace, variants: readonly Variant[]): { source: string; diagram: ParsedDiagram } | undefined => {
    unplanned = undefined
    // The candidate that rewrites the fewest authored lines is read first, so
    // a variant that respells untouched lines (a verbatim fragment the exact
    // diff sees as changed) never wins over one that keeps them; ties keep
    // the variant order.
    const candidates: Array<{ source: string; cost: number }> = []
    for (const variant of variants) {
      const plan = planEdit(authoredLines, c0, c1, diffFor(variant.loose), trace, variant, reader)
      if (typeof plan === 'string') { unplanned ??= plan; continue }
      const source = nextWrapper + renderPlan(authoredLines, plan, eol)
      const written = [...plan.before.values(), ...plan.after.values()].reduce((sum, list) => sum + list.length, 0)
      candidates.push({ source, cost: plan.removed.size + plan.text.size + written })
    }
    candidates.sort((a, b) => a.cost - b.cost)
    for (const { source } of candidates) {
      if (tried.has(source)) continue
      tried.add(source)
      const parsed = parseRegisteredMermaid(source)
      if (parsed.ok && sameProjectedDiagram(parsed.value, after, facts, c1)) return { source, diagram: parsed.value }
      const miss = misreading(parsed, c1)
      if (!closest || miss.size < closest.size) closest = miss
    }
    return undefined
  }
  const projected = attempt(lines, traceOwners(wrapper, lines, c0, before, reader), VARIANTS) ?? (() => {
    // Statements spelled over several physical lines are traced, edited and
    // removed as one authored line, and redeclared statements and blocks are
    // traced to every line they are read from.
    const joined = joinSplitValues(lines, c0, reader)
    return attempt(joined, traceOwners(wrapper, joined, c0, before, reader, true), STRUCTURAL_VARIANTS)
  })()
  if (projected) return ok(projected)
  if (closest) return err(`no local change to the authored source reads back as the edited diagram: ${closest.reason}`)
  return err(unplanned ?? 'the changed statements could not be traced to authored lines')
}

/** A statement for a reason, quoted and shortened. */
const quote = (statement: string) => JSON.stringify(statement.trim().length > 60 ? `${statement.trim().slice(0, 57)}...` : statement.trim())

/** How a rejected candidate reads differently from the edit: a parse
 * failure, else the canonical statements it gains and lacks. */
function misreading(parsed: Result<ParsedDiagram, ReadonlyArray<{ message: string }>>, expected: readonly string[]): { size: number; reason: string } {
  if (!parsed.ok) return { size: Infinity, reason: `the closest local change does not parse (${parsed.error[0]?.message ?? 'parse error'})` }
  const found = statements(parsed.value)
  if (!found) return { size: Infinity, reason: `the closest local change no longer reads as a structured ${parsed.value.kind} diagram` }
  const spell = (line: string) => line.replace(/\s+/g, '')
  const tally = (values: readonly string[]) => {
    const result = new Map<string, { text: string; count: number }>()
    for (const line of values.slice(1)) if (line.trim()) result.set(spell(line), { text: line, count: (result.get(spell(line))?.count ?? 0) + 1 })
    return result
  }
  const got = tally(found), want = tally(expected)
  const left = (a: typeof got, b: typeof got) => [...a].flatMap(([key, { text, count }]) => Array.from({ length: Math.max(0, count - (b.get(key)?.count ?? 0)) }, () => text))
  const extra = left(got, want), missing = left(want, got)
  const list = (values: readonly string[]) => `${quote(values[0]!)}${values.length > 1 ? ` and ${values.length - 1} more` : ''}`
  if (!extra.length && !missing.length) return { size: 0, reason: 'the closest local change writes the edited statements, but they read with different order, metadata or facts' }
  const reason = !missing.length ? `the closest local change also reads ${list(extra)}` : !extra.length ? `the closest local change lacks ${list(missing)}` : `the closest local change reads ${list(extra)} where the edit has ${list(missing)}`
  return { size: extra.length + missing.length, reason }
}
