/**
 * Stable role vocabulary shared by every Scene backend.  Built-in roles keep
 * their existing rendering policy, while extensions must use a namespace
 * (`vendor:role`) so they cannot accidentally acquire new core semantics.
 */

import { createExtensionIdentity, type ExtensionIdentity } from '../shared/extension-identity.ts'

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

export type SceneMarkKind = 'shape' | 'connector' | 'text' | 'group' | 'raw' | 'document' | 'prelude'
export type SceneSketchPolicy = 'shape' | 'connector' | 'none'

export interface SceneRoleTraits {
  /** Scene mark kinds on which the role is meaningful. */
  applicableKinds: readonly SceneMarkKind[]
  /** Whether structured SVG receives the stable data-id/data-role contract. */
  domIdentity: boolean
  /** Whether endpoint-bearing marks receive relation accessibility semantics. */
  relation: boolean
  /** Styled-backend realization policy. */
  sketch: SceneSketchPolicy
  /** Whether text receives the cartographic readability halo. */
  textHalo: boolean
}

const ANY_MARK: readonly SceneMarkKind[] = ['shape', 'connector', 'text', 'group', 'raw', 'document', 'prelude']
const SHAPE: readonly SceneMarkKind[] = ['shape']
const CONNECTOR: readonly SceneMarkKind[] = ['connector']
const TEXT: readonly SceneMarkKind[] = ['text']
const SHAPE_OR_TEXT: readonly SceneMarkKind[] = ['shape', 'text']
const SHAPE_OR_GROUP: readonly SceneMarkKind[] = ['shape', 'group']
const SHAPE_TEXT_OR_GROUP: readonly SceneMarkKind[] = ['shape', 'text', 'group']
const CONNECTOR_OR_GROUP: readonly SceneMarkKind[] = ['connector', 'group']
const RAW_OR_DOCUMENT: readonly SceneMarkKind[] = ['raw', 'document']
const TEXT_OR_GROUP: readonly SceneMarkKind[] = ['text', 'group']
const TEXT_OR_RAW: readonly SceneMarkKind[] = ['text', 'raw']
const PRELUDE: readonly SceneMarkKind[] = ['prelude']

function traits(
  applicableKinds: readonly SceneMarkKind[],
  options: Partial<Omit<SceneRoleTraits, 'applicableKinds'>> = {},
): SceneRoleTraits {
  return Object.freeze({
    applicableKinds,
    domIdentity: false,
    relation: false,
    sketch: 'none',
    textHalo: false,
    ...options,
  })
}

/** Exact built-in policy.  Backends consume this table instead of maintaining
 * independent role lists, so a role cannot drift between identity and paint. */
export const BUILTIN_SCENE_ROLE_TRAITS: Readonly<Record<BuiltinSceneRole, SceneRoleTraits>> = Object.freeze({
  node: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  edge: traits(CONNECTOR, { domIdentity: true, relation: true, sketch: 'connector' }),
  'edge-label': traits(TEXT_OR_GROUP),
  group: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  'group-header': traits(ANY_MARK, { sketch: 'shape', textHalo: true }),
  label: traits(TEXT, { textHalo: true }),
  actor: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  lifeline: traits(CONNECTOR, { sketch: 'connector' }),
  activation: traits(SHAPE, { domIdentity: true, sketch: 'shape' }),
  message: traits(CONNECTOR_OR_GROUP, { domIdentity: true, relation: true, sketch: 'connector' }),
  block: traits(ANY_MARK, { domIdentity: true, sketch: 'shape' }),
  note: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  'class-box': traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  member: traits(TEXT, { domIdentity: true, textHalo: true }),
  entity: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  attribute: traits(TEXT, { domIdentity: true, textHalo: true }),
  relationship: traits(CONNECTOR, { domIdentity: true, relation: true, sketch: 'connector' }),
  cardinality: traits(SHAPE_OR_TEXT, { domIdentity: true, textHalo: true }),
  'pie-slice': traits(SHAPE, { domIdentity: true, sketch: 'shape' }),
  legend: traits(SHAPE_TEXT_OR_GROUP, { textHalo: true }),
  bar: traits(SHAPE, { domIdentity: true, sketch: 'shape' }),
  series: traits(CONNECTOR, { domIdentity: true, sketch: 'connector' }),
  point: traits(SHAPE, { domIdentity: true }),
  axis: traits(ANY_MARK, { textHalo: true }),
  grid: traits(ANY_MARK),
  plate: traits(SHAPE, { domIdentity: true, sketch: 'shape' }),
  section: traits(ANY_MARK, { domIdentity: true, sketch: 'shape', textHalo: true }),
  task: traits(ANY_MARK, { domIdentity: true, sketch: 'shape' }),
  milestone: traits(SHAPE, { domIdentity: true, sketch: 'shape' }),
  'marker-line': traits(ANY_MARK),
  rail: traits(ANY_MARK, { sketch: 'connector' }),
  period: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  event: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  score: traits(ANY_MARK),
  'actor-pill': traits(SHAPE, { sketch: 'shape' }),
  service: traits(SHAPE_OR_GROUP, { domIdentity: true, sketch: 'shape' }),
  junction: traits(SHAPE_OR_GROUP, { domIdentity: true }),
  icon: traits(TEXT_OR_RAW),
  title: traits(ANY_MARK, { domIdentity: true }),
  defs: traits(RAW_OR_DOCUMENT),
  prelude: traits(PRELUDE),
  chrome: traits(ANY_MARK),
})

const SAFE_NAMESPACED_TRAITS = traits(ANY_MARK, { domIdentity: true })

export interface ResolvedSceneRoleTraits {
  traits: SceneRoleTraits
  source: 'builtin' | 'namespaced-safe'
}

export interface SceneRoleDescriptor {
  readonly identity: ExtensionIdentity<'role'>
  readonly role: BuiltinSceneRole
  readonly traits: SceneRoleTraits
}

/** Canonical discovery/identity projection derived from the trait authority. */
export const SCENE_ROLE_DESCRIPTORS: readonly SceneRoleDescriptor[] = Object.freeze(
  Object.entries(BUILTIN_SCENE_ROLE_TRAITS).map(([role, roleTraits]) => Object.freeze({
    identity: createExtensionIdentity({
      id: `role:${role}`,
      kind: 'role',
      version: '1.0.0',
      compatibility: { core: 'scene-role@1', scene: 'scene@1' },
      provenance: { owner: 'agentic-mermaid', source: 'built-in', reference: 'src/scene/roles.ts' },
    }),
    role: role as BuiltinSceneRole,
    traits: roleTraits,
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
