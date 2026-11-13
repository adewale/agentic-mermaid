import { writeFileSync } from 'node:fs'
import { countPolylineCrossings as baseline } from './baseline-edge-crossings.ts'
import { countPolylineCrossings as candidate } from '/workspace/agentic-mermaid/src/shared/edge-crossings.ts'
const rows: unknown[] = []
const values = [0, -0, 1e-300, 1e-13, 0.005, 0.01, 1, 1e100, 1e308, Infinity, -Infinity, NaN]
for (const extent of values) for (const offset of values) for (const vertical of [false, true]) {
  const paths = [
    [[-extent, offset], [extent, offset]],
    [[-extent / 2, offset], [extent / 2, offset]],
  ].map(points => ({ points: points.map(([x, y]) => vertical ? { x: y!, y: x! } : { x: x!, y: y! }) }))
  for (const involved of [undefined, new Set([0]), new Set([1]), new Set([2])]) {
    const before = baseline(paths, involved), after = candidate(paths, involved)
    rows.push({ extent: String(extent), offset: String(offset), vertical, involved: involved && [...involved], before, after, exact: Object.is(before, after) })
  }
}
writeFileSync(import.meta.dir + '/NUMERIC-PARITY.json', JSON.stringify({
  scope: 'Raw-helper parity includes malformed nonfinite and finite-endpoint overflowing spans; identical results do not certify malformed geometry.',
  rows, exact: rows.every((row: any) => row.exact), count: rows.length,
}, null, 2) + '\n')
console.log(JSON.stringify({ count: rows.length, exact: rows.every((row: any) => row.exact) }))
