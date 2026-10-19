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
): SvgSemanticAccessibility | undefined {
  if (!sceneRoleTraits(identity.role).relation) return undefined
  if (identity.from === undefined || identity.to === undefined) return undefined
  const relation: SvgRelationSemantics = {
    from: identity.from,
    to: identity.to,
    ...(label ? { label } : {}),
  }
  return {
    label: `${relation.from} to ${relation.to}${relation.label ? `: ${relation.label}` : ''}`,
    role: 'graphics-symbol',
    roleDescription: 'relation',
    relation,
  }
}
