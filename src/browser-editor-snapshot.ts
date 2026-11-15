import { DIAGRAM_WORK_LIMITS } from './shared/diagram-limits.ts'
import type { EditorWorkerOperation } from './browser-editor-protocol.ts'

// Only this module can authorize transferring a private admission snapshot.
// The adapter captures before loading; direct clients capture at submission.
const owned = new WeakSet<object>()
export function assertEditorSource(source: unknown): asserts source is string {
  if (typeof source !== 'string' || source.length > DIAGRAM_WORK_LIMITS.sourceCharacters) throw new Error('Editor source must be a string within the diagram source budget')
}

export function captureEditorOperation(operation: EditorWorkerOperation): EditorWorkerOperation {
  assertEditorSource(operation.source)
  const snapshot = structuredClone(operation)
  owned.add(snapshot)
  return snapshot
}
export function takeEditorOperation(operation: EditorWorkerOperation): EditorWorkerOperation {
  return owned.delete(operation) ? operation : structuredClone(operation)
}
