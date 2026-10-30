/** Conservative outline metadata for the four normal Inter faces pinned in
 * font-manifest.ts. The Latin-letter/space GSUB closure has no ligatures or
 * multiple substitutions. Its GPOS records only adjust the first advance;
 * every adjusted advance remains positive. Across all faces, the minimum
 * advance is 254 font units, left bearing -50, right overhang 175, and
 * vertical outline [-442,1850], at 2048 units/em. Optional single substitutions
 * are included in those extrema. This is an envelope, not shaped metrics.
 * The sparse initial-bearing table contains every negative bearing in each
 * ASCII character's full GSUB single-substitution closure, across all faces.
 * Every closure glyph also ends within its unadjusted advance. */
const initialBearings: Readonly<Record<string, number>> = Object.freeze(Object.assign(Object.create(null), { j: -50 }))

export function interTextEnvelope(text: string, weight: number, size: number, width: number, completeShapingRun = false) {
  if (!(width > 0) || !Number.isFinite(width) || !/^[A-Za-z ]+$/.test(text) || ![400, 500, 600, 700].includes(weight)) return undefined
  // With n positive adjusted advances, natural advance A >= n * 254. Only
  // the first glyph can cross the left edge: every later origin is >=254,
  // exceeding the maximum negative bearing 50. Similarly, an interior right
  // overhang <=175 cannot cross the remaining advance >=254. A complete run's
  // last glyph has no following pair adjustment and fits its raw advance.
  // Fragments keep the adjusted right bound: shaping may cross tspan edges.
  const scale = width / (text.length * 254)
  return { left: -(initialBearings[text[0]!] ?? 0) * scale, right: completeShapingRun ? 0 : 175 * scale, above: 1850 / 2048 * size, below: 442 / 2048 * size }
}
