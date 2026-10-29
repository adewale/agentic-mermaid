import { PACKAGE_VERSION } from '../version.ts'
// ============================================================================
// Style registry — ONE primitive for "how should this diagram look".
//
// A style is a PARTIAL description: every field is optional. A style that
// only sets colors is a Palette. A style that sets stroke character, fills,
// typography, and a palette is a full look. Styles compose by STACKING
// (resolveStyleStack): RenderOptions.style accepts a name, a spec, or an
// array of either, merged left → right per field — so "hand-drawn × dracula"
// is just ['hand-drawn', 'dracula'].
//
// Authors never pick a backend: the engine infers it from what the style
// asks for (inferBackend). Registered once, a style applies to every diagram
// family that lowers to the SceneGraph — N styles + M families, never N×M.
// 'crisp' (or unset) is the default path.
// ============================================================================

import {
  STYLE_SPEC_FORMAT_VERSION,
  validateStyleSpec,
} from './style-spec.ts'
import type { StyleSpec } from './style-spec.ts'
import {
  canonicalExtensionId,
  createExtensionIdentity,
  parseExtensionId,
  registerExtension,
} from '../shared/extension-identity.ts'
import type {
  ExtensionCompatibility,
  ExtensionIdentity,
  ExtensionProvenance,
  ExtensionRegistration,
} from '../shared/extension-identity.ts'
import { BUILTIN_PALETTE_DEFINITIONS, type BuiltinPaletteDefinition } from '../palette-catalog.ts'
import { assertStyleRegistryMutationAllowed, snapshotDeclarativeStyleValue, withStyleAdmission } from '../shared/declarative-style.ts'
import { BINDABLE_ROLE_STYLE_PROPERTIES } from './role-style-contract.ts'

export {
  STYLE_SPEC_FORMAT_VERSION,
  STYLE_SPEC_FIELD_DESCRIPTORS,
  STYLE_COLOR_TOKEN_DESCRIPTORS,
  ROLE_STYLE_PROPERTY_DESCRIPTORS,
  EXACT_ROLE_STYLE_CONTRACT,
  EXACT_STYLE_SCENE_ROLES,
  BINDABLE_SCENE_ROLES,
  BINDABLE_ROLE_STYLE_PROPERTIES,
  BRAND_CONSTRAINT_DESCRIPTORS,
  BRAND_CONSTRAINT_KINDS,
  SEMANTIC_BINDING_CHANNELS,
  styleSpecJsonSchema,
  styleSpecFieldReferenceMarkdown,
  styleSpecTypeScriptDeclaration,
  validateStyleSpec,
} from './style-spec.ts'
export type {
  BindableSceneRole, BrandConstraint, BrandConstraintAction, BrandConstraintKind, ExactStyleSceneRole, RoleStyleFor, RoleStyleSpec, RoleStyles,
  SemanticBinding, SemanticBindingChannel, SemanticSlots, StyleSpec, StyleColors,
} from './style-spec.ts'
import type {
  BrandConstraint, RoleStyleSpec, RoleStyles, SemanticBinding, SemanticSlots,
} from './style-spec.ts'
import { SCENE_ROLE_DESCRIPTORS, type BuiltinSceneRole } from './roles.ts'
export { resolveRoleStyle, type SemanticBindingContext } from './roles.ts'
import { isPlainRecord } from '../shared/plain-data.ts'

/** Private renderer defaults for built-in looks. This is intentionally not
 *  part of the public StyleSpec schema, registerStyle boundary, or docs. */
export interface InternalStyleFace {
  /** Complete admitted public role/policy view retained for family lowering. */
  roles?: Readonly<RoleStyles>
  semanticSlots?: SemanticSlots
  bindings?: readonly SemanticBinding[]
  constraints?: readonly BrandConstraint[]
  text?: InternalTextFace
  node?: InternalNodeFace
  edge?: InternalEdgeFace
  group?: InternalGroupFace
}
const INTERNAL_TEXT_FACE_FIELDS = Object.freeze([
  'fontSize', 'fontWeight', 'letterSpacing', 'textTransform', 'textColor',
] as const)
const INTERNAL_BOX_FACE_FIELDS = Object.freeze([
  'paddingX', 'paddingY', 'cornerRadius', 'lineWidth', 'fillColor', 'borderColor',
] as const)
/** Runtime census authority: the private face is only a compiled projection of
 * these admitted public role records and cannot own an extra expressive leaf. */
export const INTERNAL_STYLE_FACE_PROJECTION = Object.freeze({
  text: Object.freeze({ sourceRole: 'label' as const, fields: INTERNAL_TEXT_FACE_FIELDS }),
  node: Object.freeze({ sourceRole: 'node' as const, fields: Object.freeze([...INTERNAL_TEXT_FACE_FIELDS, ...INTERNAL_BOX_FACE_FIELDS]) }),
  edge: Object.freeze({ sourceRole: 'edge' as const, fields: Object.freeze([...INTERNAL_TEXT_FACE_FIELDS, 'lineWidth', 'bendRadius', 'strokeColor'] as const) }),
  group: Object.freeze({ sourceRole: 'group' as const, fields: Object.freeze([...INTERNAL_TEXT_FACE_FIELDS, ...INTERNAL_BOX_FACE_FIELDS, 'fontFamily', 'headerFillColor'] as const) }),
})
export type InternalTextFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.text.fields)[number]>
export type InternalBoxFace = Pick<RoleStyleSpec, (typeof INTERNAL_BOX_FACE_FIELDS)[number]>
export type InternalNodeFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.node.fields)[number]>
export type InternalEdgeFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.edge.fields)[number]>
export type InternalGroupFace = Pick<RoleStyleSpec, (typeof INTERNAL_STYLE_FACE_PROJECTION.group.fields)[number]>

interface InternalStyleSpec extends StyleSpec {
  /** Registry discovery metadata; never accepted in public StyleSpec JSON. */
  displayLabel?: string
}

/** What RenderOptions.style accepts: a registered name, an inline spec, or a
 *  stack of either (merged left → right). */
export type StyleInput = string | StyleSpec

export type StyleRegistryKind = 'look' | 'palette'

export interface StyleRegistrationOptions {
  readonly version?: string
  readonly compatibility?: ExtensionCompatibility
  readonly provenance?: ExtensionProvenance
}

export interface StyleDescriptor {
  readonly identity: ExtensionIdentity<StyleRegistryKind>
  readonly spec: StyleSpec
  /** Stable preferred input. */
  readonly inputName: string
  /** Stable label shared by CLI, editor, website, MCP, and generated docs. */
  readonly displayLabel: string
  readonly kind: StyleRegistryKind
  readonly isDefault: boolean
}

export interface StyleReferenceResolution {
  readonly canonicalId: string
  readonly spec: StyleSpec
}

const CORE_STYLE_VERSION = '1.0.0'
const CORE_STYLE_COMPATIBILITY = Object.freeze({ core: PACKAGE_VERSION })
const CORE_STYLE_PROVENANCE = Object.freeze({
  owner: 'agentic-mermaid',
  source: 'built-in',
  reference: 'src/scene/style-registry.ts',
})
const HOST_STYLE_PROVENANCE = Object.freeze({ owner: 'host', source: 'in-process' })

const STYLE_REGISTRY = new Map<string, ExtensionRegistration<InternalStyleSpec, StyleRegistryKind>>()
/** Stable human-facing inputs are not compatibility aliases: they have no
 * removal window and therefore live in their own projection. */
const STYLE_INPUT_NAMES = new Map<string, string>()

/** A Style input the caller supplied that names no registered style or is
 * not a valid spec. Typed so verify attributes it to configuration. */
export class StyleSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StyleSpecError'
  }
}

function validatedStyleSpecSnapshot(spec: StyleSpec): StyleSpec {
  const snapshot = snapshotDeclarativeStyleValue(spec) as StyleSpec
  const problems = validateStyleSpec(snapshot)
  if (problems.length) throw new StyleSpecError(`Invalid style spec: ${problems.join('; ')}`)
  return snapshot
}

function styleRegistrationOptionsSnapshot(options: StyleRegistrationOptions): StyleRegistrationOptions {
  const snapshot = snapshotDeclarativeStyleValue(options)
  if (!isPlainRecord(snapshot)) {
    throw new TypeError('registerStyle options must be a plain object')
  }
  return snapshot as StyleRegistrationOptions
}

function frozenRoleStyles(roles: RoleStyles | undefined): Readonly<RoleStyles> | undefined {
  if (!roles) return undefined
  return Object.freeze(Object.fromEntries(Object.entries(roles).map(([role, value]) => [role, Object.freeze({ ...value })])))
}

function frozenSemanticSlots(slots: SemanticSlots | undefined): SemanticSlots | undefined {
  if (!slots) return undefined
  return Object.freeze(Object.fromEntries(Object.entries(slots).map(([slot, value]) => [slot, Object.freeze({ ...value })])))
}

function frozenPolicyList<T extends object>(values: readonly T[] | undefined): readonly T[] | undefined {
  return values ? Object.freeze(values.map(value => Object.freeze({ ...value }) as T)) : undefined
}

function stripInternalStyle(spec: InternalStyleSpec | undefined): StyleSpec | undefined {
  if (!spec) return undefined
  const { displayLabel: _displayLabel, ...publicSpec } = spec
  return Object.freeze({
    ...publicSpec,
    formatVersion: STYLE_SPEC_FORMAT_VERSION,
    ...(publicSpec.colors ? { colors: Object.freeze({ ...publicSpec.colors }) } : {}),
    ...(publicSpec.roles ? { roles: frozenRoleStyles(publicSpec.roles) } : {}),
    ...(publicSpec.semanticSlots ? { semanticSlots: frozenSemanticSlots(publicSpec.semanticSlots) } : {}),
    ...(publicSpec.bindings ? { bindings: frozenPolicyList(publicSpec.bindings) } : {}),
    ...(publicSpec.constraints ? { constraints: frozenPolicyList(publicSpec.constraints) } : {}),
  })
}

function registryKindOf(spec: StyleSpec): StyleRegistryKind {
  return styleKind(spec)
}

function registrationIdentity(
  id: string,
  kind: StyleRegistryKind,
  options: StyleRegistrationOptions,
): ExtensionIdentity<StyleRegistryKind> {
  return createExtensionIdentity({
    id,
    kind,
    version: options.version ?? CORE_STYLE_VERSION,
    // An explicit empty/partial override must not erase the core baseline and
    // manufacture an unversioned declarative extension.
    compatibility: { ...CORE_STYLE_COMPATIBILITY, ...options.compatibility },
    provenance: options.provenance ?? HOST_STYLE_PROVENANCE,
  })
}

function registerCanonicalStyle(
  spec: InternalStyleSpec,
  kind: StyleRegistryKind,
  options: StyleRegistrationOptions,
  inputName?: string,
): () => boolean {
  const id = spec.name!
  const stored: InternalStyleSpec = Object.freeze({
    ...spec,
    formatVersion: STYLE_SPEC_FORMAT_VERSION,
    ...(spec.colors ? { colors: Object.freeze({ ...spec.colors }) } : {}),
    ...(spec.roles ? { roles: frozenRoleStyles(spec.roles) } : {}),
    ...(spec.semanticSlots ? { semanticSlots: frozenSemanticSlots(spec.semanticSlots) } : {}),
    ...(spec.bindings ? { bindings: frozenPolicyList(spec.bindings) } : {}),
    ...(spec.constraints ? { constraints: frozenPolicyList(spec.constraints) } : {}),
  })
  const identity = registrationIdentity(id, kind, options)
  registerExtension(STYLE_REGISTRY, {
    identity,
    value: stored,
  })
  if (inputName !== undefined) {
    const existing = STYLE_INPUT_NAMES.get(inputName)
    const canonicalOwner = STYLE_REGISTRY.has(inputName) && inputName !== id ? inputName : undefined
    if (existing !== undefined || canonicalOwner !== undefined) {
      STYLE_REGISTRY.delete(id)
      throw new Error(`Style input name "${inputName}" already selects "${existing ?? canonicalOwner}"`)
    }
    STYLE_INPUT_NAMES.set(inputName, id)
  }
  return () => {
    assertStyleRegistryMutationAllowed()
    const current = STYLE_REGISTRY.get(id)
    if (current?.identity !== identity) return false
    const removed = STYLE_REGISTRY.delete(id)
    if (removed && inputName !== undefined && STYLE_INPUT_NAMES.get(inputName) === id) {
      STYLE_INPUT_NAMES.delete(inputName)
    }
    return removed
  }
}

/**
 * Register a reusable declarative style. New registrations use an explicit
 * `look:` or `palette:` identity. Third-party registrations cannot create
 * unqualified inputs or compatibility aliases.
 */
export function registerStyle(spec: StyleSpec, options: StyleRegistrationOptions = {}): () => boolean {
  assertStyleRegistryMutationAllowed()
  return withStyleAdmission(() => {
    const snapshot = validatedStyleSpecSnapshot(spec)
    const registrationOptions = styleRegistrationOptionsSnapshot(options)
    if (!snapshot.name) throw new Error('registerStyle requires a name (anonymous specs are for inline use)')
    const parsed = parseExtensionId(snapshot.name)
    if (!parsed || (parsed.kind !== 'look' && parsed.kind !== 'palette')) {
      throw new Error(`registerStyle name "${snapshot.name}" must use the "look:" or "palette:" namespace`)
    }
    const inferred = registryKindOf(snapshot)
    if (parsed.kind !== inferred) {
      throw new Error(`Style "${snapshot.name}" is a ${inferred}; its name must use the "${inferred}:" namespace`)
    }
    return registerCanonicalStyle(snapshot, inferred, registrationOptions)
  })
}

function registerBuiltInStyle(
  spec: InternalStyleSpec,
  kind: StyleRegistryKind = 'look',
  inputName: string = spec.name ?? '',
): void {
  if (!spec.name) throw new Error('registerBuiltInStyle requires a name')
  const localName = spec.name
  const canonicalId = canonicalExtensionId(kind, localName)
  const publicProblems = validateStyleSpec(stripInternalStyle({ ...spec, name: canonicalId }))
  if (publicProblems.length) throw new Error(`Invalid built-in style "${canonicalId}": ${publicProblems.join('; ')}`)
  registerCanonicalStyle(
    { ...spec, name: canonicalId },
    kind,
    {
      version: CORE_STYLE_VERSION,
      compatibility: CORE_STYLE_COMPATIBILITY,
      provenance: CORE_STYLE_PROVENANCE,
    },
    inputName,
  )
}

function canonicalStyleId(name: string): string | undefined {
  if (STYLE_REGISTRY.has(name)) return name
  const inputTarget = STYLE_INPUT_NAMES.get(name)
  return inputTarget
}

export function resolveStyleReference(name: string): StyleReferenceResolution | undefined {
  const canonicalId = canonicalStyleId(name)
  if (!canonicalId) return undefined
  const spec = stripInternalStyle(STYLE_REGISTRY.get(canonicalId)?.value)
  if (!spec) return undefined
  return Object.freeze({
    canonicalId,
    spec,
  })
}

export function getStyle(name: string): StyleSpec | undefined {
  return resolveStyleReference(name)?.spec
}

export function knownStyles(): string[] {
  return knownStyleDescriptors().map(descriptor => descriptor.inputName)
}

export function knownStyleDescriptors(): readonly StyleDescriptor[] {
  return Object.freeze(Array.from(STYLE_REGISTRY.values(), ({ identity, value }) => {
    const inputName = Array.from(STYLE_INPUT_NAMES.entries()).find(([, target]) => target === identity.id)?.[0] ?? identity.id
    const localName = identity.id.slice(identity.id.indexOf(':') + 1)
    const displayLabel = value.displayLabel ?? localName
      .split('-')
      .filter(Boolean)
      .map(word => word === 'ops' ? 'OPS' : word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    return Object.freeze({
      identity,
      spec: stripInternalStyle(value)!,
      inputName,
      displayLabel,
      kind: identity.kind,
      isDefault: identity.id === 'look:crisp',
    })
  }))
}

/** Which backend a style needs, derived from what it asks for — authors
 *  describe the look, the engine picks the machinery. */
export function inferBackend(spec: StyleSpec): 'default' | 'rough' | 'hybrid' {
  if (spec.stroke === 'freehand' || spec.fill === 'wash') return 'hybrid'
  if (
    spec.stroke === 'jittered' ||
    spec.fill === 'hachure' ||
    (spec.backdrop !== undefined && spec.backdrop !== 'plain') ||
    spec.roughness !== undefined || spec.bowing !== undefined ||
    spec.passes !== undefined || spec.hachureGap !== undefined ||
    spec.hachureAngle !== undefined || spec.fillWeight !== undefined
  ) return 'rough'
  return 'default'
}

function mergeRoleStyles(left: RoleStyles | undefined, right: RoleStyles | undefined): RoleStyles | undefined {
  if (!left && !right) return undefined
  const merged: RoleStyles = { ...left }
  const lookup = merged as Partial<Record<BuiltinSceneRole, RoleStyleSpec>>
  for (const [role, value] of Object.entries(right ?? {})) {
    if (value !== undefined) lookup[role as BuiltinSceneRole] = { ...lookup[role as BuiltinSceneRole], ...value }
  }
  return merged
}

function mergeSemanticSlots(left: SemanticSlots | undefined, right: SemanticSlots | undefined): SemanticSlots | undefined {
  if (!left && !right) return undefined
  const merged: Record<string, RoleStyleSpec> = { ...left }
  for (const [slot, value] of Object.entries(right ?? {})) merged[slot] = { ...merged[slot], ...value }
  return merged
}

function mergeUniquePolicy<T>(left: readonly T[] | undefined, right: readonly T[] | undefined): readonly T[] | undefined {
  if (!left && !right) return undefined
  const values: T[] = []
  const seen = new Set<string>()
  for (const value of [...(left ?? []), ...(right ?? [])]) {
    const key = JSON.stringify(value)
    if (!seen.has(key)) { seen.add(key); values.push(value) }
  }
  return values
}

/** Merge a stack of styles left → right: later fields win; colors merge per
 *  channel. Names resolve through the registry; unknown names throw with the
 *  known list (fail loud — a silently-crisp fallback would erode trust in
 *  style coverage). */
function resolveInternalStyleStack(input: StyleInput | StyleInput[] | undefined): InternalStyleSpec | undefined {
  if (input === undefined) return undefined
  const stack = Array.isArray(input) ? input : [input]
  const specs: InternalStyleSpec[] = []
  for (const entry of stack) {
    if (typeof entry === 'string') {
      const resolved = canonicalStyleId(entry)
      if (resolved === 'look:crisp') continue
      const named = resolved ? STYLE_REGISTRY.get(resolved)?.value : undefined
      if (!named) throw new StyleSpecError(`Unknown style "${entry}". Known styles: ${knownStyles().join(', ')}`)
      specs.push(named)
    } else {
      specs.push(validatedStyleSpecSnapshot(entry))
    }
  }
  if (specs.length === 0) return undefined
  const merged: InternalStyleSpec = { formatVersion: STYLE_SPEC_FORMAT_VERSION }
  for (const spec of specs) {
    for (const [key, value] of Object.entries(spec)) {
      if (value === undefined) continue
      if (key === 'colors') {
        const colors = { ...merged.colors }
        for (const [token, color] of Object.entries(spec.colors ?? {})) {
          if (color !== undefined) (colors as Record<string, string>)[token] = color
        }
        merged.colors = colors
      } else if (key === 'roles') {
        merged.roles = mergeRoleStyles(merged.roles, spec.roles)
      } else if (key === 'semanticSlots') {
        merged.semanticSlots = mergeSemanticSlots(merged.semanticSlots, spec.semanticSlots)
      } else if (key === 'bindings') {
        merged.bindings = mergeUniquePolicy(merged.bindings, spec.bindings)
      } else if (key === 'constraints') {
        merged.constraints = mergeUniquePolicy(merged.constraints, spec.constraints)
      } else {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
  }
  return merged
}

export function resolveStyleStack(input: StyleInput | StyleInput[] | undefined): StyleSpec | undefined {
  return withStyleAdmission(() => {
    const internal = resolveInternalStyleStack(input)
    if (internal) assertRealizedStyleSpec(internal)
    return stripInternalStyle(internal)
  })
}

function compiledRoleStyle(value: RoleStyleSpec | undefined): RoleStyleSpec | undefined {
  return value ? { ...value } : undefined
}

function internalStyleFace(spec: InternalStyleSpec): InternalStyleFace | undefined {
  const width = spec.strokeWidth
  const roles = spec.roles ? Object.fromEntries(Object.entries(spec.roles).map(([role, value]) => [role, compiledRoleStyle(value)])) as RoleStyles : undefined
  const node = { ...(width !== undefined && width > 0 && inferBackend(spec) === 'default' ? { lineWidth: width } : {}), ...roles?.node }
  const edge = { ...(width !== undefined && width > 0 && inferBackend(spec) === 'default' ? { lineWidth: width } : {}), ...roles?.edge }
  const group = { ...(width !== undefined && width > 0 && inferBackend(spec) === 'default' ? { lineWidth: width } : {}), ...roles?.group }
  if (!roles && !spec.semanticSlots && !spec.bindings && !spec.constraints
    && Object.keys(node).length === 0 && Object.keys(edge).length === 0 && Object.keys(group).length === 0) return undefined
  return {
    ...(roles ? { roles: frozenRoleStyles(roles) } : {}),
    ...(spec.semanticSlots ? { semanticSlots: frozenSemanticSlots(spec.semanticSlots) } : {}),
    ...(spec.bindings ? { bindings: frozenPolicyList(spec.bindings) } : {}),
    ...(spec.constraints ? { constraints: frozenPolicyList(spec.constraints) } : {}),
    ...(roles?.label ? { text: { ...roles.label } } : {}),
    ...(Object.keys(node).length ? { node } : {}),
    ...(Object.keys(edge).length ? { edge } : {}),
    ...(Object.keys(group).length ? { group } : {}),
  }
}

/** Validate dependencies only after composition: a fragment may deliberately
 * supply hachure/wash parameters before another fragment selects that fill.
 * The final stack, however, must not carry customization that merely changes
 * receipt identity while producing no corresponding projection. */
function assertRealizedStyleSpec(spec: InternalStyleSpec): void {
  for (const [index, binding] of (spec.bindings ?? []).entries()) {
    const slot = spec.semanticSlots?.[binding.slot]
    if (!slot) throw new StyleSpecError(`Invalid style spec: binding ${index + 1} references missing semantic slot "${binding.slot}"`)
    const applicable: ReadonlySet<string> = binding.role === undefined
      ? new Set(BINDABLE_ROLE_STYLE_PROPERTIES)
      : new Set(SCENE_ROLE_DESCRIPTORS.find(candidate => candidate.role === binding.role)!.style.applicableProperties)
    if (!Object.keys(slot).some(property => applicable.has(property))) {
      throw new StyleSpecError(binding.role === undefined
        ? `Invalid style spec: semantic slot "${binding.slot}" has no field applicable to any executable category-binding role`
        : `Invalid style spec: semantic slot "${binding.slot}" has no field applicable to role "${binding.role}"`)
    }
  }
  const hachureFields = ['hachureAngle', 'hachureGap', 'fillWeight'] as const
  const inactiveHachure = hachureFields.filter(field => spec[field] !== undefined && spec.fill !== 'hachure')
  if (inactiveHachure.length > 0) {
    throw new StyleSpecError(`Invalid style spec: ${inactiveHachure.map(field => `"${field}"`).join(', ')} require fill "hachure" in the final Style stack`)
  }
  const washFields = ['washOpacity', 'washEdge'] as const
  const inactiveWash = washFields.filter(field => spec[field] !== undefined && spec.fill !== 'wash')
  if (inactiveWash.length > 0) {
    throw new StyleSpecError(`Invalid style spec: ${inactiveWash.map(field => `"${field}"`).join(', ')} require fill "wash" in the final Style stack`)
  }
  if (spec.fill !== undefined && inferBackend(spec) === 'default') {
    throw new StyleSpecError('Invalid style spec: "fill" has no crisp/default backend projection; combine it with stroke "jittered"/"freehand" or another rough/hybrid backend field')
  }
}

/** Internal boundary helper: resolve mutable registry input once, then project
 * its public StyleSpec and private renderer defaults from that same snapshot. */
export function resolveStyleStackWithFace(
  input: StyleInput | StyleInput[] | undefined,
): { style?: StyleSpec; face?: InternalStyleFace } {
  return withStyleAdmission(() => {
    const internal = resolveInternalStyleStack(input)
    if (internal === undefined) return {}
    assertRealizedStyleSpec(internal)
    const style = stripInternalStyle(internal)
    const face = internalStyleFace(internal)
    return {
      ...(style ? { style } : {}),
      ...(face ? { face } : {}),
    }
  })
}

/** A colors-only style is a Palette; anything that also sets stroke, fill, or
 * typography is a Look. "theme" is prose, never a published registry kind. */
export function styleKind(spec: StyleSpec): StyleRegistryKind {
  return Object.keys(spec).every(k => k === 'formatVersion' || k === '$schema' || k === 'name' || k === 'blurb' || k === 'colors') ? 'palette' : 'look'
}

/** True when a merged spec changes appearance beyond metadata. */
export function isStyledSpec(spec: StyleSpec): boolean {
  return inferBackend(spec) !== 'default'
    || spec.colors !== undefined
    || spec.font !== undefined
    || spec.strokeWidth !== undefined
    || spec.roles !== undefined
    || spec.semanticSlots !== undefined
    || spec.bindings !== undefined
    || spec.constraints !== undefined
}

// ----------------------------------------------------------------------------
// Palettes register as canonical palette:* styles and have stable unqualified
// inputs. Tufte is intentionally a full Look only.
// ----------------------------------------------------------------------------

// The byte-identical default is a real discoverable descriptor, not a picker-
// local pseudo-style. Stack resolution treats `crisp` as the empty treatment so
// selecting it cannot perturb the default path.
registerBuiltInStyle({
  name: 'crisp',
  displayLabel: 'Crisp',
  blurb: 'The default renderer with precise SVG geometry.',
  stroke: 'crisp',
}, 'look')

for (const definition of BUILTIN_PALETTE_DEFINITIONS as readonly BuiltinPaletteDefinition[]) {
  const { inputName: name, colors: palette } = definition
  if (canonicalExtensionId('palette', name) !== definition.id) {
    throw new Error(`Built-in palette identity mismatch: ${definition.id}`)
  }
  registerBuiltInStyle({
    name,
    displayLabel: definition.displayLabel,
    blurb: `Palette: ${name}.`,
    colors: {
      bg: palette.bg,
      fg: palette.fg,
      line: palette.line,
      accent: palette.accent,
      muted: palette.muted,
      surface: palette.surface,
      border: palette.border,
    },
  }, 'palette', name)
}

// ----------------------------------------------------------------------------
// Built-in full looks. Parameters were converged in the prototype
// (scripts/sketch-prototype); backends are inferred, never declared.
// ----------------------------------------------------------------------------

registerBuiltInStyle({
  name: 'hand-drawn',
  displayLabel: 'Hand-drawn',
  blurb: 'Black ink on ruled paper — wobbly double strokes, unfilled boxes.',
  intent: 'draft',
  colors: { bg: '#f7f5ef', fg: '#1a1a1e', line: '#26262b', accent: '#26262b', border: '#26262b' },
  font: 'Caveat',
  stroke: 'jittered',
  roughness: 1.0,
  bowing: 1,
  passes: 2,
  strokeWidth: 1.8,
  fill: 'none',
  backdrop: 'paper-ruled',
  mono: true,
})

registerBuiltInStyle({
  name: 'excalidraw',
  displayLabel: 'Excalidraw',
  blurb: 'Virtual whiteboard style — rough strokes, pastel hachure fills.',
  intent: 'draft',
  colors: { bg: '#ffffff', fg: '#1e1e1e', line: '#1e1e1e', accent: '#4263eb', surface: '#f1f3f5' },
  font: 'Caveat',
  stroke: 'jittered',
  roughness: 1.1,
  bowing: 1.2,
  passes: 2,
  strokeWidth: 1.6,
  fill: 'hachure',
  hachureAngle: -41,
  hachureGap: 5.5,
  fillWeight: 0.9,
})

registerBuiltInStyle({
  name: 'pen-and-ink',
  displayLabel: 'Pen & ink',
  blurb: 'Fine single-pass linework on warm cream — no interior hatching.',
  intent: 'premium',
  colors: { bg: '#faf6ec', fg: '#241f1a', line: '#2b241d', accent: '#2b241d', border: '#2b241d' },
  font: 'EB Garamond',
  stroke: 'jittered',
  roughness: 0.5,
  bowing: 0.6,
  passes: 1,
  strokeWidth: 1.5,
  fill: 'none',
  mono: true,
})

registerBuiltInStyle({
  name: 'freehand',
  displayLabel: 'Freehand',
  blurb: 'Pressure-sensitive marker ribbons — variable-width filled strokes.',
  intent: 'draft',
  colors: { bg: '#fbfaf7', fg: '#16161a', line: '#1d1d22', accent: '#1d1d22', border: '#1d1d22' },
  font: 'Architects Daughter',
  stroke: 'freehand',
  roughness: 0.9,
  passes: 1,
  strokeWidth: 1.6,
  fill: 'none',
  mono: true,
})

registerBuiltInStyle({
  name: 'watercolor',
  displayLabel: 'Watercolor',
  blurb: 'Rough outlines over translucent glazes with pigment-pooled edges.',
  intent: 'premium',
  colors: { bg: '#fdfbf6', fg: '#31302c', line: '#4d4a44', accent: '#7a6a52', surface: '#ead9b9', border: '#5a564e' },
  font: 'Caveat',
  stroke: 'jittered',
  roughness: 0.9,
  bowing: 0.8,
  passes: 1,
  strokeWidth: 1.5,
  fill: 'wash',
  washOpacity: 0.3,
  washEdge: 0.34,
})

registerBuiltInStyle({
  name: 'blueprint',
  displayLabel: 'Blueprint',
  blurb: 'Cyanotype: white linework on Prussian blue with a drafting grid.',
  intent: 'premium',
  colors: { bg: '#123a63', fg: '#eaf2fb', line: '#dbe9f7', accent: '#ffffff', muted: '#b8cfe6', surface: '#1c4a78', border: '#dbe9f7' },
  font: 'Share Tech Mono',
  stroke: 'jittered',
  roughness: 0.4,
  bowing: 0.4,
  passes: 1,
  strokeWidth: 1.4,
  fill: 'none',
  backdrop: 'grid',
  mono: true,
})

registerBuiltInStyle({
  name: 'tufte',
  displayLabel: 'Tufte',
  blurb: 'Maximal data-ink: crisp hairlines, warm paper, one red accent.',
  intent: 'premium',
  colors: { bg: '#fffff8', fg: '#111111', line: '#4a4a45', accent: '#a00000', muted: '#6b6b64', border: '#8a8a80' },
  font: 'EB Garamond',
  roles: {
    node: { lineWidth: 0.8, cornerRadius: 0 },
    edge: { lineWidth: 0.8 },
    group: { lineWidth: 0.8 },
  },
  mono: true,
}, 'look', 'look:tufte')

registerBuiltInStyle({
  name: 'accessible-high-contrast',
  displayLabel: 'Accessible Contrast',
  blurb: 'Accessibility-first: large labels, heavy strokes, white ground, colorblind-safe blue accent.',
  intent: 'premium',
  colors: { bg: '#ffffff', fg: '#050505', line: '#111111', accent: '#005fcc', muted: '#333333', surface: '#ffffff', border: '#050505' },
  roles: {
    node: { fontSize: 17, fontWeight: 700, textColor: 'var(--fg)', paddingX: 28, paddingY: 16, cornerRadius: 8, lineWidth: 2.4, borderColor: 'var(--fg)' },
    edge: { fontSize: 14, fontWeight: 700, textColor: 'var(--fg)', lineWidth: 2.6, bendRadius: 10, strokeColor: 'var(--fg)' },
    group: { fontSize: 14, fontWeight: 700, textColor: 'var(--fg)', paddingX: 24, paddingY: 22, cornerRadius: 8, lineWidth: 2.2, borderColor: 'var(--fg)' },
  },
})

registerBuiltInStyle({
  name: 'patent-drawing',
  displayLabel: 'Patent Hatching',
  blurb: 'Print-safe patent figure: uniform ink, strong outlines, tone via oblique hatching.',
  intent: 'premium',
  colors: { bg: '#ffffff', fg: '#111111', line: '#111111', accent: '#111111', muted: '#444444', surface: '#ffffff', border: '#111111' },
  font: 'EB Garamond',
  stroke: 'jittered',
  roughness: 0.3,
  bowing: 0.2,
  passes: 1,
  strokeWidth: 1.35,
  fill: 'hachure',
  hachureAngle: -50,
  hachureGap: 7,
  fillWeight: 0.65,
  roles: {
    node: { fontSize: 14, fontWeight: 600, textColor: 'var(--fg)', paddingX: 24, paddingY: 13, lineWidth: 1.35, cornerRadius: 0, borderColor: 'var(--fg)' },
    edge: { fontSize: 12, textColor: 'var(--fg)', lineWidth: 1.45, bendRadius: 0, strokeColor: 'var(--fg)' },
    group: { fontSize: 12, fontWeight: 700, textColor: 'var(--fg)', paddingX: 22, paddingY: 18, lineWidth: 1.35, cornerRadius: 0, borderColor: 'var(--fg)' },
  },
  mono: true,
})

registerBuiltInStyle({
  name: 'status-dashboard',
  displayLabel: 'Dark Ops Dashboard',
  blurb: 'Operational dashboard: dark surface, rounded modules, bright status-friendly accent.',
  intent: 'premium',
  colors: { bg: '#08111f', fg: '#e6f4ff', line: '#5a7c99', accent: '#2dd4bf', muted: '#8aa6bf', surface: '#102033', border: '#2e4c63' },
  roles: {
    node: { fontSize: 14, fontWeight: 700, textColor: 'var(--fg)', paddingX: 24, paddingY: 13, cornerRadius: 10, lineWidth: 1.4, borderColor: 'var(--fg)' },
    edge: { fontSize: 12, fontWeight: 600, textColor: 'var(--fg)', lineWidth: 2, bendRadius: 14, strokeColor: 'var(--fg)' },
    group: { fontSize: 13, fontWeight: 700, textColor: 'var(--fg)', textTransform: 'uppercase', letterSpacing: 0.06, paddingX: 22, paddingY: 20, cornerRadius: 10, lineWidth: 1.3, borderColor: 'var(--fg)' },
  },
})

registerBuiltInStyle({
  name: 'ops-schematic',
  displayLabel: 'Compact Trace Map',
  blurb: 'Dense operational schematic: compact mono labels, sturdy traces, theme-friendly geometry.',
  intent: 'lofi',
  colors: { bg: '#f8faf7', fg: '#17211c', line: '#24523b', accent: '#0f766e', muted: '#4f665a', surface: '#f0f5ef', border: '#24523b' },
  font: 'Share Tech Mono',
  stroke: 'jittered',
  roughness: 0.18,
  bowing: 0.2,
  passes: 1,
  strokeWidth: 1.6,
  fill: 'none',
  roles: {
    node: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', textColor: 'var(--fg)', paddingX: 16, paddingY: 8, cornerRadius: 2, lineWidth: 1.6, borderColor: 'var(--fg)' },
    edge: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', textColor: 'var(--fg)', lineWidth: 1.8, bendRadius: 0, strokeColor: 'var(--fg)' },
    group: { fontSize: 11, fontWeight: 700, textColor: 'var(--fg)', textTransform: 'uppercase', letterSpacing: 0.05, paddingX: 16, paddingY: 16, cornerRadius: 2, lineWidth: 1.5, borderColor: 'var(--fg)' },
  },
})

registerBuiltInStyle({
  name: 'chalkboard',
  displayLabel: 'Chalkboard',
  blurb: 'Classroom chalkboard: dusty off-white strokes on green slate.',
  intent: 'draft',
  colors: { bg: '#17362f', fg: '#f5f1df', line: '#ece6cf', accent: '#ffe08a', muted: '#c7d2c4', surface: '#17362f', border: '#f3ecd5' },
  font: 'Caveat',
  stroke: 'jittered',
  roughness: 1.25,
  bowing: 1,
  passes: 2,
  strokeWidth: 1.9,
  fill: 'none',
  roles: {
    node: { fontSize: 16, fontWeight: 700, textColor: 'var(--fg)', paddingX: 24, paddingY: 12, borderColor: 'var(--fg)' },
    edge: { fontSize: 13, textColor: 'var(--fg)', lineWidth: 1.8, strokeColor: 'var(--fg)' },
    group: { fontSize: 14, fontWeight: 700, textColor: 'var(--fg)', paddingX: 20, paddingY: 20, lineWidth: 1.7, borderColor: 'var(--fg)' },
  },
  mono: true,
})

registerBuiltInStyle({
  name: 'risograph',
  displayLabel: 'Riso Print',
  blurb: 'Two-ink poster print: warm stock, offset blue linework, coral accent, coarse hachure.',
  intent: 'premium',
  colors: { bg: '#fff5df', fg: '#2b2725', line: '#1f3d5a', accent: '#ff5a5f', muted: '#876a52', surface: '#ffd166', border: '#1f3d5a' },
  font: 'EB Garamond',
  stroke: 'jittered',
  roughness: 0.7,
  bowing: 0.55,
  passes: 1,
  strokeWidth: 1.5,
  fill: 'hachure',
  hachureAngle: 18,
  hachureGap: 6.5,
  fillWeight: 0.75,
  roles: {
    node: { fontSize: 14, fontWeight: 700, textColor: 'var(--fg)', paddingX: 24, paddingY: 13, cornerRadius: 3, borderColor: 'var(--fg)' },
    edge: { fontSize: 12, textColor: 'var(--fg)', lineWidth: 1.5, strokeColor: 'var(--fg)' },
    group: { fontSize: 13, fontWeight: 700, textColor: 'var(--fg)', paddingX: 22, paddingY: 18, cornerRadius: 3, borderColor: 'var(--fg)' },
  },
})

registerBuiltInStyle({
  name: 'architectural-plan',
  displayLabel: 'Plan Drafting',
  blurb: 'Architectural plan: square technical linework, uppercase mono labels, room-like frames.',
  intent: 'premium',
  colors: { bg: '#fbf7ea', fg: '#202a2f', line: '#38535e', accent: '#1f6f8b', muted: '#60727a', surface: '#fffaf0', border: '#38535e' },
  font: 'Share Tech Mono',
  stroke: 'jittered',
  roughness: 0.18,
  bowing: 0.25,
  passes: 1,
  strokeWidth: 1.45,
  fill: 'none',
  roles: {
    node: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', textColor: 'var(--fg)', paddingX: 20, paddingY: 10, cornerRadius: 0, lineWidth: 1.45, borderColor: 'var(--fg)' },
    edge: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', textColor: 'var(--fg)', lineWidth: 1.55, bendRadius: 0, strokeColor: 'var(--fg)' },
    group: { fontSize: 11, fontWeight: 700, textColor: 'var(--fg)', textTransform: 'uppercase', letterSpacing: 0.06, paddingX: 20, paddingY: 20, cornerRadius: 0, lineWidth: 1.45, borderColor: 'var(--fg)' },
  },
})

registerBuiltInStyle({
  name: 'publication-figure',
  displayLabel: 'Report Figure',
  blurb: 'Polished publication figure: serif labels, confident rules, rounded boxes, one quiet accent.',
  intent: 'premium',
  colors: { bg: '#fffdf8', fg: '#171512', line: '#24211d', accent: '#1d4ed8', muted: '#5f5a52', surface: '#faf5ea', border: '#24211d' },
  font: 'EB Garamond',
  strokeWidth: 1.45,
  roles: {
    node: { fontSize: 15, fontWeight: 700, textColor: 'var(--fg)', paddingX: 26, paddingY: 14, cornerRadius: 7, lineWidth: 1.45, borderColor: 'var(--fg)' },
    edge: { fontSize: 12, fontWeight: 600, textColor: 'var(--fg)', lineWidth: 1.45, bendRadius: 8, strokeColor: 'var(--fg)' },
    group: { fontSize: 12, fontWeight: 700, textColor: 'var(--fg)', textTransform: 'uppercase', letterSpacing: 0.08, paddingX: 24, paddingY: 22, cornerRadius: 7, lineWidth: 1.35, borderColor: 'var(--fg)' },
  },
})
