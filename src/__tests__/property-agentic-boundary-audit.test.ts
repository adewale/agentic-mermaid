import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'

import { applyOps, buildChecked } from '../agent/apply.ts'
import { negotiateCapabilities } from '../capability-negotiation.ts'
import {
  assertHostedPngRasterBudget,
  assertPngRasterBudget,
  resolvePngOutputPolicy,
  resolvePortablePngOutputPolicy,
} from '../png-contract.ts'
import { resolveTerminalOutputPolicy } from '../terminal-contract.ts'

const RUNS = 250
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"></svg>'

function outcome(run: () => unknown): string {
  try { return `ok:${JSON.stringify(run())}` }
  catch (error) { return `error:${error instanceof Error ? `${error.name}:${error.message}` : String(error)}` }
}

describe('remaining public agentic boundary fuzz', () => {
  test('checked build is total and rejects every non-array op collection', () => {
    fc.assert(fc.property(fc.anything(), value => {
      const result = buildChecked('flowchart', value as never)
      expect(typeof result.ok).toBe('boolean')
      if (!Array.isArray(value)) {
        expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_OP', opIndex: -1 } })
      }
    }), { numRuns: RUNS })
  })

  test('declarative apply is total at the root input boundary', () => {
    fc.assert(fc.property(fc.anything(), value => {
      expect(() => applyOps(value as never)).not.toThrow()
      const result = applyOps(value as never)
      expect(typeof result.ok).toBe('boolean')
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        expect(result).toMatchObject({ ok: false, family: null, error: { code: 'INVALID_OP' } })
      }
    }), { numRuns: RUNS })
  })

  test('capability negotiation is deterministic and never leaks null dereferences', () => {
    fc.assert(fc.property(fc.anything(), fc.anything(), (offers, requirements) => {
      const first = outcome(() => negotiateCapabilities(offers as never, requirements as never))
      const second = outcome(() => negotiateCapabilities(offers as never, requirements as never))
      expect(first).toBe(second)
      expect(first).not.toMatch(/null is not an object|Cannot read propert/)
    }), { numRuns: RUNS })
  })

  test('terminal and PNG policy resolvers are total and deterministic', () => {
    fc.assert(fc.property(fc.anything(), value => {
      for (const run of [
        () => resolveTerminalOutputPolicy(value as never),
        () => resolvePngOutputPolicy(value as never),
        () => resolvePortablePngOutputPolicy(value as never),
        () => assertPngRasterBudget(SVG, value as never),
        () => assertHostedPngRasterBudget(value as never),
      ]) {
        expect(outcome(run)).toBe(outcome(run))
      }
    }), { numRuns: RUNS })
  })
})
