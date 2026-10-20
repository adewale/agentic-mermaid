import type { RenderContext } from '../types.ts'
import type { SceneDoc } from './ir.ts'

type Lowerer = (context: RenderContext) => SceneDoc
const wrappers = new WeakMap<Lowerer, boolean>()
const invocations = new WeakMap<RenderContext, Lowerer>()
let capture = false

function scoped<T>(value: boolean, run: () => T): T {
  const previous = capture
  capture = value
  try { return run() } finally { capture = previous }
}

/** Representation selection only. This grants no admission/security authority. */
export function publicConstructionOperandsRequired(): boolean { return capture }

export function ownSceneLowering(wrapper: Lowerer, publicConstruction = false): Lowerer {
  wrappers.set(wrapper, publicConstruction)
  return wrapper
}

export function withSceneLoweringRepresentation<T>(wrapper: Lowerer, context: RenderContext, lower: () => T): T {
  return scoped(wrappers.get(wrapper) === true && invocations.get(context) !== wrapper, lower)
}

/** The exact engine context and enrolled hook mask enclosing public scopes. */
export function invokeSceneLowering(receiver: unknown, lowerer: Lowerer, context: RenderContext): SceneDoc {
  const invoke = (): SceneDoc => Reflect.apply(lowerer, receiver, [context])
  if (!wrappers.has(lowerer)) return scoped(false, invoke)
  const previous = invocations.get(context)
  invocations.set(context, lowerer)
  try { return scoped(false, invoke) } finally {
    if (previous) invocations.set(context, previous)
    else invocations.delete(context)
  }
}
