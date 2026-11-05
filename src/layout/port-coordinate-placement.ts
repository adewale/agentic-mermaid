interface Vertex { crossSize: number; incoming: readonly number[]; outgoing: readonly number[] }

/** Coordinate descent over actual endpoint offsets. Ordered box/label lanes
 * and the outer extent stay fixed. This is a bounded port-aware refinement,
 * not a claimed implementation of the complete Brandes–Köpf algorithm. */
export function improvePortCoordinates(
  vertices: readonly Vertex[], bands: readonly (readonly number[])[], chains: readonly (readonly number[])[],
  cross: Float64Array, sourcePort: Float64Array, targetPort: Float64Array,
  realCount: number, nodeSpacing: number, extent: number, previousReal: Int32Array, nextReal: Int32Array,
): boolean {
  const old = cross.slice(), offsets = new Uint32Array(vertices.length + 1)
  for (let id = 0; id < vertices.length; id++) offsets[id + 1] = offsets[id]! + vertices[id]!.incoming.length + vertices[id]!.outgoing.length
  const peers = new Uint32Array(offsets.at(-1)!), shifts = new Float64Array(peers.length), cursors = offsets.slice(0, -1)
  const sourceOffset = new Float64Array(chains.length), targetOffset = new Float64Array(chains.length)
  for (let edge = 0; edge < chains.length; edge++) {
    const chain = chains[edge]!
    sourceOffset[edge] = sourcePort[edge]! - cross[chain[0]!]!
    targetOffset[edge] = targetPort[edge]! - cross[chain.at(-1)!]!
    for (let step = 1; step < chain.length; step++) {
      const from = chain[step - 1]!, to = chain[step]!
      const shift = (step === chain.length - 1 ? targetOffset[edge]! : 0) - (step === 1 ? sourceOffset[edge]! : 0)
      let slot = cursors[from]!; cursors[from] = slot + 1; peers[slot] = to; shifts[slot] = shift
      slot = cursors[to]!; cursors[to] = slot + 1; peers[slot] = from; shifts[slot] = -shift
    }
  }
  const score = () => {
    let sum = 0
    for (let id = 0; id < vertices.length; id++) for (let slot = offsets[id]!; slot < offsets[id + 1]!; slot++) sum += Math.abs(cross[id]! - cross[peers[slot]!]! - shifts[slot]!)
    return sum
  }
  const before = score(), gap = Math.min(4, nodeSpacing)
  let scratch = new Float64Array(0)
  for (let sweep = 0; sweep < 4; sweep++) for (const forward of [true, false]) {
    for (let row = 0; row < bands.length; row++) {
      const band = bands[forward ? row : bands.length - 1 - row]!
      for (let cursor = 0; cursor < band.length; cursor++) {
        const slot = forward ? cursor : band.length - 1 - cursor, id = band[slot]!, vertex = vertices[id]!
        const count = offsets[id + 1]! - offsets[id]!
        if (!count) continue
        if (scratch.length < count) scratch = new Float64Array(count)
        const values = scratch.subarray(0, count)
        for (let index = 0; index < count; index++) {
          const edge = offsets[id]! + index
          values[index] = cross[peers[edge]!]! + shifts[edge]!
        }
        values.sort()
        const median = values[Math.floor((count - Number(forward)) / 2)]!
        const before = band[slot - 1], after = band[slot + 1]
        let low = before === undefined ? vertex.crossSize / 2 : cross[before]! + (vertices[before]!.crossSize + vertex.crossSize) / 2 + gap
        let high = after === undefined ? extent - vertex.crossSize / 2 : cross[after]! - (vertices[after]!.crossSize + vertex.crossSize) / 2 - gap
        if (id < realCount) {
          const previous = previousReal[id]!, next = nextReal[id]!
          if (previous >= 0) low = Math.max(low, cross[previous]! + (vertices[previous]!.crossSize + vertex.crossSize) / 2 + nodeSpacing)
          if (next >= 0) high = Math.min(high, cross[next]! - (vertices[next]!.crossSize + vertex.crossSize) / 2 - nodeSpacing)
        }
        if (low <= high) cross[id] = Math.max(low, Math.min(high, median))
      }
    }
  }
  const locallyImproved = score() + 1e-7 < before
  if (!locallyImproved) cross.set(old)
  // Individual moves can be blocked by tight same-layer neighbors. Align
  // whole blocks across ranks, admitting a merge only when every separation
  // inequality is feasible within the original extent. This optional search
  // has a shared 200,000-relaxation bound and at most 512 working vertices.
  alignPortBlocks(vertices, bands, chains, cross, sourceOffset, targetOffset, realCount, nodeSpacing, extent)
  if (cross.every((value, index) => value === old[index])) return false
  for (let edge = 0; edge < chains.length; edge++) {
    sourcePort[edge] = cross[chains[edge]![0]!]! + sourceOffset[edge]!
    targetPort[edge] = cross[chains[edge]!.at(-1)!]! + targetOffset[edge]!
  }
  return true
}

function alignPortBlocks(
  vertices: readonly Vertex[], bands: readonly (readonly number[])[], chains: readonly (readonly number[])[], cross: Float64Array,
  sourceOffset: Float64Array, targetOffset: Float64Array, realCount: number, nodeSpacing: number, extent: number,
): void {
  const n = vertices.length
  if (n > 512) return
  const parent = Int32Array.from({ length: n }, (_, index) => index), offset = new Float64Array(n)
  const constraints: Array<readonly [number, number, number]> = []
  for (const band of bands) {
    let real = -1
    for (let i = 0; i < band.length; i++) {
      const id = band[i]!
      if (i) {
        const previous = band[i - 1]!
        constraints.push([previous, id, (vertices[previous]!.crossSize + vertices[id]!.crossSize) / 2 + Math.min(4, nodeSpacing)])
      }
      if (id < realCount) {
        if (real >= 0) constraints.push([real, id, (vertices[real]!.crossSize + vertices[id]!.crossSize) / 2 + nodeSpacing])
        real = id
      }
    }
  }
  const root = (id: number): number => {
    if (parent[id] === id) return id
    const previous = parent[id]!, found = root(previous)
    offset[id] += offset[previous]!
    parent[id] = found
    return found
  }
  const alignments: Array<readonly [number, number, number, number]> = []
  chains.forEach((chain, edge) => {
    for (let step = 1; step < chain.length; step++) {
      const from = chain[step - 1]!, to = chain[step]!
      const shift = (step === 1 ? sourceOffset[edge]! : 0) - (step === chain.length - 1 ? targetOffset[edge]! : 0)
      alignments.push([from, to, shift, Math.abs(cross[to]! - cross[from]! - shift)])
    }
  })
  alignments.sort((a, b) => a[3] - b[3] || a[0] - b[0] || a[1] - b[1])
  let work = 200_000
  const solve = (): Float64Array | undefined => {
    const position = new Float64Array(n)
    for (let id = 0; id < n; id++) {
      const group = root(id)
      position[group] = Math.max(position[group]!, vertices[id]!.crossSize / 2 - offset[id]!)
    }
    for (let round = 0; round < n; round++) {
      let changed = false
      for (const [left, right, gap] of constraints) {
        if (--work < 0) return undefined
        const a = root(left), b = root(right), required = position[a]! + offset[left]! + gap - offset[right]!
        if (required > position[b]! + 1e-7) { position[b] = required; changed = true }
      }
      if (!changed) {
        const result = Float64Array.from({ length: n }, (_, id) => position[root(id)]! + offset[id]!)
        return result.every((value, id) => value + vertices[id]!.crossSize / 2 <= extent + 1e-7) ? result : undefined
      }
    }
    return undefined
  }
  for (const [from, to, shift] of alignments) {
    if (work <= 0) break
    const a = root(from), b = root(to)
    if (a === b) continue
    // Compression mutates all offsets, so retain the complete small state
    // before a speculative merge; an infeasible merge must not leak through.
    const previousParent = parent.slice(), previousOffset = offset.slice()
    parent[b] = a
    offset[b] = offset[from]! + shift - offset[to]!
    const result = solve()
    if (result) cross.set(result)
    else { parent.set(previousParent); offset.set(previousOffset) }
  }
}
