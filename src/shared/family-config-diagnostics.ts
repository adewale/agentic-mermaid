import type { DiagramKind } from '../agent/types.ts'
import type { ConfigDiagnostic } from '../types.ts'
import { ARCHITECTURE_NOOP_CONFIG_FIELDS } from '../architecture/config.ts'
import { CLASS_NOOP_CONFIG_FIELDS } from '../class/layout.ts'
import { ER_NOOP_CONFIG_FIELDS } from '../er/layout.ts'
import { FLOWCHART_NOOP_CONFIG_FIELDS } from '../flowchart-config.ts'
import { PIE_NOOP_CONFIG_FIELDS } from '../pie/config.ts'
import { QUADRANT_NOOP_CONFIG_FIELDS } from '../quadrant/config.ts'
import { SEQUENCE_NOOP_CONFIG_FIELDS } from '../sequence/config.ts'
import { stateConfigDiagnostics } from '../state/config.ts'

export interface FamilyConfigSpec {
  section: string
  keys: readonly string[]
  noopKeys?: readonly string[]
}

export const JOURNEY_NOOP_CONFIG_FIELDS = [
  'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign',
  'bottomMarginAdj', 'rightAngles', 'activationWidth', 'textPlacement',
] as const

export const TIMELINE_NOOP_CONFIG_FIELDS = [
  'diagramMarginX', 'diagramMarginY', 'leftMargin', 'width', 'height', 'padding',
  'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign',
  'bottomMarginAdj', 'rightAngles', 'taskFontSize', 'taskFontFamily', 'taskMargin',
  'activationWidth', 'textPlacement', 'actorColours', 'useMaxWidth', 'useWidth',
] as const

/** One exhaustive family-section inventory shared by source verification and explicit render config. */
export const FAMILY_CONFIG_SPECS: Record<DiagramKind, FamilyConfigSpec> = {
  flowchart: { section: 'flowchart', keys: ['nodeSpacing', 'rankSpacing', 'wrappingWidth', 'titleTopMargin', 'subGraphTitleMargin', 'arrowMarkerAbsolute', 'diagramPadding', 'htmlLabels', 'curve', 'padding', 'defaultRenderer', 'inheritDir'], noopKeys: FLOWCHART_NOOP_CONFIG_FIELDS },
  state: { section: 'state', keys: ['arrowMarkerAbsolute', 'compositTitleSize', 'defaultRenderer', 'dividerMargin', 'edgeLengthFactor', 'fontSize', 'fontSizeFactor', 'forkHeight', 'forkWidth', 'labelHeight', 'miniPadding', 'nodeSpacing', 'noteMargin', 'padding', 'radius', 'rankSpacing', 'sizeUnit', 'textHeight', 'titleShift', 'titleTopMargin'] },
  sequence: { section: 'sequence', keys: ['actorMargin', 'width', 'height', 'diagramMarginX', 'diagramMarginY', 'messageMargin', 'noteMargin', 'activationWidth', 'showSequenceNumbers', 'boxMargin', 'boxTextMargin', 'messageAlign', 'mirrorActors', 'bottomMarginAdj', 'rightAngles', 'wrap', 'wrapPadding', 'labelBoxWidth', 'labelBoxHeight', 'hideUnusedParticipants', 'forceMenus', 'arrowMarkerAbsolute', 'noteAlign', 'actorFontSize', 'actorFontFamily', 'actorFontWeight', 'noteFontSize', 'noteFontFamily', 'noteFontWeight', 'messageFontSize', 'messageFontFamily', 'messageFontWeight', 'useMaxWidth', 'useWidth'], noopKeys: SEQUENCE_NOOP_CONFIG_FIELDS },
  timeline: { section: 'timeline', keys: ['disableMulticolor', 'sectionFills', 'sectionColours', 'diagramMarginX', 'diagramMarginY', 'leftMargin', 'width', 'height', 'padding', 'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'taskFontSize', 'taskFontFamily', 'taskMargin', 'activationWidth', 'textPlacement', 'actorColours', 'useMaxWidth', 'useWidth'], noopKeys: TIMELINE_NOOP_CONFIG_FIELDS },
  journey: { section: 'journey', keys: ['diagramMarginX', 'diagramMarginY', 'leftMargin', 'maxLabelWidth', 'width', 'height', 'taskFontSize', 'taskFontFamily', 'taskMargin', 'actorColours', 'sectionFills', 'sectionColours', 'titleColor', 'titleFontFamily', 'titleFontSize', 'useMaxWidth', 'boxMargin', 'boxTextMargin', 'noteMargin', 'messageMargin', 'messageAlign', 'bottomMarginAdj', 'rightAngles', 'activationWidth', 'textPlacement'], noopKeys: JOURNEY_NOOP_CONFIG_FIELDS },
  class: { section: 'class', keys: ['nodeSpacing', 'rankSpacing', 'titleTopMargin', 'arrowMarkerAbsolute', 'dividerMargin', 'padding', 'textHeight', 'defaultRenderer', 'diagramPadding', 'htmlLabels', 'hideEmptyMembersBox', 'hierarchicalNamespaces'], noopKeys: CLASS_NOOP_CONFIG_FIELDS },
  er: { section: 'er', keys: ['layoutDirection', 'nodeSpacing', 'rankSpacing', 'titleTopMargin', 'diagramPadding', 'minEntityWidth', 'minEntityHeight', 'entityPadding', 'stroke', 'fill', 'fontSize'], noopKeys: ER_NOOP_CONFIG_FIELDS },
  architecture: { section: 'architecture', keys: ['padding', 'iconSize', 'fontSize', 'nodeSeparation', 'idealEdgeLengthMultiplier', 'edgeElasticity', 'numIter', 'seed', 'randomize'], noopKeys: ARCHITECTURE_NOOP_CONFIG_FIELDS },
  xychart: { section: 'xyChart', keys: ['width', 'height', 'useMaxWidth', 'useWidth', 'titleFontSize', 'titlePadding', 'chartOrientation', 'plotReservedSpacePercent', 'showDataLabel', 'showTitle', 'showLegend', 'legendFontSize', 'legendPadding', 'xAxis', 'yAxis'] },
  pie: { section: 'pie', keys: ['textPosition', 'donutHole', 'legendPosition', 'highlightSlice', 'useMaxWidth', 'useWidth'], noopKeys: PIE_NOOP_CONFIG_FIELDS },
  quadrant: { section: 'quadrantChart', keys: ['chartWidth', 'chartHeight', 'titleFontSize', 'titlePadding', 'quadrantPadding', 'quadrantLabelFontSize', 'xAxisLabelFontSize', 'yAxisLabelFontSize', 'xAxisLabelPadding', 'yAxisLabelPadding', 'pointLabelFontSize', 'pointRadius', 'pointTextPadding', 'quadrantInternalBorderStrokeWidth', 'quadrantExternalBorderStrokeWidth', 'useMaxWidth', 'quadrantTextTopPadding', 'xAxisPosition', 'yAxisPosition', 'useWidth'], noopKeys: QUADRANT_NOOP_CONFIG_FIELDS },
  gantt: { section: 'gantt', keys: ['displayMode'] },
  mindmap: { section: 'mindmap', keys: ['padding', 'maxNodeWidth'] },
  gitgraph: { section: 'gitGraph', keys: ['showBranches', 'showCommitLabel', 'mainBranchName', 'mainBranchOrder', 'parallelCommits', 'rotateCommitLabel'] },
}

function section(root: unknown, key: string): Record<string, unknown> | undefined {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return undefined
  const value = (root as Record<string, unknown>)[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function familyUnknownConfigDiagnostics(kind: DiagramKind, root: unknown): ConfigDiagnostic[] {
  const spec = FAMILY_CONFIG_SPECS[kind]
  const record = root && typeof root === 'object' && !Array.isArray(root) ? root as Record<string, unknown> : undefined
  const config = section(root, spec.section)
  if (!config) return record && spec.section in record ? [{
    code: 'INEFFECTIVE_CONFIG',
    field: spec.section,
    message: `${kind} config section "${spec.section}" must be an object; the invalid value has no effect.`,
  }] : []
  const known = new Set(spec.keys)
  return Object.keys(config).filter(key => !known.has(key)).sort().map(key => ({
    code: 'INEFFECTIVE_CONFIG',
    field: `${spec.section}.${key}`,
    message: `${kind} config field "${key}" is unknown and has no effect; check the spelling or remove it.`,
  }))
}

interface ValueRule { expected: string; valid: (value: unknown) => boolean }
const rule = (expected: string, valid: ValueRule['valid']): ValueRule => ({ expected, valid })
const positive = rule('a finite positive number', value => typeof value === 'number' && Number.isFinite(value) && value > 0)
const nonNegative = rule('a finite non-negative number', value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
const finite = rule('a finite number', value => typeof value === 'number' && Number.isFinite(value))
const boolean = rule('a boolean', value => typeof value === 'boolean')
const nonEmptyString = rule('a non-empty string', value => typeof value === 'string' && value.trim().length > 0)
const stringArray = rule('a non-empty array of strings', value => Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'string'))
const oneOf = (...values: string[]): ValueRule => rule(`one of: ${values.join(', ')}`, value => typeof value === 'string' && values.includes(value))
const oneOfInsensitive = (...values: string[]): ValueRule => rule(`one of: ${values.join(', ')} (case-insensitive)`, value =>
  typeof value === 'string' && values.some(candidate => candidate.toLowerCase() === value.toLowerCase()),
)
const range = (min: number, max: number, leftClosed = true): ValueRule => rule(
  `a finite number ${leftClosed ? 'from' : 'greater than'} ${min} through ${max}`,
  value => typeof value === 'number' && Number.isFinite(value) && (leftClosed ? value >= min : value > min) && value <= max,
)
const positiveCssSize = rule('a finite positive number or non-empty CSS size string', value =>
  (typeof value === 'number' && Number.isFinite(value) && value > 0) || (typeof value === 'string' && value.trim().length > 0),
)
const numericLike = (minimum: number, exclusive = false): ValueRule => rule(
  `a numeric value${exclusive ? ` greater than ${minimum}` : ` of at least ${minimum}`}`,
  value => {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/i.test(value.trim()) ? Number.parseFloat(value) : Number.NaN
    return Number.isFinite(parsed) && (exclusive ? parsed > minimum : parsed >= minimum)
  },
)

const FAMILY_VALUE_RULES: Partial<Record<DiagramKind, Record<string, ValueRule>>> = {
  flowchart: { nodeSpacing: positive, rankSpacing: positive, wrappingWidth: positive },
  sequence: Object.fromEntries([
    ...['actorMargin', 'width', 'height', 'diagramMarginX', 'diagramMarginY', 'messageMargin', 'noteMargin', 'activationWidth'].map(key => [key, nonNegative]),
    ['showSequenceNumbers', boolean],
  ]),
  timeline: { disableMulticolor: boolean, sectionFills: stringArray, sectionColours: stringArray },
  journey: Object.fromEntries([
    ...['diagramMarginX', 'diagramMarginY', 'leftMargin', 'maxLabelWidth', 'width', 'height', 'taskMargin'].map(key => [key, positive]),
    ...['taskFontSize', 'titleFontSize'].map(key => [key, positiveCssSize]),
    ...['taskFontFamily', 'titleColor', 'titleFontFamily'].map(key => [key, nonEmptyString]),
    ...['actorColours', 'sectionFills', 'sectionColours'].map(key => [key, stringArray]),
    ['useMaxWidth', boolean],
  ]),
  class: { nodeSpacing: nonNegative, rankSpacing: nonNegative, hierarchicalNamespaces: boolean },
  er: { layoutDirection: oneOfInsensitive('TB', 'TD', 'BT', 'LR', 'RL'), nodeSpacing: nonNegative, rankSpacing: nonNegative },
  architecture: {
    padding: numericLike(0), iconSize: numericLike(0, true), fontSize: numericLike(0, true),
    nodeSeparation: numericLike(0), idealEdgeLengthMultiplier: numericLike(0, true),
  },
  xychart: {
    width: positive, height: positive, useMaxWidth: boolean, useWidth: positive,
    titleFontSize: positive, titlePadding: nonNegative,
    chartOrientation: oneOf('vertical', 'horizontal'), plotReservedSpacePercent: range(0, 100, false),
    showDataLabel: boolean, showTitle: boolean, showLegend: boolean,
    legendFontSize: positive, legendPadding: nonNegative,
    xAxis: rule('an axis-config object', value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)),
    yAxis: rule('an axis-config object', value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)),
  },
  pie: { textPosition: range(0, 1), donutHole: range(0, 0.9), legendPosition: oneOf('top', 'bottom', 'left', 'right', 'center') },
  quadrant: Object.fromEntries([
    ...['chartWidth', 'chartHeight', 'titleFontSize', 'quadrantLabelFontSize', 'xAxisLabelFontSize', 'yAxisLabelFontSize', 'pointLabelFontSize', 'pointRadius'].map(key => [key, positive]),
    ...['titlePadding', 'quadrantPadding', 'xAxisLabelPadding', 'yAxisLabelPadding', 'pointTextPadding', 'quadrantInternalBorderStrokeWidth', 'quadrantExternalBorderStrokeWidth'].map(key => [key, nonNegative]),
    ['useMaxWidth', boolean],
  ]),
  gantt: { displayMode: oneOfInsensitive('compact') },
  mindmap: { padding: nonNegative, maxNodeWidth: positive },
  gitgraph: {
    showBranches: boolean, showCommitLabel: boolean, parallelCommits: boolean, rotateCommitLabel: boolean,
    mainBranchName: nonEmptyString, mainBranchOrder: finite,
  },
}

const XY_AXIS_VALUE_RULES: Record<string, ValueRule> = {
  showLabel: boolean, labelFontSize: positive, labelPadding: nonNegative,
  showTitle: boolean, titleFontSize: positive, titlePadding: nonNegative,
  showTick: boolean, tickLength: nonNegative, tickWidth: positive,
  showAxisLine: boolean, axisLineWidth: positive,
}

/** Value-validity diagnostics for every wired family config key. */
export function familyConfigValueDiagnostics(kind: DiagramKind, root: unknown): ConfigDiagnostic[] {
  if (kind === 'state') return [] // state/config.ts owns its richer value diagnostics
  const spec = FAMILY_CONFIG_SPECS[kind]
  const config = section(root, spec.section)
  const diagnostics: ConfigDiagnostic[] = []
  const warn = (field: string, expected: string): void => {
    diagnostics.push({ code: 'INEFFECTIVE_CONFIG', field, message: `${field} must be ${expected}; the invalid value has no effect.` })
  }
  if (kind === 'mindmap') {
    const rootRecord = root && typeof root === 'object' && !Array.isArray(root) ? root as Record<string, unknown> : undefined
    if (rootRecord && 'layout' in rootRecord && rootRecord.layout !== 'tidy-tree') warn('layout', '"tidy-tree" for mindmap diagrams')
  }
  if (!config) return diagnostics
  for (const [key, valueRule] of Object.entries(FAMILY_VALUE_RULES[kind] ?? {})) {
    if (key in config && !valueRule.valid(config[key])) warn(`${spec.section}.${key}`, valueRule.expected)
  }
  if (kind === 'xychart') {
    for (const axis of ['xAxis', 'yAxis'] as const) {
      const value = config[axis]
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const axisConfig = value as Record<string, unknown>
      for (const key of Object.keys(axisConfig).sort()) {
        const valueRule = XY_AXIS_VALUE_RULES[key]
        if (!valueRule) warn(`xyChart.${axis}.${key}`, 'a documented axis-config field')
        else if (!valueRule.valid(axisConfig[key])) warn(`xyChart.${axis}.${key}`, valueRule.expected)
      }
    }
  }
  return diagnostics
}

/** Backward-compatible name retained for callers outside this module. */
export const mindmapGitGraphValueDiagnostics = familyConfigValueDiagnostics

/** Diagnostics for the explicit RenderOptions.mermaidConfig entry path. */
export function explicitFamilyConfigDiagnostics(kind: DiagramKind, root: unknown): ConfigDiagnostic[] {
  const spec = FAMILY_CONFIG_SPECS[kind]
  const unknown = familyUnknownConfigDiagnostics(kind, root)
  const config = section(root, spec.section)
  const valueDiagnostics = familyConfigValueDiagnostics(kind, root)
  if (!config) return [...unknown, ...valueDiagnostics]
  if (kind === 'state') return stateConfigDiagnostics([config], true)

  const diagnostics = [
    ...unknown,
    ...valueDiagnostics,
  ]
  const noop = new Set(spec.noopKeys ?? [])
  for (const key of Object.keys(config).filter(key => noop.has(key)).sort()) {
    diagnostics.push({
      code: 'INEFFECTIVE_CONFIG',
      field: `${spec.section}.${key}`,
      message: `${kind} config field "${key}" is accepted for Mermaid compatibility but has no effect on this renderer.`,
    })
  }
  return diagnostics
}
