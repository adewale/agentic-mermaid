import type { MermaidRuntimeConfig, StateRuntimeConfig } from '../mermaid-source.ts'
import type { ConfigDiagnostic, RenderOptions } from '../types.ts'
import { FLOWCHART_STYLE_DEFAULTS, type RenderStyleDefaults } from '../styles.ts'

/** State config fields with a faithful equivalent in this renderer. */
export const STATE_WIRED_CONFIG_FIELDS = [
  'compositTitleSize', 'dividerMargin', 'fontSize', 'forkHeight', 'forkWidth',
  'nodeSpacing', 'noteMargin', 'padding', 'radius', 'rankSpacing',
] as const

/** Legacy Mermaid/Dagre calibration fields that have no honest ELK/measured-text equivalent. */
export const STATE_LEGACY_CONFIG_FIELDS = [
  'arrowMarkerAbsolute', 'edgeLengthFactor', 'fontSizeFactor', 'labelHeight',
  'miniPadding', 'sizeUnit', 'textHeight', 'titleShift', 'titleTopMargin',
] as const

/** Mermaid's complete documented stateDiagram config key inventory. */
export const STATE_CONFIG_FIELDS = [
  'arrowMarkerAbsolute', 'compositTitleSize', 'defaultRenderer', 'dividerMargin',
  'edgeLengthFactor', 'fontSize', 'fontSizeFactor', 'forkHeight', 'forkWidth',
  'labelHeight', 'miniPadding', 'nodeSpacing', 'noteMargin', 'padding', 'radius',
  'rankSpacing', 'sizeUnit', 'textHeight', 'titleShift', 'titleTopMargin',
] as const

const KNOWN_FIELDS = new Set<string>(STATE_CONFIG_FIELDS)
const WIRED_FIELDS = new Set<string>(STATE_WIRED_CONFIG_FIELDS)
const LEGACY_FIELDS = new Set<string>(STATE_LEGACY_CONFIG_FIELDS)
const POSITIVE_FIELDS = new Set(['fontSize', 'compositTitleSize', 'forkWidth', 'forkHeight'])

export interface ResolvedStateVisualConfig {
  forkWidth: number
  forkHeight: number
  noteMargin: number
  dividerMargin: number
  styleDefaults: RenderStyleDefaults
}

/** @internal RenderOptions enriched after resolving the state config section. */
export interface StateRenderOptions extends RenderOptions {
  stateVisual?: ResolvedStateVisualConfig
}

const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
const nonNegative = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

function sections(configs: unknown[]): Record<string, unknown>[] {
  return configs.filter((config): config is Record<string, unknown> =>
    Boolean(config) && typeof config === 'object' && !Array.isArray(config))
}

/**
 * Diagnose State config that cannot affect output. Wired keys only warn when
 * their value is invalid; `defaultRenderer: elk` is already satisfied.
 */
export function stateConfigDiagnostics(configs: unknown[], includeUnknown = false): ConfigDiagnostic[] {
  const found = new Map<string, unknown>()
  for (const config of sections(configs)) {
    for (const [field, value] of Object.entries(config)) found.set(field, value)
  }

  const diagnostics: ConfigDiagnostic[] = []
  for (const [field, value] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    if (!KNOWN_FIELDS.has(field)) {
      if (includeUnknown) diagnostics.push({
        code: 'INEFFECTIVE_CONFIG',
        field: `state.${field}`,
        message: `State config field "state.${field}" is unknown and has no effect; check the spelling or remove it.`,
      })
      continue
    }
    if (LEGACY_FIELDS.has(field)) {
      diagnostics.push({
        code: 'INEFFECTIVE_CONFIG',
        field: `state.${field}`,
        message: `State config field "state.${field}" is a legacy Dagre/fixed-metric option with no faithful effect in the ELK measured-text renderer.`,
      })
      continue
    }
    if (field === 'defaultRenderer') {
      if (value !== 'elk') diagnostics.push({
        code: 'INEFFECTIVE_CONFIG',
        field: 'state.defaultRenderer',
        message: `State config field "state.defaultRenderer" requested ${JSON.stringify(value)}; this renderer supports only "elk" and will not silently select a different engine.`,
      })
      continue
    }
    if (WIRED_FIELDS.has(field)) {
      const requiresPositive = POSITIVE_FIELDS.has(field)
      const valid = requiresPositive ? positive(value) !== undefined : nonNegative(value) !== undefined
      if (!valid) diagnostics.push({
        code: 'INEFFECTIVE_CONFIG',
        field: `state.${field}`,
        message: `State config field "state.${field}" must be a ${requiresPositive ? 'positive' : 'non-negative'} finite number; the supplied value was ignored.`,
      })
    }
  }
  return diagnostics
}

function stateSection(config: MermaidRuntimeConfig | Record<string, unknown> | undefined): StateRuntimeConfig {
  const value = config?.state
  return value && typeof value === 'object' && !Array.isArray(value) ? value as StateRuntimeConfig : {}
}

/**
 * Resolve State layout/paint options. Source config is applied first, explicit
 * `RenderOptions.mermaidConfig.state` second, and direct RenderOptions last.
 */
export function resolveStateRenderOptions(
  sourceConfig: MermaidRuntimeConfig | Record<string, unknown> | undefined,
  options: RenderOptions,
): StateRenderOptions {
  const config: StateRuntimeConfig = {
    ...stateSection(sourceConfig),
    ...stateSection(options.mermaidConfig),
  }
  const nodeSpacing = nonNegative(config.nodeSpacing)
  const rankSpacing = nonNegative(config.rankSpacing)
  const nodePadding = nonNegative(config.padding)
  const radius = nonNegative(config.radius)
  const fontSize = positive(config.fontSize)
  const compositeTitleSize = positive(config.compositTitleSize)

  const styleDefaults: RenderStyleDefaults = {
    ...FLOWCHART_STYLE_DEFAULTS,
    ...(nodePadding === undefined ? {} : { nodePaddingX: nodePadding, nodePaddingY: nodePadding }),
    ...(radius === undefined ? {} : { nodeCornerRadius: radius }),
    ...(fontSize === undefined ? {} : { nodeLabelFontSize: fontSize, edgeLabelFontSize: fontSize }),
    ...(compositeTitleSize === undefined ? {} : { groupHeaderFontSize: compositeTitleSize }),
  }

  const effectiveNodeSpacing = options.nodeSpacing ?? nodeSpacing
  const effectiveLayerSpacing = options.layerSpacing ?? rankSpacing
  return {
    ...options,
    ...(effectiveNodeSpacing === undefined ? {} : { nodeSpacing: effectiveNodeSpacing }),
    ...(effectiveLayerSpacing === undefined ? {} : { layerSpacing: effectiveLayerSpacing }),
    stateVisual: {
      forkWidth: positive(config.forkWidth) ?? 70,
      forkHeight: positive(config.forkHeight) ?? 10,
      noteMargin: nonNegative(config.noteMargin) ?? 18,
      dividerMargin: nonNegative(config.dividerMargin) ?? 0,
      styleDefaults,
    },
  }
}
