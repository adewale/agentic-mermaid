/** Full public Scene admission; native browser builds select the private
 * built-in-only twin while sharing snapshot ownership and validation rules. */
import type { SceneDoc } from './ir.ts'
import { assertAdmissibleSceneDoc } from './scene-validation.ts'
import { sceneAssertionsEnabled } from './assertions.ts'
import { admitSceneDocumentWith } from './scene-data-snapshot.ts'
export {
  EXTERNAL_SCENE_INPUT_SNAPSHOT_LIMITS,
  EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS,
  snapshotBoundedExternalData,
  recordAdmittedScene,
} from './scene-data-snapshot.ts'
export type { ExternalDataSnapshotLimits } from './scene-data-snapshot.ts'

export function admitBackendSceneDocument(value: unknown): SceneDoc {
  return admitSceneDocument(value)
}

export function admitSceneDocument(value: unknown, mode?: 'internal' | 'external', crossChecks = sceneAssertionsEnabled()): SceneDoc {
  return admitSceneDocumentWith(value, mode, crossChecks, assertAdmissibleSceneDoc)
}
