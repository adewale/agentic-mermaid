/**
 * Stable role vocabulary shared by every Scene backend.  Built-in roles keep
 * their existing rendering policy, while extensions must use a namespace
 * (`vendor:role`) so they cannot accidentally acquire new core semantics.
 */

import { createExtensionIdentity, type ExtensionIdentity } from '../shared/extension-identity.ts'
import {
  EXACT_ROLE_STYLE_CONTRACT,
  type ExactRoleStyleContract,
  type RoleStyleSpec,
} from './role-style-contract.ts'

export type CoreSceneRole =
  | 'node' | 'edge' | 'edge-label' | 'group' | 'group-header' | 'label'
  | 'title' | 'defs' | 'prelude' | 'chrome'

export type BuiltinSceneRole = CoreSceneRole
  // sequence
  | 'actor' | 'lifeline' | 'activation' | 'message' | 'block' | 'note'
  // class / er
  | 'class-box' | 'member' | 'entity' | 'attribute' | 'relationship' | 'cardinality'
  // charts
  | 'pie-slice' | 'legend' | 'bar' | 'series' | 'point' | 'axis' | 'grid'
  | 'plate' | 'section' | 'task' | 'milestone' | 'marker-line'
  // timeline / journey / architecture
  | 'rail' | 'period' | 'event' | 'score' | 'actor-pill' | 'service' | 'junction' | 'icon'

export type NamespacedSceneRole = `${string}:${string}`
export type SceneRole = BuiltinSceneRole | NamespacedSceneRole

export type SceneMarkKind = 'shape' | 'connector' | 'text' | 'group' | 'document'
export type SceneSketchPolicy = 'shape' | 'connector' | 'none'

export type SceneRoleStyleFallback = 'node' | 'edge' | 'group' | 'label'

export interface SceneRoleTraits {
  /** Scene mark kinds on which the role is meaningful. */
  applicableKinds: readonly SceneMarkKind[]
  /** Public brand archetype inherited by this semantic role. */
  styleFallback: SceneRoleStyleFallback
  /** Whether an exact role record has an implemented family projection. */
  styleConsumption: 'exact' | 'fallback-only'
  /** Additional role-specific leaves with an implemented family projection. */
  styleExtras: readonly (keyof RoleStyleSpec)[]
  /** Optional exact applicable set when the fallback archetype is broader. */
  styleProperties?: readonly (keyof RoleStyleSpec)[]
  /** Built-in families that resolve semantic bindings for this exact role. */
  styleBindingFamilies: readonly string[]
  /** Whether structured SVG receives the stable data-id/data-role contract. */
  domIdentity: boolean
  /** Whether endpoint-bearing marks receive relation accessibility semantics. */
  relation: boolean
  /** Styled-backend realization policy. */
  sketch: SceneSketchPolicy
  /** Whether text receives the cartographic readability halo. */
  textHalo: boolean
}

const ANY_MARK: readonly SceneMarkKind[] = ['shape', 'connector', 'text', 'group', 'document']
const SHAPE: readonly SceneMarkKind[] = ['shape']
const CONNECTOR: readonly SceneMarkKind[] = ['connector']
const TEXT: readonly SceneMarkKind[] = ['text']
const SHAPE_OR_TEXT: readonly SceneMarkKind[] = ['shape', 'text']
const SHAPE_OR_GROUP: readonly SceneMarkKind[] = ['shape', 'group']
const SHAPE_TEXT_OR_GROUP: readonly SceneMarkKind[] = ['shape', 'text', 'group']
const CONNECTOR_OR_GROUP: readonly SceneMarkKind[] = ['connector', 'group']
const DOCUMENT: readonly SceneMarkKind[] = ['document']
const TEXT_OR_GROUP: readonly SceneMarkKind[] = ['text', 'group']
const TEXT_OR_DOCUMENT: readonly SceneMarkKind[] = ['text', 'document']
const SHAPE_TEXT_OR_DOCUMENT: readonly SceneMarkKind[] = ['shape', 'text', 'document']
const PRELUDE: readonly SceneMarkKind[] = ['document']

type BehavioralTraitOptions = Partial<Pick<SceneRoleTraits,
  'domIdentity' | 'relation' | 'sketch' | 'textHalo'
>>

function traits(
  role: BuiltinSceneRole,
  applicableKinds: readonly SceneMarkKind[],
  styleFallback: SceneRoleStyleFallback,
  options: BehavioralTraitOptions = {},
): SceneRoleTraits {
  const exact = (EXACT_ROLE_STYLE_CONTRACT as Partial<Record<BuiltinSceneRole, ExactRoleStyleContract>>)[role]
  return Object.freeze({
    applicableKinds,
    styleFallback,
    styleConsumption: exact ? 'exact' : 'fallback-only',
    styleExtras: Object.freeze([]),
    ...(exact ? { styleProperties: exact.properties } : {}),
    styleBindingFamilies: Object.freeze([...(exact?.bindingFamilies ?? [])]),
    domIdentity: false,
    relation: false,
    sketch: 'none',
    textHalo: false,
    ...options,
  })
}

/** Exact built-in policy. Backends consume this table; exact style properties
 * and binding-family admission are projected from EXACT_ROLE_STYLE_CONTRACT. */
export const BUILTIN_SCENE_ROLE_TRAITS: Readonly<Record<BuiltinSceneRole, SceneRoleTraits>> = Object.freeze({
  node: traits('node', SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  edge: traits('edge', CONNECTOR, 'edge', { domIdentity: true, relation: true, sketch: 'connector' }),
  'edge-label': traits('edge-label', TEXT_OR_GROUP, 'label'),
  group: traits('group', SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  'group-header': traits('group-header', ANY_MARK, 'group', { sketch: 'shape', textHalo: true }),
  label: traits('label', TEXT, 'label', { textHalo: true }),
  actor: traits('actor', SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  lifeline: traits('lifeline', CONNECTOR, 'edge', { sketch: 'connector' }),
  activation: traits('activation', SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  message: traits('message', CONNECTOR_OR_GROUP, 'edge', { domIdentity: true, relation: true, sketch: 'connector' }),
  block: traits('block', ANY_MARK, 'group', { domIdentity: true, sketch: 'shape' }),
  note: traits('note', SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  'class-box': traits('class-box', SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  member: traits('member', TEXT, 'label', { domIdentity: true, textHalo: true }),
  entity: traits('entity', SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  // ER attributes may be emitted as a semantic wrapper containing the name,
  // type, and key badge; the group carries the attribute identity.
  attribute: traits('attribute', TEXT_OR_GROUP, 'label', { domIdentity: true, textHalo: true }),
  relationship: traits('relationship', CONNECTOR, 'edge', { domIdentity: true, relation: true, sketch: 'connector' }),
  cardinality: traits('cardinality', SHAPE_OR_TEXT, 'label', { domIdentity: true, textHalo: true }),
  'pie-slice': traits('pie-slice', SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  legend: traits('legend', SHAPE_TEXT_OR_GROUP, 'group', { textHalo: true }),
  bar: traits('bar', SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  series: traits('series', CONNECTOR, 'edge', { domIdentity: true, sketch: 'connector' }),
  point: traits('point', SHAPE, 'node', { domIdentity: true }),
  axis: traits('axis', ANY_MARK, 'label', { textHalo: true }),
  grid: traits('grid', ANY_MARK, 'edge'),
  plate: traits('plate', SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  section: traits('section', ANY_MARK, 'group', { domIdentity: true, sketch: 'shape', textHalo: true }),
  task: traits('task', ANY_MARK, 'node', { domIdentity: true, sketch: 'shape' }),
  milestone: traits('milestone', SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  'marker-line': traits('marker-line', ANY_MARK, 'edge'),
  rail: traits('rail', ANY_MARK, 'edge', { sketch: 'connector' }),
  period: traits('period', SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  event: traits('event', SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  score: traits('score', ANY_MARK, 'node'),
  'actor-pill': traits('actor-pill', SHAPE, 'node', { sketch: 'shape' }),
  service: traits('service', SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  junction: traits('junction', SHAPE_OR_GROUP, 'node', { domIdentity: true }),
  icon: traits('icon', SHAPE_TEXT_OR_DOCUMENT, 'node'),
  title: traits('title', ANY_MARK, 'label', { domIdentity: true }),
  defs: traits('defs', DOCUMENT, 'label'),
  prelude: traits('prelude', PRELUDE, 'label'),
  chrome: traits('chrome', ANY_MARK, 'label'),
})

const SAFE_NAMESPACED_TRAITS: SceneRoleTraits = Object.freeze({
  applicableKinds: ANY_MARK,
  styleFallback: 'label',
  styleConsumption: 'fallback-only',
  styleExtras: Object.freeze([]),
  styleBindingFamilies: Object.freeze([]),
  domIdentity: true,
  relation: false,
  sketch: 'none',
  textHalo: false,
})

export interface ResolvedSceneRoleTraits {
  traits: SceneRoleTraits
  source: 'builtin' | 'namespaced-safe'
}

export type RoleStyleProperty = keyof RoleStyleSpec
export interface SceneRoleStyleDescriptor {
  readonly fallbackRole: SceneRoleStyleFallback
  readonly applicableProperties: readonly RoleStyleProperty[]
}
export interface SceneRoleDescriptor {
  readonly identity: ExtensionIdentity<'role'>
  readonly role: BuiltinSceneRole
  readonly traits: SceneRoleTraits
  readonly style: SceneRoleStyleDescriptor
}

/** Canonical discovery/identity/style projection derived from the trait authority. */
export const SCENE_ROLE_DESCRIPTORS: readonly SceneRoleDescriptor[] = Object.freeze(
  Object.entries(BUILTIN_SCENE_ROLE_TRAITS).map(([role, roleTraits]) => Object.freeze({
    identity: createExtensionIdentity({

      id: `role:${role}`,
      kind: 'role',
      version: '1.0.0',
      compatibility: { core: '^0.2.0', scene: '^2.0.0' },
      provenance: { owner: 'agentic-mermaid', source: 'built-in', reference: 'src/scene/roles.ts' },
    }),
    role: role as BuiltinSceneRole,
    traits: roleTraits,
    style: (() => {
      const fallback = roleTraits.styleFallback
      return Object.freeze({
        fallbackRole: fallback,
        applicableProperties: roleTraits.styleProperties ?? Object.freeze([]),
      })
    })(),
  })),
)

/**
 * Resolve extension behavior deterministically. Namespaced roles always get
 * the inert identity-only policy. Their local names never inherit current or
 * future core semantics implicitly; a versioned trait-registration contract
 * can be added later if a concrete extension needs one.
 */
export function resolveSceneRoleTraits(role: SceneRole): ResolvedSceneRoleTraits {
  const exact = (BUILTIN_SCENE_ROLE_TRAITS as Partial<Record<SceneRole, SceneRoleTraits>>)[role]
  if (exact) return { traits: exact, source: 'builtin' }
  return { traits: SAFE_NAMESPACED_TRAITS, source: 'namespaced-safe' }
}

export function sceneRoleTraits(role: SceneRole): SceneRoleTraits {
  return resolveSceneRoleTraits(role).traits
}
