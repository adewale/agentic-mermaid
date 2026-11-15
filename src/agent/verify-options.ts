// ============================================================================
// Verify option admission — one rule for every surface that accepts
// VerifyOptions: the library (verifyMermaid, and Code Mode through it), the
// CLI's `am verify` flags and its `am batch` verify lines. A value outside the
// rule is refused with the field it names, never read as "no cap" or "no
// check": NaN and Infinity compare false against every label, so an admitted
// one would silently disable LABEL_OVERFLOW.
// ============================================================================

import { WARNING_SEVERITY, type VerifyOptions } from './types.ts'

/** A VerifyOptions value no surface accepts. `field` names the option. */
export class VerifyOptionsError extends TypeError {
  readonly code = 'INVALID_OPTIONS'
  constructor(readonly field: 'labelCharCap' | 'suppress' | 'options', message: string) {
    super(message)
    this.name = 'VerifyOptionsError'
  }
}

/** The problem with `options`, or undefined when every surface admits it.
 * Only the fields named here are checked; render options keep their own
 * render admission. */
export function verifyOptionsProblem(options: unknown): VerifyOptionsError | undefined {
  if (options === undefined) return undefined
  if (typeof options !== 'object' || options === null || Array.isArray(options)) return new VerifyOptionsError('options', 'verify options must be a plain object')
  const { labelCharCap, suppress } = options as { labelCharCap?: unknown; suppress?: unknown }
  if (labelCharCap !== undefined && !(Number.isSafeInteger(labelCharCap) && (labelCharCap as number) > 0)) {
    return new VerifyOptionsError('labelCharCap', `verify option "labelCharCap" must be a positive safe integer, got ${describe(labelCharCap)}`)
  }
  if (suppress !== undefined && (!Array.isArray(suppress) || suppress.some(code => typeof code !== 'string' || !Object.hasOwn(WARNING_SEVERITY, code)))) {
    return new VerifyOptionsError('suppress', 'verify option "suppress" must be an array of known warning-code strings')
  }
  return undefined
}

/** Throw the problem verifyOptionsProblem finds. */
export function admitVerifyOptions(options: unknown): asserts options is VerifyOptions | undefined {
  const problem = verifyOptionsProblem(options)
  if (problem) throw problem
}

function describe(value: unknown): string {
  return typeof value === 'number' ? String(value) : typeof value === 'string' ? JSON.stringify(value) : typeof value
}
