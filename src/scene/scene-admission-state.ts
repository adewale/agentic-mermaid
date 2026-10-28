import type { SceneDoc } from './ir.ts'

// Shared admission ownership, independent of validation/serialization imports.
// This is the existing snapshot cache, not a writer or paint-proof cache.
const admittedScenes = new WeakMap<object, { mode: 'internal' | 'external'; crossChecks: boolean }>()
export function admittedSceneRecord(value: object) { return admittedScenes.get(value) }
export function isAdmittedSceneDocument(value: object): boolean { return admittedScenes.has(value) }
export function recordAdmittedScene(scene: SceneDoc, mode: 'internal' | 'external', crossChecks = true): void {
  admittedScenes.set(scene, Object.freeze({ mode, crossChecks }))
}
