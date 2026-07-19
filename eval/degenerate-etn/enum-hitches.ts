// Exhaustively enumerate ROUTE_HITCH over the original 2,800-case issue #81
// corpus. A non-zero exit preserves every failing source while making the
// command suitable as a regression gate.
//
//   bun run eval/degenerate-etn/enum-hitches.ts
import { parseMermaid } from '../../src/parser.ts'
import { layoutGraphSync } from '../../src/layout-engine.ts'
import { findRouteHitches } from '../../src/route-contracts.ts'
import { DEGENERATE_ROUTE_GENERATORS } from './generators.ts'

interface HitchCase {
  generator: string
  seed: number
  hitches: ReturnType<typeof findRouteHitches>
  source: string
}

const failures: HitchCase[] = []
let cases = 0

for (const generator of DEGENERATE_ROUTE_GENERATORS) {
  for (let seed = 0; seed < generator.cases; seed++) {
    cases++
    const source = generator.generate(seed)
    const graph = parseMermaid(source)
    const positioned = layoutGraphSync(graph)
    const hitches = findRouteHitches(positioned, graph)
    if (hitches.length > 0) failures.push({ generator: generator.name, seed, hitches, source })
  }
}

console.log(JSON.stringify({ cases, hitchCases: failures.length, failures }, null, 2))
if (failures.length > 0) process.exitCode = 1
