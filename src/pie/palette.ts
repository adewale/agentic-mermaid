// Pie owns its authored override semantics; derived categorical colors live at
// the shared waist consumed by every applicable peer-series family.
import {
  categoricalPalette,
  type CategoricalPaletteInputs,
} from '../shared/categorical-palette.ts'
import { CHART_ACCENT_FALLBACK, isValidHex } from '../xychart/colors.ts'

export interface PiePaletteInputs extends CategoricalPaletteInputs {
  /** pie1..pie12 explicit fills in source order (index i = slice i, cycling at 12). */
  overrides?: Array<string | undefined>
}

/** Fill colors for `count` slices, in source order. Deterministic. Explicit
 * pie1..pie12 variables cycle at 12 and remain authoritative. */
export function pieSliceColors(count: number, inputs: PiePaletteInputs = {}): string[] {
  // Pie/radar historically accepted only six-digit accent/background inputs
  // for their <=6 ladder. Keep that family-specific byte contract while the
  // shared high-count path normalizes every parser-resolvable CSS color.
  const paletteInputs = count <= 6
    ? {
        accent: inputs.accent && isValidHex(inputs.accent) ? inputs.accent : CHART_ACCENT_FALLBACK,
        bg: inputs.bg && isValidHex(inputs.bg) ? inputs.bg : undefined,
      }
    : inputs
  const derived = categoricalPalette(count, paletteInputs)
  const overrides = inputs.overrides
  if (!overrides || overrides.length === 0) return derived
  return derived.map((color, index) => overrides[index % 12] ?? color)
}
