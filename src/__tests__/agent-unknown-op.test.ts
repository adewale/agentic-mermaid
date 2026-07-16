// Every family's mutator must reject an unrecognized op with a PRESCRIPTIVE
// message that names the family's valid ops — so a caller (especially a smaller
// model) can correct from the error alone instead of guessing which ops exist.
// Driven off the canonical family set so a new family can't ship a bare
// "Unknown op" catch-all.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { mutate } from '../agent/mutate.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
import type { AnyMutationOp, MutableValidDiagram } from '../agent/types.ts'

describe('unknown mutation ops are prescriptive', () => {
  test('every structured family: an unrecognized op names the family valid ops', () => {
    let checked = 0
    for (const fam of BUILTIN_FAMILY_METADATA) {
      const p = parseMermaid(fam.example)
      expect({ family: fam.id, parsed: p.ok }).toEqual({ family: fam.id, parsed: true })
      if (!p.ok) continue
      // An example that round-trips as an opaque (source-level) body has no
      // structured op switch to reach; mutate reports the unsupported body kind.
      if (p.value.body.kind === 'opaque') continue
      const r = mutate(p.value as MutableValidDiagram, { kind: '__no_such_op__' } as unknown as AnyMutationOp)
      expect({ family: fam.id, rejected: !r.ok }).toEqual({ family: fam.id, rejected: true })
      if (r.ok) continue
      const msg = r.error.message
      const ops = MUTATION_OPS_BY_FAMILY[fam.id as keyof typeof MUTATION_OPS_BY_FAMILY]
      expect({ family: fam.id, namesValidOps: msg.includes('valid ops:') })
        .toEqual({ family: fam.id, namesValidOps: true })
      expect({ family: fam.id, listsARealOp: msg.includes(ops[0]!) })
        .toEqual({ family: fam.id, listsARealOp: true })
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })
})
