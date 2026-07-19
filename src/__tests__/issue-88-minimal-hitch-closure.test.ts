import { describe, expect, test } from 'bun:test'
import { denseDag, diamondFan } from '../../eval/degenerate-etn/generators.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { parseMermaid } from '../parser.ts'
import { findRouteHitches } from '../route-contracts.ts'

const REGRESSIONS = [
  ...[31, 157, 217, 229, 269, 319, 363, 464, 605, 733, 937, 1177, 1653, 1656, 1768, 1938, 1952]
    .map(seed => ({ id: `denseDag #${seed}`, source: denseDag(seed) })),
  ...[269, 373].map(seed => ({ id: `diamondFan #${seed}`, source: diamondFan(seed) })),
] as const

describe('minimal final hitch closure (issue #88)', () => {
  for (const regression of REGRESSIONS) {
    test(regression.id, () => {
      const graph = parseMermaid(regression.source)
      const positioned = layoutGraphSync(graph)
      expect(findRouteHitches(positioned, graph)).toEqual([])
    })
  }
})
