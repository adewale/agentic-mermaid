/**
 * Stable role vocabulary shared by every Scene backend.  Built-in roles keep
 * their existing rendering policy, while extensions must use a namespace
 * (`vendor:role`) so they cannot accidentally acquire new core semantics.
 */

import { createExtensionIdentity, type ExtensionIdentity } from '../shared/extension-identity.ts'
import type { RoleStyleSpec } from './style-spec.ts'

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

export type SceneRoleStyleFallback = 'node' | 'edge' | 'group' | 'label'

export interface SceneRoleTraits {
  /** Scene mark kinds on which the role is meaningful. */
  applicableKinds: readonly SceneMarkKind[]
  /** Public brand archetype inherited by this semantic role. */
  styleFallback: SceneRoleStyleFallback
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
const SHAPE_TEXT_OR_RAW: readonly SceneMarkKind[] = ['shape', 'text', 'raw']
const PRELUDE: readonly SceneMarkKind[] = ['prelude']

function traits(
  applicableKinds: readonly SceneMarkKind[],
  styleFallback: SceneRoleStyleFallback,
  options: Partial<Omit<SceneRoleTraits, 'applicableKinds' | 'styleFallback'>> = {},
): SceneRoleTraits {
  return Object.freeze({
    applicableKinds,
    styleFallback,
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
  node: traits(SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  edge: traits(CONNECTOR, 'edge', { domIdentity: true, relation: true, sketch: 'connector' }),
  'edge-label': traits(TEXT_OR_GROUP, 'label'),
  group: traits(SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  'group-header': traits(ANY_MARK, 'group', { sketch: 'shape', textHalo: true }),
  label: traits(TEXT, 'label', { textHalo: true }),
  actor: traits(SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  lifeline: traits(CONNECTOR, 'edge', { sketch: 'connector' }),
  activation: traits(SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  message: traits(CONNECTOR_OR_GROUP, 'edge', { domIdentity: true, relation: true, sketch: 'connector' }),
  block: traits(ANY_MARK, 'group', { domIdentity: true, sketch: 'shape' }),
  note: traits(SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  'class-box': traits(SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  member: traits(TEXT, 'label', { domIdentity: true, textHalo: true }),
  entity: traits(SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  // ER attributes may be emitted as a semantic wrapper containing the name,
  // type, and key badge; the group carries the attribute identity.
  attribute: traits(TEXT_OR_GROUP, 'label', { domIdentity: true, textHalo: true }),
  relationship: traits(CONNECTOR, 'edge', { domIdentity: true, relation: true, sketch: 'connector' }),
  cardinality: traits(SHAPE_OR_TEXT, 'label', { domIdentity: true, textHalo: true }),
  'pie-slice': traits(SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  legend: traits(SHAPE_TEXT_OR_GROUP, 'group', { textHalo: true }),
  bar: traits(SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  series: traits(CONNECTOR, 'edge', { domIdentity: true, sketch: 'connector' }),
  point: traits(SHAPE, 'node', { domIdentity: true }),
  axis: traits(ANY_MARK, 'label', { textHalo: true }),
  grid: traits(ANY_MARK, 'edge'),
  plate: traits(SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  section: traits(ANY_MARK, 'group', { domIdentity: true, sketch: 'shape', textHalo: true }),
  task: traits(ANY_MARK, 'node', { domIdentity: true, sketch: 'shape' }),
  milestone: traits(SHAPE, 'node', { domIdentity: true, sketch: 'shape' }),
  'marker-line': traits(ANY_MARK, 'edge'),
  rail: traits(ANY_MARK, 'edge', { sketch: 'connector' }),
  period: traits(SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  event: traits(SHAPE_OR_GROUP, 'group', { domIdentity: true, sketch: 'shape' }),
  score: traits(ANY_MARK, 'node'),
  'actor-pill': traits(SHAPE, 'node', { sketch: 'shape' }),
  service: traits(SHAPE_OR_GROUP, 'node', { domIdentity: true, sketch: 'shape' }),
  junction: traits(SHAPE_OR_GROUP, 'node', { domIdentity: true }),
  icon: traits(SHAPE_TEXT_OR_RAW, 'node'),
  title: traits(ANY_MARK, 'label', { domIdentity: true }),
  defs: traits(RAW_OR_DOCUMENT, 'label'),
  prelude: traits(PRELUDE, 'label'),
  chrome: traits(ANY_MARK, 'label'),
})

const SAFE_NAMESPACED_TRAITS = traits(ANY_MARK, 'label', { domIdentity: true })

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

const TEXT_STYLE = Object.freeze(['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'textTransform', 'textColor', 'cue'] as const)
const SHAPE_STYLE = Object.freeze(['paddingX', 'paddingY', 'cornerRadius', 'lineWidth', 'fillColor', 'borderColor', 'elevation', 'cue'] as const)
const CONNECTOR_STYLE = Object.freeze(['lineWidth', 'bendRadius', 'strokeColor', 'cue'] as const)
const uniqueProperties = (...groups: readonly (readonly RoleStyleProperty[])[]): readonly RoleStyleProperty[] =>
  Object.freeze([...new Set(groups.flat())])
const GROUP_STYLE = uniqueProperties(TEXT_STYLE, SHAPE_STYLE, ['headerFillColor'])
function applicableStyle(fallback: SceneRoleStyleFallback): readonly RoleStyleProperty[] {
  // A semantic wrapper may own the typography of child text even when its own
  // Scene mark kind is shape/group. Applicability therefore follows the
  // descriptor's explicit brand fallback contract, not physical-kind order.
  if (fallback === 'node') return uniqueProperties(TEXT_STYLE, SHAPE_STYLE)
  if (fallback === 'edge') return uniqueProperties(TEXT_STYLE, CONNECTOR_STYLE)
  if (fallback === 'group') return GROUP_STYLE
  return TEXT_STYLE
}

/** Canonical discovery/identity/style projection derived from the trait authority. */
export const SCENE_ROLE_DESCRIPTORS: readonly SceneRoleDescriptor[] = Object.freeze(
  Object.entries(BUILTIN_SCENE_ROLE_TRAITS).map(([role, roleTraits]) => Object.freeze({
    identity: createExtensionIdentity({

      id: `role:${role}`,
      kind: 'role',
      version: '1.0.0',
      compatibility: { core: '^0.1.1', scene: '^1.0.0' },
      provenance: { owner: 'agentic-mermaid', source: 'built-in', reference: 'src/scene/roles.ts' },
    }),
    role: role as BuiltinSceneRole,
    traits: roleTraits,
    style: (() => {
      const fallback = roleTraits.styleFallback
      return Object.freeze({
        fallbackRole: fallback,
        applicableProperties: applicableStyle(fallback),
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
