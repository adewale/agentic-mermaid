export const DEFAULT_LAYER_SPACING = 48

/** Public minimum gap for an authored long link, independent of routing. */
export function minimumLinkRankGap(length: number, layerSpacing = DEFAULT_LAYER_SPACING): number {
  return layerSpacing + (length - 1) * (layerSpacing + 40)
}
