// ============================================================================
// Style registry — ONE primitive for "how should this diagram look".
//
// A style is a PARTIAL description: every field is optional. A style that
// only sets colors is what people call a theme (the THEMES palettes register
// here as exactly that). A style that sets stroke character, fills,
// typography, and a palette is a full look. Styles compose by STACKING
// (resolveStyleStack): RenderOptions.style accepts a name, a spec, or an
// array of either, merged left → right per field — so "hand-drawn × dracula"
// is just ['hand-drawn', 'dracula'].
//
// Authors never pick a backend: the engine infers it from what the style
// asks for (inferBackend). Registered once, a style applies to every diagram
// family that lowers to the SceneGraph — N styles + M families, never N×M.
// 'crisp' (or unset) is the byte-identical default path.
// ============================================================================

import type { TextTransform } from '../types.ts'
import {
  STYLE_SPEC_FORMAT_VERSION,
  validateStyleSpec,
} from './style-spec.ts'
import type { StyleSpec } from './style-spec.ts'
import {
  canonicalExtensionId,
  createExtensionIdentity,
  parseExtensionId,
  registerCompatibilityAlias,
  registerExtension,
} from '../shared/extension-identity.ts'
import type {
  CompatibilityAlias,
  CompatibilityAliasDiagnostic,
  ExtensionCompatibility,
  ExtensionIdentity,
  ExtensionProvenance,
  ExtensionRegistration,
} from '../shared/extension-identity.ts'
import { BUILTIN_PALETTE_DEFINITIONS, type BuiltinPaletteDefinition } from '../palette-catalog.ts'

export {
  STYLE_SPEC_FORMAT_VERSION,
  STYLE_SPEC_FIELD_DESCRIPTORS,
  STYLE_COLOR_TOKEN_DESCRIPTORS,
  styleSpecJsonSchema,
  styleSpecFieldReferenceMarkdown,
  validateStyleSpec,
} from './style-spec.ts'
export type { StyleSpec, StyleColors } from './style-spec.ts'

/** Private renderer defaults for built-in looks. This is intentionally not
 *  part of the public StyleSpec schema, registerStyle boundary, or docs. */
export interface InternalStyleFace {
  text?: InternalTextFace
  node?: InternalNodeFace
  edge?: InternalEdgeFace
  group?: InternalGroupFace
}
export interface InternalTextFace {
  fontSize?: number
  fontWeight?: number
  letterSpacing?: number
  textTransform?: TextTransform
  textColor?: string
}
export interface InternalBoxFace {
  paddingX?: number
  paddingY?: number
  cornerRadius?: number
  lineWidth?: number
  fillColor?: string
  borderColor?: string
}
export interface InternalNodeFace extends InternalTextFace, InternalBoxFace {}
export interface InternalEdgeFace extends InternalTextFace {
  lineWidth?: number
  bendRadius?: number
  strokeColor?: string
}
export interface InternalGroupFace extends InternalTextFace, InternalBoxFace {
  fontFamily?: string
  lineWidth?: number
  headerFillColor?: string
}

interface InternalStyleSpec extends StyleSpec {
  face?: InternalStyleFace
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
  readonly aliases: readonly CompatibilityAlias[]
  /** Preferred accepted spelling for human-facing inputs. */
  readonly inputName: string
  /** Stable label shared by CLI, editor, website, MCP, and generated docs. */
  readonly displayLabel: string
  readonly category: 'default' | 'look' | 'theme'
}

export interface StyleReferenceResolution {
  readonly canonicalId: string
  readonly spec: StyleSpec
  readonly diagnostic?: CompatibilityAliasDiagnostic
}

const CORE_STYLE_VERSION = '1.0.0'
const CORE_STYLE_COMPATIBILITY = Object.freeze({ core: '^0.1.1' })
const CORE_STYLE_PROVENANCE = Object.freeze({
  owner: 'agentic-mermaid',
  source: 'built-in',
  reference: 'src/scene/style-registry.ts',
})
const HOST_STYLE_PROVENANCE = Object.freeze({ owner: 'host', source: 'in-process' })

const STYLE_REGISTRY = new Map<string, ExtensionRegistration<InternalStyleSpec, StyleRegistryKind>>()
const STYLE_ALIASES = new Map<string, CompatibilityAlias>()

/** Published compatibility window for the historically ambiguous bare name. */
export const TUFTE_STYLE_ALIAS = Object.freeze({
  alias: 'tufte',
  targetId: 'look:tufte',
  diagnostic: Object.freeze({
    code: 'STYLE_ALIAS_DEPRECATED',
    message: 'Style alias "tufte" resolves to "look:tufte"; use "palette:tufte" for the palette-only style.',
    removal: Object.freeze({ release: '0.3.0', date: '2027-01-31' }),
  }),
}) satisfies CompatibilityAlias

function stripInternalStyle(spec: InternalStyleSpec | undefined): StyleSpec | undefined {
  if (!spec) return undefined
  const { face: _face, displayLabel: _displayLabel, ...publicSpec } = spec
  return {
    ...publicSpec,
    formatVersion: STYLE_SPEC_FORMAT_VERSION,
    ...(publicSpec.colors ? { colors: { ...publicSpec.colors } } : {}),
  }
}

function registryKindOf(spec: StyleSpec): StyleRegistryKind {
  return styleKind(spec) === 'theme' ? 'palette' : 'look'
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
    compatibility: options.compatibility ?? CORE_STYLE_COMPATIBILITY,
    provenance: options.provenance ?? HOST_STYLE_PROVENANCE,
  })
}

function registerCanonicalStyle(
  spec: InternalStyleSpec,
  kind: StyleRegistryKind,
  options: StyleRegistrationOptions,
): void {
  const id = spec.name!
  const stored: InternalStyleSpec = Object.freeze({
    ...spec,
    formatVersion: STYLE_SPEC_FORMAT_VERSION,
    ...(spec.colors ? { colors: Object.freeze({ ...spec.colors }) } : {}),
    ...(spec.face ? { face: Object.freeze({ ...spec.face }) } : {}),
  })
  registerExtension(STYLE_REGISTRY, {
    identity: registrationIdentity(id, kind, options),
    value: stored,
  })
}

/**
 * Register a reusable declarative style. New registrations use an explicit
 * `look:` or `palette:` identity; legacy bare built-in aliases remain inputs
 * but cannot be created by third-party registration.
 */
export function registerStyle(spec: StyleSpec, options: StyleRegistrationOptions = {}): void {
  const problems = validateStyleSpec(spec)
  if (problems.length) throw new Error(`Invalid style spec: ${problems.join('; ')}`)
  if (!spec.name) throw new Error('registerStyle requires a name (anonymous specs are for inline use)')
  const parsed = parseExtensionId(spec.name)
  if (!parsed || (parsed.kind !== 'look' && parsed.kind !== 'palette')) {
    throw new Error(`registerStyle name "${spec.name}" must use the "look:" or "palette:" namespace`)
  }
  const inferred = registryKindOf(spec)
  if (parsed.kind !== inferred) {
    throw new Error(`Style "${spec.name}" is a ${inferred}; its name must use the "${inferred}:" namespace`)
  }
  registerCanonicalStyle(spec, inferred, options)
}

function registerBuiltInStyle(
  spec: InternalStyleSpec,
  kind: StyleRegistryKind = 'look',
  legacyAlias: CompatibilityAlias | string | null = spec.name ?? null,
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
  )
  if (legacyAlias) {
    const alias = typeof legacyAlias === 'string'
      ? { alias: legacyAlias, targetId: canonicalId }
      : legacyAlias
    registerCompatibilityAlias(STYLE_ALIASES, alias)
  }
}

function canonicalStyleId(name: string): { id: string; alias?: CompatibilityAlias } | undefined {
  if (STYLE_REGISTRY.has(name)) return { id: name }
  const alias = STYLE_ALIASES.get(name)
  return alias ? { id: alias.targetId, alias } : undefined
}

/** Resolve a name while retaining compatibility diagnostics for host surfaces. */
export function resolveStyleReference(name: string): StyleReferenceResolution | undefined {
  const resolved = canonicalStyleId(name)
  if (!resolved) return undefined
  const spec = stripInternalStyle(STYLE_REGISTRY.get(resolved.id)?.value)
  if (!spec) return undefined
  return Object.freeze({
    canonicalId: resolved.id,
    spec,
    ...(resolved.alias?.diagnostic ? { diagnostic: resolved.alias.diagnostic } : {}),
  })
}

export function getStyle(name: string): StyleSpec | undefined {
  return resolveStyleReference(name)?.spec
}

function getInternalStyle(name: string): InternalStyleSpec | undefined {
  const resolved = canonicalStyleId(name)
  return resolved ? STYLE_REGISTRY.get(resolved.id)?.value : undefined
}

/** Legacy-compatible names; use knownStyleDescriptors for canonical discovery. */
export function knownStyles(): string[] {
  return knownStyleDescriptors().map(descriptor => descriptor.inputName)
}

export function knownStyleDescriptors(): readonly StyleDescriptor[] {
  return Object.freeze(Array.from(STYLE_REGISTRY.values(), ({ identity, value }) => {
    const aliases = Object.freeze(Array.from(STYLE_ALIASES.values()).filter(alias => alias.targetId === identity.id))
    const inputName = aliases[0]?.alias ?? identity.id
    const localName = identity.id.slice(identity.id.indexOf(':') + 1)
    const displayLabel = value.displayLabel ?? localName
      .split('-')
      .filter(Boolean)
      .map(word => word === 'ops' ? 'OPS' : word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    const category = identity.id === 'look:crisp' ? 'default' : identity.kind === 'palette' ? 'theme' : 'look'
    return Object.freeze({ identity, spec: stripInternalStyle(value)!, aliases, inputName, displayLabel, category })
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

const FACE_KEYS = ['text', 'node', 'edge', 'group'] as const

function mergeFace(left: InternalStyleFace | undefined, right: InternalStyleFace | undefined): InternalStyleFace | undefined {
  if (!left && !right) return undefined
  const merged: InternalStyleFace = { ...left }
  if (!right) return merged
  for (const key of FACE_KEYS) {
    if (right[key] !== undefined) merged[key] = { ...merged[key], ...right[key] } as never
  }
  return merged
}

function assertValidInlineStyle(entry: StyleSpec): void {
  const problems = validateStyleSpec(entry)
  if (problems.length) throw new Error(`Invalid style spec: ${problems.join('; ')}`)
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
      if (entry === 'crisp' || entry === 'default') continue
      const named = getInternalStyle(entry)
      if (!named) throw new Error(`Unknown style "${entry}". Known styles: ${knownStyles().join(', ')}`)
      specs.push(named)
    } else {
      assertValidInlineStyle(entry)
      specs.push(entry)
    }
  }
  if (specs.length === 0) return undefined
  const merged: InternalStyleSpec = { formatVersion: STYLE_SPEC_FORMAT_VERSION }
  for (const spec of specs) {
    for (const [key, value] of Object.entries(spec)) {
      if (value === undefined || key === 'face') continue
      if (key === 'colors') {
        const colors = { ...merged.colors }
        for (const [token, color] of Object.entries(spec.colors ?? {})) {
          if (color !== undefined) (colors as Record<string, string>)[token] = color
        }
        merged.colors = colors
      } else {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
    merged.face = mergeFace(merged.face, spec.face)
  }
  return merged
}

export function resolveStyleStack(input: StyleInput | StyleInput[] | undefined): StyleSpec | undefined {
  return stripInternalStyle(resolveInternalStyleStack(input))
}

/** Private reader for renderer/layout defaults attached to built-in styles. */
export function styleFaceOf(input: StyleInput | StyleInput[] | undefined): InternalStyleFace | undefined {
  const spec = resolveInternalStyleStack(input)
  if (spec === undefined) return undefined
  const width = spec.strokeWidth
  const widthFace: InternalStyleFace | undefined = width !== undefined && width > 0 && inferBackend(spec) === 'default'
    ? { node: { lineWidth: width }, edge: { lineWidth: width }, group: { lineWidth: width } }
    : undefined
  return mergeFace(widthFace, spec.face)
}

/** A palette-only spec is what people call a THEME; anything that also sets
 *  stroke/fill/typography is a full LOOK. One predicate, shared by the CLI's
 *  `am styles` listing and the editor's style picker, so the two surfaces can
 *  never disagree about what counts as a look. */
export function styleKind(spec: StyleSpec): 'look' | 'theme' {
  return Object.keys(spec).every(k => k === 'formatVersion' || k === '$schema' || k === 'name' || k === 'blurb' || k === 'colors') ? 'theme' : 'look'
}

/** True when a merged spec changes anything beyond metadata — i.e. when
 *  rendering must go through the styled scene path. */
export function isStyledSpec(spec: StyleSpec): boolean {
  return inferBackend(spec) !== 'default' || spec.colors !== undefined || spec.font !== undefined
}

// ----------------------------------------------------------------------------
// Themes register as canonical palette:* styles. Existing unqualified names
// remain compatibility inputs. `tufte` is reserved for the historical Look
// mapping, so the formerly shadowed palette is `palette:tufte`.
// ----------------------------------------------------------------------------

// The byte-identical default is a real discoverable descriptor, not a picker-
// local pseudo-style. Stack resolution still treats its aliases as the empty
// treatment so selecting it cannot perturb the historical default path.
registerBuiltInStyle({
  name: 'crisp',
  displayLabel: 'Crisp',
  blurb: 'The byte-identical default renderer with precise SVG geometry.',
  stroke: 'crisp',
})

for (const definition of BUILTIN_PALETTE_DEFINITIONS as readonly BuiltinPaletteDefinition[]) {
  const { legacyName: name, colors: palette } = definition
  if (canonicalExtensionId('palette', name) !== definition.id) {
    throw new Error(`Built-in palette identity mismatch: ${definition.id}`)
  }
  registerBuiltInStyle({
    name,
    displayLabel: definition.displayLabel,
    blurb: `Palette: ${name} (theme).`,
    colors: {
      bg: palette.bg,
      fg: palette.fg,
      line: palette.line,
      accent: palette.accent,
      muted: palette.muted,
      surface: palette.surface,
      border: palette.border,
    },
  }, 'palette', name === 'tufte' ? null : name)
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
  face: {
    node: { lineWidth: 0.8, cornerRadius: 0 },
    edge: { lineWidth: 0.8 },
    group: { lineWidth: 0.8 },
  },
  mono: true,
}, 'look', TUFTE_STYLE_ALIAS)

registerBuiltInStyle({
  name: 'accessible-high-contrast',
  displayLabel: 'Accessible Contrast',
  blurb: 'Accessibility-first: large labels, heavy strokes, white ground, colorblind-safe blue accent.',
  intent: 'premium',
  colors: { bg: '#ffffff', fg: '#050505', line: '#111111', accent: '#005fcc', muted: '#333333', surface: '#ffffff', border: '#050505' },
  face: {
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
  face: {
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
  face: {
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
  face: {
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
  face: {
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
  face: {
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
  face: {
    node: { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', textColor: 'var(--fg)', paddingX: 20, paddingY: 10, cornerRadius: 0, lineWidth: 1.45, borderColor: 'var(--fg)' },
    edge: { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', textColor: 'var(--fg)', lineWidth: 1.55, bendRadius: 0, strokeColor: 'var(--fg)' },
    group: { fontSize: 11, fontWeight: 700, textColor: 'var(--fg)', textTransform: 'uppercase', letterSpacing: 0.06, paddingX: 20, paddingY: 20, cornerRadius: 0, lineWidth: 1.45, borderColor: 'var(--fg)' },
  },
})

registerBuiltInStyle({
  name: 'cupertino',
  displayLabel: 'Cupertino',
  blurb: 'Apple-HIG product surface for app and system docs: borderless white cards on a grouped gray page, hierarchy from surface and weight; light-first.',
  intent: 'premium',
  // Apple grouped-surface tokens (HIG "Materials"/"Color"), gate-adjusted:
  // bg = systemGroupedBackground, surface = systemBackground (pure white is
  // the sourced token — cards read as elevation only because the page is
  // tinted), fg = label, border = separator. line/muted start from systemGray
  // (#8e8e93) and secondaryLabel but are darkened to clear this repo's
  // legibility gates (3:1 strokes, 4.5:1 text) — HIG's own grays measure
  // 2.7-2.9:1 here; the deviation is deliberate and documented.
  colors: { bg: '#f2f2f7', fg: '#000000', line: '#7a7a80', accent: '#007aff', muted: '#66666b', surface: '#ffffff', border: 'rgba(60,60,67,0.29)' },
  // Inter, not SF Pro — SF's license restricts it to Apple platforms; Inter
  // is the bundled PNG-safe stand-in. Do not substitute.
  font: 'Inter',
  face: {
    // Typography ("The Details of UI Typography", WWDC 2020): hierarchy from
    // weight + size as a set; tracking is size-specific — 13px labels at 0,
    // 11px edge labels get SF's small-size bump (~+6/1000em ≈ 0.07px).
    // Borderless cards: separation comes from surface fill + elevation, so
    // borderColor is transparent and the fill falls back to the derived node
    // fill when a stacked palette drops --surface.
    node: { fontSize: 13, fontWeight: 600, letterSpacing: 0, textColor: 'var(--fg)', paddingX: 24, paddingY: 12, cornerRadius: 10, lineWidth: 1, fillColor: 'var(--surface, var(--_node-fill))', borderColor: 'transparent' },
    edge: { fontSize: 11, fontWeight: 500, letterSpacing: 0.07, lineWidth: 1.5, bendRadius: 16, strokeColor: 'var(--line, var(--_line))', textColor: 'var(--fg)' },
    // Materials ("Designing Fluid Interfaces", WWDC 2018): material weight
    // encodes hierarchy — groups are quaternary-fill surfaces (alpha, so they
    // survive palette stacking), header bands one step heavier, no borders;
    // grouping reads from proximity, never from 1px dividers. Corner
    // concentricity: group radius 26 = node radius 10 + padding 16.
    group: { fontSize: 12, fontWeight: 600, letterSpacing: 0, textColor: 'var(--muted, var(--_text-sec))', paddingX: 16, paddingY: 16, cornerRadius: 26, lineWidth: 1, fillColor: 'rgba(120,120,128,0.08)', headerFillColor: 'rgba(120,120,128,0.12)', borderColor: 'transparent' },
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
  face: {
    node: { fontSize: 15, fontWeight: 700, textColor: 'var(--fg)', paddingX: 26, paddingY: 14, cornerRadius: 7, lineWidth: 1.45, borderColor: 'var(--fg)' },
    edge: { fontSize: 12, fontWeight: 600, textColor: 'var(--fg)', lineWidth: 1.45, bendRadius: 8, strokeColor: 'var(--fg)' },
    group: { fontSize: 12, fontWeight: 700, textColor: 'var(--fg)', textTransform: 'uppercase', letterSpacing: 0.08, paddingX: 24, paddingY: 22, cornerRadius: 7, lineWidth: 1.35, borderColor: 'var(--fg)' },
  },
})
