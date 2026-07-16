import type { BuiltinSceneRole } from './roles.ts'

/** Closed brand-neutral leaves available to applicable Scene roles. */
export const ROLE_STYLE_PROPERTY_DESCRIPTORS = Object.freeze({
  fontFamily: { kind: 'font', description: 'Safe font family/stack for roles whose descriptor exposes family-specific typography.' },
  fontSize: { kind: 'number', minimum: 1, maximum: 256, expected: 'between 1 and 256', description: 'Font size in SVG user units.' },
  fontWeight: { kind: 'number', minimum: 1, maximum: 1000, expected: 'between 1 and 1000', description: 'CSS numeric font weight.' },
  letterSpacing: { kind: 'number', minimum: -2, maximum: 4, expected: 'between -2 and 4', description: 'Letter spacing in SVG user units.' },
  textTransform: { kind: 'enum', values: ['uppercase', 'lowercase', 'capitalize'], description: 'Text transformation.' },
  textColor: { kind: 'color', description: 'Text paint.' },
  paddingX: { kind: 'number', minimum: 0, maximum: 256, expected: 'between 0 and 256', description: 'Horizontal role padding.' },
  paddingY: { kind: 'number', minimum: 0, maximum: 256, expected: 'between 0 and 256', description: 'Vertical role padding.' },
  cornerRadius: { kind: 'number', minimum: 0, maximum: 256, expected: 'between 0 and 256', description: 'Applicable corner radius.' },
  lineWidth: { kind: 'number', exclusiveMinimum: 0, maximum: 20, expected: 'greater than 0 and at most 20', description: 'Border or connector width.' },
  bendRadius: { kind: 'number', minimum: 0, maximum: 256, expected: 'between 0 and 256', description: 'Applicable connector bend radius.' },
  fillColor: { kind: 'color', description: 'Surface fill paint.' },
  borderColor: { kind: 'color', description: 'Border paint.' },
  strokeColor: { kind: 'color', description: 'Connector stroke paint.' },
  headerFillColor: { kind: 'color', description: 'Group header surface paint.' },
  cue: { kind: 'enum', values: ['none', 'outline', 'double-line', 'pattern'], description: 'Non-color semantic cue on roles whose family renderer exposes a cue projection.' },
} as const)

type RolePropertyDescriptor = (typeof ROLE_STYLE_PROPERTY_DESCRIPTORS)[keyof typeof ROLE_STYLE_PROPERTY_DESCRIPTORS]
type RolePropertyValue<D> = D extends { readonly kind: 'number' } ? number
  : D extends { readonly kind: 'font' | 'color' } ? string
    : D extends { readonly kind: 'enum'; readonly values: readonly (infer V)[] } ? V
      : never

export type RoleStyleSpec = {
  -readonly [K in keyof typeof ROLE_STYLE_PROPERTY_DESCRIPTORS]?: RolePropertyValue<(typeof ROLE_STYLE_PROPERTY_DESCRIPTORS)[K]>
}

const NODE_PROPERTIES = Object.freeze([
  'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'textColor',
  'paddingX', 'paddingY', 'cornerRadius', 'lineWidth', 'fillColor', 'borderColor',
] as const)
const EDGE_PROPERTIES = Object.freeze([
  'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'textColor',
  'lineWidth', 'bendRadius', 'strokeColor',
] as const)
const GROUP_PROPERTIES = Object.freeze([...NODE_PROPERTIES, 'fontFamily', 'headerFillColor'] as const)
const LABEL_PROPERTIES = Object.freeze(['fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'textColor'] as const)
const HEADER_PROPERTIES = Object.freeze([
  'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'textColor',
  'fillColor', 'borderColor', 'strokeColor', 'lineWidth', 'cue',
] as const)
const PIE_SLICE_PROPERTIES = Object.freeze(['fillColor', 'borderColor', 'strokeColor', 'lineWidth', 'cue'] as const)
const LEGEND_PROPERTIES = Object.freeze(['fillColor', 'borderColor', 'strokeColor', 'lineWidth', 'textColor'] as const)
const SHAPE_PAINT_PROPERTIES = Object.freeze(['fillColor', 'borderColor', 'strokeColor', 'lineWidth'] as const)
const CONNECTOR_PAINT_PROPERTIES = Object.freeze(['borderColor', 'strokeColor', 'lineWidth'] as const)
const CUED_SHAPE_PROPERTIES = Object.freeze([...SHAPE_PAINT_PROPERTIES, 'cue'] as const)

export interface ExactRoleStyleContract {
  readonly properties: readonly (keyof RoleStyleSpec)[]
  readonly bindingFamilies?: readonly string[]
}

function exactRoleStyle<const Properties extends readonly (keyof RoleStyleSpec)[]>(
  properties: Properties,
): Readonly<{ properties: Properties }>
function exactRoleStyle<
  const Properties extends readonly (keyof RoleStyleSpec)[],
  const Families extends readonly [string, ...string[]],
>(properties: Properties, bindingFamilies: Families): Readonly<{ properties: Properties; bindingFamilies: Families }>
function exactRoleStyle(
  properties: readonly (keyof RoleStyleSpec)[],
  bindingFamilies?: readonly string[],
): ExactRoleStyleContract {
  return Object.freeze({
    properties,
    ...(bindingFamilies ? { bindingFamilies: Object.freeze([...bindingFamilies]) } : {}),
  })
}

/**
 * The single exact-role styling authority. Runtime role descriptors, public
 * TypeScript, JSON Schema, binding admission, docs, and the executable census
 * all project from this record.
 */
export const EXACT_ROLE_STYLE_CONTRACT = Object.freeze({
  node: exactRoleStyle(NODE_PROPERTIES),
  edge: exactRoleStyle(EDGE_PROPERTIES),
  group: exactRoleStyle(GROUP_PROPERTIES),
  'group-header': exactRoleStyle(HEADER_PROPERTIES, ['journey']),
  label: exactRoleStyle(LABEL_PROPERTIES),
  actor: exactRoleStyle(NODE_PROPERTIES, ['sequence']),
  relationship: exactRoleStyle(EDGE_PROPERTIES, ['er']),
  'pie-slice': exactRoleStyle(PIE_SLICE_PROPERTIES, ['pie', 'radar']),
  legend: exactRoleStyle(LEGEND_PROPERTIES, ['radar']),
  bar: exactRoleStyle(SHAPE_PAINT_PROPERTIES, ['xychart']),
  series: exactRoleStyle(CONNECTOR_PAINT_PROPERTIES, ['xychart']),
  point: exactRoleStyle(SHAPE_PAINT_PROPERTIES, ['radar']),
  task: exactRoleStyle(CUED_SHAPE_PROPERTIES, ['gantt']),
  milestone: exactRoleStyle(CUED_SHAPE_PROPERTIES, ['gantt']),
} as const satisfies Readonly<Partial<Record<BuiltinSceneRole, ExactRoleStyleContract>>>)

export type ExactStyleSceneRole = keyof typeof EXACT_ROLE_STYLE_CONTRACT
export type BindableSceneRole = {
  [Role in ExactStyleSceneRole]: (typeof EXACT_ROLE_STYLE_CONTRACT)[Role] extends { readonly bindingFamilies: readonly [string, ...string[]] }
    ? Role
    : never
}[ExactStyleSceneRole]

export const EXACT_STYLE_SCENE_ROLES = Object.freeze(Object.keys(EXACT_ROLE_STYLE_CONTRACT) as ExactStyleSceneRole[])
export const BINDABLE_SCENE_ROLES = Object.freeze(EXACT_STYLE_SCENE_ROLES.filter(
  (role): role is BindableSceneRole => 'bindingFamilies' in EXACT_ROLE_STYLE_CONTRACT[role],
))

/** Closed union of leaves that at least one executable category-binding role
 * can consume. Role-free bindings must intersect this set after stack merge. */
export const BINDABLE_ROLE_STYLE_PROPERTIES = Object.freeze(
  [...new Set(BINDABLE_SCENE_ROLES.flatMap(role => EXACT_ROLE_STYLE_CONTRACT[role].properties))],
)

export type RoleStyleFor<Role extends BuiltinSceneRole> = Role extends ExactStyleSceneRole
  ? Pick<RoleStyleSpec, (typeof EXACT_ROLE_STYLE_CONTRACT)[Role]['properties'][number]>
  : never

export type RoleStyles = { [Role in ExactStyleSceneRole]?: Readonly<RoleStyleFor<Role>> }
