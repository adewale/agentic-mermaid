/** The async browser API accepts source and built-in descriptors, never an
 * external Scene. Keep every internal structural/cross-check and final security
 * gate, and refuse an unexpected external family rather than weakening it. */
import type { SceneDoc } from './ir.ts'
import { SceneValidationError, validateSceneDocument } from './scene-validation-core.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { admitSceneDocumentWith } from './scene-data-snapshot.ts'
export {
  EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS,
  EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS,
  snapshotBoundedExternalData,
  recordAdmittedScene,
} from './scene-data-snapshot.ts'
export type { ExternalDataSnapshotLimits } from './scene-data-snapshot.ts'

function assertInternalScene(value: unknown, mode: 'internal' | 'external' | undefined, crossChecks: boolean): asserts value is SceneDoc {
  const result = validateSceneDocument(value, { mode }, crossChecks)
  if (!result.valid) throw new SceneValidationError(result.diagnostics)
}

export function admitBackendSceneDocument(value: unknown): SceneDoc {
  return admitSceneDocument(value)
}

export function admitSceneDocument(value: unknown, mode?: 'internal' | 'external', crossChecks = sceneAssertionsEnabled()): SceneDoc {
  return admitSceneDocumentWith(value, mode, crossChecks, assertInternalScene, true)
}
