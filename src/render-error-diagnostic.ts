import { renderErrorOrigin } from './agent/error-origin.ts'
import { parseRegisteredMermaid } from './agent/parse.ts'
import type { ParseError } from './agent/types.ts'
import { AsciiWidthError } from './ascii/index.ts'
import {
  MermaidFamilyDetectionError,
  type FamilyDetectionDiagnostic,
} from './family-detection.ts'
import { AuthoredStyleColorError } from './shared/style-props.ts'
import { PngRasterBudgetError } from './png-contract.ts'
import { QuadrantStyleColorError } from './quadrant/point-style.ts'
import { FamilyConfigColorError, RenderOptionColorError, ThemeVariableColorError } from './theme-color-admission.ts'

export type AsciiWidthErrorDiagnostic = Readonly<{
  code: AsciiWidthError['code']
  message: string
  requestedWidth: number
  requiredWidth: number
  family: AsciiWidthError['family']
  reason: AsciiWidthError['reason']
}>

export type AuthoredStyleColorDiagnostic = Readonly<{
  code: 'INVALID_STYLE_COLOR'
  message: string
  subject: string
  property: string
  value: string
}>

export type ThemeVariableColorDiagnostic = Readonly<{
  code: 'INVALID_THEME_COLOR'
  message: string
  key: string
  value: string
}>

export type FamilyConfigColorDiagnostic = Readonly<{
  code: 'INVALID_CONFIG_COLOR'
  message: string
  path: string
  value: string
}>

export type RenderOptionColorDiagnostic = Readonly<{
  code: 'INVALID_RENDER_COLOR'
  message: string
  field: string
  value: string
}>

export type KnownRenderErrorDiagnostic = FamilyDetectionDiagnostic | AsciiWidthErrorDiagnostic | AuthoredStyleColorDiagnostic | ThemeVariableColorDiagnostic | FamilyConfigColorDiagnostic | RenderOptionColorDiagnostic

/** The registered parser rejects the source; `details` are its errors. */
export type ParseFailedDiagnostic = Readonly<{
  code: 'PARSE_FAILED'
  message: string
  details: readonly ParseError[]
}>

export type PngRasterBudgetDiagnostic = Readonly<{
  code: PngRasterBudgetError['code']
  message: string
  width: number
  height: number
  maxDimension: number
  maxPixels: number
  budget: PngRasterBudgetError['budget']
}>

/** The render path refused the source or its configuration: the same failure
 * verify reports as a RENDER_FAILED warning with this `origin`. */
export type RenderRefusalDiagnostic = Readonly<{
  code: 'RENDER_FAILED'
  origin: 'source' | 'config'
  message: string
}>

/** A defect in Agentic Mermaid: the failure verify reports as INTERNAL_ERROR. */
export type InternalRenderErrorDiagnostic = Readonly<{
  code: 'INTERNAL_ERROR'
  message: string
}>

export type RenderErrorDiagnostic = KnownRenderErrorDiagnostic
  | ParseFailedDiagnostic
  | PngRasterBudgetDiagnostic
  | RenderRefusalDiagnostic
  | InternalRenderErrorDiagnostic
  | Readonly<{ code: 'RENDER_FAILED'; message: 'Rendering failed' }>

/** What the caller can see of the failed request; `source` lets a failure on
 * source the registered parser rejects report the parser's own errors. */
export interface RenderErrorContext {
  readonly source?: string
}

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
  if (error instanceof AuthoredStyleColorError) {
    return {
      code: error.code,
      message: error.message,
      subject: error.subject,
      property: error.property,
      value: error.value,
    }
  }
  if (error instanceof QuadrantStyleColorError) {
    return {
      code: error.code,
      message: error.message,
      subject: error.subject,
      property: error.property,
      value: error.value,
    }
  }
  if (error instanceof ThemeVariableColorError) {
    return {
      code: error.code,
      message: error.message,
      key: error.key,
      value: error.value,
    }
  }
  if (error instanceof FamilyConfigColorError) {
    return {
      code: error.code,
      message: error.message,
      path: error.path,
      value: error.value,
    }
  }
  if (error instanceof RenderOptionColorError) {
    return {
      code: error.code,
      message: error.message,
      field: error.field,
      value: error.value,
    }
  }
  return undefined
}

/** One parse-failure envelope for every transport: the first error leads the
 * message, and `details` carries every structured ParseError. */
export function parseFailedDiagnostic(errors: readonly ParseError[]): ParseFailedDiagnostic {
  const first = errors[0]
  return { code: 'PARSE_FAILED', message: first ? `${first.code}: ${first.message}` : 'parse error', details: errors }
}

const OPAQUE_INTERNAL_MESSAGE = 'Rendering failed because of an internal Agentic Mermaid error; report it with the source'
const RUNTIME_DEFECTS: readonly (abstract new (...args: never[]) => Error)[] = [TypeError, RangeError, ReferenceError]

/** The message an Error was constructed with, read without running accessors. */
function ownMessage(error: Error): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, 'message')
  return typeof descriptor?.value === 'string' && descriptor.value.length > 0 ? descriptor.value : undefined
}

/** An operating-system error: the host failed, and its text names host paths. */
function isSystemError(error: Error): boolean {
  const errno = Object.getOwnPropertyDescriptor(error, 'errno')?.value
  const syscall = Object.getOwnPropertyDescriptor(error, 'syscall')?.value
  return typeof errno === 'number' || typeof syscall === 'string'
}

/** Errors whose text is not ours to show: a JavaScript runtime message about
 * our own code (not actionable by the caller) or an operating-system error. */
function hasHostOnlyMessage(error: Error): boolean {
  return isSystemError(error) || RUNTIME_DEFECTS.some(type => Object.getPrototypeOf(error) === type.prototype)
}

function registeredParseErrors(source: string | undefined): readonly ParseError[] | undefined {
  if (source === undefined) return undefined
  try {
    const parsed = parseRegisteredMermaid(source)
    return parsed.ok ? undefined : parsed.error
  } catch {
    // A parser that throws (a host work limit) already decided the render
    // error itself; keep that classification.
    return undefined
  }
}

/**
 * The one projection from a caught render failure to the diagnostic every
 * render surface (hosted and stdio MCP tools, Code Mode, CLI) reports.
 *
 * Classification is verify's: `renderErrorOrigin` decides whether the source,
 * its configuration or the engine is at fault, so a render failure and the
 * verify finding for the same input agree. In order:
 *   1. documented typed refusals keep their fields (`projectKnownRenderErrorDiagnostic`);
 *   2. a PNG over its raster budget names the limits and the fitTo/scale way out;
 *   3. a configuration refusal is RENDER_FAILED with origin `config`;
 *   4. source the registered parser rejects is PARSE_FAILED with its errors;
 *   5. any other refusal is RENDER_FAILED with origin `source`, and an engine
 *      defect is INTERNAL_ERROR, each with the renderer's message.
 * A new user-input error class needs only an origin in `error-origin.ts`
 * (it then arrives here as RENDER_FAILED with that origin) or, for its own
 * code and fields, a branch in `projectKnownRenderErrorDiagnostic`.
 *
 * Only an Error's own constructed message is read, never its stack, cause or
 * other properties. A JavaScript runtime error's text (a defect in our code)
 * and an operating-system error's (host paths) are replaced by a fixed
 * message, and a thrown non-Error value gets the generic fallback, so neither
 * host internals nor a forged object reach a response.
 */
export function projectRenderErrorDiagnostic(error: unknown, context: RenderErrorContext = {}): RenderErrorDiagnostic {
  const known = projectKnownRenderErrorDiagnostic(error)
  if (known) return known
  if (error instanceof PngRasterBudgetError) {
    return {
      code: error.code,
      message: error.message,
      width: error.width,
      height: error.height,
      maxDimension: error.maxDimension,
      maxPixels: error.maxPixels,
      budget: error.budget,
    }
  }
  if (!(error instanceof Error)) return { code: 'RENDER_FAILED', message: 'Rendering failed' }
  const origin = renderErrorOrigin(error)
  if (origin !== 'config') {
    const parseErrors = registeredParseErrors(context.source)
    if (parseErrors) return parseFailedDiagnostic(parseErrors)
  }
  const message = hasHostOnlyMessage(error) ? undefined : ownMessage(error)
  if (origin === 'engine' || isSystemError(error)) return { code: 'INTERNAL_ERROR', message: message ?? OPAQUE_INTERNAL_MESSAGE }
  if (message === undefined) return { code: 'RENDER_FAILED', message: 'Rendering failed' }
  return { code: 'RENDER_FAILED', origin, message }
}
