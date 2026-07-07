import type { DiagramColors } from '../theme.ts'
import type { MermaidFrontmatterMap, MermaidConfigValue } from '../mermaid-source.ts'
import type { RenderOptions, TextTransform } from '../types.ts'
import { resolveRenderStyle } from '../styles.ts'
import type { RenderStyleDefaults } from '../styles.ts'

export interface ArchitectureVisualConfig {
  groupHeaderHeight: number
  groupFontSize: number
  groupFontWeight: number
  groupLetterSpacing: number
  groupFont?: string
  groupTextTransform?: TextTransform
  groupPaddingX: number
  groupPaddingY: number
  groupLabelPaddingX: number
  groupCornerRadius: number
  groupLineWidth: number
  groupText?: string
  serviceFontSize: number
  serviceFontWeight: number
  serviceLetterSpacing: number
  serviceTextTransform?: TextTransform
  servicePaddingX: number
  servicePaddingY: number
  serviceCornerRadius: number
  serviceLineWidth: number
  serviceText?: string
  edgeFontSize: number
  edgeFontWeight: number
  edgeLetterSpacing: number
  edgeTextTransform?: TextTransform
  edgeLineWidth: number
  edgeBendRadius: number
  edgeStroke?: string
  edgeText?: string
  iconSize: number
  serviceIconSize: number
  junctionOuterRadius: number
  junctionInnerRadius: number
  groupSurface?: string
  groupHeaderSurface?: string
  groupBorder?: string
  serviceSurface?: string
  serviceBorder?: string
}

export interface ArchitectureLayoutMetrics {
  groupFontSize: number
  groupFontWeight: number
  groupLetterSpacing: number
  groupFont?: string
  groupTextTransform?: TextTransform
  groupPaddingX: number
  groupPaddingY: number
  groupCornerRadius: number
  groupLineWidth: number
  serviceFontSize: number
  serviceFontWeight: number
  serviceLetterSpacing: number
  serviceTextTransform?: TextTransform
  servicePaddingX: number
  servicePaddingY: number
  serviceCornerRadius: number
  serviceLineWidth: number
  edgeFontSize: number
  edgeFontWeight: number
  edgeLetterSpacing: number
  edgeTextTransform?: TextTransform
  edgeLineWidth: number
  edgeBendRadius: number
}

export interface ResolvedArchitectureVisualConfig {
  visual: ArchitectureVisualConfig
  layout: ArchitectureLayoutMetrics
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
    serviceTextTransform: style.nodeTextTransform,
    servicePaddingX: style.nodePaddingX,
    servicePaddingY: style.nodePaddingY,
    serviceCornerRadius: style.cornerRadius ?? 0,
    serviceLineWidth: style.nodeLineWidth,
    edgeFontSize: style.edgeLabelFontSize,
    edgeFontWeight: style.edgeLabelFontWeight,
    edgeLetterSpacing: style.edgeLetterSpacing,
    edgeTextTransform: style.edgeTextTransform,
    edgeLineWidth: style.lineWidth,
    edgeBendRadius: style.edgeBendRadius,
    iconSize,
    serviceIconSize,
    junctionOuterRadius,
    junctionInnerRadius,
    groupSurface: style.groupFillColor ?? pickString(themeVariables, 'clusterBkg') ?? colors.surface,
    groupHeaderSurface: style.groupHeaderFillColor,
    groupBorder: style.groupBorderColor ?? pickString(themeVariables, 'clusterBorder') ?? colors.border,
    groupText: style.groupTextColor,
    serviceSurface: style.nodeFillColor ?? pickString(themeVariables, 'mainBkg', 'secondaryColor') ?? colors.surface,
    serviceBorder: style.nodeBorderColor ?? pickString(themeVariables, 'primaryBorderColor') ?? colors.border,
    serviceText: style.nodeTextColor,
    edgeStroke: style.edgeStrokeColor,
    edgeText: style.edgeTextColor,
  }

  return {
    visual,
    layout: architectureLayoutMetrics(visual),
    padding: getNumber(architecture, 'padding'),
  }
}

export function architectureLayoutMetrics(visual: ArchitectureVisualConfig): ArchitectureLayoutMetrics {
  return {
    groupFontSize: visual.groupFontSize,
    groupFontWeight: visual.groupFontWeight,
    groupLetterSpacing: visual.groupLetterSpacing,
    groupFont: visual.groupFont,
    groupTextTransform: visual.groupTextTransform,
    groupPaddingX: visual.groupPaddingX,
    groupPaddingY: visual.groupPaddingY,
    groupCornerRadius: visual.groupCornerRadius,
    groupLineWidth: visual.groupLineWidth,
    serviceFontSize: visual.serviceFontSize,
    serviceFontWeight: visual.serviceFontWeight,
    serviceLetterSpacing: visual.serviceLetterSpacing,
    serviceTextTransform: visual.serviceTextTransform,
    servicePaddingX: visual.servicePaddingX,
    servicePaddingY: visual.servicePaddingY,
    serviceCornerRadius: visual.serviceCornerRadius,
    serviceLineWidth: visual.serviceLineWidth,
    edgeFontSize: visual.edgeFontSize,
    edgeFontWeight: visual.edgeFontWeight,
    edgeLetterSpacing: visual.edgeLetterSpacing,
    edgeTextTransform: visual.edgeTextTransform,
    edgeLineWidth: visual.edgeLineWidth,
    edgeBendRadius: visual.edgeBendRadius,
  }
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
