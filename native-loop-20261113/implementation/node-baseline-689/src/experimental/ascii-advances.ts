import type { PixelTextOptions } from '../shared/prepared-text.ts'
import type { DisplayRun } from '../shared/display-text.ts'
import { getCharWidth } from '../text-metrics.ts'
/** Packed source/advance lanes for the deterministic, unstyled ASCII estimator.
 * Custom shaping, tracking, monospace and styled text keep the general path. */
export function asciiAdvanceSpans(runs: readonly DisplayRun[], options: PixelTextOptions): { offsets: Uint32Array; width(start: number, end: number): number } | undefined {
  if (runs.length !== 1 || options.monospace || options.letterSpacing || runs[0]!.bold || runs[0]!.italic || runs[0]!.underline || runs[0]!.strikethrough || /[^\x20-\x7e]/u.test(runs[0]!.text)) return undefined
  const run = runs[0]!
  // Expanding casing/entities and caller-prepared runs may have different
  // display/source cluster counts. Their existing provenance remains authoritative.
  const isOffset = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff
  if (!run.clusters || run.clusters.length !== run.text.length || !isOffset(run.sourceEnd)
    || run.clusters.some((cluster, i) => cluster.text !== run.text[i] || !isOffset(cluster.sourceStart))) return undefined
  const prefix = new Float64Array(run.text.length + 1), offsets = new Uint32Array(run.text.length + 1)
  const ratio = options.fontWeight >= 600 ? 0.60 : options.fontWeight >= 500 ? 0.57 : 0.54
  for (let i = 0; i < run.text.length; i++) {
    let units = getCharWidth(run.text[i]!)
    if (options.safeFont && (run.text[i] === 'W' || run.text[i] === 'M')) units += 0.35
    prefix[i + 1] = prefix[i]! + units
    offsets[i] = run.clusters[i]!.sourceStart
  }
  offsets[run.text.length] = run.sourceEnd
  return { offsets, width: (start, end) => (prefix[end]! - prefix[start]!) * options.fontSize * ratio + options.fontSize * 0.15 }
}
