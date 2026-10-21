import type { RenderContext } from '../types.ts'
import type { SceneDoc } from './ir.ts'

type Lowerer = (context: RenderContext) => SceneDoc
const wrappers = new WeakMap<Lowerer, boolean>()
const invocations = new WeakMap<RenderContext, Lowerer>()
let capture = false
let publicLowering = false

function scoped<T>(value: boolean, publicCall: boolean, run: () => T): T {
  const previous = capture
  const previousPublic = publicLowering
  capture = value
  publicLowering = publicCall
  try { return run() } finally { capture = previous; publicLowering = previousPublic }
}

/** Representation selection only. This grants no admission/security authority. */
export function publicConstructionOperandsRequired(): boolean { return capture }

/** Public built-in adapters retain writable Scene data. Like construction
 * capture, this is scoped to the exact invocation, never a caller option. */
export function publicSceneLowering(): boolean { return publicLowering }

export function ownSceneLowering(wrapper: Lowerer, publicConstruction = false): Lowerer {
  wrappers.set(wrapper, publicConstruction)
  return wrapper
}

export function withSceneLoweringRepresentation<T>(wrapper: Lowerer, context: RenderContext, lower: () => T): T {
  const publicCall = wrappers.has(wrapper) && invocations.get(context) !== wrapper
  return scoped(wrappers.get(wrapper) === true && publicCall, publicCall, lower)
}

/** The exact engine context and enrolled hook mask enclosing public scopes. */
export function invokeSceneLowering(receiver: unknown, lowerer: Lowerer, context: RenderContext): SceneDoc {
  const invoke = (): SceneDoc => Reflect.apply(lowerer, receiver, [context])
  if (!wrappers.has(lowerer)) return scoped(false, false, invoke)
  const previous = invocations.get(context)
  invocations.set(context, lowerer)
  try { return scoped(false, false, invoke) } finally {
    if (previous) invocations.set(context, previous)
    else invocations.delete(context)
  }
}
