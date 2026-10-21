/** Internal control flow for an async entry's not-yet-loaded dependency.
 * Synchronous entries never throw this: they retain their bundled provider. */
export class DeferredDependencyError extends Error {
  constructor(readonly dependency: string, readonly load: () => Promise<void>) {
    super(`${dependency} has not loaded`)
    this.name = 'DeferredDependencyError'
  }
}
