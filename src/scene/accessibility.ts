import type { SvgSemanticIdentity } from './identity.ts'
import { sceneRoleTraits } from './roles.ts'
import type { ConnectorDirection } from './ir.ts'
import { relationPhrase } from '../shared/relation-direction.ts'

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


/** Build relation accessibility from typed Scene fields only. A family that
 * declares its relation direction is read in arrowhead order; marker-derived
 * direction is not, since cardinality and UML markers are not arrowheads. */
export function relationAccessibility(
  identity: SvgSemanticIdentity,
  label?: string,
  direction?: ConnectorDirection,
): SvgSemanticAccessibility | undefined {
  if (!sceneRoleTraits(identity.role).relation) return undefined
  if (identity.from === undefined || identity.to === undefined) return undefined
  const relation: SvgRelationSemantics = {
    from: identity.from,
    to: identity.to,
    ...(label ? { label } : {}),
  }
  return {
    label: `${relationPhrase(relation.from, relation.to, direction)}${relation.label ? `: ${relation.label}` : ''}`,
    role: 'graphics-symbol',
    roleDescription: 'relation',
    relation,
  }
}
