/** Public minimum gap for an authored long link, independent of routing. */
export function minimumLinkRankGap(length: number, layerSpacing: number): number {
  return layerSpacing + (length - 1) * (layerSpacing + 40)
}
