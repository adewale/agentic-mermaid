/** Exact insertion positions for one private long-edge chain, with every other
 * vertex fixed. Adjacent-rank inversion costs form a small dynamic program.
 * This is optional ordering work: exhaustion never exposes a partial proposal. */
export function refinePrivateChainOrder(
  bands: number[][],
  vertices: readonly { rank: number; incoming: readonly number[]; outgoing: readonly number[] }[],
  chains: readonly (readonly number[])[],
  work: { blockPairs?: number },
): void {
  const order = new Int32Array(vertices.length)
  for (const chain of chains) {
    if ((work.blockPairs ?? 2_000_000) <= 0) return
    const block = chain.slice(1, -1)
    if (block.length < 2 || block.some((id, index) => vertices[id]!.incoming.length !== 1 || vertices[id]!.outgoing.length !== 1
      || vertices[id]!.incoming[0] !== chain[index] || vertices[id]!.outgoing[0] !== chain[index + 2]
      || vertices[id]!.rank !== vertices[chain[index]!]!.rank + 1)) continue
    for (const band of bands) for (let slot = 0; slot < band.length; slot++) order[band[slot]!] = slot
    const rows = block.map(id => bands[vertices[id]!.rank]!.filter(other => other !== id))
    const original = block.map(id => order[id]!)
    const boundaries: Int32Array[] = []
    for (let level = 0; level <= block.length; level++) {
      const left = chain[level]!, right = chain[level + 1]!, arcs: number[] = []
      for (const id of bands[vertices[left]!.rank]!) {
        for (const target of vertices[id]!.outgoing) {
          if (id === left && target === right) continue
          const x = order[id]!, y = order[target]!
          arcs.push(x - Number(level > 0 && x > order[left]!), y - Number(level < block.length && y > order[right]!))
        }
      }
      boundaries.push(Int32Array.from(arcs))
    }
    let exhausted = false
    const cost = (level: number, a: number, b: number): number => {
      const arcs = boundaries[level]!, charge = 1 + arcs.length / 2
      if ((work.blockPairs ?? 2_000_000) < charge) { exhausted = true; return Infinity }
      work.blockPairs = (work.blockPairs ?? 2_000_000) - charge
      let value = 0
      for (let index = 0; index < arcs.length; index += 2) {
        const x = arcs[index]!, y = arcs[index + 1]!
        const sx = x + Number(level > 0 && x >= a), sy = y + Number(level < block.length && y >= b)
        if ((a - sx) * (b - sy) < 0) value++
      }
      return value
    }
    let old = 0
    for (let level = 0; level <= block.length; level++) old += cost(level,
      level === 0 ? order[chain[0]!]! : original[level - 1]!,
      level === block.length ? order[chain.at(-1)!]! : original[level]!)
    if (exhausted) return
    if (old === 0) continue
    let scores = Float64Array.from({ length: rows[0]!.length + 1 }, (_, slot) => cost(0, order[chain[0]!]!, slot))
    let displacement = Float64Array.from(scores, (_, slot) => Math.abs(slot - original[0]!))
    const parents: Int32Array[] = []
    for (let level = 1; level < block.length && !exhausted; level++) {
      const next = new Float64Array(rows[level]!.length + 1).fill(Infinity), previous = new Int32Array(next.length)
      const movement = new Float64Array(next.length).fill(Infinity)
      for (let b = 0; b < next.length && !exhausted; b++) for (let a = 0; a < scores.length; a++) {
        if (scores[a]! >= old) continue
        const value = scores[a]! + cost(level, a, b)
        const moved = displacement[a]! + Math.abs(b - original[level]!)
        if (value < next[b]! || (value === next[b]! && moved < movement[b]!)) { next[b] = value; previous[b] = a; movement[b] = moved }
        if (exhausted) break
      }
      scores = next; displacement = movement; parents.push(previous)
    }
    if (exhausted) return
    let best = Infinity, moved = Infinity, end = 0
    for (let slot = 0; slot < scores.length; slot++) {
      const value = scores[slot]! + cost(block.length, slot, order[chain.at(-1)!]!)
      if (value < best || (value === best && displacement[slot]! < moved)) { best = value; moved = displacement[slot]!; end = slot }
    }
    if (exhausted) return
    if (best >= old) continue
    const slots = new Int32Array(block.length); slots[block.length - 1] = end
    for (let level = block.length - 2; level >= 0; level--) slots[level] = parents[level]![slots[level + 1]!]!
    for (let level = 0; level < block.length; level++) {
      const row = rows[level]!
      row.splice(slots[level]!, 0, block[level]!)
      bands[vertices[block[level]!]!.rank] = row
    }
  }
}
