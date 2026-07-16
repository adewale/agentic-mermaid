import { AsciiWidthError } from './ascii/index.ts'
import {
  MermaidFamilyDetectionError,
  type FamilyDetectionDiagnostic,
} from './family-detection.ts'

export type AsciiWidthErrorDiagnostic = Readonly<{
  code: AsciiWidthError['code']
  message: string
  requestedWidth: number
  requiredWidth: number
  family: AsciiWidthError['family']
  reason: AsciiWidthError['reason']
}>

export type KnownRenderErrorDiagnostic = FamilyDetectionDiagnostic | AsciiWidthErrorDiagnostic
export type RenderErrorDiagnostic = KnownRenderErrorDiagnostic
  | Readonly<{ code: 'RENDER_FAILED'; message: 'Rendering failed' }>

/**
 * Project documented render failures and one transport-neutral generic error.
 *
 * Deliberately use nominal checks and copy an explicit field allowlist: an
 * arbitrary thrown object cannot smuggle accessors, prototypes, stacks, or a
 * transport-specific error vocabulary into a CLI/MCP response.
 */
export function projectKnownRenderErrorDiagnostic(error: unknown): KnownRenderErrorDiagnostic | undefined {
  if (error instanceof MermaidFamilyDetectionError) {
    return {
      code: error.code,
      message: error.message,
      line: error.line,
      preservation: error.preservation,
      help: error.help,
    }
  }
  if (error instanceof AsciiWidthError) {
    return {
      code: error.code,
      message: error.message,
      requestedWidth: error.requestedWidth,
      requiredWidth: error.requiredWidth,
      family: error.family,
      reason: error.reason,
    }
  }
  return undefined
}

export function projectRenderErrorDiagnostic(error: unknown): RenderErrorDiagnostic {
  return projectKnownRenderErrorDiagnostic(error)
    ?? { code: 'RENDER_FAILED', message: 'Rendering failed' }
}
