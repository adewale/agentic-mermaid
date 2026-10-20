/** Terminal-only derived data on the trusted, assertions-off Scene path.
 * The own enumerable property remains observable as before. Admission reserves
 * its complete resource envelope before allowing it to stay unevaluated. */
import type { ConnectorMark } from './ir.ts'
import { deriveConnectorTerminalProjection, type ConnectorTerminalProjectionInput } from './connector-terminal.ts'

interface DeferredProjection {
  readonly input: ConnectorTerminalProjectionInput
  readonly get: () => ConnectorMark['terminalProjection']
  projection: ConnectorMark['terminalProjection'] | undefined
  reserved: boolean
}

const deferred = new WeakMap<object, DeferredProjection>()
let loweringDepth = 0

/** Only built-in lowering enters this scope; caller-owned marks and external
 * families retain their eager constructor and admission behavior. */
export function withDeferredTerminalProjections<T>(lower: () => T): T {
  loweringDepth++
  try { return lower() } finally { loweringDepth-- }
}

function freezeProjection(value: unknown): void {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const key of Object.keys(value)) freezeProjection((value as Record<string, unknown>)[key])
  Object.freeze(value)
}

function install(node: ConnectorMark, input: ConnectorTerminalProjectionInput): void {
  const state: DeferredProjection = {
    input,
    projection: undefined,
    reserved: false,
    get() {
      if (state.projection === undefined) {
        const projection = deriveConnectorTerminalProjection(input, true)
        // Only an admitted, bounded immutable capture can survive a public
        // return with its projection deferred.
        if (state.reserved && Object.isFrozen(node)) freezeProjection(projection)
        state.projection = projection
      }
      return state.projection
    },
  }
  deferred.set(node, state)
  Object.defineProperty(node, 'terminalProjection', {
    enumerable: true,
    configurable: true,
    get: state.get,
    set(value: ConnectorMark['terminalProjection']) {
      // Before admission a lowering may replace a derived field (the
      // consistency checks diagnose that defect). Frozen public Scenes must
      // retain the old data property's read-only behavior.
      if (Object.isFrozen(node)) throw new TypeError('Cannot assign to readonly terminalProjection')
      deferred.delete(node)
      Object.defineProperty(node, 'terminalProjection', { value, enumerable: true, configurable: true, writable: true })
    },
  })
}

export function setConnectorTerminalProjection(node: ConnectorMark, input: ConnectorTerminalProjectionInput): void {
  // Path derivation also validates marker-mid ownership across contours, so it
  // stays eager. Additional diagnostics are captured before any caller can
  // change the array that supplied them.
  if (loweringDepth === 0 || input.geometry.kind === 'path'
    || (input.additionalDiagnostics !== undefined && !input.additionalDiagnostics.every(value => typeof value === 'string'))) {
    node.terminalProjection = deriveConnectorTerminalProjection(input)
    return
  }
  install(node, Object.freeze({
    ...input,
    ...(input.additionalDiagnostics ? { additionalDiagnostics: Object.freeze([...input.additionalDiagnostics]) } : {}),
  }))
}

/** A getter borrowed by a forged object is not registered and is never trusted. */
export function deferredTerminalProjectionInput(node: object): ConnectorTerminalProjectionInput | undefined {
  const state = deferred.get(node)
  if (!state || state.projection !== undefined) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(node, 'terminalProjection')
  return descriptor?.get === state.get ? state.input : undefined
}

export function reserveDeferredTerminalProjection(node: object): void {
  const state = deferred.get(node)
  if (state) state.reserved = true
}

export function hasReservedDeferredTerminalProjection(node: object): boolean {
  return deferredTerminalProjectionInput(node) !== undefined && deferred.get(node)!.reserved && Object.isFrozen(node)
}

/** Snapshot only our registered getter. External caller accessors still fail
 * the own-data admission rule without being invoked. */
export function materializeOwnTerminalProjection(node: object, key: string, descriptor: PropertyDescriptor): unknown {
  const state = deferred.get(node)
  return key === 'terminalProjection' && state && descriptor.get === state.get
    ? state.get()
    : undefined
}

/** Group ownership must not read a deferred getter while copying a mark. */
export function copyDeferredTerminalProjection(source: object, target: ConnectorMark): boolean {
  const input = deferredTerminalProjectionInput(source)
  if (!input) return false
  install(target, input)
  return true
}
