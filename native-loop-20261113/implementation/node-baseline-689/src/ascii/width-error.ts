import type { FamilyId } from '../agent/types.ts'

export type AsciiWidthErrorReason = 'UNBREAKABLE_GRAPHEME' | 'MINIMUM_GEOMETRY' | 'INVALID_WIDTH'

export class AsciiWidthError extends Error {
  readonly code = 'ASCII_TARGET_WIDTH_IMPOSSIBLE'
  constructor(
    readonly requestedWidth: number,
    readonly requiredWidth: number,
    readonly family: FamilyId,
    readonly reason: AsciiWidthErrorReason,
  ) {
    super(
      `Cannot render ${family} within ${requestedWidth} terminal cells; required width is ${requiredWidth} (${reason}).`,
    )
    this.name = 'AsciiWidthError'
  }
}
