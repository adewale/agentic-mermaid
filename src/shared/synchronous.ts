/** Stack-scoped execution must close before its owner restores the context. */
export function synchronousResult<T>(result: T): T {
  if (result !== null && (typeof result === 'object' || typeof result === 'function')
    && typeof (result as { then?: unknown }).then === 'function') {
    throw new TypeError('Stack-scoped rendering work must be synchronous')
  }
  return result
}
