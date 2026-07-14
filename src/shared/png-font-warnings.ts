import type { RenderRequestReceipt } from '../render-contract.ts'
import type { PngRuntimeProvenance } from '../png-contract.ts'

export interface PngFontWarning {
  code: 'PNG_FONT_COVERAGE'
  script: string
  chars: string[]
  message: string
}

export interface PngRasterResult {
  png: Uint8Array
  warnings: PngFontWarning[]
  /** Receipt from the same resolved graphical request that produced the PNG. */
  receipt: RenderRequestReceipt
  /** Artifact/runtime provenance, separate from the logical request receipt. */
  runtime: PngRuntimeProvenance
}

export function buildPngFontWarnings(
  uncovered: readonly { script: string; chars: string[] }[],
  options: { systemFontsMayCover?: boolean } = {},
): PngFontWarning[] {
  return uncovered.map(({ script, chars }) => {
    const examples = chars.slice(0, 5).join(' ')
    const uncertainty = options.systemFontsMayCover
      ? ' They are absent from bundled/caller-provided fonts; an installed system font may cover them, so final shaping is machine-dependent.'
      : ' They may draw as tofu or fail to shape as one grapheme.'
    return {
      code: 'PNG_FONT_COVERAGE' as const,
      script,
      chars: [...chars],
      message: `no known loaded face covers ${chars.length} ${script} character${chars.length === 1 ? '' : 's'} (${examples}) in one grapheme cluster.${uncertainty} Supply fontDirs (CLI: --font-dirs <dir>) with a face that covers the cluster.`,
    }
  })
}
