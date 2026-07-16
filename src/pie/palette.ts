// Pie owns its authored override semantics; derived categorical colors live at
// the shared waist consumed by every applicable peer-series family.
import {
  categoricalPalette,
  type CategoricalPaletteInputs,
} from '../shared/categorical-palette.ts'

export interface PiePaletteInputs extends CategoricalPaletteInputs {
  /** pie1..pie12 explicit fills in source order (index i = slice i, cycling at 12). */
  overrides?: Array<string | undefined>
}

/** Fill colors for `count` slices, in source order. Deterministic. Explicit
 * pie1..pie12 variables cycle at 12 and remain authoritative. */
export function pieSliceColors(count: number, inputs: PiePaletteInputs = {}): string[] {
  const derived = categoricalPalette(count, inputs)
  const overrides = inputs.overrides
  if (!overrides || overrides.length === 0) return derived
  return derived.map((color, index) => overrides[index % 12] ?? color)
}
