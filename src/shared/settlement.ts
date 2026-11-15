/** One completion owns all registered cleanup. Policies such as scheduling,
 * retirement and permanent disposal remain with the caller. */
export function createSettlement<T>(complete: (value: T) => void) {
  let notify: typeof complete | undefined = complete
  let cleanups: Array<() => void> = []
  return {
    get pending(): boolean {
      return notify !== undefined
    },
    onCleanup(cleanup: () => void): void {
      if (notify) cleanups.push(cleanup)
      else cleanup()
    },
    finish(value: T): boolean {
      if (!notify) return false
      const done = notify,
        release = cleanups
      notify = undefined
      cleanups = []
      let cleanupFailure: { error: unknown } | undefined
      try {
        for (const cleanup of release) {
          try { cleanup() }
          catch (error) { cleanupFailure ??= { error } }
        }
      } finally {
        done(value)
      }
      if (cleanupFailure) throw cleanupFailure.error
      return true
    },
  }
}
