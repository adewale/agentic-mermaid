// Property fuzz for the untyped agent-edit boundary: validateOp / mutateChecked
// / applyOps (src/agent/op-schema.ts + apply.ts) and the hosted declarative
// `mutate`/`build` tools. These are exactly the surface the boundary exists to
// guard — ops arriving as arbitrary JSON — so they get generated-input coverage,
// not just the example-based tests in agent-op-schema.test.ts.
//
// Contract under test:
//  - validateOp never throws; it returns null or a well-formed INVALID_OP.
//  - applyOps / mutateChecked never throw; they always return a tagged result.
//  - No silent mangle: a successful applyOps implies every op passed shape
//    validation (the bug the boundary replaces let a bad-shaped op through).
//  - The result is deterministic (layout is deterministic; so is validation).
//  - The hosted mutate/build handlers turn any payload into a JSON-RPC response.
// Seed is pinned globally (fc-seed.preload.ts).
import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'
import { fcParameters } from './helpers/fc-parameters.ts'

import { validateOp, applyOps, mutateChecked, hasOpSchema, describeOps } from '../agent/core.ts'
import { createMermaid } from '../agent/create.ts'
import { MUTATION_OPS_BY_FAMILY, type MutableFamilyId } from '../agent/mutation-ops.ts'
import { mutate, applyMutationBatch } from '../agent/mutate.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { getFamily } from '../agent/families.ts'
import type { AnyMutationOp, ParsedDiagram } from '../agent/types.ts'
import { handleHostedRequest, type HostedMcpContext } from '../mcp/hosted-server.ts'
import type { JsonRpcRequest } from '../mcp/protocol.ts'

const NUM_RUNS = 400
const FAMILIES = Object.keys(MUTATION_OPS_BY_FAMILY) as MutableFamilyId[]
const KINDS = [...new Set(Object.values(MUTATION_OPS_BY_FAMILY).flat())]
// The union of field names any op reads, plus the near-miss typos the boundary
// is meant to catch (`name` for `id`, `type` for `kind`).
const FIELD_NAMES = [
  'id', 'label', 'members', 'from', 'to', 'class', 'text', 'index', 'relKind', 'for',
  'fromSide', 'toSide', 'icon', 'group', 'parent', 'hasArrowStart', 'hasArrowEnd',
  'sectionIndex', 'periodIndex', 'eventIndex', 'events', 'title', 'showData', 'value',
  'axis', 'near', 'far', 'quadrant', 'x', 'y', 'kind2', 'name', 'values', 'score',
  'actors', 'taskId', 'tags', 'start', 'end', 'status', 'leftCard', 'rightCard',
  'dashed', 'participantKind', 'style', 'shape', 'target', 'type',
]

const familyArb = fc.constantFrom(...FAMILIES)
const junkValue = fc.oneof(
  fc.string({ maxLength: 12 }), fc.integer(), fc.double(), fc.boolean(),
  fc.constant(null), fc.constant(undefined),
  fc.array(fc.oneof(fc.string({ maxLength: 6 }), fc.integer()), { maxLength: 4 }),
  fc.object({ maxDepth: 1 }),
)
// kind: a real op kind, a typo/garbage string, or a non-string.
const kindArb = fc.oneof(fc.constantFrom(...KINDS), fc.string({ maxLength: 12 }), fc.integer(), fc.constant(undefined))
const fieldNameArb = fc.oneof(fc.constantFrom(...FIELD_NAMES), fc.string({ maxLength: 8 }))
const opObjArb = fc.tuple(kindArb, fc.array(fc.tuple(fieldNameArb, junkValue), { maxLength: 5 })).map(([kind, entries]) => {
  const o: Record<string, unknown> = {}
  if (kind !== undefined) o.kind = kind
  for (const [k, v] of entries) o[k] = v
  return o
})
// Junk alone almost never forms a shape-valid op, so the "success implies shape
// validity" branch would never run. Build shape-valid ops from each family's
// published field docs (describeOps: the same shapes `am capabilities` serves),
// with values drawn from a tiny id vocabulary so add_* ops can actually land on
// an empty diagram.
const ID_VOCAB = ['A', 'B', 'n1', 'Label']
type FieldDoc = { name: string; required: boolean; type: string; fields?: FieldDoc[] }
// Shape-valid op records from the published field docs, with every string
// field (top-level or nested, e.g. xychart axis.range) drawn from `text`.
const opArbs = (text: fc.Arbitrary<string>) => {
  const recordFor = (fields: FieldDoc[]): fc.Arbitrary<Record<string, unknown>> => {
    const record: Record<string, fc.Arbitrary<unknown>> = {}
    for (const f of fields) record[f.name] = valueFor(f)
    return fc.record(record, { requiredKeys: fields.filter(f => f.required).map(f => f.name) })
  }
  const valueFor = (field: Pick<FieldDoc, 'type' | 'fields'>): fc.Arbitrary<unknown> => {
    const { type, fields } = field
    if (type.startsWith('one of ')) {
      const values = [...type.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m => JSON.parse(m[0]) as string)
      return type.endsWith(' | null') ? fc.constantFrom<unknown>(...values, null) : fc.constantFrom(...values)
    }
    switch (type) {
      case 'string': return text
      case 'number': return fc.integer({ min: 0, max: 3 })
      case 'boolean': return fc.boolean()
      case 'string | null': return fc.option(text, { nil: null })
      case 'number | null': return fc.option(fc.integer({ min: 0, max: 3 }), { nil: null })
      case 'boolean | null': return fc.option(fc.boolean(), { nil: null })
      case 'string[]': return fc.array(text, { maxLength: 2 })
      case 'number[]': return fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 3 })
      case 'object[]': return fields ? fc.array(recordFor(fields), { maxLength: 2 }) : fc.array(fc.dictionary(fc.constantFrom('id', 'label', 'value'), text, { maxKeys: 3 }), { maxLength: 2 })
      case 'object': return recordFor(fields ?? [])
      case 'object | null': return fields ? fc.option(recordFor(fields), { nil: null }) : fc.constant(null)
      default: throw new Error(`op-boundary fuzz: no generator for field type ${type}`)
    }
  }
  const opFor = (family: MutableFamilyId): fc.Arbitrary<Record<string, unknown>> =>
    fc.oneof(...Object.entries(describeOps(family)).map(([kind, fields]) => recordFor(fields).map(o => ({ kind, ...o }))))
  return { recordFor, opFor }
}
const shapeValidOpArb = opArbs(fc.constantFrom(...ID_VOCAB)).opFor
// A near miss: a shape-valid op with exactly one defect the boundary must catch —
// a required field dropped, an unknown field added (`name` for `id`), or a field
// retyped. The mutator alone might tolerate these; validateOp must not.
const nearMissOpArb = (family: MutableFamilyId): fc.Arbitrary<Record<string, unknown>> =>
  fc.tuple(shapeValidOpArb(family), fc.nat(), fc.constantFrom('drop', 'extra', 'retype')).map(([op, pick, defect]) => {
    const fields = Object.keys(op).filter(k => k !== 'kind')
    if (defect === 'extra' || fields.length === 0) return { ...op, zz_unknown_field: 'x' }
    const field = fields[pick % fields.length]!
    if (defect === 'drop') { const { [field]: _dropped, ...rest } = op; return rest }
    return { ...op, [field]: Array.isArray(op[field]) ? 'not-an-array' : [op[field]] }
  })
// Also feed the boundary non-object ops (a string, number, null, array).
const opArb = fc.oneof(opObjArb, fc.string({ maxLength: 8 }), fc.integer(), fc.constant(null), fc.array(junkValue, { maxLength: 3 }))
// A family paired with a shape-valid op, a near miss, or junk.
const familyAndOpArb = familyArb.chain(family => fc.tuple(
  fc.constant(family),
  fc.oneof(shapeValidOpArb(family), nearMissOpArb(family), opArb) as fc.Arbitrary<unknown>,
))

describe('op-boundary fuzz: validateOp', () => {
  it('never throws and returns null or a well-formed INVALID_OP', () => {
    fc.assert(fc.property(familyArb, opArb, (family, op) => {
      const r = validateOp(family, op)
      if (r !== null) {
        expect(r.code).toBe('INVALID_OP')
        expect(typeof r.reason).toBe('string')
        expect(typeof r.message).toBe('string')
        expect(r.message.length).toBeGreaterThan(0)
        // The bug it replaces: a mangled op that serialized "undefined" into the
        // diagram. A shape rejection must never itself echo a bare "undefined".
        expect(r.message).not.toMatch(/\bclass undefined\b|\bnode undefined\b/)
      }
    }), fcParameters({ numRuns: NUM_RUNS }))
  })
})

describe('op-boundary fuzz: applyOps / mutateChecked', () => {
  it('applyOps is total, returns an envelope, and agrees with the shape validator', () => {
    // Vacuity counters: the success branch (shape-gate agreement) and the
    // near-miss rejection must both actually run at the pinned seed.
    let appliedSeen = 0
    let shapeRejectedSeen = 0
    fc.assert(fc.property(familyAndOpArb, ([family, op]) => {
      const env = applyOps({ family, ops: [op] })
      expect(typeof env.ok).toBe('boolean')
      if (env.ok) {
        appliedSeen++
        expect(typeof env.source).toBe('string')
        expect(env.verify).toBeDefined()
        // A successful apply must mean the op passed SHAPE validation — the
        // boundary never lets a shape-invalid op reach the mutator.
        expect({ family, op, shapeError: validateOp(family, op) }).toEqual({ family, op, shapeError: null })
      } else {
        if (validateOp(family, op) !== null) shapeRejectedSeen++
        expect(env.error).toBeDefined()
        expect(typeof env.error.message).toBe('string')
        expect(env.error.message.length).toBeGreaterThan(0)
      }
    }), fcParameters({ numRuns: NUM_RUNS }))
    expect(appliedSeen).toBeGreaterThan(0)
    expect(shapeRejectedSeen).toBeGreaterThan(0)
  })

  it('mutateChecked never throws on a valid diagram with an arbitrary op', () => {
    fc.assert(fc.property(familyAndOpArb, ([family, op]) => {
      const d = createMermaid(family)
      const r = mutateChecked(d, op)
      expect(typeof r.ok).toBe('boolean')
      if (!r.ok) expect(typeof r.error.message).toBe('string')
    }), fcParameters({ numRuns: NUM_RUNS }))
  })

  it('applyOps is deterministic for identical input', () => {
    fc.assert(fc.property(familyArb, fc.array(opArb, { maxLength: 4 }), (family, ops) => {
      expect(applyOps({ family, ops })).toEqual(applyOps({ family, ops }))
    }), fcParameters({ numRuns: NUM_RUNS }))
  })
})

// Typed text and identifier edits, for every family and every string field an
// op publishes, either refuse or write Mermaid that re-reads as the edited
// diagram (CLAUDE.md: write strictly, keep the author's meaning). A value the
// writer cannot hold used to be accepted and silently changed on re-read:
// `%%` and `%%{…}%%` inside titles and labels (K1), `<br>` in a quadrant
// title (K2), U+2028 in a gantt title (K3), ids that read as statement
// separators or shape brackets (V1).
describe('op-boundary fuzz: typed text edits round-trip or are refused', () => {
  // A small diagram per family whose ids the ops can target; families
  // without a source start from their blank-slate scaffold.
  const FIXTURES: Record<MutableFamilyId, { source?: string; ids: string[] }> = {
    flowchart: { source: 'flowchart TD\n  A[Alpha] --> B\n  subgraph G[Group]\n    C\n  end\n', ids: ['A', 'B', 'C', 'G', 'A->B'] },
    state: { source: 'stateDiagram-v2\n  [*] --> S1\n  S1 --> S2 : go\n  note right of S1 : n\n', ids: ['S1', 'S2'] },
    sequence: { source: 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n  loop L\n    B->>A: back\n  end\n', ids: ['A', 'B'] },
    timeline: { source: 'timeline\n  title T\n  section One\n    2020 : Start\n', ids: [] },
    class: { source: 'classDiagram\n  class A\n  class B\n  A <|-- B\n', ids: ['A', 'B'] },
    er: { source: 'erDiagram\n  A ||--o{ B : has\n', ids: ['A', 'B'] },
    journey: { source: 'journey\n  title Day\n  section Morning\n    Wake: 3: Me\n', ids: ['Me'] },
    architecture: { source: 'architecture-beta\n  group g(cloud)[G]\n  service api(server)[API] in g\n  service db(database)[DB]\n  junction j\n  api:R --> L:db\n', ids: ['api', 'db', 'g', 'j'] },
    xychart: { source: 'xychart-beta\n  title Sales\n  x-axis [jan, feb]\n  y-axis "Revenue" 0 --> 10\n  bar S [3, 5]\n', ids: [] },
    pie: { source: 'pie\n  title Pets\n  "Dogs" : 3\n  "Cats" : 2\n', ids: ['Dogs', 'Cats'] },
    quadrant: { source: 'quadrantChart\n  title Reach\n  x-axis Low --> High\n  y-axis Low --> High\n  quadrant-1 Q1\n  A: [0.3, 0.6]\n', ids: ['A'] },
    gantt: { source: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n    Core : core, 2024-01-01, 3d\n', ids: ['core'] },
    mindmap: { source: 'mindmap\n  root((Root))\n    Child\n', ids: ['root', 'Child'] },
    gitgraph: { source: 'gitGraph\n  commit id: "a"\n  branch dev\n  commit id: "b"\n', ids: ['a', 'b', 'dev', 'main'] },
    radar: { source: 'radar-beta\n  title Skills\n  axis a["A"], b["B"], c["C"]\n  curve x["X"]{1, 2, 3}\n', ids: ['a', 'b', 'c', 'x'] },
    sankey: { source: 'sankey-beta\nA,B,1\n', ids: ['A', 'B'] },
    c4: { source: 'C4Context\n  Person(u, "User")\n  System(s, "Sys")\n  Rel(u, s, "uses")\n', ids: ['u', 's'] },
    packet: { source: 'packet\n  0-7: "a"\n', ids: [] },
    kanban: { source: 'kanban\n  todo[Todo]\n    t1[Task]\n', ids: ['todo', 't1'] },
    requirement: { source: 'requirementDiagram\n  requirement r {\n    id: 1\n    text: hi\n  }\n  element e {\n    type: sim\n  }\n  e - satisfies -> r\n', ids: ['r', 'e'] },
    treemap: { source: 'treemap-beta\n  "A"\n    "B": 1\n', ids: [] },
    ishikawa: { ids: [] },
    block: { source: 'block\n  a b\n  a --> b\n', ids: ['a', 'b'] },
    zenuml: { ids: [] },
    eventmodeling: { ids: [] },
  }
  const base = (family: MutableFamilyId): ParsedDiagram => {
    const source = FIXTURES[family].source
    if (source === undefined) return createMermaid(family)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(`${family} fixture: ${JSON.stringify(parsed.error)}`)
    return parsed.value
  }
  // Grammar punctuation, comment and directive markers, entity spellings
  // (including a noncharacter), line-break markup, line terminators, controls,
  // a lone surrogate, combining marks and a ZWJ emoji, beside the full
  // code-point range and long runs.
  const HOSTILE = ['%%', '%%{x}%%', '%%{init: {}}%%', '#35;', '#37;', '#quot;', '#65534;', '#59;', '"', "'", '`', '[', ']', '{', '}', '(', ')', '|', ';', ',', ':', '--', '-->', '<br>', '<br/>', '<BR >', ' ', ' ', '\u0000', '\u0007', '\u0085', '\u001b', '\t', ' ', '\ud800', 'é', '👩🏽‍💻', '東京', 'end', 'title', '\\', '&amp;', '#', '<', '>', '@', '=', '+', '*', '~']
  const hostileText = fc.oneof(
    fc.string({ unit: 'binary', minLength: 1, maxLength: 10 }),
    fc.string({ unit: 'grapheme', minLength: 1, maxLength: 10 }),
    fc.array(fc.oneof(fc.constantFrom(...HOSTILE), fc.string({ unit: 'grapheme-ascii', maxLength: 3 })), { minLength: 1, maxLength: 6 }).map(parts => parts.join('')),
    fc.string({ unit: 'grapheme-ascii', minLength: 60, maxLength: 300 }),
  )
  const editArb = familyArb.chain(family => {
    const ids = FIXTURES[family].ids
    const text = fc.oneof(fc.constantFrom(...ids, 'N1'), hostileText)
    return fc.tuple(fc.constant(family), fc.array(opArbs(text).opFor(family), { minLength: 1, maxLength: 3 }))
  })
  // Blank-slate builders may hold a body below the family's source floor (a
  // Sankey diagram after its last link is removed); mutate admits that one
  // scaffold, which re-reads as preserved source.
  const emptyScaffold = (d: ParsedDiagram) => getFamily(d.kind)?.verify?.(d.body, {}).some(warning => warning.code === 'EMPTY_DIAGRAM') === true
  const reread = (d: ParsedDiagram) => {
    const written = serializeMermaid(d)
    const parsed = parseRegisteredMermaid(written)
    if (!parsed.ok) return { written, error: parsed.error }
    if (parsed.value.body.kind !== d.body.kind && emptyScaffold(d)) return { written, scaffold: true }
    return { written, kind: parsed.value.body.kind, facts: describeMermaidFacts(parsed.value) }
  }
  // Shrunk counterexamples (finder runs and the adversarial review).
  const EXAMPLES: Array<[[MutableFamilyId, Array<Record<string, unknown>>]]> = [
    [['pie', [{ kind: 'set_title', title: 'a %% b' }]]],
    [['class', [{ kind: 'set_title', title: '%%{x}%%$y8:k<<+' }]]],
    [['architecture', [{ kind: 'set_service_label', id: 'api', label: 'a %%{x}%% b' }]]],
    [['radar', [{ kind: 'set_axis_label', id: 'a', label: '%%{init: {}}%%>P<br/>jMY' }]]],
    [['flowchart', [{ kind: 'set_label', target: 'A', label: '%%{x}%%#35;' }]]],
    [['quadrant', [{ kind: 'set_quadrant_label', quadrant: 1, label: '+%%' }]]],
    [['quadrant', [{ kind: 'set_title', title: 'a<br>b' }]]],
    [['gantt', [{ kind: 'set_title', title: 'a b' }]]],
    [['flowchart', [{ kind: 'rename_node', from: 'B', to: 'A;B' }]]],
    [['flowchart', [{ kind: 'rename_node', from: 'B', to: 'A[B]' }]]],
    [['flowchart', [{ kind: 'add_subgraph', id: '񂕛򘭍򓧩񗡱' }]]],
    [['flowchart', [{ kind: 'add_edge', from: 'A', to: 'A', label: 'x', style: 'invisible' }]]],
    [['requirement', [{ kind: 'rename_node', from: 'r', to: '%%{init: {}}%%~#59;' }]]],
    [['sequence', [{ kind: 'add_message', from: 'N1', to: 'US#', text: 'x', wrap: false, index: 1 }]]],
    [['eventmodeling', [{ kind: 'set_accessibility_title', title: 'https://example.com' }]]],
  ]

  it('an accepted edit re-reads as the edited diagram', () => {
    fc.assert(fc.property(editArb, ([family, ops]) => {
      let d = base(family)
      for (const op of ops) {
        const result = mutateChecked(d, op)
        if (!result.ok) {
          expect(result.error.message.length).toBeGreaterThan(0)
          continue
        }
        d = result.value
        const back = reread(d)
        if ('scaffold' in back) continue
        expect(back).toEqual({ written: back.written, kind: d.body.kind, facts: describeMermaidFacts(d) })
      }
    }), fcParameters({ numRuns: 2000, examples: EXAMPLES }))
  }, 120_000)

  // The documented edit paths are one checked core: mutate, mutateChecked, a
  // one-op batch, applyOps and the hosted MCP mutate tool give the same verdict
  // and the same source. applyOps (and MCP) additionally gate on verify, so a
  // diagram mutate accepts may still be refused there with VERIFY_FAILED.
  // mutatePreservingSource edits opaque bodies only and refuses these
  // structured fixtures by design.
  it('the mutate entry points agree on refusal and written source', async () => {
    const ctx: HostedMcpContext = { execute: async () => ({ ok: true, value: null, logs: [] }) }
    const singleEditArb = familyArb.chain(family => fc.tuple(fc.constant(family), fc.array(opArbs(fc.oneof(fc.constantFrom(...FIXTURES[family].ids, 'N1'), hostileText)).opFor(family), { minLength: 1, maxLength: 1 })))
    await fc.assert(fc.asyncProperty(singleEditArb, async ([family, [op]]) => {
      // Every path starts from the same source text.
      const source = serializeMermaid(base(family))
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const d = parsed.value
      const outcome = (r: { ok: true; value: ParsedDiagram } | { ok: false; error: { code: string; message: string } }) => r.ok ? { ok: true, source: serializeMermaid(r.value) } : { ok: false, code: r.error.code, message: r.error.message }
      // mutate is the typed entry point (no shape check): it agrees with the
      // checked core on every op that passes shape validation.
      const direct = outcome(mutateChecked(d, op))
      if (validateOp(family, op) === null) expect(outcome(mutate(d, op as AnyMutationOp))).toEqual(direct)
      const batch = applyMutationBatch(d, [op])
      expect(batch.ok ? outcome(batch) : { ok: false, code: batch.error.code, message: batch.error.message }).toEqual(direct)
      const envelope = applyOps({ source, ops: [op] })
      const declarative = envelope.ok ? { ok: true, source: envelope.source } : { ok: false, code: envelope.error.code, message: envelope.error.message }
      if (!(direct.ok && !envelope.ok && envelope.error.code === 'VERIFY_FAILED')) expect(declarative).toEqual(direct)
      const response = await handleHostedRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mutate', arguments: { source, ops: [op] } } } as JsonRpcRequest, ctx)
      const payload = JSON.parse(((response as { result: { content: Array<{ text: string }> } }).result.content[0]!.text))
      expect(payload.ok ? { ok: true, source: payload.source } : { ok: false, code: payload.error.code, message: payload.error.message }).toEqual(declarative)
    }), fcParameters({ numRuns: 300, examples: EXAMPLES.map(([[family, ops]]) => [[family, ops.slice(0, 1)]] as [[MutableFamilyId, Array<Record<string, unknown>>]]) }))
  }, 120_000)
})

// Nested op records (an xychart axis and its range, a block record and its
// children, requirement records) are shape-checked like an op's own fields. A
// key the record does not have was silently dropped (`axis: {name, min, max}`
// wrote `y-axis Units` and deleted the range); it must be rejected with its
// dotted path, and the batch must not apply.
describe('op-boundary fuzz: a stray key in a nested op record is rejected, never dropped', () => {
  const XY = 'xychart-beta\n  x-axis [a, b]\n  y-axis "Old" 0 --> 120\n  bar [5, 20]\n'
  // Each base op applies as written; `slips` are keys that record does not have.
  const NESTED: Array<{ input: { source: string } | { family: MutableFamilyId }; op: Record<string, unknown>; records: Array<{ path: Array<string | number>; slips: string[] }> }> = [
    {
      input: { source: XY },
      op: { kind: 'set_y_axis', axis: { name: 'Units', range: { min: 0, max: 200 } } },
      records: [{ path: ['axis'], slips: ['min', 'max', 'title', 'labels'] }, { path: ['axis', 'range'], slips: ['step', 'from', 'to'] }],
    },
    { input: { source: XY }, op: { kind: 'set_x_axis', axis: { name: 'Region', categories: ['a', 'b'] } }, records: [{ path: ['axis'], slips: ['labels', 'values', 'title'] }] },
    {
      input: { family: 'block' },
      op: { kind: 'add_block', block: { id: 'g', type: 'composite', children: [{ id: 'c', label: 'C' }] } },
      records: [{ path: ['block'], slips: ['shape', 'shap', 'text'] }, { path: ['block', 'children', 0], slips: ['lable', 'name', 'shape'] }],
    },
    { input: { family: 'requirement' }, op: { kind: 'add_requirement', requirement: { name: 'r', text: 'hi', risk: 'High' } }, records: [{ path: ['requirement'], slips: ['txt', 'label', 'verify'] }] },
    { input: { family: 'requirement' }, op: { kind: 'add_element', element: { name: 'e', type: 'sim' } }, records: [{ path: ['element'], slips: ['typ', 'doc', 'label'] }] },
  ]
  const dotted = (path: Array<string | number>) => path.map((part, index) => typeof part === 'number' ? `[${part}]` : `${index ? '.' : ''}${part}`).join('')
  const withStray = (op: Record<string, unknown>, path: Array<string | number>, key: string, value: unknown) => {
    const copy = structuredClone(op)
    let record = copy as Record<string | number, unknown>
    for (const part of path) record = record[part] as Record<string | number, unknown>
    record[key] = value
    return copy
  }
  // Realistic slips, plus generated keys in a namespace no record uses.
  const caseArb = fc.constantFrom(...NESTED).chain(entry => fc.tuple(
    fc.constant(entry),
    fc.constantFrom(...entry.records).chain(record => fc.tuple(fc.constant(record), fc.oneof(fc.constantFrom(...record.slips), fc.stringMatching(/^x_[a-z]{1,6}$/)))),
    fc.oneof(fc.integer({ min: -5, max: 500 }), fc.string({ maxLength: 6 }), fc.boolean()),
  ))

  it('every base op applies without the stray key', () => {
    for (const { input, op } of NESTED) expect(applyOps({ ...input, ops: [op] })).toMatchObject({ ok: true })
  })

  it('rejects the stray key with its dotted path and applies nothing', () => {
    fc.assert(fc.property(caseArb, ([{ input, op }, [record, key], value]) => {
      const r = applyOps({ ...input, ops: [withStray(op, record.path, key, value)] })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error).toMatchObject({ code: 'INVALID_OP', reason: 'unknown_field', field: `${dotted(record.path)}.${key}` })
    }), fcParameters({ numRuns: 200 }))
  })
})

// Regression: an op `kind`, a `family`, or a field name that collides with an inherited
// Object.prototype property (toString, constructor, __proto__, …) must not slip past the
// prototype chain. `kind in schema` / `family in SCHEMAS` reported these as valid and then
// dereferenced the inherited function as an op spec, crashing validateOp/applyOps at the
// untrusted boundary (found by the finder sweep at op-boundary seed=2, kind:"toString").
describe('op-boundary fuzz: inherited Object.prototype keys are never valid ops', () => {
  const PROTO_KEYS = [
    'toString', 'valueOf', 'hasOwnProperty', 'constructor', 'isPrototypeOf',
    'toLocaleString', 'propertyIsEnumerable', '__proto__', '__defineGetter__',
  ]

  it('validateOp rejects a prototype-named kind with INVALID_OP instead of throwing', () => {
    for (const family of FAMILIES) {
      for (const kind of PROTO_KEYS) {
        const r = validateOp(family, { kind })
        expect(r).not.toBeNull()
        expect(r!.code).toBe('INVALID_OP')
        expect(r!.reason).toBe('unknown_kind')
      }
    }
  })

  it('validateOp flags a prototype-named field as unknown_field', () => {
    // add_node is a flowchart op; add a well-formed base then an inherited-name extra field.
    for (const key of PROTO_KEYS) {
      const r = validateOp('flowchart', { kind: 'add_node', id: 'A', label: 'x', [key]: 'evil' })
      expect(r).not.toBeNull()
      expect(r!.reason).toBe('unknown_field')
    }
  })

  it('hasOpSchema returns false for inherited prototype names', () => {
    for (const key of PROTO_KEYS) expect(hasOpSchema(key)).toBe(false)
  })

  it('applyOps never throws on a prototype-named family or op kind', () => {
    for (const key of PROTO_KEYS) {
      expect(() => applyOps({ family: key as never, ops: [{ kind: 'add_node', id: 'A' }] })).not.toThrow()
      expect(applyOps({ family: key as never, ops: [{ kind: 'add_node', id: 'A' }] }).ok).toBe(false)
      expect(() => applyOps({ family: 'flowchart', ops: [{ kind: key }] })).not.toThrow()
      expect(applyOps({ family: 'flowchart', ops: [{ kind: key }] }).ok).toBe(false)
    }
  })
})

describe('op-boundary admission rejects non-JSON object mechanics', () => {
  it('rejects inherited, accessor-backed, and proxy-backed ops without throwing', () => {
    const inherited = Object.create({ kind: 'add_node', id: 'Injected', label: 'Injected' })
    const accessor = Object.defineProperty({}, 'kind', {
      enumerable: true,
      get() { throw new Error('boom') },
    })
    const proxy = new Proxy({ kind: 'add_node', id: 'A', label: 'A' }, {
      getOwnPropertyDescriptor() { throw new Error('boom') },
    })
    for (const op of [inherited, accessor, proxy]) {
      expect(() => validateOp('flowchart', op)).not.toThrow()
      expect(validateOp('flowchart', op)).toMatchObject({ code: 'INVALID_OP' })
      expect(() => mutateChecked(createMermaid('flowchart'), op)).not.toThrow()
      expect(mutateChecked(createMermaid('flowchart'), op).ok).toBe(false)
    }
  })

  it('rejects unreadable op arrays with tagged results', () => {
    const ops = new Proxy([] as unknown[], {
      getOwnPropertyDescriptor() { throw new Error('boom') },
    })
    expect(() => applyOps({ source: 'flowchart TD\n  A --> B', ops })).not.toThrow()
    expect(applyOps({ source: 'flowchart TD\n  A --> B', ops })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_OP' },
    })
  })
})

describe('op-boundary fuzz: hosted mutate/build handlers', () => {
  const ctx: HostedMcpContext = { execute: async () => ({ ok: true, value: null, logs: [] }) }
  const argsArb = fc.oneof(
    fc.constant(undefined),
    fc.object({ maxDepth: 2 }),
    fc.record({ source: fc.string({ maxLength: 40 }), ops: fc.array(opObjArb, { maxLength: 4 }) }),
    fc.record({ family: familyArb, ops: fc.array(opObjArb, { maxLength: 4 }) }),
  )

  it('turn any mutate/build payload into a well-formed JSON-RPC response, never a crash', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom('mutate', 'build'), fc.oneof(fc.integer(), fc.string({ maxLength: 6 })), argsArb, async (name, id, args) => {
      const req = { jsonrpc: '2.0' as const, id, method: 'tools/call', params: { name, arguments: args } }
      const res = await handleHostedRequest(req as JsonRpcRequest, ctx)
      expect(res).not.toBeNull()
      const r = res as unknown as Record<string, unknown>
      expect(r.jsonrpc).toBe('2.0')
      // Exactly one of result / error.
      expect(('result' in r) !== ('error' in r)).toBe(true)
      if ('error' in r) {
        const err = r.error as { code?: unknown; message?: unknown }
        expect(typeof err.code).toBe('number')
        expect(typeof err.message).toBe('string')
      }
    }), fcParameters({ numRuns: NUM_RUNS }))
  }, 60_000)
})
