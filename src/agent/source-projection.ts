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
// The projection only proposes. A few placement variants are tried in order,
// and a candidate is returned only when the shared parser reads it back as the
// same diagram as the canonical result: the same facts and the same canonical
// statements (whose incidental order may follow the authored order). The
// caller otherwise writes the canonical source and says so.
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
}

/** Which authored line produced each canonical statement of `before`: the
 * statement the family's source map locates for the same identity, else a
 * line already in canonical spelling, else the line whose own canonical
 * reading contains it. Nearby lines win ties, so repeated text stays in order. */
function traceOwners(wrapper: string, lines: readonly AuthoredLine[], c0: readonly string[], before: ParsedDiagram): Trace {
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
  const header = lines[0]!.text
  const read = (source: string): Map<string, number> | undefined => {
    const parsed = parseRegisteredMermaid(source)
    const found = parsed.ok ? statements(parsed.value) : undefined
    return found ? counts(found.slice(1)) : undefined
  }
  const base = read(`${wrapper}${header}\n`) ?? new Map<string, number>()
  const isolated = (text: string): Map<string, number> | undefined => {
    for (const closer of ['', '\nend', '\n}']) {
      const found = read(`${wrapper}${header}\n${text}${closer}`)
      if (!found) continue
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
  const readings = lines.map(({ text }, index) => {
    const trimmed = text.trim()
    // A family that keeps comments as verbatim segments writes them back.
    if (index === 0 || !trimmed || (inert(text) && !canonical.has(trimmed))) return new Map<string, number>()
    if (canonical.has(trimmed)) return new Map([[trimmed, 1]])
    return isolated(trimmed) ?? new Map([[trimmed, 1]])
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
  const traced = new Set(owner)
  readings.forEach((reading, line) => {
    if (traced.has(line) || inert(lines[line]!.text)) return
    const into = c0.flatMap((statement, index) => index > 0 && [...reading.keys()].some(read => read !== statement.trim() && containsToken(statement, read)) ? [index] : [])
    if (into.length) folded.set(line, into)
  })
  return { owner, folded }
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

/** Replace the one authored occurrence of a changed canonical token run. */
function spliceLine(text: string, before: string, after: string): string | undefined {
  const { removed, added } = changedTokens(before, after)
  if (!removed) return undefined
  for (const spelling of authoredSpellings(removed)) {
    const found: number[] = []
    for (let at = text.indexOf(spelling); at >= 0; at = text.indexOf(spelling, at + 1)) {
      if (isWord(spelling[0]) && isWord(text[at - 1])) continue
      if (isWord(spelling.at(-1)) && isWord(text[at + spelling.length])) continue
      found.push(at)
    }
    if (found.length > 1) return undefined
    if (!found.length) continue
    let start = found[0]!, end = start + spelling.length, replacement = added
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
}
const VARIANTS: readonly Variant[] = [
  ...[false, true].flatMap(loose => [true, false].flatMap(splice => [true, false].map(previous => ({ splice, loose, previous, move: false, pair: true })))),
  ...[false, true].flatMap(loose => [true, false].map(previous => ({ splice: true, loose, previous, move: true, pair: true }))),
  ...[false, true].flatMap(loose => [true, false].map(previous => ({ splice: true, loose, previous, move: true, pair: false }))),
]

interface Plan {
  readonly removed: Set<number>
  readonly text: Map<number, string>
  readonly before: Map<number, string[]>
  readonly after: Map<number, string[]>
}

function planEdit(lines: readonly AuthoredLine[], c0: readonly string[], c1: readonly string[], { owner, folded }: Trace, variant: Variant): Plan | undefined {
  const key = variant.loose ? (line: string) => line.replace(/\s+/g, '') : (line: string) => line
  const ops = diffLines(c0.map(key), c1.map(key))
  if (!ops) return undefined
  const plan: Plan = { removed: new Set(), text: new Map(), before: new Map(), after: new Map() }
  // Insertions are collected with their position in the edited canonical
  // text, so statements written at one authored line keep that order.
  const placed = { before: new Map<number, Array<[number, string]>>(), after: new Map<number, Array<[number, string]>>() }
  // A moved statement keeps its authored line when that line held only it.
  const moved = new Map<string, number[]>()
  const push = (where: 'before' | 'after', at: number, index: number) => {
    const list = placed[where].get(at) ?? []
    const from = moved.get(c1[index]!.trim())?.shift()
    list.push([index, from === undefined ? indentFor(index) + c1[index]!.trimStart() : lines[from]!.text])
    placed[where].set(at, list)
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
    if (owner[del]! < 0) return undefined
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
    if (edited === undefined) { whole.add(del); continue }
    plan.text.set(line, edited)
    spliced.set(owner[del]!, (spliced.get(owner[del]!) ?? new Set()).add(change))
  }
  const gone = new Set<number>([...whole])
  for (const hunk of hunks) for (const del of hunk.dels) if (!pairOf.has(del)) gone.add(del)
  for (const del of gone) {
    const line = owner[del]!
    if (line < 0) return undefined
    plan.removed.add(line)
  }
  // A declaration folded into statements that all go away goes with them.
  for (const [line, into] of folded) if (into.every(index => gone.has(index))) plan.removed.add(line)
  for (const line of plan.removed) if (plan.text.has(line)) return undefined
  const ownedLine = new Map<number, number>()
  owner.forEach(line => ownedLine.set(line, (ownedLine.get(line) ?? 0) + 1))
  const unit = indentUnit(lines)
  // A new statement takes the authored indentation of its nearest sibling
  // in the edited canonical text, or of its enclosing block plus one step.
  const indentFor = (index: number): string => {
    const target = depthOf(c1[index]!)
    const authoredIndent = (at: number) => {
      const from = sourceOf.get(at)
      return from !== undefined && owner[from]! >= 0 ? leading(lines[owner[from]!]!.text) : undefined
    }
    let opener: string | undefined
    for (let at = index - 1; at >= 0; at--) {
      if (!c1[at]!.trim()) continue
      const depth = depthOf(c1[at]!), indent = authoredIndent(at)
      if (depth === target && indent !== undefined) return indent
      if (depth < target) { opener = indent === undefined ? undefined : indent + unit; break }
    }
    for (let at = index + 1; at < c1.length; at++) {
      if (!c1[at]!.trim()) continue
      const depth = depthOf(c1[at]!), indent = authoredIndent(at)
      if (depth === target && indent !== undefined) return indent
      if (depth < target) break
    }
    return opener ?? leading(c1[index]!)
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
  // those statements in canonical spelling, where it stood.
  for (let index = 0; index < c0.length; index++) {
    if (!c0[index]!.trim() || gone.has(index) || !plan.removed.has(owner[index]!)) continue
    const kept = keptAs.get(index) ?? pairOf.get(index)
    if (kept === undefined) return undefined
    push('before', owner[index]!, kept)
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
      if (at !== undefined) push('before', owner[at]!, ins)
      else if (afterPrevious && previous >= 0) push('after', owner[previous]!, ins)
      else if (next >= 0) push('before', owner[next]!, ins)
      else return undefined
    }
  }
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
      if ([...words(written[earlier]!)].some(word => shared.has(word))) return undefined
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
  const trace = traceOwners(wrapper, lines, c0, before)
  const facts = describeMermaidFacts(after)
  const tried = new Set<string>()
  for (const variant of VARIANTS) {
    const plan = planEdit(lines, c0, c1, trace, variant)
    if (!plan) continue
    const source = nextWrapper + renderPlan(lines, plan, eol)
    if (tried.has(source)) continue
    tried.add(source)
    const parsed = parseRegisteredMermaid(source)
    if (parsed.ok && sameProjectedDiagram(parsed.value, after, facts, c1)) return ok({ source, diagram: parsed.value })
  }
  return err(tried.size ? 'no local change to the authored source reads back as the edited diagram' : 'the changed statements could not be traced to authored lines')
}
