import { isImmutablePixelTextPart } from '../shared/prepared-text.ts'
import { deferredTerminalProjectionInput, materializeOwnTerminalProjection } from './deferred-terminal-projection.ts'
import { SCENE_VALIDATION_LIMITS } from './scene-validation-core.ts'
import type { SceneDoc } from './ir.ts'

// This capability is private to constructor programs. A frozen caller object,
// a built-in family name, or an extension's replacement hook cannot grant it.
const ownedScenes = new WeakSet<object>()
export function isOwnedScene(scene: object): boolean { return ownedScenes.has(scene) }

/** Finalize data constructed by an owned drawing program in place. Public
 * constructors and external scenes still use the defensive copying boundary.
 * Charge the same property visits as native emission's generic snapshot. */
export function freezeOwnedDrawingData<T>(value: T, pay: (count?: number) => boolean = () => true, depth = 0, materializeDeferred = false): T {
  if (depth > (materializeDeferred ? SCENE_VALIDATION_LIMITS.maxDepth * 4 : 64)) throw new RangeError('Owned drawing data is too deeply nested')
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return value
  if (typeof value !== 'object' || !pay()) throw new TypeError('Unsupported owned drawing data')
  if (isImmutablePixelTextPart(value)) return value
  const keys = Object.getOwnPropertyNames(value)
  if (!pay(keys.length)) throw new RangeError('Owned drawing data exceeds its work allowance')
  const deferred = deferredTerminalProjectionInput(value)
  for (const key of keys) {
    if (!pay()) throw new RangeError('Owned drawing data exceeds its work allowance')
    if (Array.isArray(value) && key === 'length') continue
    if (key === 'terminalProjection' && deferred) {
      if (!materializeDeferred) continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      const projection = materializeOwnTerminalProjection(value, key, descriptor)
      Object.defineProperty(value, key, { value: projection, enumerable: true, configurable: true, writable: true })
    }
    freezeOwnedDrawingData((value as Record<string, unknown>)[key], pay, depth + 1, materializeDeferred)
  }
  if (deferred && !pay(3)) throw new RangeError('Owned drawing data exceeds its work allowance')
  return Object.freeze(value)
}

export function finalizeOwnedScene(scene: SceneDoc): SceneDoc {
  freezeOwnedDrawingData(scene, undefined, 0, true)
  ownedScenes.add(scene)
  return scene
}
