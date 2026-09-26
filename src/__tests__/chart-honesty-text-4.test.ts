// Chart honesty, text principles (docs/design/system/chart-honesty.md), part
// 4 of 4: every family's corpus in every style draws text that is legible
// against what surrounds it, on the canvas, present (or reported by verify),
// and the same words in every style. The families are the registry split four
// ways (honestyPartition), so a new family is checked without editing a list.
import { beforeAll, describe, expect, it } from 'bun:test'

import { describeViolations, honestyCorpus, honestyPartition, textHonestyViolations } from './helpers/chart-honesty.ts'
import { renderedTextReady } from './helpers/rendered-text.ts'

beforeAll(() => renderedTextReady())

describe('chart honesty: text, part 4 of 4', () => {
  for (const kind of honestyPartition(4)) {
    it(`${kind} text reads, stays on the canvas, is drawn, and survives every style`, () => {
      const violations = honestyCorpus(kind).flatMap(sample => describeViolations(kind, sample, textHonestyViolations(sample)))
      expect(violations).toEqual([])
    }, 240_000)
  }
})
