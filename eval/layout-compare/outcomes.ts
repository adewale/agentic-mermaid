/** Diagnostic transport: complete typed failures, excluding nondeterministic stacks. */
export interface ApiFailure {
  name: string
  message: string
  code?: string
  properties: Record<string, unknown>
  cause?: ApiFailure
}

export type ApiOutcome<T> = { ok: true; value: T } | { ok: false; error: ApiFailure }

export function apiFailure(error: unknown, seen = new Set<unknown>()): ApiFailure {
  if (error === null || typeof error !== 'object' && typeof error !== 'function') return { name: typeof error, message: String(error), properties: {} }
  if (seen.has(error)) return { name: 'CircularCause', message: 'Repeated error in cause chain', properties: {} }
  seen.add(error)
  const value = error as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown }
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    message: typeof value.message === 'string' ? value.message : 'Thrown object without a string message',
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    properties: Object.fromEntries(Object.entries(error).filter(([key]) => key !== 'stack' && key !== 'cause')),
    ...(value.cause === undefined ? {} : { cause: apiFailure(value.cause, seen) }),
  }
}

export function attemptApi<T>(run: () => T): ApiOutcome<T> {
  try { return { ok: true, value: run() } } catch (error) { return { ok: false, error: apiFailure(error) } }
}

export function failureCode(error: ApiFailure): string | undefined {
  return error.code ?? (error.cause ? failureCode(error.cause) : undefined)
}
