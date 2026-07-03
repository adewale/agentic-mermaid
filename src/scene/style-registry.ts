// ============================================================================
// Style registry — ONE primitive for "how should this diagram look".
//
// A style is a PARTIAL description: every field is optional. A style that
// only sets colors is what people call a theme (the THEMES palettes register
// here as exactly that). A style that only sets node.cornerRadius is a
// tweak. A style that sets stroke character, fills, typography, and a
// palette is a full look. Styles compose by STACKING (resolveStyleStack):
// RenderOptions.style accepts a name, a spec, or an array of either, merged
// left → right per field — so "hand-drawn × dracula" is just
// ['hand-drawn', 'dracula'].
//
// Authors never pick a backend: the engine infers it from what the style
// asks for (inferBackend). Registered once, a style applies to every diagram
// family that lowers to the SceneGraph — N styles + M families, never N×M.
// 'crisp' (or unset) is the byte-identical default path.
// ============================================================================

import type { DiagramStyleOptions } from '../types.ts'
import { THEMES } from '../theme.ts'

/** A partial, composable description of how diagrams look. Extends the role
 *  overrides (text/node/edge/group), so a role-only object IS a valid style. */
export interface StyleSpec extends DiagramStyleOptions {
  // identity — optional; anonymous inline styles are fine
  name?: string
  blurb?: string

  /** Palette — the seven tokens every mark references. A colors-only style
   *  is a theme. User themeVariables/color options still win over these. */
  colors?: { bg?: string; fg?: string; line?: string; accent?: string; muted?: string; surface?: string; border?: string }
  /** Font family default (threaded through the --font CSS variable). PNG
   *  export needs the family bundled or resolvable by the rasterizer. */
  font?: string

  // Mark treatment (what the sketch backends read).
  /** Stroke rendering: 'crisp' (default), 'jittered' rough.js strokes, or
   *  'freehand' pressure-ribbon strokes. */
  stroke?: 'crisp' | 'jittered' | 'freehand'
  roughness?: number
  bowing?: number
  /** 1 = single stroke (disableMultiStroke), 2 = sketchy double stroke. */
  passes?: number
  strokeWidth?: number
  fill?: 'none' | 'hachure' | 'solid' | 'wash'
  hachureAngle?: number
  hachureGap?: number
  fillWeight?: number
  /** Wash fill glaze opacity / edge-darkening opacity (fill: 'wash'). */
  washOpacity?: number
  washEdge?: number
  /** Flat page furniture drawn right after the document prelude. */
  backdrop?: 'plain' | 'paper-ruled' | 'grid'

  /** Expert override only — normally inferred by inferBackend(). */
  backend?: 'default' | 'rough' | 'hybrid'

  // Advisory metadata — documented, never read by the engine.
  intent?: 'premium' | 'draft' | 'lofi'
  /** §3.8 monochrome contract: tone via shading/weight, never extra hues. */
  mono?: boolean
}

/** What RenderOptions.style accepts: a registered name, an inline spec, or a
 *  stack of either (merged left → right). */
export type StyleInput = string | StyleSpec

const STYLE_REGISTRY = new Map<string, StyleSpec>()

export function registerStyle(spec: StyleSpec): void {
  if (!spec.name) throw new Error('registerStyle requires a name (anonymous specs are for inline use)')
  STYLE_REGISTRY.set(spec.name, spec)
}

export function getStyle(name: string): StyleSpec | undefined {
  return STYLE_REGISTRY.get(name)
}

export function knownStyles(): string[] {
  return ['crisp', ...STYLE_REGISTRY.keys()]
}

/** Which backend a style needs, derived from what it asks for — authors
 *  describe the look, the engine picks the machinery. */
export function inferBackend(spec: StyleSpec): 'default' | 'rough' | 'hybrid' {
  if (spec.backend) return spec.backend
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

const ROLE_KEYS = ['text', 'node', 'edge', 'group'] as const

/** Merge a stack of styles left → right: later fields win; colors merge per
 *  channel; role overrides merge per field within each role. Names resolve
 *  through the registry; unknown names throw with the known list (fail loud —
 *  a silently-crisp fallback would erode trust in style coverage). */
export function resolveStyleStack(input: StyleInput | StyleInput[] | undefined): StyleSpec | undefined {
  if (input === undefined) return undefined
  const stack = Array.isArray(input) ? input : [input]
  const specs: StyleSpec[] = []
  for (const entry of stack) {
    if (typeof entry === 'string') {
      if (entry === 'crisp' || entry === 'default') continue
      const named = getStyle(entry)
      if (!named) throw new Error(`Unknown style "${entry}". Known styles: ${knownStyles().join(', ')}`)
      specs.push(named)
    } else {
      specs.push(entry)
    }
  }
  if (specs.length === 0) return undefined
  const merged: StyleSpec = {}
  for (const spec of specs) {
    for (const [key, value] of Object.entries(spec)) {
      if (value === undefined) continue
      if (key === 'colors') {
        merged.colors = { ...merged.colors, ...spec.colors }
      } else if ((ROLE_KEYS as readonly string[]).includes(key)) {
        const role = key as (typeof ROLE_KEYS)[number]
        merged[role] = { ...merged[role], ...spec[role] } as never
      } else {
        ;(merged as Record<string, unknown>)[key] = value
      }
    }
  }
  return merged
}

/** Normalize any style input to its role overrides (text/node/edge/group).
 *  The common case — an already-merged spec or a bare role object — passes
 *  through without re-resolving; names and stacks resolve via the registry.
 *  This is the single reader used by resolveRenderStyle and family layouts. */
export function styleRolesOf(input: StyleInput | StyleInput[] | undefined): DiagramStyleOptions | undefined {
  if (input === undefined) return undefined
  const spec = typeof input !== 'string' && !Array.isArray(input) ? input : resolveStyleStack(input)
  return spec === undefined ? undefined : withDefaultBackendStrokeWidth(spec)
}

/** On the default backend, `strokeWidth` seeds the role line widths so the
 *  knob works on every backend (sketch backends read it directly; without
 *  this it would be silently inert on crisp output). Explicit role widths
 *  win. Sketch paths pass through untouched — their crisp underlay must not
 *  double-scale what the backend already applies via strokeWidth. */
function withDefaultBackendStrokeWidth(spec: StyleSpec): DiagramStyleOptions {
  const width = spec.strokeWidth
  if (width === undefined || !(width > 0) || inferBackend(spec) !== 'default') return spec
  return {
    ...spec,
    node: { lineWidth: width, ...spec.node },
    edge: { lineWidth: width, ...spec.edge },
    group: { lineWidth: width, ...spec.group },
  }
}

/** A palette-only spec is what people call a THEME; anything that also sets
 *  stroke/fill/typography/roles is a full LOOK. One predicate, shared by the
 *  CLI's `am styles` listing and the editor's style picker, so the two
 *  surfaces can never disagree about what counts as a look. */
export function styleKind(spec: StyleSpec): 'look' | 'theme' {
  return Object.keys(spec).every(k => k === 'name' || k === 'blurb' || k === 'colors') ? 'theme' : 'look'
}

/** True when a merged spec changes anything beyond role overrides/metadata —
 *  i.e. when rendering must go through the styled scene path. Role-only
 *  specs stay on the crisp path (byte-identical to previous releases). */
export function isStyledSpec(spec: StyleSpec): boolean {
  return inferBackend(spec) !== 'default' || spec.colors !== undefined || spec.font !== undefined
}

const KNOWN_KEYS = new Set([
  'name', 'blurb', 'colors', 'font',
  'stroke', 'roughness', 'bowing', 'passes', 'strokeWidth',
  'fill', 'hachureAngle', 'hachureGap', 'fillWeight', 'washOpacity', 'washEdge',
  'backdrop', 'backend', 'intent', 'mono',
  'text', 'node', 'edge', 'group',
])

/** Validate an untrusted (e.g. JSON) style record. Returns human-readable
 *  problems; [] means the record is a usable StyleSpec. Declarative-only by
 *  construction — there is no field that can carry markup or URLs. */
export function validateStyleSpec(value: unknown): string[] {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['style spec must be a plain object']
  }
  const spec = value as Record<string, unknown>
  for (const key of Object.keys(spec)) {
    if (!KNOWN_KEYS.has(key)) problems.push(`unknown field "${key}"`)
  }
  const str = (k: string) => spec[k] === undefined || typeof spec[k] === 'string' || problems.push(`"${k}" must be a string`)
  const num = (k: string) => spec[k] === undefined || (typeof spec[k] === 'number' && Number.isFinite(spec[k] as number)) || problems.push(`"${k}" must be a finite number`)
  const oneOf = (k: string, allowed: string[]) =>
    spec[k] === undefined || (typeof spec[k] === 'string' && allowed.includes(spec[k] as string)) || problems.push(`"${k}" must be one of ${allowed.join(' | ')}`)
  str('name'); str('blurb'); str('font')
  num('roughness'); num('bowing'); num('passes'); num('strokeWidth')
  num('hachureAngle'); num('hachureGap'); num('fillWeight'); num('washOpacity'); num('washEdge')
  oneOf('stroke', ['crisp', 'jittered', 'freehand'])
  oneOf('fill', ['none', 'hachure', 'solid', 'wash'])
  oneOf('backdrop', ['plain', 'paper-ruled', 'grid'])
  oneOf('backend', ['default', 'rough', 'hybrid'])
  oneOf('intent', ['premium', 'draft', 'lofi'])
  if (spec.mono !== undefined && typeof spec.mono !== 'boolean') problems.push('"mono" must be a boolean')
  if (spec.colors !== undefined) {
    if (typeof spec.colors !== 'object' || spec.colors === null || Array.isArray(spec.colors)) {
      problems.push('"colors" must be an object of color tokens')
    } else {
      for (const [token, color] of Object.entries(spec.colors as Record<string, unknown>)) {
        if (!['bg', 'fg', 'line', 'accent', 'muted', 'surface', 'border'].includes(token)) problems.push(`unknown color token "${token}"`)
        else if (typeof color !== 'string') problems.push(`color token "${token}" must be a string`)
      }
    }
  }
  return problems
}

// ----------------------------------------------------------------------------
// Themes register as palette-only styles: every THEMES entry is addressable
// wherever a style name is accepted ('dracula', 'nord', 'zinc-dark', …).
// Built-in full looks register AFTER, so a shared name ('tufte') resolves to
// the full look; the bare palette stays reachable via explicit colors.
// ----------------------------------------------------------------------------

for (const [name, palette] of Object.entries(THEMES)) {
  registerStyle({
    name,
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
  })
}

// ----------------------------------------------------------------------------
// Built-in full looks. Parameters were converged in the prototype
// (scripts/sketch-prototype); backends are inferred, never declared.
// ----------------------------------------------------------------------------

registerStyle({
  name: 'hand-drawn',
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

registerStyle({
  name: 'excalidraw',
  blurb: 'Virtual whiteboard look — rough strokes, pastel hachure fills.',
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

registerStyle({
  name: 'pen-and-ink',
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

registerStyle({
  name: 'freehand',
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

registerStyle({
  name: 'watercolor',
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

registerStyle({
  name: 'blueprint',
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

registerStyle({
  name: 'tufte',
  blurb: 'Maximal data-ink: crisp hairlines, warm paper, one red accent.',
  intent: 'premium',
  colors: { bg: '#fffff8', fg: '#111111', line: '#4a4a45', accent: '#a00000', muted: '#6b6b64', border: '#8a8a80' },
  font: 'EB Garamond',
  node: { lineWidth: 0.8, cornerRadius: 0 },
  edge: { lineWidth: 0.8 },
  group: { lineWidth: 0.8 },
  mono: true,
})
