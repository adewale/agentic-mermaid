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

import { validateOp, applyOps, mutateChecked, hasOpSchema, describeOps } from '../agent/core.ts'
import { createMermaid } from '../agent/create.ts'
import { MUTATION_OPS_BY_FAMILY, type MutableFamilyId } from '../agent/mutation-ops.ts'
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
const valueForType = (type: string): fc.Arbitrary<unknown> => {
  if (type.startsWith('one of ')) {
    const values = [...type.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(m => JSON.parse(m[0]) as string)
    return type.endsWith(' | null') ? fc.constantFrom<unknown>(...values, null) : fc.constantFrom(...values)
  }
  switch (type) {
    case 'string': return fc.constantFrom(...ID_VOCAB)
    case 'number': return fc.integer({ min: 0, max: 3 })
    case 'boolean': return fc.boolean()
    case 'string | null': return fc.option(fc.constantFrom(...ID_VOCAB), { nil: null })
    case 'number | null': return fc.option(fc.integer({ min: 0, max: 3 }), { nil: null })
    case 'boolean | null': return fc.option(fc.boolean(), { nil: null })
    case 'string[]': return fc.array(fc.constantFrom(...ID_VOCAB), { maxLength: 2 })
    case 'number[]': return fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 2 })
    case 'object | null': return fc.constant(null)
    default: throw new Error(`op-boundary fuzz: no generator for field type ${type}`)
  }
}
const shapeValidOpArb = (family: MutableFamilyId): fc.Arbitrary<Record<string, unknown>> =>
  fc.oneof(...Object.entries(describeOps(family)).map(([kind, fields]) => {
    const record: Record<string, fc.Arbitrary<unknown>> = {}
    for (const f of fields) record[f.name] = valueForType(f.type)
    const requiredKeys = fields.filter(f => f.required).map(f => f.name)
    return fc.record(record, { requiredKeys }).map(o => ({ kind, ...o }))
  }))
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
    }), { numRuns: NUM_RUNS })
  })
})

describe('op-boundary fuzz: applyOps / mutateChecked', () => {
  it('applyOps never throws, returns a well-formed envelope, and never silently mangles', () => {
    // Vacuity counters: the success branch (the no-silent-mangle check) and the
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
    }), { numRuns: NUM_RUNS })
    expect(appliedSeen).toBeGreaterThan(0)
    expect(shapeRejectedSeen).toBeGreaterThan(0)
  })

  it('mutateChecked never throws on a valid diagram with an arbitrary op', () => {
    fc.assert(fc.property(familyAndOpArb, ([family, op]) => {
      const d = createMermaid(family)
      const r = mutateChecked(d, op)
      expect(typeof r.ok).toBe('boolean')
      if (!r.ok) expect(typeof r.error.message).toBe('string')
    }), { numRuns: NUM_RUNS })
  })

  it('applyOps is deterministic for identical input', () => {
    fc.assert(fc.property(familyArb, fc.array(opArb, { maxLength: 4 }), (family, ops) => {
      expect(applyOps({ family, ops })).toEqual(applyOps({ family, ops }))
    }), { numRuns: NUM_RUNS })
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
    }), { numRuns: NUM_RUNS })
  }, 60_000)
})
