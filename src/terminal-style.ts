// ============================================================================
// ResolvedAppearance -> terminal projection.
//
// Terminal output preserves semantic roles and hierarchy, but cannot promise
// pixel parity for radius, typography, elevation, or sketch character. Those
// losses are explicit diagnostics attached to the projection receipt.
// ============================================================================

import type { AsciiTheme, ColorMode } from './ascii/types.ts'
import { diagramColorsToAsciiTheme } from './ascii/ansi.ts'
import type { DiagramColors } from './theme.ts'
import type { ResolvedRenderRequest } from './render-contract.ts'
import { renderContractDigest, SHARED_RENDER_OPTION_FIELD_DESCRIPTORS } from './render-contract.ts'
import { safeCssColor } from './shared/css-color.ts'
import { toHex, tryParseCssColor } from './shared/color-math.ts'
import { sanitizeTerminalText } from './terminal-security.ts'
import type {
  ConnectorMark,
  ConnectorTerminalProjection,
  SceneDoc,
  SceneNode,
  SceneRole,
} from './scene/ir.ts'
import { terminalConnectorCapabilityClaims } from './scene/capabilities.ts'
import type { PrimitiveCapabilityClaim } from './scene/capabilities.ts'

export const TERMINAL_STYLE_VERSION = 1 as const

export type TerminalProjectionDiagnosticCode =
  | 'TERMINAL_RADIUS_PROJECTED'
  | 'TERMINAL_TYPOGRAPHY_PROJECTED'
  | 'TERMINAL_ELEVATION_PROJECTED'
  | 'TERMINAL_STROKE_CHARACTER_PROJECTED'
  | 'TERMINAL_FILL_PROJECTED'
  | 'TERMINAL_ROLE_PAINT_PROJECTED'
  | 'TERMINAL_RENDER_OPTION_PROJECTED'
  | 'TERMINAL_RENDER_OPTION_NOT_APPLICABLE'
  | 'TERMINAL_UNSAFE_COLOR_REJECTED'
  | 'TERMINAL_COLOR_UNREPRESENTABLE'
  | 'TERMINAL_CONNECTOR_PROJECTED'
  | 'TERMINAL_CONNECTOR_UNSUPPORTED'
  | 'TERMINAL_CONNECTOR_DECLARED_LIMITATION'
  | 'TERMINAL_CONNECTOR_PROJECTION_UNAVAILABLE'
  | 'TERMINAL_CONTROL_CHARACTERS_REPLACED'

export interface TerminalProjectionDiagnostic {
  code: TerminalProjectionDiagnosticCode
  feature: string
  message: string
}

export interface ResolvedTerminalStyle {
  readonly version: typeof TERMINAL_STYLE_VERSION
  readonly colorMode: ColorMode
  readonly theme: Readonly<AsciiTheme>
  readonly diagnostics: readonly TerminalProjectionDiagnostic[]
  /** No-color keeps categories/status through labels, glyphs and line styles. */
  readonly semanticFallbacks: readonly ['labels', 'symbols', 'markers', 'line-patterns']
  readonly connectorProjection: TerminalConnectorProjectionReceipt
  readonly digest: string
}

export interface TerminalConnectorProjectionReceipt {
  readonly evidence: 'scene' | 'unavailable' | 'not-evaluated'
  readonly count: number
  readonly topologies: Readonly<Record<'line' | 'polyline' | 'path', number>>
  readonly realizations: Readonly<Record<string, number>>
  readonly relationships: readonly string[]
  readonly directions: readonly ConnectorMark['relationship']['direction'][]
  readonly markerPositions: Readonly<{ start: number; mid: number; end: number }>
  readonly labelCount: number
  /** Typed semantic projection supplied to the family terminal renderer. */
  readonly connectors: readonly TerminalConnectorProjection[]
  readonly capabilities: readonly PrimitiveCapabilityClaim[]
  readonly digest: string
}

export interface TerminalConnectorProjection extends ConnectorTerminalProjection {
  readonly id: string
  readonly role: SceneRole
}

export interface TerminalProjectionSecurityContext {
  /** User-derived C0/C1 controls replaced before terminal layout/emission. */
  readonly controlsReplaced?: boolean
  /** Optional graphical connector projection failed; terminal rendering remains independent. */
  readonly connectorProjectionFailed?: boolean
}

function hasPositive(...values: Array<number | undefined>): boolean {
  return values.some(value => typeof value === 'number' && value > 0)
}

export function projectTerminalStyle(
  request: ResolvedRenderRequest,
  colorMode: ColorMode,
  override: Partial<AsciiTheme> = {},
  connectorScene?: SceneDoc | null,
  security: TerminalProjectionSecurityContext = {},
): ResolvedTerminalStyle {
  const diagnostics: TerminalProjectionDiagnostic[] = []
  if (security.controlsReplaced) reportTerminalControlReplacement(diagnostics)
  const appearance = request.appearance
  // Graphical resolution drops unsafe Mermaid theme paints before they enter
  // the shared appearance. Retain the rejection evidence at the terminal
  // projection boundary without putting unsafe values back into that shared
  // appearance or making its digest output-dependent.
  for (const key of appearance.unsafeThemeColorKeys ?? []) {
    diagnostics.push({
      code: 'TERMINAL_UNSAFE_COLOR_REJECTED',
      feature: `mermaid-theme.${key}`,
      message: `Mermaid theme variable "${key}" was rejected because it is not a safe non-fetching CSS color.`,
    })
  }
  for (const field of request.explicitOptionFields) {
    const descriptor = SHARED_RENDER_OPTION_FIELD_DESCRIPTORS[field]
    if (descriptor.terminal === 'consumed') continue
    const notApplicable = descriptor.terminal === 'not-applicable'
    diagnostics.push({
      code: notApplicable ? 'TERMINAL_RENDER_OPTION_NOT_APPLICABLE' : 'TERMINAL_RENDER_OPTION_PROJECTED',
      feature: `render-option:${field}`,
      message: `Render option "${field}" ${notApplicable ? 'does not apply to' : 'is projected for'} terminal output: ${descriptor.terminalNote ?? 'the terminal adapter has no pixel-equivalent representation'}.`,
    })
  }
  const face = appearance.face
  if (hasPositive(face?.node?.cornerRadius, face?.group?.cornerRadius, face?.edge?.bendRadius)) {
    diagnostics.push({
      code: 'TERMINAL_RADIUS_PROJECTED',
      feature: 'corner-and-bend-radius',
      message: 'Terminal cells cannot represent continuous corner or connector bend radius; topology is preserved with box/line glyphs.',
    })
  }
  const typographyFaces = [face?.text, face?.node, face?.edge, face?.group]
  if (
    appearance.font !== 'Inter' ||
    face?.group?.fontFamily !== undefined ||
    typographyFaces.some(value => value?.fontSize !== undefined || value?.fontWeight !== undefined || value?.letterSpacing !== undefined || value?.textTransform !== undefined)
  ) {
    diagnostics.push({
      code: 'TERMINAL_TYPOGRAPHY_PROJECTED',
      feature: 'typography',
      message: 'Terminal output preserves text, hierarchy and emphasis but projects font family, size, weight and tracking to terminal cells.',
    })
  }
  const faceSurfacePaint = face?.node?.fillColor !== undefined
    || face?.group?.fillColor !== undefined
    || face?.group?.headerFillColor !== undefined
  const faceRolePaint = face?.text?.textColor !== undefined
    || face?.node?.textColor !== undefined || face?.node?.borderColor !== undefined
    || face?.edge?.textColor !== undefined || face?.edge?.strokeColor !== undefined
    || face?.group?.textColor !== undefined || face?.group?.borderColor !== undefined
  if (appearance.colors.shadow === true || faceSurfacePaint) {
    diagnostics.push({
      code: 'TERMINAL_ELEVATION_PROJECTED',
      feature: 'elevation',
      message: 'Terminal output does not render graphical shadow or layered surface elevation; grouping remains explicit in borders and labels.',
    })
  }
  if (appearance.style?.stroke && appearance.style.stroke !== 'crisp') {
    diagnostics.push({
      code: 'TERMINAL_STROKE_CHARACTER_PROJECTED',
      feature: 'stroke-character',
      message: 'Jittered/freehand stroke character projects to deterministic terminal line patterns.',
    })
  }
  if (appearance.style?.fill && appearance.style.fill !== 'none' && appearance.style.fill !== 'solid') {
    diagnostics.push({
      code: 'TERMINAL_FILL_PROJECTED',
      feature: 'fill-treatment',
      message: 'Graphical fill texture projects to category/status labels and terminal symbols.',
    })
  }
  if (faceSurfacePaint) {
    diagnostics.push({
      code: 'TERMINAL_FILL_PROJECTED',
      feature: 'role-surface-fill',
      message: 'Per-role node, group, and header surface fills project to terminal labels, symbols, and borders.',
    })
  }
  if (faceRolePaint) {
    diagnostics.push({
      code: 'TERMINAL_ROLE_PAINT_PROJECTED',
      feature: 'role-paint',
      message: 'Per-role text, border, and connector paints project through the smaller terminal theme palette.',
    })
  }
  // Normalize every public color source before terminal math or HTML emission.
  // This is the projection boundary: invalid/fetching CSS is rejected with a
  // stable diagnostic and replaced, while concrete safe CSS is canonicalized
  // to a deterministic sRGB hex token shared by ANSI and HTML modes.
  const fallbackColors: DiagramColors = {
    bg: '#ffffff',
    fg: '#27272a',
    line: '#71717a',
    accent: '#52525b',
    muted: '#71717a',
    surface: '#ffffff',
    border: '#a1a1aa',
  }
  const normalize = (value: unknown, fallback: string, feature: string): string => {
    const safe = safeCssColor(value)
    const parsed = safe ? tryParseCssColor(safe) : null
    if (parsed) return toHex(parsed[0], parsed[1], parsed[2])
    diagnostics.push({
      code: safe ? 'TERMINAL_COLOR_UNREPRESENTABLE' : 'TERMINAL_UNSAFE_COLOR_REJECTED',
      feature,
      message: safe
        ? `Color ${feature} is safe CSS but cannot be resolved to terminal sRGB; fallback ${fallback} was used.`
        : `Color ${feature} was rejected because it is not a safe non-fetching CSS color; fallback ${fallback} was used.`,
    })
    return fallback
  }
  const rawColors = appearance.colors
  const colors: DiagramColors = {
    ...rawColors,
    bg: normalize(rawColors.bg, fallbackColors.bg, 'appearance.bg'),
    fg: normalize(rawColors.fg, fallbackColors.fg, 'appearance.fg'),
    ...(rawColors.line === undefined ? {} : { line: normalize(rawColors.line, fallbackColors.line!, 'appearance.line') }),
    ...(rawColors.accent === undefined ? {} : { accent: normalize(rawColors.accent, fallbackColors.accent!, 'appearance.accent') }),
    ...(rawColors.muted === undefined ? {} : { muted: normalize(rawColors.muted, fallbackColors.muted!, 'appearance.muted') }),
    ...(rawColors.surface === undefined ? {} : { surface: normalize(rawColors.surface, fallbackColors.surface!, 'appearance.surface') }),
    ...(rawColors.border === undefined ? {} : { border: normalize(rawColors.border, fallbackColors.border!, 'appearance.border') }),
  }
  const projected = diagramColorsToAsciiTheme(colors)
  const themeFields = ['fg', 'border', 'line', 'arrow', 'accent', 'bg', 'corner', 'junction'] as const
  for (const field of themeFields) {
    const value = override[field]
    if (value === undefined) continue
    const fallback = projected[field] ?? fallbackColors.fg
    projected[field] = normalize(value, fallback, `terminal-theme.${field}`)
  }
  const theme = Object.freeze(projected)
  const connectorProjection = projectConnectorScene(
    connectorScene,
    diagnostics,
    security.connectorProjectionFailed === true,
  )
  const semanticFallbacks = ['labels', 'symbols', 'markers', 'line-patterns'] as const
  const receipt = { version: TERMINAL_STYLE_VERSION, colorMode, theme, diagnostics, semanticFallbacks, connectorProjection }
  return Object.freeze({ ...receipt, diagnostics: Object.freeze(diagnostics), digest: renderContractDigest(receipt) })
}

function reportTerminalControlReplacement(diagnostics: TerminalProjectionDiagnostic[]): void {
  if (diagnostics.some(diagnostic => diagnostic.code === 'TERMINAL_CONTROL_CHARACTERS_REPLACED')) return
  diagnostics.push({
    code: 'TERMINAL_CONTROL_CHARACTERS_REPLACED',
    feature: 'terminal-text',
    message: 'User-derived C0/C1 terminal control characters were replaced with inert single-cell text before layout and color projection.',
  })
}

function connectorMarks(nodes: readonly SceneNode[]): ConnectorMark[] {
  const result: ConnectorMark[] = []
  for (const node of nodes) {
    if (node.kind === 'connector') result.push(node)
    else if (node.kind === 'group') result.push(...connectorMarks(node.children.map(child => child.node)))
  }
  return result
}

function projectConnectorScene(
  scene: SceneDoc | null | undefined,
  diagnostics: TerminalProjectionDiagnostic[],
  projectionFailed = false,
): TerminalConnectorProjectionReceipt {
  const connectors = scene ? connectorMarks(scene.parts) : []
  const topologies = { line: 0, polyline: 0, path: 0 }
  const realizations: Record<string, number> = {}
  const relationships = new Set<string>()
  const directions = new Set<ConnectorMark['relationship']['direction']>()
  const markerPositions = { start: 0, mid: 0, end: 0 }
  let labelCount = 0
  const projectedConnectors: TerminalConnectorProjection[] = []
  const signatures = new Map<string, { realization: ConnectorMark['terminalProjection']['realization']; topology: ConnectorMark['terminalProjection']['topology']; count: number }>()
  let connectorControlsReplaced = false
  const clean = (value: string): string => {
    const sanitized = sanitizeTerminalText(value)
    if (sanitized !== value) connectorControlsReplaced = true
    return sanitized
  }
  const cleanProjectionValue = (value: unknown): unknown => {
    if (typeof value === 'string') return clean(value)
    if (Array.isArray(value)) return Object.freeze(value.map(cleanProjectionValue))
    if (value === null || typeof value !== 'object') return value
    const entries = Object.entries(value).map(([key, child]) => [key, cleanProjectionValue(child)] as const)
    return Object.freeze(Object.fromEntries(entries))
  }
  for (const connector of connectors) {
    const projection = connector.terminalProjection
    const projected: TerminalConnectorProjection = Object.freeze({
      id: clean(connector.id),
      role: connector.role,
      ...(cleanProjectionValue(projection) as ConnectorMark['terminalProjection']),
    })
    projectedConnectors.push(projected)
    topologies[projection.topology]++
    realizations[projection.realization] = (realizations[projection.realization] ?? 0) + 1
    relationships.add(clean(connector.relationship.kind))
    directions.add(connector.relationship.direction)
    markerPositions.start += projection.markerPlacements.start.length
    markerPositions.mid += projection.markerPlacements.mid.length
    markerPositions.end += projection.markerPlacements.end.length
    labelCount += projection.labels.length
    const key = `${projection.realization}:${projection.topology}`
    const current = signatures.get(key)
    if (current) current.count++
    else signatures.set(key, { realization: projection.realization, topology: projection.topology, count: 1 })
    for (const limitation of projection.diagnostics) {
      diagnostics.push({
        code: 'TERMINAL_CONNECTOR_DECLARED_LIMITATION',
        feature: `connector:${clean(connector.id ?? connector.relationship.kind)}`,
        message: clean(limitation),
      })
    }
  }
  if (connectorControlsReplaced) reportTerminalControlReplacement(diagnostics)
  if (scene === null) {
    diagnostics.push({
      code: 'TERMINAL_CONNECTOR_PROJECTION_UNAVAILABLE',
      feature: 'connectors',
      message: projectionFailed
        ? 'Optional Scene connector projection failed; native terminal rendering continued independently.'
        : 'The family renders terminal output but exposes no Scene connector projection evidence.',
    })
  }
  for (const signature of [...signatures.values()].sort((left, right) =>
    `${left.realization}:${left.topology}`.localeCompare(`${right.realization}:${right.topology}`))) {
    if (signature.realization === 'native') continue
    const unsupported = signature.realization === 'unsupported'
    diagnostics.push({
      code: unsupported ? 'TERMINAL_CONNECTOR_UNSUPPORTED' : 'TERMINAL_CONNECTOR_PROJECTED',
      feature: `connectors:${signature.topology}`,
      message: `${signature.count} ${signature.topology} connector${signature.count === 1 ? '' : 's'} declare ${signature.realization} terminal realization; their typed semantics are supplied to the terminal adapter and receipt.`,
    })
  }
  const body = {
    evidence: scene === undefined ? 'not-evaluated' as const : scene === null ? 'unavailable' as const : 'scene' as const,
    count: connectors.length,
    topologies: Object.freeze(topologies),
    realizations: Object.freeze(realizations),
    relationships: Object.freeze([...relationships].sort()),
    directions: Object.freeze([...directions].sort()),
    markerPositions: Object.freeze(markerPositions),
    labelCount,
    connectors: Object.freeze(projectedConnectors),
    capabilities: terminalConnectorCapabilityClaims(),
  }
  return Object.freeze({ ...body, digest: renderContractDigest(body) })
}
