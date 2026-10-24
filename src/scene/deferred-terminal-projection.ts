/** Defer terminal-only derived data during trusted native drawing. Retained
 * Scenes materialize it into their bounded immutable admission snapshot. */
import type { ConnectorMark } from './ir.ts'
import { deriveConnectorTerminalProjection, type ConnectorTerminalProjectionInput } from './connector-terminal.ts'

interface DeferredProjection {
  readonly input: ConnectorTerminalProjectionInput
  projection: ConnectorMark['terminalProjection'] | undefined
}

const deferred = new WeakMap<object, DeferredProjection>()
let loweringDepth = 0

/** Only built-in lowering enters this scope; caller-owned marks and external
 * families retain their eager constructor and admission behavior. */
export function withDeferredTerminalProjections<T>(lower: () => T): T {
  loweringDepth++
  try { return lower() } finally { loweringDepth-- }
}

function projectionOf(node: object): ConnectorMark['terminalProjection'] {
  const state = deferred.get(node)
  if (!state) throw new TypeError('Unregistered terminal projection receiver')
  return state.projection ??= deriveConnectorTerminalProjection(state.input, true)
}

// The receiver's private entry owns the captured input. Sharing accessors does
// not authorize a copied descriptor on an unregistered object.
const property: PropertyDescriptor = {
  enumerable: true,
  configurable: true,
  get(this: ConnectorMark) { return projectionOf(this) },
  set(this: ConnectorMark, value: ConnectorMark['terminalProjection']) {
    if (Object.isFrozen(this)) throw new TypeError('Cannot assign to readonly terminalProjection')
    Object.defineProperty(this, 'terminalProjection', { value, enumerable: true, configurable: true, writable: true })
    deferred.delete(this)
  },
}

function install(node: ConnectorMark, input: ConnectorTerminalProjectionInput): void {
  deferred.set(node, { input, projection: undefined })
  Object.defineProperty(node, 'terminalProjection', property)
}

/** The mark constructor transfers its fresh private input record here. Nested
 * caller diagnostics still need their own snapshot; the public marker map is
 * separate. This is not an admission path for arbitrary caller-owned records. */
export function setConnectorTerminalProjection(node: ConnectorMark, input: ConnectorTerminalProjectionInput): void {
  // Path derivation also validates marker-mid ownership across contours, so it
  // stays eager. Additional diagnostics are captured before any caller can
  // change the array that supplied them.
  if (loweringDepth === 0 || input.geometry.kind === 'path'
    || (input.additionalDiagnostics !== undefined && !input.additionalDiagnostics.every(value => typeof value === 'string'))) {
    node.terminalProjection = deriveConnectorTerminalProjection(input)
    return
  }
  if (input.additionalDiagnostics) Object.defineProperty(input, 'additionalDiagnostics', {
    value: Object.freeze([...input.additionalDiagnostics]), enumerable: true, configurable: true, writable: true,
  })
  install(node, Object.freeze(input))
}

/** A getter borrowed by a forged object is not registered and is never trusted. */
export function deferredTerminalProjectionInput(node: object): ConnectorTerminalProjectionInput | undefined {
  const state = deferred.get(node)
  if (!state || state.projection !== undefined) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(node, 'terminalProjection')
  return descriptor?.get === property.get ? state.input : undefined
}

/** Snapshot only our registered getter. External caller accessors still fail
 * the own-data admission rule without being invoked. */
export function materializeOwnTerminalProjection(node: object, key: string, descriptor: PropertyDescriptor): unknown {
  const state = deferred.get(node)
  return key === 'terminalProjection' && state && descriptor.get === property.get
    ? projectionOf(node)
    : undefined
}

/** Group ownership must not read a deferred getter while copying a mark. */
export function copyDeferredTerminalProjection(source: object, target: ConnectorMark): boolean {
  const input = deferredTerminalProjectionInput(source)
  if (!input) return false
  install(target, input)
  return true
}
