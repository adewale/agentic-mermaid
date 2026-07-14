/** One family-aware admission gate between Scene lowering and every backend. */

import type { FamilyDescriptor } from '../agent/families.ts'
import { isExternalFamilyId } from '../agent/families.ts'
import { sceneNodePrimitives } from './capabilities.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
import {
  EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS,
  snapshotBoundedExternalData,
} from './external-data-snapshot.ts'
import {
  SceneValidationError,
  assertValidSceneDoc,
  type SceneValidationDiagnostic,
} from './scene-validation.ts'

function visit(nodes: readonly SceneNode[], callback: (node: SceneNode, path: string) => void, prefix = 'scene.parts'): void {
  nodes.forEach((node, index) => {
    const path = `${prefix}[${index}]`
    callback(node, path)
    if (node.kind === 'group') visit(node.children.map(child => child.node), callback, `${path}.children`)
  })
}

/**
 * Validate a lowered document and reconcile what it actually emitted with the
 * descriptor's complete role x primitive ledger. Built-in documents retain
 * their original identity for byte compatibility; external documents return
 * the bounded immutable snapshot that every backend must serialize.
 */
export function admitFamilyScene(descriptor: FamilyDescriptor, value: unknown): SceneDoc {
  const external = isExternalFamilyId(descriptor.id)
  // External lowerScene hooks are executable host code and may return a live
  // Proxy. Reduce that value to one bounded immutable data snapshot before
  // validation; every backend then serializes the exact object that passed
  // admission. Built-ins retain their historical identity/byte path.
  const admitted = external
    ? snapshotBoundedExternalData(
        value,
        EXTERNAL_SCENE_DOCUMENT_SNAPSHOT_LIMITS,
        'scene',
      )
    : value
  assertValidSceneDoc(admitted, { mode: external ? 'external' : 'internal' })
  const scene = admitted as SceneDoc
  const diagnostics: SceneValidationDiagnostic[] = []

  if (external && scene.family !== descriptor.id) {
    diagnostics.push({
      code: 'SCENE_DOCUMENT',
      path: 'scene.family',
      message: `external family "${descriptor.id}" emitted a document owned by "${scene.family}"`,
    })
  }

  const roles = new Set(descriptor.semanticRoles)
  const evidence = new Map(descriptor.scenePrimitiveEvidence.map(cell => [
    `${cell.role}\u0000${cell.primitive}`,
    cell,
  ] as const))
  visit(scene.parts, (node, path) => {
    if (!roles.has(node.role)) {
      diagnostics.push({
        code: 'SCENE_PRIMITIVE_CLAIM',
        path: `${path}.role`,
        message: `emitted undeclared role "${node.role}"`,
      })
      return
    }
    for (const primitive of sceneNodePrimitives(node)) {
      const claim = evidence.get(`${node.role}\u0000${primitive}`)
      if (!claim || claim.applicability !== 'applicable' || claim.realization === 'unsupported') {
        diagnostics.push({
          code: 'SCENE_PRIMITIVE_CLAIM',
          path,
          message: `emitted undeclared ${node.role}/${primitive} primitive`,
        })
      }
    }
  })

  if (diagnostics.length > 0) throw new SceneValidationError(Object.freeze(diagnostics))
  return scene
}
