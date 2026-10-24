import { createHash } from 'node:crypto'

export interface GeneratedFlowchartRange { start: number; count: number }

/** Bounded, replayable mixed-shape multigraphs for backend quality exploration.
 * Seeds used to choose a refinement become development data, not a new holdout. */
export type GeneratedFlowchartKind = 'lcg-v1' | 'sha256-counter-v1'

export function generatedFlowchartSamples({ start, count }: GeneratedFlowchartRange, kind: GeneratedFlowchartKind = 'lcg-v1'): { id: string; family: string; source: string }[] {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1 || count > 256 || start + count > 0x1_0000_0000) {
    throw new RangeError('Generated comparison requires 1–256 cases in a nonnegative 32-bit seed range')
  }
  if (kind !== 'lcg-v1' && kind !== 'sha256-counter-v1') throw new RangeError('Unknown generated comparison kind')
  const shapes = [['[', ']'], ['{', '}'], ['(', ')'], ['((', '))'], ['[[', ']]'], ['[(', ')]']]
  return Array.from({ length: count }, (_, offset) => {
    const seed = start + offset
    let state = seed + 1, counter = 0
    // Each endpoint consumes a separate counter digest. Unlike the retained
    // LCG's alternating low bits, even-sized graphs admit either source parity.
    // This generates inputs only; hashing is not a provenance check or solver.
    const random = kind === 'lcg-v1'
      ? (bound: number): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % bound }
      : (bound: number): number => createHash('sha256').update(`agentic-mermaid-qualification-v1:${seed}:${counter++}`).digest().readUInt32BE(0) % bound
    const nodes = 8 + seed % 13
    const lines = [`flowchart ${['TD', 'LR', 'BT', 'RL'][seed % 4]}`]
    for (let index = 0; index < nodes; index++) {
      const shape = shapes[(seed + index) % shapes.length]!
      lines.push(`n${index}${shape[0]}Node ${seed}-${index}${shape[1]}`)
    }
    for (let index = 0; index < 2 * nodes + seed % 7; index++) {
      const source = random(nodes), target = (source + 1 + random(nodes - 1)) % nodes
      const label = index % 4 === 0 ? `|edge ${index} ${'x'.repeat(3 + index % 17)}|` : ''
      lines.push(`n${source} -->${label} n${target}`)
    }
    return { id: `${kind === 'lcg-v1' ? 'generated-cyclic' : 'generated-sha256-counter-v1'}:${seed}`, family: 'flowchart', source: lines.join('\n') }
  })
}
