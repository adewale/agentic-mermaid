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

import { validateOp, applyOps, mutateChecked, hasOpSchema } from '../agent/core.ts'
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
// Also feed the boundary non-object ops (a string, number, null, array).
const opArb = fc.oneof(opObjArb, fc.string({ maxLength: 8 }), fc.integer(), fc.constant(null), fc.array(junkValue, { maxLength: 3 }))

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
    fc.assert(fc.property(familyArb, opArb, (family, op) => {
      const env = applyOps({ family, ops: [op] })
      expect(typeof env.ok).toBe('boolean')
      if (env.ok) {
        expect(typeof env.source).toBe('string')
        expect(env.verify).toBeDefined()
        // A successful apply must mean the op passed SHAPE validation — the
        // boundary never lets a shape-invalid op reach the mutator.
        expect(validateOp(family, op)).toBeNull()
      } else {
        expect(env.error).toBeDefined()
        expect(typeof env.error.message).toBe('string')
        expect(env.error.message.length).toBeGreaterThan(0)
      }
    }), { numRuns: NUM_RUNS })
  })

  it('mutateChecked never throws on a valid diagram with an arbitrary op', () => {
    fc.assert(fc.property(familyArb, opArb, (family, op) => {
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
