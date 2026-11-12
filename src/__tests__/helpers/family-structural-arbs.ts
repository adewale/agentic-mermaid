// Structural source generators for the cross-family fuzz (Hegel finding F-03).
//
// The metamorphic builders in metamorphic-families.ts emit linear chains with
// fixed label templates, so a property drawing them sees about twenty shapes
// per family. These generators draw a family's STRUCTURE instead — nesting
// through fc.letrec, optional styles, notes and directions — and write hostile
// text into a quoted or free-text context the family's grammar can carry.
// Each materializes source its family's reader accepts. Structure follows
// Mermaid 12.2.0's grammar (checked against the pinned reference while these
// were written); hostile text Mermaid itself rejects (`%%{` in a C4 string, a
// free-form ZenUML condition) is kept, since our readers are generous there.
// Size is bounded here (array maxLength, letrec maxDepth/depthSize), never by
// an entity count.
//
// Text domain: printable Unicode graphemes, emoji, combining marks and the
// metacharacters that have broken a family before (`%%`, entity spellings,
// `:`, `;`, `|`, brackets, quotes, `<br>`, `$&`). Each slot strips only what
// its grammar cannot carry (a `"` inside a `"..."` string, a `:` in a
// timeline event, a backslash before a Langium string's closing quote).
// Controls and line terminators are left to the hostile single-slot
// properties in property-validator-surface-fuzz.test.ts.

import fc from 'fast-check'
import type { DiagramKind } from '../../agent/types.ts'

const HOSTILE_PIECES = [
  'é', 'Ω', '中文', 'ß', 'Ж', 'ي', '😀', '👩‍💻', '🇯🇵', 'e\u0301', 'a\u0308\u0301', '\u200d',
  '%%', '%%{', '#35;', '#quot;', '#9829;', '&amp;', '&lt;', ':', ';', '|', '[', ']', '"', "'", '<br>', '<br/>',
  '{', '}', '(', ')', ',', '-->', '->', '#', '&', '<', '>', '\\', '`', '*', '_', '=', '@', '/', '~', '$', '.', '+', '!', '?',
  ' ', '  ',
]

// Code points no single-line slot can hold (controls, line and paragraph
// separators), plus lone surrogates.
const NEVER = /[\p{Cc}\u2028\u2029\u0085]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu

const pieceArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom(...HOSTILE_PIECES) },
  { weight: 3, arbitrary: fc.stringMatching(/^[A-Za-z0-9]{1,6}$/) },
  { weight: 2, arbitrary: fc.string({ unit: 'grapheme', minLength: 1, maxLength: 2 }) },
)

/** Hostile single-line text. `forbid` (global) strips what the slot cannot
 * carry; `fallback` prefixes a result left without visible text (a label
 * that is only a line break is degenerate in every family). */
function textArb(forbid?: RegExp, maxPieces = 4, fallback = 'x'): fc.Arbitrary<string> {
  return fc.array(pieceArb, { minLength: 1, maxLength: maxPieces }).map(pieces => {
    let text = pieces.join('').replace(NEVER, '')
    if (forbid) text = text.replace(forbid, '')
    text = text.trim()
    return text.replace(/<br\s*\/?>/gi, '').trim() ? text : `${fallback}${text}`
  })
}

/** Text for a `"…"` string. A string opening with a backtick is a Markdown
 * string (`"`…`"`) in the graph grammars, so such text gets a prefix. */
const quotedArb = (forbid: RegExp = /"/g, maxPieces = 4) => textArb(forbid, maxPieces).map(text => (text.startsWith('`') ? `x${text}` : text))

/** Text for a string in a Langium-grammar family (pie, packet, radar, XY
 * chart, architecture, treemap): a backslash before the closing quote
 * escapes it there. */
const langiumQuotedArb = (forbid: RegExp = /"/g, maxPieces = 4) => textArb(forbid, maxPieces).map(text => text.replace(/\\+$/, '') || 'x')

/** A word every grammar reads as an identifier. */
const wordArb = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,4}$/)

/** `undefined` one time in `freq` (fast-check's option frequency). */
const option = <T>(arb: fc.Arbitrary<T>, freq = 2) => fc.option(arb, { nil: undefined, freq })
/** A value one time in eight, else `undefined`. */
const rare = <T>(arb: fc.Arbitrary<T>) => fc.oneof({ weight: 7, arbitrary: fc.constant(undefined) }, { weight: 1, arbitrary: arb })
const colorArb = fc.constantFrom('#f9f', '#ff0000', '#0a0', 'red', 'blue', 'white', '#123456')
const indent = (depth: number) => '  '.repeat(depth)
const pick = <T>(items: readonly T[], n: number): T => items[n % items.length]!

// ---------------------------------------------------------------------------
// C4
// ---------------------------------------------------------------------------

const C4_ELEMENTS: Record<string, string[]> = {
  C4Context: ['Person', 'Person_Ext', 'System', 'System_Ext', 'SystemDb', 'SystemQueue', 'SystemDb_Ext'],
  C4Container: ['Person', 'System_Ext', 'Container', 'ContainerDb', 'ContainerQueue', 'Container_Ext'],
  C4Component: ['Container', 'Component', 'ComponentDb', 'ComponentQueue', 'Component_Ext'],
  C4Dynamic: ['Person', 'Container', 'Component', 'ComponentDb'],
  C4Deployment: ['Container', 'ContainerDb', 'System'],
}
const C4_BOUNDARIES: Record<string, string[]> = {
  C4Context: ['Boundary', 'Enterprise_Boundary', 'System_Boundary'],
  C4Container: ['System_Boundary', 'Container_Boundary', 'Boundary'],
  C4Component: ['Container_Boundary', 'Boundary'],
  C4Dynamic: ['Container_Boundary', 'Boundary'],
  C4Deployment: ['Deployment_Node', 'Node', 'Node_L', 'Node_R'],
}
const C4_RELS = ['Rel', 'BiRel', 'Rel_U', 'Rel_D', 'Rel_L', 'Rel_R', 'Rel_Back']
const c4Text = textArb(/"/g)

type C4Tree = { boundary: boolean; macro: number; label: string; descr?: string; techn?: string; children: C4Tree[] }
const c4TreeArb = fc.letrec<{ node: C4Tree; children: C4Tree[] }>(tie => ({
  node: fc.oneof(
    { depthSize: 'small', maxDepth: 4, withCrossShrink: true },
    fc.record({ boundary: fc.constant(false), macro: fc.nat(), label: c4Text, descr: option(c4Text), techn: option(c4Text), children: fc.constant([] as C4Tree[]) }),
    fc.record({ boundary: fc.constant(true), macro: fc.nat(), label: c4Text, descr: option(c4Text), techn: fc.constant(undefined), children: tie('children') as fc.Arbitrary<C4Tree[]> }),
  ) as fc.Arbitrary<C4Tree>,
  children: fc.array(tie('node') as fc.Arbitrary<C4Tree>, { maxLength: 3 }),
}))

const c4Arb = fc
  .record({
    variant: fc.constantFrom('C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'),
    title: option(textArb(/"/g)),
    prefix: fc.constantFrom('s', 'Rel', 'node', 'boundary', 'é'),
    roots: fc.array(c4TreeArb.node, { minLength: 1, maxLength: 4 }),
    rels: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), macro: fc.constantFrom(...C4_RELS), label: c4Text, techn: option(c4Text) }), { maxLength: 5 }),
    elementStyles: fc.array(fc.record({ target: fc.nat(), bg: colorArb, font: option(colorArb) }), { maxLength: 2 }),
    relStyle: option(fc.record({ rel: fc.nat(), color: colorArb, offset: fc.integer({ min: -40, max: 40 }) })),
    layout: option(fc.record({ shapes: fc.integer({ min: 1, max: 5 }), boundaries: fc.integer({ min: 1, max: 3 }) })),
  })
  .map(({ variant, title, prefix, roots, rels, elementStyles, relStyle, layout }) => {
    const lines: string[] = [variant]
    if (title !== undefined) lines.push(`  title ${title}`)
    const elements: string[] = []
    let n = 0
    const emit = (node: C4Tree, depth: number): void => {
      const id = `${prefix}${n++}`
      if (node.boundary) {
        const macro = pick(C4_BOUNDARIES[variant]!, node.macro)
        const deployment = macro.startsWith('Node') || macro === 'Deployment_Node'
        const args = [id, `"${node.label}"`, ...(deployment ? [`"${node.descr ?? 'node'}"`] : node.descr !== undefined ? [`"${node.descr}"`] : [])]
        lines.push(`${indent(depth)}${macro}(${args.join(', ')}) {`)
        node.children.forEach(child => emit(child, depth + 1))
        lines.push(`${indent(depth)}}`)
      } else {
        const macro = pick(C4_ELEMENTS[variant]!, node.macro)
        const technical = macro.startsWith('Container') || macro.startsWith('Component')
        const args = [id, `"${node.label}"`]
        if (technical) args.push(`"${node.techn ?? ''}"`)
        if (node.descr !== undefined) args.push(`"${node.descr}"`)
        lines.push(`${indent(depth)}${macro}(${args.join(', ')})`)
        elements.push(id)
      }
    }
    roots.forEach(root => emit(root, 1))
    // An element-free diagram keeps its boundaries; relations need endpoints.
    const relLines: [string, string][] = []
    if (elements.length) {
      for (const rel of rels) {
        const from = pick(elements, rel.from), to = pick(elements, rel.to)
        relLines.push([from, to])
        lines.push(`  ${rel.macro}(${from}, ${to}, "${rel.label}"${rel.techn === undefined ? '' : `, "${rel.techn}"`})`)
      }
      for (const style of elementStyles) lines.push(`  UpdateElementStyle(${pick(elements, style.target)}, $bgColor="${style.bg}"${style.font ? `, $fontColor="${style.font}"` : ''})`)
      if (relStyle && relLines.length) {
        const [from, to] = pick(relLines, relStyle.rel)
        lines.push(`  UpdateRelStyle(${from}, ${to}, $textColor="${relStyle.color}", $offsetY="${relStyle.offset}")`)
      }
    }
    if (layout) lines.push(`  UpdateLayoutConfig($c4ShapeInRow="${layout.shapes}", $c4BoundaryInRow="${layout.boundaries}")`)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Ishikawa — one effect, causes nested by indentation, free-text lines.
// ---------------------------------------------------------------------------

type Tree = { label: string; children: Tree[] }
const treeArb = (label: fc.Arbitrary<string>, maxChildren = 3) =>
  fc.letrec<{ node: Tree; children: Tree[] }>(tie => ({
    node: fc.record({ label, children: tie('children') as fc.Arbitrary<Tree[]> }),
    children: fc.oneof({ depthSize: 'small', maxDepth: 4, withCrossShrink: true }, fc.constant([] as Tree[]), fc.array(tie('node') as fc.Arbitrary<Tree>, { minLength: 1, maxLength: maxChildren })),
  })).node

// A line starting with the header or an accessibility keyword is read as that
// keyword; a leading `%%` is a comment.
const freeLine = (forbid?: RegExp) => textArb(forbid).map(text => (/^(?:%%|ishikawa|accTitle|accDescr)/i.test(text) ? `x${text}` : text))

const ishikawaArb = treeArb(freeLine()).map(root => {
  const lines = ['ishikawa']
  const emit = (node: Tree, depth: number): void => {
    lines.push(`${indent(depth)}${node.label}`)
    node.children.forEach(child => emit(child, depth + 1))
  }
  emit(root, 1)
  return lines.join('\n')
})

// ---------------------------------------------------------------------------
// Event Modeling — frames with explicit sources, inline/block data, notes and
// Given/When/Then specifications.
// ---------------------------------------------------------------------------

const EVENT_TYPES = ['ui', 'cmd', 'evt', 'rmo', 'pcr', 'command', 'event', 'readmodel', 'processor']
const eventEntityArb = fc.tuple(option(wordArb, 3), wordArb).map(([ns, name]) => (ns ? `${ns}.${name}` : name))
const eventModelingArb = fc
  .record({
    title: option(textArb()),
    frames: fc.array(
      fc.record({ reset: fc.boolean(), type: fc.constantFrom(...EVENT_TYPES), entity: eventEntityArb, sources: fc.array(fc.nat(), { maxLength: 2 }), data: option(textArb(/[{}]/g)), ref: fc.boolean() }),
      { minLength: 1, maxLength: 7 },
    ),
    blocks: fc.array(textArb(/[{}]/g), { maxLength: 2 }),
    notes: fc.array(fc.record({ frame: fc.nat(), text: textArb(/[{}]/g) }), { maxLength: 2 }),
    specs: fc.array(fc.record({ frame: fc.nat(), given: fc.array(fc.tuple(fc.constantFrom(...EVENT_TYPES), wordArb), { minLength: 1, maxLength: 2 }), then: fc.array(fc.tuple(fc.constantFrom(...EVENT_TYPES), wordArb), { minLength: 1, maxLength: 2 }) }), { maxLength: 2 }),
  })
  .map(({ title, frames, blocks, notes, specs }) => {
    const ids = frames.map((_, index) => String(index + 1).padStart(2, '0'))
    // Pinned Mermaid reads a title only from frontmatter.
    const lines = title === undefined ? ['eventmodeling'] : ['---', `title: ${JSON.stringify(title)}`, '---', 'eventmodeling']
    blocks.forEach((text, index) => lines.push(`data D${index} {`, `  ${text}`, '}'))
    frames.forEach((frame, index) => {
      const sources = index ? [...new Set(frame.sources.map(source => ids[source % index]!))] : []
      const ref = frame.ref && blocks.length ? ` [[D${index % blocks.length}]]` : ''
      lines.push(`${frame.reset ? 'rf' : 'tf'} ${ids[index]} ${frame.type} ${frame.entity}${sources.map(source => ` ->> ${source}`).join('')}${ref}${frame.data === undefined ? '' : ` {${frame.data}}`}`)
    })
    notes.forEach(note => lines.push(`note ${pick(ids, note.frame)} {`, `  ${note.text}`, '}'))
    specs.forEach(spec => lines.push(`gwt ${pick(ids, spec.frame)}`, '  given', ...spec.given.map(([type, name]) => `    ${type} ${name}`), '  then', ...spec.then.map(([type, name]) => `    ${type} ${name}`)))
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// ZenUML — declarations, async messages, nested calls, creations, returns,
// comments and if/else, while, try/catch, par and opt fragments.
// ---------------------------------------------------------------------------

type ZenStatement =
  | { kind: 'message'; from: number; to: number; label: string; reply: boolean }
  | { kind: 'call'; to: number; method: string; args: string; children: ZenStatement[] }
  | { kind: 'create'; ctor: string; children: ZenStatement[] }
  | { kind: 'return'; label: string }
  | { kind: 'comment'; text: string }
  | { kind: 'fragment'; type: string; condition: string; body: ZenStatement[]; alternative: ZenStatement[] | undefined }

const zenMessageText = textArb(/;/g)
const zenParenText = textArb(/[()[\]"'\\;]|\/\//g)
const zenArb = fc
  .record({
    title: option(textArb(/;/g)),
    participants: fc.array(fc.record({ quoted: fc.boolean(), name: textArb(/["\\]/g), annotation: option(fc.constantFrom('@Actor', '@Database', '@Boundary', '@Control', '@Entity')), alias: option(textArb(/["\\]/g)) }), { minLength: 1, maxLength: 4 }),
    statements: fc.letrec<{ statement: ZenStatement; block: ZenStatement[] }>(tie => ({
      statement: fc.oneof(
        { depthSize: 'small', maxDepth: 4, withCrossShrink: true },
        fc.record({ kind: fc.constant('message' as const), from: fc.nat(), to: fc.nat(), label: zenMessageText, reply: fc.boolean() }),
        fc.record({ kind: fc.constant('comment' as const), text: textArb() }),
        fc.record({ kind: fc.constant('return' as const), label: textArb(/[;{}()[\]"'\\]|\/\//g) }),
        fc.record({ kind: fc.constant('call' as const), to: fc.nat(), method: wordArb, args: fc.oneof(fc.constant(''), zenParenText), children: tie('block') as fc.Arbitrary<ZenStatement[]> }),
        fc.record({ kind: fc.constant('create' as const), ctor: wordArb, children: tie('block') as fc.Arbitrary<ZenStatement[]> }),
        fc.record({ kind: fc.constant('fragment' as const), type: fc.constantFrom('if', 'while', 'opt', 'par', 'loop', 'try', 'critical', 'forEach'), condition: zenParenText, body: tie('block') as fc.Arbitrary<ZenStatement[]>, alternative: option(tie('block') as fc.Arbitrary<ZenStatement[]>) }),
      ) as fc.Arbitrary<ZenStatement>,
      block: fc.array(tie('statement') as fc.Arbitrary<ZenStatement>, { maxLength: 3 }),
    })).block,
  })
  .map(({ title, participants, statements }) => {
    const names: string[] = []
    const lines = ['zenuml']
    if (title !== undefined) lines.push(`  title ${title}`)
    participants.forEach((p, index) => {
      // Keep each authored identity distinct; quote what is not a bare name.
      const name = p.quoted ? `${p.name} ${index}` : `P${index}`
      if (names.includes(name)) return
      names.push(name)
      const spelled = p.quoted ? JSON.stringify(name) : name
      lines.push(`  ${p.annotation ? `${p.annotation} ` : ''}${spelled}${p.alias === undefined ? '' : ` as ${JSON.stringify(p.alias)}`}`)
    })
    const ref = (n: number) => {
      const name = pick(names, n)
      return /^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(name) ? name : JSON.stringify(name)
    }
    const emit = (items: ZenStatement[], depth: number): void => {
      for (const s of items) {
        const pad = indent(depth)
        switch (s.kind) {
          case 'message': lines.push(`${pad}${ref(s.from)}${s.reply ? '-->' : '->'}${ref(s.to)}: ${s.label}`); break
          case 'comment': lines.push(`${pad}// ${s.text}`); break
          case 'return': lines.push(`${pad}return ${s.label}`); break
          case 'call':
          case 'create': {
            const head = s.kind === 'call' ? `${ref(s.to)}.${s.method}(${s.args})` : `new ${s.ctor}()`
            if (!s.children.length) { lines.push(`${pad}${head}`); break }
            lines.push(`${pad}${head} {`); emit(s.children, depth + 1); lines.push(`${pad}}`)
            break
          }
          case 'fragment': {
            const conditional = s.type !== 'par' && s.type !== 'try'
            lines.push(`${pad}${s.type}${conditional ? `(${s.condition})` : ''} {`)
            emit(s.body, depth + 1)
            if (s.alternative && (s.type === 'if' || s.type === 'try')) {
              lines.push(`${pad}} ${s.type === 'if' ? 'else' : `catch(${s.condition})`} {`)
              emit(s.alternative, depth + 1)
            }
            lines.push(`${pad}}`)
          }
        }
      }
    }
    emit(statements, 1)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Treemap — sections nested by indentation, leaves with fractional values,
// class assignments.
// ---------------------------------------------------------------------------

type TreemapNode = { label: string; value: number | undefined; cls: boolean; children: TreemapNode[] }
const treemapText = langiumQuotedArb()
// Leaves carry integer or fractional values; sections carry children.
const treemapNodeArb = fc.letrec<{ node: TreemapNode }>(tie => ({
  node: fc.oneof(
    { depthSize: 'small', maxDepth: 4, withCrossShrink: true },
    fc.record({ label: treemapText, value: fc.oneof(fc.integer({ min: 0, max: 500 }), fc.double({ min: 0.01, max: 99, noNaN: true }).map(v => Math.round(v * 100) / 100)), cls: fc.boolean(), children: fc.constant([] as TreemapNode[]) }),
    fc.record({ label: treemapText, value: fc.constant(undefined), cls: fc.boolean(), children: fc.array(tie('node') as fc.Arbitrary<TreemapNode>, { minLength: 1, maxLength: 3 }) }),
  ) as fc.Arbitrary<TreemapNode>,
})).node
const treemapArb = fc
  .record({ header: fc.constantFrom('treemap', 'treemap-beta'), title: option(textArb()), roots: fc.array(treemapNodeArb, { minLength: 1, maxLength: 3 }), classDef: fc.boolean() })
  .map(({ header, title, roots, classDef }) => {
    const lines: string[] = [header]
    if (title !== undefined) lines.push(`  title ${title}`)
    const emit = (node: TreemapNode, depth: number): void => {
      lines.push(`${indent(depth)}"${node.label}"${node.value === undefined ? '' : `: ${node.value}`}${classDef && node.cls ? ':::hot' : ''}`)
      node.children.forEach(child => emit(child, depth + 1))
    }
    roots.forEach(root => emit(root, 1))
    if (classDef) lines.push('  classDef hot fill:#f96,stroke:#333')
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// GitGraph — a simulated branch history: commits (custom ids, messages, tags,
// types), branches with order, checkout/switch, merges and cherry-picks,
// emitted only where Mermaid's history rules admit them.
// ---------------------------------------------------------------------------

type GitOp = { kind: 'commit' | 'branch' | 'checkout' | 'merge' | 'cherry'; n: number; id: boolean; msg: string | undefined; tag: string | undefined; type: number }
// Mermaid's gitGraph strings read a backslash before the closing quote as an escape.
const gitText = textArb(/"/g, 3).map(text => text.replace(/\\+$/, '') || 'x')
const gitgraphArb = fc
  .record({
    direction: fc.constantFrom('', ' LR:', ' TB:', ' BT:'),
    branchNames: fc.uniqueArray(fc.constantFrom('develop', 'feature/a-1', 'release.2', 'hotfix_x', 'fix-é', 'b2'), { minLength: 1, maxLength: 4 }),
    ops: fc.array(fc.record({ kind: fc.constantFrom('commit', 'commit', 'branch', 'checkout', 'merge', 'cherry'), n: fc.nat(), id: fc.boolean(), msg: option(gitText), tag: option(gitText, 4), type: fc.nat({ max: 3 }) }), { minLength: 1, maxLength: 12 }) as fc.Arbitrary<GitOp[]>,
    order: fc.boolean(),
  })
  .map(({ direction, branchNames, ops, order }) => {
    const lines = [`gitGraph${direction}`]
    type Commit = { id: string; branch: string; parents: string[]; custom: boolean; merge: boolean }
    const commits = new Map<string, Commit>()
    const heads = new Map<string, string | undefined>([['main', undefined]])
    let current = 'main', serial = 0
    const ancestors = (id: string | undefined): Set<string> => {
      const seen = new Set<string>(), stack = id ? [id] : []
      while (stack.length) { const next = stack.pop()!; if (seen.has(next)) continue; seen.add(next); stack.push(...commits.get(next)!.parents) }
      return seen
    }
    const tags = new Set<string>()
    const attrs = (op: GitOp, id: string, custom: boolean, withType = true): string => {
      const parts = custom ? [`id: "${id}"`] : []
      if (op.msg !== undefined) parts.push(`msg: "${op.msg}"`)
      if (op.tag !== undefined && !tags.has(op.tag)) { tags.add(op.tag); parts.push(`tag: "${op.tag}"`) }
      if (withType && op.type) parts.push(`type: ${['NORMAL', 'REVERSE', 'HIGHLIGHT'][op.type - 1]}`)
      return parts.length ? ` ${parts.join(' ')}` : ''
    }
    for (const op of ops) {
      if (op.kind === 'commit') {
        const custom = op.id
        const id = custom ? `c${serial}${op.msg ? `-${op.msg}` : ''}` : `auto${serial}`
        serial++
        commits.set(id, { id, branch: current, parents: heads.get(current) ? [heads.get(current)!] : [], custom, merge: false })
        heads.set(current, id)
        lines.push(`  commit${attrs(op, id, custom)}`)
      } else if (op.kind === 'branch') {
        const name = branchNames.find(candidate => !heads.has(candidate))
        if (!name || heads.get(current) === undefined) continue
        heads.set(name, heads.get(current)); current = name
        lines.push(`  branch ${name}${order ? ` order: ${heads.size}` : ''}`)
      } else if (op.kind === 'checkout') {
        const name = pick([...heads.keys()], op.n)
        current = name
        lines.push(`  ${op.n % 2 ? 'switch' : 'checkout'} ${name}`)
      } else if (op.kind === 'merge') {
        const others = [...heads.keys()].filter(name => name !== current)
        if (!others.length) continue
        const name = pick(others, op.n), head = heads.get(name), mine = heads.get(current)
        if (!head || !mine || ancestors(mine).has(head)) continue
        const id = `m${serial++}`
        commits.set(id, { id, branch: current, parents: [mine, head], custom: true, merge: true })
        heads.set(current, id)
        lines.push(`  merge ${name}${attrs(op, id, op.id)}`)
        if (!op.id) commits.get(id)!.custom = false
      } else {
        const mine = heads.get(current)
        if (!mine) continue
        const reachable = ancestors(mine)
        const candidates = [...commits.values()].filter(commit => commit.custom && !commit.merge && commit.branch !== current && !reachable.has(commit.id))
        if (!candidates.length) continue
        const picked = pick(candidates, op.n)
        const id = `p${serial++}`
        commits.set(id, { id, branch: current, parents: [mine], custom: false, merge: false })
        heads.set(current, id)
        lines.push(`  cherry-pick id: "${picked.id}"`)
      }
    }
    if (lines.length === 1) lines.push('  commit')
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Timeline — optional sections, periods with several events on one line and
// on continuation lines. `:` separates events and `#` opens a comment.
// ---------------------------------------------------------------------------

const timelineText = textArb(/[:#]|%%/g)
const timelineArb = fc
  .record({
    direction: fc.constantFrom('', ' LR', ' TD'),
    title: option(timelineText),
    leading: fc.array(fc.record({ label: timelineText, events: fc.array(timelineText, { maxLength: 3 }), continued: fc.array(timelineText, { maxLength: 2 }) }), { maxLength: 2 }),
    sections: fc.array(fc.record({ label: timelineText, periods: fc.array(fc.record({ label: timelineText, events: fc.array(timelineText, { maxLength: 3 }), continued: fc.array(timelineText, { maxLength: 2 }) }), { minLength: 1, maxLength: 3 }) }), { maxLength: 3 }),
  })
  .map(({ direction, title, leading, sections }) => {
    const lines = [`timeline${direction}`]
    if (title !== undefined) lines.push(`  title ${title}`)
    type Period = { label: string; events: string[]; continued: string[] }
    const period = (p: Period, pad: string): void => {
      // A bare word title/section is that keyword, not a period label.
      const label = /^(?:title|section|accTitle|accDescr|timeline)\b/i.test(p.label) ? `P ${p.label}` : p.label
      lines.push(`${pad}${label}${p.events.map(event => ` : ${event}`).join('')}`)
      if (p.events.length) p.continued.forEach(event => lines.push(`${pad}     : ${event}`))
    }
    leading.forEach(p => period(p, '  '))
    for (const section of sections) {
      lines.push(`  section ${section.label}`)
      section.periods.forEach(p => period(p, '    '))
    }
    if (lines.length === 1 + (title === undefined ? 0 : 1)) lines.push('  2024 : start')
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Block — columns, shaped blocks with widths, nested composite blocks,
// spaces, labelled edges, styles and classes.
// ---------------------------------------------------------------------------

const BLOCK_SHAPES: [string, string][] = [['["', '"]'], ['("', '")'], ['(["', '"])'], ['[["', '"]]'], ['(("', '"))'], ['{"', '"}'], ['{{"', '"}}'], ['>"', '"]'], ['[/"', '"/]'], ['[\\"', '"\\]'], ['((("', '")))']]
type BlockItem = { kind: 'node'; shape: number; label: string | undefined; width: number } | { kind: 'space'; width: number } | { kind: 'group'; named: boolean; columns: number | undefined; width: number; children: BlockItem[] }
const blockText = quotedArb()
const blockItemArb = fc.letrec<{ item: BlockItem; items: BlockItem[] }>(tie => ({
  item: fc.oneof(
    { depthSize: 'small', maxDepth: 4, withCrossShrink: true },
    fc.record({ kind: fc.constant('node' as const), shape: fc.nat(), label: option(blockText, 4), width: fc.integer({ min: 1, max: 2 }) }),
    fc.record({ kind: fc.constant('space' as const), width: fc.integer({ min: 1, max: 2 }) }),
    // Anonymous composites (`block` … `end`) are excluded: the writer names
    // them with their generated id, which shifts every later generated id
    // on re-read (reported finding; see the F-03 report).
    fc.record({ kind: fc.constant('group' as const), named: fc.constant(true), columns: option(fc.integer({ min: 1, max: 3 })), width: fc.integer({ min: 1, max: 2 }), children: tie('items') as fc.Arbitrary<BlockItem[]> }),
  ) as fc.Arbitrary<BlockItem>,
  items: fc.array(tie('item') as fc.Arbitrary<BlockItem>, { minLength: 1, maxLength: 4 }),
}))
const blockArb = fc
  .record({
    header: fc.constantFrom('block', 'block-beta'),
    columns: option(fc.integer({ min: 1, max: 4 })),
    // Mermaid's block lexer reads class and style targets as ASCII words.
    prefix: fc.constantFrom('b', 'end', 'block', 'space', 'columns'),
    items: blockItemArb.items,
    edges: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), label: option(blockText), arrow: fc.constantFrom('-->', '---', '==>', '-.->') }), { maxLength: 4 }),
    styles: fc.array(fc.record({ target: fc.nat(), color: colorArb }), { maxLength: 2 }),
    classed: option(fc.nat()),
  })
  .map(({ header, columns, prefix, items, edges, styles, classed }) => {
    const lines: string[] = [header]
    if (columns !== undefined) lines.push(`  columns ${columns}`)
    const nodes: string[] = []
    let n = 0
    const emit = (list: BlockItem[], depth: number): void => {
      for (const item of list) {
        const pad = indent(depth)
        if (item.kind === 'space') lines.push(`${pad}space${item.width > 1 ? `:${item.width}` : ''}`)
        else if (item.kind === 'node') {
          const id = `${prefix}${n++}`
          nodes.push(id)
          const [open, close] = pick(BLOCK_SHAPES, item.shape)
          lines.push(`${pad}${id}${item.label === undefined ? '' : `${open}${item.label}${close}`}${item.width > 1 ? `:${item.width}` : ''}`)
        } else {
          const id = `${prefix}g${n++}`
          lines.push(item.named ? `${pad}block:${id}${item.width > 1 ? `:${item.width}` : ''}` : `${pad}block`)
          if (item.columns !== undefined) lines.push(`${pad}  columns ${item.columns}`)
          emit(item.children, depth + 1)
          lines.push(`${pad}end`)
        }
      }
    }
    emit(items, 1)
    if (nodes.length) {
      for (const e of edges) {
        const from = pick(nodes, e.from), to = pick(nodes, e.to)
        if (from === to) continue
        lines.push(e.label === undefined ? `  ${from} ${e.arrow} ${to}` : `  ${from} -- "${e.label}" ${e.arrow} ${to}`)
      }
      for (const s of styles) lines.push(`  style ${pick(nodes, s.target)} fill:${s.color},stroke:#333`)
      if (classed !== undefined) lines.push('  classDef hot fill:#f96', `  class ${pick(nodes, classed)} hot`)
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Requirement — every requirement type, elements, all relation types in both
// arrow directions, direction, styles and classes.
// ---------------------------------------------------------------------------

const REQ_TYPES = ['requirement', 'functionalRequirement', 'interfaceRequirement', 'performanceRequirement', 'physicalRequirement', 'designConstraint']
const REQ_RELS = ['contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces']
const reqText = textArb(/"/g)
const requirementArb = fc
  .record({
    direction: option(fc.constantFrom('TB', 'BT', 'LR', 'RL')),
    requirements: fc.array(fc.record({ type: fc.constantFrom(...REQ_TYPES), quoted: option(textArb(/"/g, 2), 3), id: option(fc.oneof(wordArb, fc.stringMatching(/^[0-9]{1,3}(\.[0-9]{1,2})?$/))), text: option(reqText), risk: option(fc.constantFrom('low', 'medium', 'high', 'Low', 'HIGH')), verify: option(fc.constantFrom('analysis', 'inspection', 'test', 'demonstration')) }), { minLength: 1, maxLength: 4 }),
    elements: fc.array(fc.record({ type: option(reqText), docref: option(reqText) }), { maxLength: 3 }),
    relations: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), type: fc.constantFrom(...REQ_RELS), backward: fc.boolean() }), { maxLength: 5 }),
    styles: fc.array(fc.record({ target: fc.nat(), color: colorArb }), { maxLength: 2 }),
    classed: option(fc.record({ target: fc.nat(), shorthand: fc.boolean() })),
  })
  .map(({ direction, requirements, elements, relations, styles, classed }) => {
    const lines = ['requirementDiagram']
    if (direction) lines.push(`  direction ${direction}`)
    const names: string[] = []
    requirements.forEach((r, index) => {
      const name = r.quoted === undefined ? `r${index}` : `"${r.quoted} ${index}"`
      names.push(name)
      lines.push(`  ${r.type} ${name} {`)
      if (r.id !== undefined) lines.push(`    id: ${r.id}`)
      if (r.text !== undefined) lines.push(`    text: "${r.text}"`)
      if (r.risk !== undefined) lines.push(`    risk: ${r.risk}`)
      if (r.verify !== undefined) lines.push(`    verifymethod: ${r.verify}`)
      lines.push('  }')
    })
    elements.forEach((e, index) => {
      const name = `e${index}`
      names.push(name)
      lines.push(`  element ${name} {`)
      if (e.type !== undefined) lines.push(`    type: "${e.type}"`)
      if (e.docref !== undefined) lines.push(`    docref: "${e.docref}"`)
      lines.push('  }')
    })
    for (const r of relations) {
      const from = pick(names, r.from), to = pick(names, r.to)
      lines.push(r.backward ? `  ${to} <- ${r.type} - ${from}` : `  ${from} - ${r.type} -> ${to}`)
    }
    for (const s of styles) lines.push(`  style ${pick(names, s.target)} fill:${s.color},stroke:#333`)
    if (classed) {
      lines.push('  classDef hot fill:#f96')
      const name = pick(names, classed.target)
      lines.push(classed.shorthand ? `  ${name}:::hot` : `  class ${name} hot`)
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Flowchart — nested subgraphs with their own directions, every quoted shape,
// labelled edges of every stroke, styles, classes and link styles.
// ---------------------------------------------------------------------------

const FLOW_SHAPES: [string, string][] = [['["', '"]'], ['("', '")'], ['(["', '"])'], ['[["', '"]]'], ['[("', '")]'], ['(("', '"))'], ['>"', '"]'], ['{"', '"}'], ['{{"', '"}}'], ['[/"', '"/]'], ['[\\"', '"\\]'], ['[/"', '"\\]'], ['[\\"', '"/]'], ['((("', '")))']]
const FLOW_ARROWS = ['-->', '---', '-.->', '==>', '--o', '--x', '<-->', '-.-', '===']
const DIRECTIONS = ['TD', 'TB', 'LR', 'RL', 'BT']
const flowText = quotedArb()
type FlowItem = { kind: 'node'; shape: number; label: string | undefined } | { kind: 'subgraph'; label: string | undefined; direction: string | undefined; children: FlowItem[] }
const flowItemsArb = fc.letrec<{ item: FlowItem; items: FlowItem[] }>(tie => ({
  item: fc.oneof(
    { depthSize: 'small', maxDepth: 4, withCrossShrink: true },
    fc.record({ kind: fc.constant('node' as const), shape: fc.nat(), label: option(flowText, 4) }),
    fc.record({ kind: fc.constant('subgraph' as const), label: option(flowText), direction: option(fc.constantFrom(...DIRECTIONS)), children: tie('items') as fc.Arbitrary<FlowItem[]> }),
  ) as fc.Arbitrary<FlowItem>,
  items: fc.array(tie('item') as fc.Arbitrary<FlowItem>, { minLength: 1, maxLength: 4 }),
})).items
const flowchartArb = fc
  .record({
    header: fc.constantFrom('flowchart', 'graph'),
    direction: fc.constantFrom(...DIRECTIONS),
    prefix: fc.constantFrom('n', 'end', 'node', 'subgraph', 'é', 'A_'),
    items: flowItemsArb,
    edges: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), arrow: fc.constantFrom(...FLOW_ARROWS), label: option(flowText), pipe: fc.boolean() }), { maxLength: 5 }),
    styles: fc.array(fc.record({ target: fc.nat(), color: colorArb }), { maxLength: 2 }),
    classed: option(fc.record({ target: fc.nat(), shorthand: fc.boolean() })),
    linkStyle: option(colorArb),
  })
  .map(({ header, direction, prefix, items, edges, styles, classed, linkStyle }) => {
    const lines = [`${header} ${direction}`]
    const nodes: string[] = []
    let n = 0
    const emit = (list: FlowItem[], depth: number): void => {
      for (const item of list) {
        const pad = indent(depth)
        if (item.kind === 'node') {
          const id = `${prefix}${n++}`
          nodes.push(id)
          const [open, close] = pick(FLOW_SHAPES, item.shape)
          lines.push(`${pad}${id}${item.label === undefined ? '' : `${open}${item.label}${close}`}`)
        } else {
          lines.push(`${pad}subgraph ${prefix}g${n++}${item.label === undefined ? '' : ` ["${item.label}"]`}`)
          if (item.direction) lines.push(`${pad}  direction ${item.direction}`)
          emit(item.children, depth + 1)
          lines.push(`${pad}end`)
        }
      }
    }
    emit(items, 1)
    let edgeCount = 0
    if (nodes.length) {
      for (const e of edges) {
        const from = pick(nodes, e.from), to = pick(nodes, e.to)
        edgeCount++
        if (e.label === undefined) lines.push(`  ${from} ${e.arrow} ${to}`)
        else if (e.pipe) lines.push(`  ${from} ${e.arrow}|"${e.label}"| ${to}`)
        else lines.push(`  ${from} ${e.arrow.startsWith('<') ? '<--' : e.arrow.slice(0, 2)} "${e.label}" ${e.arrow.startsWith('<') ? '-->' : e.arrow} ${to}`)
      }
      for (const s of styles) lines.push(`  style ${pick(nodes, s.target)} fill:${s.color},stroke:#333`)
      if (classed) {
        lines.push('  classDef hot fill:#f96,stroke-width:2px')
        lines.push(classed.shorthand ? `  ${pick(nodes, classed.target)}:::hot` : `  class ${pick(nodes, classed.target)} hot`)
      }
      if (linkStyle && edgeCount) lines.push(`  linkStyle 0 stroke:${linkStyle}`)
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// State — composite states nested to depth, concurrent regions, start/end
// pseudostates, forks/choices, notes, directions and classes.
// ---------------------------------------------------------------------------

type StateScope = { states: { label: string | undefined; composite: StateScope | undefined; regions: StateScope[] }[]; transitions: { from: number; to: number; label: string | undefined }[]; start: boolean; end: boolean; direction: string | undefined }
const stateLabel = quotedArb()
const transitionText = textArb()
const stateScopeArb = fc.letrec<{ scope: StateScope; state: StateScope['states'][number] }>(tie => ({
  scope: fc.record({
    states: fc.array(tie('state') as fc.Arbitrary<StateScope['states'][number]>, { minLength: 1, maxLength: 3 }),
    transitions: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), label: option(transitionText) }), { maxLength: 3 }),
    start: fc.boolean(),
    end: fc.boolean(),
    direction: option(fc.constantFrom('LR', 'TB', 'RL', 'BT'), 4),
  }),
  state: fc.oneof(
    { depthSize: 'small', maxDepth: 2, withCrossShrink: true },
    fc.record({ label: option(stateLabel), composite: fc.constant(undefined), regions: fc.constant([] as StateScope[]) }),
    fc.record({ label: fc.constant(undefined), composite: tie('scope') as fc.Arbitrary<StateScope>, regions: fc.constant([] as StateScope[]) }),
    fc.record({ label: fc.constant(undefined), composite: fc.constant(undefined), regions: fc.array(tie('scope') as fc.Arbitrary<StateScope>, { minLength: 2, maxLength: 2 }) }),
  ),
}))
const stateArb = fc
  .record({
    direction: option(fc.constantFrom('LR', 'TB', 'RL', 'BT')),
    prefix: fc.constantFrom('s', 'state', 'end', 'note', 'é'),
    root: stateScopeArb.scope,
    choice: fc.boolean(),
    notes: fc.array(fc.record({ target: fc.nat(), side: fc.constantFrom('left', 'right'), text: textArb(), block: fc.boolean() }), { maxLength: 2 }),
    classed: option(fc.nat()),
  })
  .map(({ direction, prefix, root, choice, notes, classed }) => {
    const lines = ['stateDiagram-v2']
    if (direction) lines.push(`  direction ${direction}`)
    const simple: string[] = []
    let n = 0
    const emit = (scope: StateScope, depth: number): void => {
      const pad = indent(depth)
      if (scope.direction && depth > 1) lines.push(`${pad}direction ${scope.direction}`)
      const ids: string[] = []
      for (const state of scope.states) {
        const id = `${prefix}${n++}`
        ids.push(id)
        if (state.composite || state.regions.length) {
          lines.push(`${pad}state ${id} {`)
          if (state.composite) emit(state.composite, depth + 1)
          else state.regions.forEach((region, index) => { if (index) lines.push(`${pad}  --`); emit(region, depth + 1) })
          lines.push(`${pad}}`)
        } else {
          simple.push(id)
          if (state.label !== undefined) lines.push(`${pad}state "${state.label}" as ${id}`)
        }
      }
      if (scope.start) lines.push(`${pad}[*] --> ${ids[0]}`)
      for (const t of scope.transitions) lines.push(`${pad}${pick(ids, t.from)} --> ${pick(ids, t.to)}${t.label === undefined ? '' : ` : ${t.label}`}`)
      if (scope.end) lines.push(`${pad}${ids.at(-1)} --> [*]`)
      // A scope whose states are all labelled-or-composite still needs one
      // statement that names each plain state; declarations above do that.
      for (const [index, state] of scope.states.entries()) if (!state.composite && !state.regions.length && state.label === undefined && !scope.transitions.length && !scope.start && !scope.end) lines.push(`${pad}${ids[index]} --> ${ids[index]}`)
    }
    emit(root, 1)
    if (choice && simple.length) lines.push(`  state ${prefix}choice <<choice>>`, `  ${simple[0]} --> ${prefix}choice`, `  ${prefix}choice --> ${simple.at(-1)}`)
    for (const note of notes) {
      if (!simple.length) break
      const target = pick(simple, note.target)
      if (note.block) lines.push(`  note ${note.side} of ${target}`, `    ${note.text}`, '  end note')
      else lines.push(`  note ${note.side} of ${target} : ${note.text}`)
    }
    // Mermaid's state `class` statement reads ASCII identifiers only.
    if (classed !== undefined && simple.length && /^[A-Za-z]/.test(prefix)) lines.push('  classDef hot fill:#f96', `  class ${pick(simple, classed)} hot`)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Sequence — participants and actors with aliases, boxes, every arrow, notes,
// and loop/alt/opt/par/critical/break/rect fragments nested to depth.
// ---------------------------------------------------------------------------

type SeqStatement =
  | { kind: 'message'; from: number; to: number; arrow: string; text: string }
  | { kind: 'note'; target: number; span: boolean; side: string; text: string }
  | { kind: 'fragment'; type: string; label: string; branches: SeqStatement[][] }
const SEQ_ARROWS = ['->>', '-->>', '->', '-->', '-x', '--x', '-)', '--)', '<<->>']
const seqText = textArb(/[;#]/g)
const seqStatementsArb = fc.letrec<{ statement: SeqStatement; block: SeqStatement[] }>(tie => ({
  statement: fc.oneof(
    { depthSize: 'small', maxDepth: 4, withCrossShrink: true },
    fc.record({ kind: fc.constant('message' as const), from: fc.nat(), to: fc.nat(), arrow: fc.constantFrom(...SEQ_ARROWS), text: seqText }),
    fc.record({ kind: fc.constant('note' as const), target: fc.nat(), span: fc.boolean(), side: fc.constantFrom('left of', 'right of', 'over'), text: seqText }),
    fc.record({ kind: fc.constant('fragment' as const), type: fc.constantFrom('loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'), label: seqText, branches: fc.array(tie('block') as fc.Arbitrary<SeqStatement[]>, { minLength: 1, maxLength: 2 }) }),
  ) as fc.Arbitrary<SeqStatement>,
  block: fc.array(tie('statement') as fc.Arbitrary<SeqStatement>, { minLength: 1, maxLength: 3 }),
})).block
const sequenceArb = fc
  .record({
    autonumber: fc.boolean(),
    participants: fc.array(fc.record({ actor: fc.boolean(), alias: option(seqText) }), { minLength: 1, maxLength: 4 }),
    box: option(seqText, 4),
    statements: seqStatementsArb,
  })
  .map(({ autonumber, participants, box, statements }) => {
    const lines = ['sequenceDiagram']
    if (autonumber) lines.push('  autonumber')
    const ids = participants.map((_, index) => `p${index}`)
    const declare = (p: (typeof participants)[number], index: number, pad: string) => lines.push(`${pad}${p.actor ? 'actor' : 'participant'} ${ids[index]}${p.alias === undefined ? '' : ` as ${p.alias}`}`)
    if (box !== undefined) {
      lines.push(`  box ${box}`)
      declare(participants[0]!, 0, '    ')
      lines.push('  end')
      participants.slice(1).forEach((p, index) => declare(p, index + 1, '  '))
    } else participants.forEach((p, index) => declare(p, index, '  '))
    const emit = (items: SeqStatement[], depth: number): void => {
      const pad = indent(depth)
      for (const s of items) {
        if (s.kind === 'message') lines.push(`${pad}${pick(ids, s.from)}${s.arrow}${pick(ids, s.to)}: ${s.text}`)
        else if (s.kind === 'note') lines.push(`${pad}Note ${s.side} ${pick(ids, s.target)}${s.span && s.side === 'over' && ids.length > 1 ? `,${pick(ids, s.target + 1)}` : ''}: ${s.text}`)
        else {
          const label = s.type === 'rect' ? 'rgb(200, 220, 255)' : s.label
          const separator = s.type === 'alt' ? 'else' : s.type === 'par' ? 'and' : s.type === 'critical' ? 'option' : undefined
          const branches = separator ? s.branches : s.branches.slice(0, 1)
          lines.push(`${pad}${s.type} ${label}`)
          branches.forEach((branch, index) => {
            if (index) lines.push(`${pad}${separator} ${s.label}`)
            emit(branch, depth + 1)
          })
          lines.push(`${pad}end`)
        }
      }
    }
    emit(statements, 1)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Class — members, generics, namespaces, every relation with cardinalities and
// labels, notes, direction, styles and classes.
// ---------------------------------------------------------------------------

const CLASS_RELS = ['<|--', '*--', 'o--', '-->', '--', '..>', '..|>', '..', '<|..', '--*', '--o']
const memberText = fc.tuple(fc.constantFrom('+', '-', '#', '~', ''), wordArb, fc.constantFrom('', '()', '(int a)', '(List~int~ xs) bool', ' int', '$', '()*')).map(([visibility, name, suffix]) => `${visibility}${name}${suffix}`)
const classArb = fc
  .record({
    // Direction, style and classDef keep a class body opaque by design
    // (class-body.ts, "Unmodeled"), so they are drawn rarely.
    direction: rare(fc.constantFrom('LR', 'TB', 'RL', 'BT')),
    classes: fc.array(fc.record({ label: option(textArb(/["`]/g), 4), generic: fc.boolean(), members: fc.array(memberText, { maxLength: 3 }), namespace: option(fc.nat({ max: 1 })), annotation: option(fc.constantFrom('<<interface>>', '<<abstract>>', '<<enumeration>>'), 4) }), { minLength: 1, maxLength: 4 }),
    relations: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), arrow: fc.constantFrom(...CLASS_RELS), label: option(textArb(/[:"]/g)), cardinality: option(fc.tuple(fc.constantFrom('1', '*', '0..1', '1..*', 'many'), fc.constantFrom('1', '*', 'n'))) }), { maxLength: 4 }),
    notes: fc.array(fc.record({ target: option(fc.nat()), text: textArb(/"/g) }), { maxLength: 2 }),
    styled: rare(fc.record({ target: fc.nat(), color: colorArb })),
    classed: rare(fc.nat()),
  })
  .map(({ direction, classes, relations, notes, styled, classed }) => {
    const lines = ['classDiagram']
    if (direction) lines.push(`  direction ${direction}`)
    const ids = classes.map((_, index) => `C${index}`)
    const declare = (c: (typeof classes)[number], index: number, pad: string) => {
      const head = `${pad}class ${ids[index]}${c.generic ? '~T~' : ''}${c.label === undefined ? '' : `["${c.label}"]`}`
      if (!c.members.length && !c.annotation) { lines.push(head); return }
      lines.push(`${head} {`)
      if (c.annotation) lines.push(`${pad}  ${c.annotation}`)
      c.members.forEach(member => lines.push(`${pad}  ${member}`))
      lines.push(`${pad}}`)
    }
    for (const ns of [0, 1]) {
      const members = classes.map((c, index) => [c, index] as const).filter(([c]) => c.namespace === ns)
      if (!members.length) continue
      lines.push(`  namespace NS${ns} {`)
      members.forEach(([c, index]) => declare(c, index, '    '))
      lines.push('  }')
    }
    classes.forEach((c, index) => { if (c.namespace === undefined) declare(c, index, '  ') })
    for (const r of relations) {
      const card = r.cardinality ? [`"${r.cardinality[0]}" `, ` "${r.cardinality[1]}"`] : ['', '']
      lines.push(`  ${pick(ids, r.from)} ${card[0]}${r.arrow}${card[1]} ${pick(ids, r.to)}${r.label === undefined ? '' : ` : ${r.label}`}`)
    }
    for (const note of notes) lines.push(note.target === undefined ? `  note "${note.text}"` : `  note for ${pick(ids, note.target)} "${note.text}"`)
    if (styled) lines.push(`  style ${pick(ids, styled.target)} fill:${styled.color},stroke:#333`)
    if (classed !== undefined) lines.push('  classDef hot fill:#f96', `  cssClass "${pick(ids, classed)}" hot`)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// ER — entities with aliases and attribute blocks (keys, comments), every
// cardinality pair, identifying and non-identifying relations, direction,
// styles and classes.
// ---------------------------------------------------------------------------

const ER_LEFT = ['|o', '||', '}o', '}|']
const ER_RIGHT = ['o|', '||', 'o{', '|{']
// Our ER reader takes `\"` inside a quoted name as an escaped quote, where
// Mermaid reads no escapes; a trailing backslash is left out (reported finding:
// the agent body then publishes a typed body the renderer refuses).
const erText = quotedArb().map(text => text.replace(/\\+$/, '') || 'x')
const erArb = fc
  .record({
    direction: option(fc.constantFrom('LR', 'TB', 'RL', 'BT')),
    prefix: fc.constantFrom('E', 'CUSTOMER', 'order-line', 'é'),
    entities: fc.array(fc.record({ alias: option(erText, 4), attributes: fc.array(fc.record({ type: fc.constantFrom('string', 'int', 'float', 'varchar(255)', 'decimal(10,2)'), name: wordArb, key: option(fc.constantFrom('PK', 'FK', 'UK', 'PK, FK')), comment: option(erText) }), { maxLength: 3 }) }), { minLength: 1, maxLength: 4 }),
    relations: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), left: fc.constantFrom(...ER_LEFT), right: fc.constantFrom(...ER_RIGHT), identifying: fc.boolean(), label: erText }), { maxLength: 4 }),
    styled: option(fc.record({ target: fc.nat(), color: colorArb })),
    classed: option(fc.nat()),
  })
  .map(({ direction, prefix, entities, relations, styled, classed }) => {
    const lines = ['erDiagram']
    if (direction) lines.push(`  direction ${direction}`)
    const ids = entities.map((_, index) => `${prefix}${index}`)
    entities.forEach((e, index) => {
      const head = `  ${ids[index]}${e.alias === undefined ? '' : `["${e.alias}"]`}`
      if (!e.attributes.length) { if (e.alias !== undefined) lines.push(head); return }
      lines.push(`${head} {`)
      for (const a of e.attributes) lines.push(`    ${a.type} ${a.name}${a.key ? ` ${a.key}` : ''}${a.comment === undefined ? '' : ` "${a.comment}"`}`)
      lines.push('  }')
    })
    for (const r of relations) lines.push(`  ${pick(ids, r.from)} ${r.left}${r.identifying ? '--' : '..'}${r.right} ${pick(ids, r.to)} : "${r.label}"`)
    if (!relations.length && entities.every(e => !e.attributes.length && e.alias === undefined)) lines.push(`  ${ids[0]} {`, '    string id', '  }')
    if (styled) lines.push(`  style ${pick(ids, styled.target)} fill:${styled.color},stroke:#333`)
    if (classed !== undefined) lines.push('  classDef hot fill:#f96', `  class ${pick(ids, classed)} hot`)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Mindmap — a tree of quoted shapes, icons and classes.
// ---------------------------------------------------------------------------

const MINDMAP_SHAPES: [string, string][] = [['["', '"]'], ['("', '")'], ['(("', '"))'], ['))"', '"(('], [')"', '"('], ['{{"', '"}}']]
type MindNode = { shape: number; label: string; icon: boolean; cls: boolean; children: MindNode[] }
const mindNodeArb = fc.letrec<{ node: MindNode; children: MindNode[] }>(tie => ({
  // A trailing backslash is left out: our mindmap reader rejects `m["x\"]`,
  // which Mermaid 12.2.0 accepts (reported finding, AM_FC_SEED=1647430003).
  node: fc.record({ shape: fc.nat(), label: quotedArb().map(text => text.replace(/\\+$/, '') || 'x'), icon: fc.boolean(), cls: fc.boolean(), children: tie('children') as fc.Arbitrary<MindNode[]> }),
  children: fc.oneof({ depthSize: 'small', maxDepth: 4, withCrossShrink: true }, fc.constant([] as MindNode[]), fc.array(tie('node') as fc.Arbitrary<MindNode>, { minLength: 1, maxLength: 3 })),
})).node
const mindmapArb = fc.record({ root: mindNodeArb, decorate: fc.boolean() }).map(({ root, decorate }) => {
  const lines = ['mindmap']
  let n = 0
  const emit = (node: MindNode, depth: number): void => {
    const [open, close] = pick(MINDMAP_SHAPES, node.shape)
    lines.push(`${indent(depth)}m${n++}${open}${node.label}${close}`)
    if (decorate && node.icon) lines.push(`${indent(depth)}::icon(fa fa-book)`)
    if (decorate && node.cls) lines.push(`${indent(depth)}:::urgent large`)
    node.children.forEach(child => emit(child, depth + 1))
  }
  emit(root, 1)
  return lines.join('\n')
})

// ---------------------------------------------------------------------------
// Architecture — nested groups, services and junctions placed in them, edges
// between sides with arrows and group-boundary endpoints.
// ---------------------------------------------------------------------------

type ArchGroup = { icon: string; label: string; services: { icon: string; label: string }[]; junction: boolean; groups: ArchGroup[] }
const ARCH_ICONS = ['cloud', 'database', 'disk', 'internet', 'server']
const archText = langiumQuotedArb(/["[\]]/g)
const archGroupArb = fc.letrec<{ group: ArchGroup; groups: ArchGroup[] }>(tie => ({
  group: fc.record({ icon: fc.constantFrom(...ARCH_ICONS), label: archText, services: fc.array(fc.record({ icon: fc.constantFrom(...ARCH_ICONS), label: archText }), { maxLength: 3 }), junction: fc.boolean(), groups: tie('groups') as fc.Arbitrary<ArchGroup[]> }),
  groups: fc.oneof({ depthSize: 'small', maxDepth: 4, withCrossShrink: true }, fc.constant([] as ArchGroup[]), fc.array(tie('group') as fc.Arbitrary<ArchGroup>, { minLength: 1, maxLength: 2 })),
}))
const SIDES = ['L', 'R', 'T', 'B']
const architectureArb = fc
  .record({
    groups: archGroupArb.groups,
    loose: fc.array(fc.record({ icon: fc.constantFrom(...ARCH_ICONS), label: archText }), { minLength: 1, maxLength: 3 }),
    edges: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), fromSide: fc.constantFrom(...SIDES), toSide: fc.constantFrom(...SIDES), arrow: fc.constantFrom('--', '-->', '<--', '<-->') }), { maxLength: 4 }),
  })
  .map(({ groups, loose, edges }) => {
    const lines = ['architecture-beta']
    const endpoints: string[] = []
    let n = 0
    const emit = (group: ArchGroup, parent: string | undefined): void => {
      const id = `g${n++}`
      lines.push(`  group ${id}(${group.icon})["${group.label}"]${parent ? ` in ${parent}` : ''}`)
      for (const s of group.services) { const sid = `s${n++}`; endpoints.push(sid); lines.push(`  service ${sid}(${s.icon})["${s.label}"] in ${id}`) }
      if (group.junction) { const jid = `j${n++}`; endpoints.push(jid); lines.push(`  junction ${jid} in ${id}`) }
      group.groups.forEach(child => emit(child, id))
    }
    groups.forEach(group => emit(group, undefined))
    for (const s of loose) { const sid = `s${n++}`; endpoints.push(sid); lines.push(`  service ${sid}(${s.icon})["${s.label}"]`) }
    const used = new Set<string>()
    for (const e of edges) {
      const from = pick(endpoints, e.from), to = pick(endpoints, e.to)
      if (from === to) continue
      // Mermaid allows one edge per endpoint side pair.
      const key = `${from}:${e.fromSide}|${to}:${e.toSide}`
      if (used.has(key)) continue
      used.add(key)
      lines.push(`  ${from}:${e.fromSide} ${e.arrow} ${e.toSide}:${to}`)
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Kanban — columns of tasks with quoted labels and metadata.
// ---------------------------------------------------------------------------

const kanbanText = quotedArb(/["\]]/g)
const kanbanArb = fc
  .array(fc.record({ label: kanbanText, tasks: fc.array(fc.record({ label: kanbanText, ticket: option(fc.stringMatching(/^[A-Z]{2,4}-[0-9]{1,3}$/)), assigned: option(textArb(/['"{}:,\]]/g, 2)), priority: option(fc.constantFrom('Very High', 'High', 'Low', 'Very Low')) }), { maxLength: 3 }) }), { minLength: 1, maxLength: 4 })
  .map(columns => {
    const lines = ['kanban']
    let n = 0
    for (const column of columns) {
      lines.push(`  c${n++}["${column.label}"]`)
      for (const task of column.tasks) {
        const meta = [task.ticket && `ticket: ${task.ticket}`, task.assigned && `assigned: '${task.assigned}'`, task.priority && `priority: '${task.priority}'`].filter(Boolean)
        lines.push(`    t${n++}["${task.label}"]${meta.length ? `@{ ${meta.join(', ')} }` : ''}`)
      }
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Gantt — sections of tasks with ids, after-dependencies, milestones, tags
// and durations; title, axis format, excludes and today marker.
// ---------------------------------------------------------------------------

const ganttText = textArb(/[:#;]|%%/g)
const ganttArb = fc
  .record({
    title: option(ganttText),
    axis: option(fc.constantFrom('%Y-%m-%d', '%m/%d', '%b %e')),
    excludes: fc.boolean(),
    sections: fc.array(fc.record({ label: ganttText, tasks: fc.array(fc.record({ label: ganttText, tags: fc.subarray(['crit', 'done', 'active']), milestone: fc.boolean(), after: fc.boolean(), day: fc.integer({ min: 1, max: 28 }), length: fc.integer({ min: 1, max: 9 }), unit: fc.constantFrom('d', 'h', 'w') }), { minLength: 1, maxLength: 3 }) }), { minLength: 1, maxLength: 3 }),
  })
  .map(({ title, axis, excludes, sections }) => {
    const lines = ['gantt']
    if (title !== undefined) lines.push(`  title ${title}`)
    lines.push('  dateFormat YYYY-MM-DD')
    if (axis) lines.push(`  axisFormat ${axis}`)
    if (excludes) lines.push('  excludes weekends')
    let n = 0
    for (const section of sections) {
      lines.push(`  section ${/^(?:title|section|dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday|click|accTitle|accDescr)\b/i.test(section.label) ? `S ${section.label}` : section.label}`)
      for (const task of section.tasks) {
        const id = `t${n}`
        const start = task.after && n ? `after t${n - 1}` : `2024-02-${String(task.day).padStart(2, '0')}`
        const tags = [...task.tags, ...(task.milestone ? ['milestone'] : [])]
        const label = /^(?:title|section|dateFormat|axisFormat|excludes|includes|todayMarker|tickInterval|weekday|click|accTitle|accDescr)\b/i.test(task.label) ? `T ${task.label}` : task.label
        lines.push(`    ${label} :${tags.map(tag => `${tag}, `).join('')}${id}, ${start}, ${task.milestone ? '0d' : `${task.length}${task.unit}`}`)
        n++
      }
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Journey — titled sections of tasks with scores and actor lists.
// ---------------------------------------------------------------------------

const journeyText = textArb(/[:#;]|%%/g)
const journeyArb = fc
  .record({
    title: option(journeyText),
    sections: fc.array(fc.record({ label: journeyText, tasks: fc.array(fc.record({ label: journeyText, score: fc.integer({ min: 1, max: 5 }), actors: fc.uniqueArray(fc.constantFrom('Me', 'Cat', 'é Dev', 'Ops team'), { maxLength: 3 }) }), { minLength: 1, maxLength: 3 }) }), { minLength: 1, maxLength: 3 }),
  })
  .map(({ title, sections }) => {
    const lines = ['journey']
    if (title !== undefined) lines.push(`  title ${title}`)
    const guard = (text: string) => (/^(?:title|section|accTitle|accDescr)\b/i.test(text) ? `x ${text}` : text)
    for (const section of sections) {
      lines.push(`  section ${guard(section.label)}`)
      for (const task of section.tasks) lines.push(`    ${guard(task.label)}: ${task.score}${task.actors.length ? `: ${task.actors.join(', ')}` : ''}`)
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Sankey — CSV rows; quoted fields carry commas and doubled quotes.
// ---------------------------------------------------------------------------

// Quote any field holding a quote, a comma or a percent sign (a row opening
// with `%%` is a comment line).
const csvField = (text: string) => (/[",%]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text)
const sankeyArb = fc
  .record({
    nodes: fc.uniqueArray(textArb(), { minLength: 2, maxLength: 5 }),
    links: fc.array(fc.record({ from: fc.nat(), to: fc.nat(), value: fc.oneof(fc.integer({ min: 1, max: 900 }), fc.double({ min: 0.01, max: 99, noNaN: true }).map(v => Math.round(v * 100) / 100)) }), { minLength: 1, maxLength: 6 }),
  })
  .map(({ nodes, links }) => {
    const lines = ['sankey-beta']
    // Keep links acyclic: always from an earlier node to a later one.
    for (const link of links) {
      const a = link.from % nodes.length, b = link.to % nodes.length
      const [from, to] = a === b ? [0, nodes.length - 1] : [Math.min(a, b), Math.max(a, b)]
      lines.push(`${csvField(nodes[from]!)},${csvField(nodes[to]!)},${link.value}`)
    }
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Quadrant — title, axes, quadrant labels, quoted points with styles/classes.
// ---------------------------------------------------------------------------

const quadText = textArb(/["]/g)
// Free text (title, quadrant labels) ends at a `%%` comment.
const quadFree = textArb(/%%/g)
const hexColorArb = fc.constantFrom('#f9f', '#ff0000', '#0a0', '#123456')
const unitArb = fc.integer({ min: 0, max: 100 }).map(v => v / 100)
const quadrantArb = fc
  .record({
    title: option(quadFree),
    axes: option(fc.tuple(textArb(/[-]|"/g, 2), textArb(/[-]|"/g, 2))),
    quadrants: fc.array(quadFree, { maxLength: 4 }),
    points: fc.array(fc.record({ label: quadText, x: unitArb, y: unitArb, radius: option(fc.integer({ min: 1, max: 20 })), color: option(hexColorArb), cls: fc.boolean() }), { minLength: 1, maxLength: 5 }),
  })
  .map(({ title, axes, quadrants, points }) => {
    const lines = ['quadrantChart']
    if (title !== undefined) lines.push(`  title ${title}`)
    if (axes) lines.push(`  x-axis "${axes[0]}" --> "${axes[1]}"`, `  y-axis "${axes[1]}" --> "${axes[0]}"`)
    quadrants.forEach((label, index) => lines.push(`  quadrant-${index + 1} ${label}`))
    for (const p of points) {
      const style = [p.radius && `radius: ${p.radius}`, p.color && `color: ${p.color}`].filter(Boolean).join(', ')
      lines.push(`  "${p.label}"${p.cls ? ':::hot' : ''}: [${p.x}, ${p.y}]${style ? ` ${style}` : ''}`)
    }
    if (points.some(p => p.cls)) lines.push('  classDef hot color: #109060, radius: 12')
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Radar — labelled axes, curves by position or by axis name, signed and
// fractional values, bounds, ticks, legend and graticule.
// ---------------------------------------------------------------------------

const radarText = langiumQuotedArb(/["\]]/g)
const radarArb = fc
  .record({
    title: option(textArb()),
    axes: fc.array(option(radarText), { minLength: 3, maxLength: 6 }),
    curves: fc.array(fc.record({ label: option(radarText), named: fc.boolean(), values: fc.array(fc.integer({ min: 0, max: 100 }).map(v => v / 4), { minLength: 6, maxLength: 6 }) }), { minLength: 1, maxLength: 3 }),
    // Radar numbers have no sign token.
    bounds: option(fc.tuple(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 26, max: 40 }))),
    ticks: option(fc.integer({ min: 1, max: 8 })),
    legend: option(fc.boolean()),
    graticule: option(fc.constantFrom('circle', 'polygon')),
  })
  .map(({ title, axes, curves, bounds, ticks, legend, graticule }) => {
    const lines = ['radar-beta']
    if (title !== undefined) lines.push(`  title ${title}`)
    const ids = axes.map((_, index) => `a${index}`)
    lines.push(`  axis ${axes.map((label, index) => `${ids[index]}${label === undefined ? '' : `["${label}"]`}`).join(', ')}`)
    curves.forEach((c, index) => {
      const values = c.values.slice(0, axes.length)
      const body = c.named ? values.map((v, i) => `${ids[i]}: ${v}`).join(', ') : values.join(', ')
      lines.push(`  curve k${index}${c.label === undefined ? '' : `["${c.label}"]`}{${body}}`)
    })
    if (bounds) lines.push(`  min ${bounds[0]}`, `  max ${bounds[1]}`)
    if (ticks !== undefined) lines.push(`  ticks ${ticks}`)
    if (legend !== undefined) lines.push(`  showLegend ${legend}`)
    if (graticule) lines.push(`  graticule ${graticule}`)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// XY chart — orientation, quoted title and axis names, category or numeric
// x-axis, signed fractional series.
// ---------------------------------------------------------------------------

const xyText = langiumQuotedArb()
const signedArb = fc.integer({ min: -400, max: 400 }).map(v => v / 4)
const xychartArb = fc
  .record({
    header: fc.constantFrom('xychart-beta', 'xychart', 'xychart-beta horizontal'),
    title: option(xyText),
    xName: option(xyText),
    categories: option(fc.array(xyText, { minLength: 1, maxLength: 5 })),
    yName: option(xyText),
    yRange: option(fc.tuple(fc.integer({ min: -200, max: 0 }), fc.integer({ min: 1, max: 200 }))),
    series: fc.array(fc.record({ bar: fc.boolean(), name: option(xyText, 4), values: fc.array(signedArb, { minLength: 5, maxLength: 5 }) }), { minLength: 1, maxLength: 3 }),
    count: fc.integer({ min: 1, max: 5 }),
  })
  .map(({ header, title, xName, categories, yName, yRange, series, count }) => {
    const lines: string[] = [header]
    if (title !== undefined) lines.push(`  title "${title}"`)
    const n = categories ? categories.length : count
    const name = xName === undefined ? '' : ` "${xName}"`
    if (categories) lines.push(`  x-axis${name} [${categories.map(c => `"${c}"`).join(', ')}]`)
    else if (xName !== undefined) lines.push(`  x-axis${name} 0 --> ${n * 10}`)
    if (yName !== undefined || yRange) lines.push(`  y-axis${yName === undefined ? '' : ` "${yName}"`}${yRange ? ` ${yRange[0]} --> ${yRange[1]}` : ''}`)
    for (const s of series) lines.push(`  ${s.bar ? 'bar' : 'line'}${s.name === undefined ? '' : ` "${s.name}"`} [${s.values.slice(0, n).join(', ')}]`)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Pie — showData, title, quoted slices with fractional values.
// ---------------------------------------------------------------------------

const pieArb = fc
  .record({ showData: fc.boolean(), title: option(textArb()), slices: fc.uniqueArray(fc.record({ label: langiumQuotedArb(), value: fc.oneof(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: 9999 }).map(v => v / 100)) }), { minLength: 1, maxLength: 6, selector: s => s.label }) })
  .map(({ showData, title, slices }) => {
    const lines = [`pie${showData ? ' showData' : ''}`]
    if (title !== undefined) lines.push(`  title ${title}`)
    for (const s of slices) lines.push(`  "${s.label}" : ${s.value}`)
    return lines.join('\n')
  })

// ---------------------------------------------------------------------------
// Packet — contiguous fields spelled as ranges, single bits or +N lengths.
// ---------------------------------------------------------------------------

const packetArb = fc
  .record({ header: fc.constantFrom('packet', 'packet-beta'), title: option(textArb()), fields: fc.array(fc.record({ bits: fc.integer({ min: 1, max: 40 }), spelling: fc.constantFrom('range', 'plus'), label: langiumQuotedArb() }), { minLength: 1, maxLength: 6 }) })
  .map(({ header, title, fields }) => {
    const lines: string[] = [header]
    if (title !== undefined) lines.push(`  title ${title}`)
    let start = 0
    for (const f of fields) {
      const end = start + f.bits - 1
      const spelled = f.spelling === 'plus' ? `+${f.bits}` : f.bits === 1 ? `${start}` : `${start}-${end}`
      lines.push(`  ${spelled}: "${f.label}"`)
      start = end + 1
    }
    return lines.join('\n')
  })

/** Structural generators, keyed by family. A family without an entry is
 * fuzzed through its metamorphic builder instead. */
export const STRUCTURAL_FAMILY_ARBS: Partial<Record<DiagramKind, fc.Arbitrary<string>>> = {
  c4: c4Arb,
  ishikawa: ishikawaArb,
  eventmodeling: eventModelingArb,
  zenuml: zenArb,
  treemap: treemapArb,
  gitgraph: gitgraphArb,
  timeline: timelineArb,
  block: blockArb,
  requirement: requirementArb,
  flowchart: flowchartArb,
  state: stateArb,
  sequence: sequenceArb,
  class: classArb,
  er: erArb,
  mindmap: mindmapArb,
  architecture: architectureArb,
  kanban: kanbanArb,
  gantt: ganttArb,
  journey: journeyArb,
  sankey: sankeyArb,
  quadrant: quadrantArb,
  radar: radarArb,
  xychart: xychartArb,
  pie: pieArb,
  packet: packetArb,
}
