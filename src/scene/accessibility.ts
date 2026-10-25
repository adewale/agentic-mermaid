import type { SvgSemanticIdentity } from './identity.ts'
import { sceneRoleTraits } from './roles.ts'

export interface SvgRelationSemantics {
  from: string
  to: string
  label?: string
}

/** Typed per-element accessibility carried beside Scene identity. */
export interface SvgSemanticAccessibility {
  label: string
  role: 'graphics-symbol'
  roleDescription: 'relation'
  relation: SvgRelationSemantics
}


/** Build relation accessibility from typed Scene fields only. */
export function relationAccessibility(
  identity: SvgSemanticIdentity,
  label?: string,
  owned?: SvgSemanticAccessibility,
): SvgSemanticAccessibility | undefined {
  if (!sceneRoleTraits(identity.role).relation) return undefined
  if (identity.from === undefined || identity.to === undefined) return undefined
  const from = identity.from, to = identity.to
  const relation: SvgRelationSemantics = owned?.relation ?? { from, to }
  relation.from = from
  relation.to = to
  if (label) relation.label = label
  else delete relation.label
  const description = `${relation.from} to ${relation.to}${relation.label ? `: ${relation.label}` : ''}`
  if (owned) {
    owned.label = description
    return owned
  }
  return {
    label: description,
    role: 'graphics-symbol',
    roleDescription: 'relation',
    relation,
  }
}
