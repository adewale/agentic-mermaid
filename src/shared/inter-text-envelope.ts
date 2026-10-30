/** Conservative outline metadata for the four normal Inter faces pinned in
 * font-manifest.ts. The Latin-letter/space GSUB closure has no ligatures or
 * multiple substitutions. Its GPOS records only adjust the first advance;
 * every adjusted advance remains positive. Across all faces, the minimum
 * advance is 254 font units, left bearing -50, right overhang 175, and
 * vertical outline [-442,1850], at 2048 units/em. Optional single substitutions
 * are included in those extrema. This is an envelope, not shaped metrics. */
export function interTextEnvelope(text: string, weight: number, size: number, width: number) {
  if (!(width > 0) || !Number.isFinite(width) || !/^[A-Za-z ]+$/.test(text) || ![400, 500, 600, 700].includes(weight)) return undefined
  // With n positive adjusted advances, natural advance A >= n * 254. Fitting
  // to W therefore scales an overhang by at most W / (n * 254).
  const scale = width / (text.length * 254)
  return { left: 50 * scale, right: 175 * scale, above: 1850 / 2048 * size, below: 442 / 2048 * size }
}
