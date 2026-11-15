// Scoring for the edit-arms evaluation. Pure except for the oracle it is given.
//
// For one task the scorer compares three Mermaid sources: the held-out diagram
// (`before`), the task's hand-written reference edit (`reference`, possibly
// several acceptable alternatives) and the model's output. Semantic deltas come
// from upstream Mermaid 12.2.0 (oracle.ts); source preservation is a plain
// line diff. Nothing here calls Agentic Mermaid.

import { finalizeFacts, type CheckStrength, type Fact, type Oracle, type SemanticModel } from './oracle.ts'

export interface Patch {
  /** Exact text in the pre-edit source; it must occur exactly once. */
  find: string
  replace: string
}

export interface EditTask {
  id: string
  diagram: string
  family: string
  category: string
  /** The request as a user would type it. */
  request: string
  /** Acceptable reference edits, each a patch list applied to the held-out source. */
  references: Patch[][]
  /** Fact kinds the request leaves open; ignored for both required and collateral facts. */
  free?: string[]
  /** Attribute kinds that are required even on new elements (e.g. `parent` when the request names a subgraph). */
  strictNew?: string[]
  note?: string
}

export function applyPatches(source: string, patches: Patch[]): string {
  let out = source
  for (const p of patches) {
    const first = out.indexOf(p.find)
    if (first < 0) throw new Error(`patch text not found: ${JSON.stringify(p.find.slice(0, 80))}`)
    if (out.indexOf(p.find, first + 1) >= 0) throw new Error(`patch text occurs more than once: ${JSON.stringify(p.find.slice(0, 80))}`)
    out = out.slice(0, first) + p.replace + out.slice(first + p.find.length)
  }
  return out
}

export const referenceSources = (before: string, task: EditTask): string[] => task.references.map(patches => applyPatches(before, patches))

/**
 * The final Mermaid source in a chat response: the first ```mermaid fence after
 * an "Updated Mermaid" heading, else the last ```mermaid fence. Only leading
 * and trailing blank lines are removed, so indentation stays measurable.
 */
export function extractMermaid(response: string): string | undefined {
  const fences = [...response.matchAll(/```[ \t]*mermaid[^\n]*\n([\s\S]*?)\n?```/gi)]
  if (!fences.length) return undefined
  const heading = response.search(/(?:^|\n)[ \t]*(?:#+[ \t]*|\*\*)?Updated Mermaid\b/i)
  const chosen = (heading >= 0 ? fences.find(f => f.index! > heading) : undefined) ?? fences[fences.length - 1]!
  const body = chosen[1]!.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '')
  return body.trim() ? `${body}\n` : undefined
}

// ---------------------------------------------------------------------------
// Semantic delta

type Counts = Map<string, number>
const countKeys = (facts: Fact[]): Counts => {
  const counts: Counts = new Map()
  for (const f of facts) counts.set(f.key, (counts.get(f.key) ?? 0) + 1)
  return counts
}

interface Delta { added: Fact[]; removed: Fact[] }

function delta(before: Fact[], after: Fact[]): Delta {
  const b = countKeys(before)
  const a = countKeys(after)
  const excess = (facts: Fact[], mine: Counts, theirs: Counts) => {
    const seen: Counts = new Map()
    const out: Fact[] = []
    for (const f of facts) {
      const n = (seen.get(f.key) ?? 0) + 1
      seen.set(f.key, n)
      if (n > (theirs.get(f.key) ?? 0) && n <= (mine.get(f.key) ?? 0)) out.push(f)
    }
    return out
  }
  return { added: excess(after, a, b), removed: excess(before, b, a) }
}

/** Attribute facts of an element that did not exist before (or no longer exists) are free unless strict. */
function freeFilter(task: EditTask, beforeKeys: Set<string>, afterKeys: Set<string>) {
  const strict = new Set(task.strictNew ?? [])
  const open = new Set(task.free ?? [])
  return {
    added: (f: Fact) => open.has(f.kind) || (f.owner !== undefined && !beforeKeys.has(f.owner) && !strict.has(f.kind)),
    removed: (f: Fact) => open.has(f.kind) || (f.owner !== undefined && !afterKeys.has(f.owner) && !strict.has(f.kind)),
  }
}

/** Multiset `a − b` by key. */
function minus(a: Fact[], b: Fact[]): Fact[] {
  const left = countKeys(b)
  const out: Fact[] = []
  for (const f of a) {
    const n = left.get(f.key) ?? 0
    if (n > 0) left.set(f.key, n - 1)
    else out.push(f)
  }
  return out
}

export interface SemanticComparison {
  /** (a) every required fact of the reference delta is present in the output delta. */
  intended: boolean
  /** (b) the output delta contains facts the reference delta does not. */
  collateral: boolean
  missing: string[]
  unexpected: string[]
}

export function compareDeltas(task: EditTask, before: SemanticModel, reference: SemanticModel, output: SemanticModel): SemanticComparison {
  const known = new Set(before.elements.keys())
  const b = finalizeFacts(before, known)
  const r = finalizeFacts(reference, known)
  const o = finalizeFacts(output, known)
  const bKeys = new Set(b.map(f => f.key))
  const expected = delta(b, r)
  const actual = delta(b, o)
  const freeR = freeFilter(task, bKeys, new Set(r.map(f => f.key)))
  const freeO = freeFilter(task, bKeys, new Set(o.map(f => f.key)))
  const missing = [
    ...minus(expected.added.filter(f => !freeR.added(f)), actual.added).map(f => `+${f.key}`),
    ...minus(expected.removed.filter(f => !freeR.removed(f)), actual.removed).map(f => `-${f.key}`),
  ]
  const unexpected = [
    ...minus(actual.added.filter(f => !freeO.added(f)), expected.added).map(f => `+${f.key}`),
    ...minus(actual.removed.filter(f => !freeO.removed(f)), expected.removed).map(f => `-${f.key}`),
  ]
  return { intended: missing.length === 0, collateral: unexpected.length > 0, missing, unexpected }
}

/** True when the reference edit changes something the oracle can see. */
export function referenceChangesModel(task: EditTask, before: SemanticModel, reference: SemanticModel): boolean {
  const known = new Set(before.elements.keys())
  const b = finalizeFacts(before, known)
  const r = finalizeFacts(reference, known)
  const d = delta(b, r)
  const free = freeFilter(task, new Set(b.map(f => f.key)), new Set(r.map(f => f.key)))
  return d.added.some(f => !free.added(f)) || d.removed.some(f => !free.removed(f))
}

// ---------------------------------------------------------------------------
// Source preservation

const splitLines = (source: string): string[] => {
  const lines = source.split('\n').map(l => l.replace(/\r$/, ''))
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Indices of `a` kept by a longest-common-subsequence line diff against `b`. */
export function keptLines(a: string[], b: string[]): Set<number> {
  const n = a.length
  const m = b.length
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
  }
  const kept = new Set<number>()
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { kept.add(i); i++; j++ }
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++
    else j++
  }
  return kept
}

export type LineClass = 'comment' | 'style' | 'directive'

export function classifyLines(lines: string[]): Array<LineClass | undefined> {
  let frontmatterEnd = -1
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
    if (close > 0) frontmatterEnd = close
  }
  return lines.map((line, i) => {
    if (i <= frontmatterEnd || /^\s*%%\{/.test(line)) return 'directive'
    if (/^\s*%%/.test(line)) return 'comment'
    if (/^\s*(classDef|class|style|linkStyle|cssClass)\s/.test(line) || /:::\w/.test(line)) return 'style'
    return undefined
  })
}

export interface Ratio { kept: number; total: number; rate: number | null }
const ratio = (kept: number, total: number): Ratio => ({ kept, total, rate: total ? kept / total : null })

export interface Preservation {
  /** (c) untouched non-blank source lines preserved byte-for-byte. */
  untouched: Ratio
  comments: Ratio
  styles: Ratio
  directives: Ratio
}

/**
 * Lines the reference edit leaves alone are "untouched". Preservation is the
 * share of those (non-blank) lines that survive byte-for-byte, in order, in the
 * output. Edited lines are outside the measure, so rewriting the requested
 * line costs nothing; reformatting the rest of the diagram does.
 */
export function measurePreservation(before: string, reference: string, output: string): Preservation {
  const b = splitLines(before)
  const untouched = keptLines(b, splitLines(reference))
  const kept = keptLines(b, splitLines(output))
  const classes = classifyLines(b)
  const tally = (pick: (i: number) => boolean) => {
    let total = 0
    let survived = 0
    for (const i of untouched) {
      if (!b[i]!.trim() || !pick(i)) continue
      total++
      if (kept.has(i)) survived++
    }
    return ratio(survived, total)
  }
  return {
    untouched: tally(() => true),
    comments: tally(i => classes[i] === 'comment'),
    styles: tally(i => classes[i] === 'style'),
    directives: tally(i => classes[i] === 'directive'),
  }
}

// ---------------------------------------------------------------------------
// One output against one task

export interface EditScore {
  taskId: string
  extracted: boolean
  /** (d) Mermaid 12.2.0 parses the output. */
  parses: boolean
  parseError?: string
  intended: boolean
  /** null when the output could not be compared (missing or unparseable). */
  collateral: boolean | null
  /** Primary harm measure: collateral change, or a diagram Mermaid can no longer read. */
  damage: boolean
  /** a ∧ ¬b ∧ d */
  success: boolean
  missing: string[]
  unexpected: string[]
  /** Index of the reference alternative the output was judged against. */
  alternative: number
  preservation: Preservation | null
  strength: CheckStrength
  limitations: string[]
}

export async function scoreEdit(oracle: Oracle, before: string, task: EditTask, output: string | undefined): Promise<EditScore> {
  const parsedBefore = await oracle.parse(before)
  if (!parsedBefore.ok) throw new Error(`${task.id}: held-out source does not parse in Mermaid ${oracle.mermaidVersion}: ${parsedBefore.error}`)
  const refs = referenceSources(before, task)
  const parsedRefs = await Promise.all(refs.map(r => oracle.parse(r)))
  parsedRefs.forEach((p, i) => { if (!p.ok) throw new Error(`${task.id}: reference ${i} does not parse: ${p.error}`) })
  const { strength, limitations } = parsedBefore.model
  const base = { taskId: task.id, strength, limitations }
  if (output === undefined) {
    return { ...base, extracted: false, parses: false, intended: false, collateral: null, damage: true, success: false, missing: [], unexpected: [], alternative: 0, preservation: null }
  }
  const parsedOut = await oracle.parse(output)
  if (!parsedOut.ok) {
    return { ...base, extracted: true, parses: false, parseError: parsedOut.error.slice(0, 500), intended: false, collateral: null, damage: true, success: false, missing: [], unexpected: [], alternative: 0, preservation: measurePreservation(before, refs[0]!, output) }
  }
  // Judge against the alternative the output matches best: intended first, then least collateral.
  let best: { i: number; cmp: SemanticComparison } | undefined
  parsedRefs.forEach((p, i) => {
    if (!p.ok) return
    const cmp = compareDeltas(task, parsedBefore.model, p.model, parsedOut.model)
    const better = !best
      || (cmp.intended && !best.cmp.intended)
      || (cmp.intended === best.cmp.intended && cmp.unexpected.length + cmp.missing.length < best.cmp.unexpected.length + best.cmp.missing.length)
    if (better) best = { i, cmp }
  })
  const { i, cmp } = best!
  return {
    ...base,
    extracted: true,
    parses: true,
    intended: cmp.intended,
    collateral: cmp.collateral,
    damage: cmp.collateral,
    success: cmp.intended && !cmp.collateral,
    missing: cmp.missing,
    unexpected: cmp.unexpected,
    alternative: i,
    preservation: measurePreservation(before, refs[i]!, output),
  }
}
