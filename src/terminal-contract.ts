import { detectColorMode } from './ascii/ansi.ts'
import type { AsciiTheme, ColorMode } from './ascii/types.ts'

/** Logical terminal projection policy shared by every ASCII/Unicode/HTML adapter. */
export const TERMINAL_OUTPUT_POLICY_VERSION = 1 as const
export const TERMINAL_DEFAULT_PADDING_X = 5 as const
export const TERMINAL_BOUNDED_PADDING_X = 1 as const
export const TERMINAL_DEFAULT_PADDING_Y = 5 as const
export const TERMINAL_DEFAULT_BOX_BORDER_PADDING = 1 as const

/** Resolved modes form the executable terminal contract. Registration
 * conformance imports this roster, so adding a ColorMode cannot silently skip
 * its external-family witness. */
export const RESOLVED_TERMINAL_COLOR_MODES = Object.freeze([
  'none', 'ansi16', 'ansi256', 'truecolor', 'html',
] as const satisfies readonly ColorMode[])
type MissingResolvedTerminalColorMode = Exclude<ColorMode, typeof RESOLVED_TERMINAL_COLOR_MODES[number]>
const resolvedTerminalColorModesAreExhaustive:
  MissingResolvedTerminalColorMode extends never ? true : never = true
void resolvedTerminalColorModesAreExhaustive

const COLOR_MODES = Object.freeze(['auto', ...RESOLVED_TERMINAL_COLOR_MODES] as const)
const COLOR_MODE_SET = new Set<AsciiRenderColorMode>(COLOR_MODES)
const THEME_FIELDS = Object.freeze([
  'fg', 'border', 'line', 'arrow', 'accent', 'bg', 'corner', 'junction',
] as const satisfies readonly (keyof AsciiTheme)[])
const THEME_FIELD_SET = new Set<string>(THEME_FIELDS)
const INPUT_FIELDS = new Set([
  'useAscii', 'paddingX', 'paddingY', 'boxBorderPadding', 'colorMode',
  'theme', 'maxWidth', 'targetWidth',
])

export type AsciiRenderColorMode = ColorMode | 'auto'

export interface TerminalOutputPolicyInput {
  useAscii?: boolean
  paddingX?: number
  paddingY?: number
  boxBorderPadding?: number
  colorMode?: AsciiRenderColorMode
  theme?: Partial<AsciiTheme>
  maxWidth?: number
  targetWidth?: number
}

export interface ResolvedTerminalOutputPolicy {
  readonly version: typeof TERMINAL_OUTPUT_POLICY_VERSION
  readonly useAscii: boolean
  readonly paddingX: number
  readonly paddingY: number
  readonly boxBorderPadding: number
  /** `auto` is resolved at the request boundary; execution never re-detects it. */
  readonly colorMode: ColorMode
  /** Structurally validated overrides. Paint safety is projected with diagnostics. */
  readonly theme: Readonly<Partial<AsciiTheme>>
  readonly maxWidth?: number
  readonly targetWidth?: number
}

export class TerminalOutputPolicyError extends TypeError {
  constructor(
    readonly code: 'INVALID_INPUT' | 'INVALID_FIELD' | 'WIDTH_CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'TerminalOutputPolicyError'
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function present(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field)
}

function optionalField(record: Record<string, unknown>, field: string): unknown {
  const value = record[field]
  if (present(record, field) && value === null) {
    throw new TerminalOutputPolicyError('INVALID_FIELD', `terminal ${field} must be omitted instead of null`)
  }
  return value
}

function nonNegativeInteger(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new TerminalOutputPolicyError('INVALID_FIELD', `terminal ${field} must be a non-negative finite integer`)
  }
  return value
}

function positiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new TerminalOutputPolicyError('INVALID_FIELD', `terminal ${field} must be a positive finite integer`)
  }
  return value
}

function normalizeTheme(value: unknown): Readonly<Partial<AsciiTheme>> {
  if (value === undefined) return Object.freeze({})
  if (!plainObject(value)) {
    throw new TerminalOutputPolicyError('INVALID_FIELD', 'terminal theme must be a plain object')
  }
  const unknownFields = Object.keys(value).filter(field => !THEME_FIELD_SET.has(field))
  if (unknownFields.length > 0) {
    throw new TerminalOutputPolicyError('INVALID_FIELD', `terminal theme has unknown field "${unknownFields[0]}"`)
  }
  const theme: Partial<AsciiTheme> = {}
  for (const field of THEME_FIELDS) {
    const candidate = optionalField(value, field)
    if (candidate === undefined) continue
    if (typeof candidate !== 'string') {
      throw new TerminalOutputPolicyError('INVALID_FIELD', `terminal theme.${field} must be a string`)
    }
    theme[field] = candidate
  }
  return Object.freeze(theme)
}

/** Normalize terminal controls and defaults before either hashing or execution. */
export function resolveTerminalOutputPolicy(
  input: TerminalOutputPolicyInput = {},
): ResolvedTerminalOutputPolicy {
  if (!plainObject(input)) {
    throw new TerminalOutputPolicyError('INVALID_INPUT', 'terminal output policy must be a plain object')
  }
  const unknownFields = Object.keys(input).filter(field => !INPUT_FIELDS.has(field))
  if (unknownFields.length > 0) {
    throw new TerminalOutputPolicyError('INVALID_FIELD', `terminal output policy has unknown field "${unknownFields[0]}"`)
  }

  const rawUseAscii = optionalField(input, 'useAscii')
  if (rawUseAscii !== undefined && typeof rawUseAscii !== 'boolean') {
    throw new TerminalOutputPolicyError('INVALID_FIELD', 'terminal useAscii must be a boolean')
  }
  const rawColorMode = optionalField(input, 'colorMode')
  if (rawColorMode !== undefined && (typeof rawColorMode !== 'string' || !COLOR_MODE_SET.has(rawColorMode as AsciiRenderColorMode))) {
    throw new TerminalOutputPolicyError('INVALID_FIELD', `terminal colorMode must be one of ${COLOR_MODES.join(', ')}`)
  }
  const requestedColorMode = rawColorMode as AsciiRenderColorMode | undefined
  const maxWidth = positiveInteger(optionalField(input, 'maxWidth'), 'maxWidth')
  const targetWidth = positiveInteger(optionalField(input, 'targetWidth'), 'targetWidth')
  if (maxWidth !== undefined && targetWidth !== undefined) {
    throw new TerminalOutputPolicyError('WIDTH_CONFLICT', 'terminal maxWidth and targetWidth are mutually exclusive')
  }

  const useAscii = rawUseAscii ?? false
  const colorMode: ColorMode = requestedColorMode === undefined || requestedColorMode === 'auto'
    ? detectColorMode()
    : requestedColorMode
  const policy: ResolvedTerminalOutputPolicy = {
    version: TERMINAL_OUTPUT_POLICY_VERSION,
    useAscii,
    paddingX: nonNegativeInteger(
      optionalField(input, 'paddingX'),
      'paddingX',
      targetWidth === undefined ? TERMINAL_DEFAULT_PADDING_X : TERMINAL_BOUNDED_PADDING_X,
    ),
    paddingY: nonNegativeInteger(optionalField(input, 'paddingY'), 'paddingY', TERMINAL_DEFAULT_PADDING_Y),
    boxBorderPadding: nonNegativeInteger(
      optionalField(input, 'boxBorderPadding'),
      'boxBorderPadding',
      TERMINAL_DEFAULT_BOX_BORDER_PADDING,
    ),
    colorMode,
    theme: normalizeTheme(optionalField(input, 'theme')),
    ...(maxWidth === undefined ? {} : { maxWidth }),
    ...(targetWidth === undefined ? {} : { targetWidth }),
  }
  return Object.freeze(policy)
}
