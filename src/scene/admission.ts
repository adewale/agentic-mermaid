/** One family-aware admission gate between Scene lowering and every backend. */

import type { FamilyDescriptor } from '../agent/families.ts'
import { isExternalFamilyId } from '../agent/families.ts'
import { sceneNodePrimitives } from './capabilities.ts'
import type { SceneDoc, SceneNode } from './ir.ts'
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
 * descriptor's complete role x primitive ledger. Returns the original object
 * unchanged so crisp built-in serialization remains byte-for-byte identical.
 */
export function admitFamilyScene(descriptor: FamilyDescriptor, value: unknown): SceneDoc {
  const external = isExternalFamilyId(descriptor.id)
  assertValidSceneDoc(value, { mode: external ? 'external' : 'internal' })
  const scene = value as SceneDoc
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
