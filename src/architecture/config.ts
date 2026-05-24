import type { DiagramColors } from '../theme.ts'
import type { MermaidFrontmatterMap, MermaidConfigValue } from '../mermaid-source.ts'
import type { RenderOptions } from '../types.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'

export interface ArchitectureVisualConfig {
  groupHeaderHeight: number
  groupFontSize: number
  groupFontWeight: number
  groupLetterSpacing: number
  groupFont?: string
  groupTextTransform?: 'uppercase' | 'lowercase' | 'capitalize'
  groupPaddingX: number
  groupPaddingY: number
  groupLabelPaddingX: number
  groupCornerRadius: number
  groupLineWidth: number
  serviceFontSize: number
  serviceFontWeight: number
  serviceLetterSpacing: number
  servicePaddingX: number
  servicePaddingY: number
  serviceCornerRadius: number
  serviceLineWidth: number
  edgeFontSize: number
  edgeFontWeight: number
  edgeLetterSpacing: number
  edgeLineWidth: number
  edgeBendRadius: number
  iconSize: number
  serviceIconSize: number
  junctionOuterRadius: number
  junctionInnerRadius: number
  groupSurface?: string
  groupBorder?: string
  serviceSurface?: string
  serviceBorder?: string
}

export interface ResolvedArchitectureVisualConfig {
  visual: ArchitectureVisualConfig
  padding?: number
}

export const DEFAULT_ARCHITECTURE_VISUAL: ArchitectureVisualConfig = {
  groupHeaderHeight: 28,
  groupFontSize: 12,
  groupFontWeight: 600,
  groupLetterSpacing: 0,
  groupPaddingX: 16,
  groupPaddingY: 16,
  groupLabelPaddingX: 12,
  groupCornerRadius: 0,
  groupLineWidth: 1,
  serviceFontSize: 13,
  serviceFontWeight: 500,
  serviceLetterSpacing: 0,
  servicePaddingX: 20,
  servicePaddingY: 10,
  serviceCornerRadius: 0,
  serviceLineWidth: 1,
  edgeFontSize: 11,
  edgeFontWeight: 400,
  edgeLetterSpacing: 0,
  edgeLineWidth: 1,
  edgeBendRadius: 0,
  iconSize: 16,
  serviceIconSize: 18,
  junctionOuterRadius: 8,
  junctionInnerRadius: 4.5,
}

/**
 * Resolve architecture-specific visual metrics from Mermaid frontmatter.
 *
 * Color resolution is handled by the shared `buildColors()` in src/index.ts.
 * This function only computes layout metrics (font sizes, icon sizes, junction
 * radii) and architecture-specific surface/border overrides (clusterBkg, etc.).
 */
export function resolveArchitectureVisualConfig(
  mermaidConfig: MermaidFrontmatterMap,
  colors: DiagramColors,
  options: RenderOptions = {},
): ResolvedArchitectureVisualConfig {
  const themeVariables = getMap(mermaidConfig, 'themeVariables')
  const architecture = getMap(mermaidConfig, 'architecture')

  const baseFontSize = clamp(
    getNumber(architecture, 'fontSize')
      ?? getNumber(mermaidConfig, 'fontSize')
      ?? getNumber(themeVariables, 'fontSize')
      ?? DEFAULT_ARCHITECTURE_VISUAL.serviceFontSize,
    10,
    24,
  )

  const serviceIconSize = clamp(
    getNumber(architecture, 'iconSize') ?? DEFAULT_ARCHITECTURE_VISUAL.serviceIconSize,
    12,
    40,
  )

  const iconSize = clamp(Math.round(serviceIconSize * (DEFAULT_ARCHITECTURE_VISUAL.iconSize / DEFAULT_ARCHITECTURE_VISUAL.serviceIconSize)), 10, 36)
  const groupFontSize = clamp(Math.round(baseFontSize * 0.92), 10, 22)
  const edgeFontSize = clamp(Math.round(baseFontSize * 0.85), 10, 20)
  const groupHeaderHeight = Math.max(
    DEFAULT_ARCHITECTURE_VISUAL.groupHeaderHeight,
    Math.round(Math.max(groupFontSize, iconSize) + 12),
  )
  const junctionOuterRadius = clamp(Math.round(serviceIconSize * 0.44), 8, 18)
  const junctionInnerRadius = Number((junctionOuterRadius * 0.56).toFixed(1))

  const styleDefaults: RenderStyleDefaults = {
    nodeLabelFontSize: baseFontSize,
    edgeLabelFontSize: edgeFontSize,
    groupHeaderFontSize: groupFontSize,
    nodeLabelFontWeight: DEFAULT_ARCHITECTURE_VISUAL.serviceFontWeight,
    edgeLabelFontWeight: DEFAULT_ARCHITECTURE_VISUAL.edgeFontWeight,
    groupHeaderFontWeight: DEFAULT_ARCHITECTURE_VISUAL.groupFontWeight,
    nodePaddingX: DEFAULT_ARCHITECTURE_VISUAL.servicePaddingX,
    nodePaddingY: DEFAULT_ARCHITECTURE_VISUAL.servicePaddingY,
    nodeCornerRadius: DEFAULT_ARCHITECTURE_VISUAL.serviceCornerRadius,
    nodeLineWidth: DEFAULT_ARCHITECTURE_VISUAL.serviceLineWidth,
    edgeLineWidth: DEFAULT_ARCHITECTURE_VISUAL.edgeLineWidth,
    edgeBendRadius: DEFAULT_ARCHITECTURE_VISUAL.edgeBendRadius,
    groupCornerRadius: DEFAULT_ARCHITECTURE_VISUAL.groupCornerRadius,
    groupPaddingX: DEFAULT_ARCHITECTURE_VISUAL.groupPaddingX,
    groupPaddingY: DEFAULT_ARCHITECTURE_VISUAL.groupPaddingY,
    groupLabelPaddingX: DEFAULT_ARCHITECTURE_VISUAL.groupLabelPaddingX,
    groupLineWidth: DEFAULT_ARCHITECTURE_VISUAL.groupLineWidth,
  }
  const style = resolveRenderStyle(options, styleDefaults)

  const visual: ArchitectureVisualConfig = {
    groupHeaderHeight: Math.max(groupHeaderHeight, style.groupHeaderFontSize + 12),
    groupFontSize: style.groupHeaderFontSize,
    groupFontWeight: style.groupHeaderFontWeight,
    groupLetterSpacing: style.groupLetterSpacing,
    groupFont: style.groupFont,
    groupTextTransform: style.groupTextTransform,
    groupPaddingX: style.groupPaddingX,
    groupPaddingY: style.groupPaddingY,
    groupLabelPaddingX: style.groupLabelPaddingX,
    groupCornerRadius: style.groupCornerRadius,
    groupLineWidth: style.groupLineWidth,
    serviceFontSize: style.nodeLabelFontSize,
    serviceFontWeight: style.nodeLabelFontWeight,
    serviceLetterSpacing: style.nodeLetterSpacing,
    servicePaddingX: style.nodePaddingX,
    servicePaddingY: style.nodePaddingY,
    serviceCornerRadius: style.cornerRadius ?? 0,
    serviceLineWidth: style.nodeLineWidth,
    edgeFontSize: style.edgeLabelFontSize,
    edgeFontWeight: style.edgeLabelFontWeight,
    edgeLetterSpacing: style.edgeLetterSpacing,
    edgeLineWidth: style.lineWidth,
    edgeBendRadius: style.edgeBendRadius,
    iconSize,
    serviceIconSize,
    junctionOuterRadius,
    junctionInnerRadius,
    groupSurface: pickString(themeVariables, 'clusterBkg') ?? colors.surface,
    groupBorder: style.groupBorderColor ?? pickString(themeVariables, 'clusterBorder') ?? colors.border,
    serviceSurface: pickString(themeVariables, 'mainBkg', 'secondaryColor') ?? colors.surface,
    serviceBorder: pickString(themeVariables, 'primaryBorderColor') ?? colors.border,
  }

  return { visual, padding: getNumber(architecture, 'padding') }
}

function pickString(map: MermaidFrontmatterMap | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getString(map, key)
    if (value) return value
  }
  return undefined
}

function getString(map: MermaidFrontmatterMap | undefined, key: string): string | undefined {
  const value = map?.[key]
  return typeof value === 'string' ? value : undefined
}

function getNumber(map: MermaidFrontmatterMap | undefined, key: string): number | undefined {
  return toNumber(map?.[key])
}

function getMap(map: MermaidFrontmatterMap | undefined, key: string): MermaidFrontmatterMap | undefined {
  const value = map?.[key]
  return isMap(value) ? value : undefined
}

function toNumber(value: MermaidConfigValue | undefined): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return undefined

  const normalized = value.trim()
  const match = normalized.match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/i)
  return match ? Number.parseFloat(normalized) : undefined
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isMap(value: MermaidConfigValue | undefined): value is MermaidFrontmatterMap {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
