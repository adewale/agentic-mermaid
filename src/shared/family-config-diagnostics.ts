import type { DiagramKind, FamilyId } from '../agent/types.ts'
import type { ConfigDiagnostic } from '../types.ts'
import { getFamily, type FamilyConfigContract } from '../agent/families.ts'
import { stateConfigDiagnostics } from '../state/config.ts'
import { compareCodePointStrings } from './deterministic-order.ts'

export type FamilyConfigSpec = FamilyConfigContract

function familyConfigSpec(kind: FamilyId | string): FamilyConfigContract | undefined {
  return getFamily(kind)?.config
}

function section(root: unknown, key: string): Record<string, unknown> | undefined {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return undefined
  const value = (root as Record<string, unknown>)[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function familyUnknownConfigDiagnostics(kind: DiagramKind, root: unknown): ConfigDiagnostic[] {
  const spec = familyConfigSpec(kind)
  if (!spec) return []
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
  gantt: {
    displayMode: oneOfInsensitive('compact'), barHeight: positive, topAxis: boolean,
    axisFormat: nonEmptyString,
    tickInterval: rule('a positive Mermaid interval such as "1day" or "2week"', value => typeof value === 'string' && /^[1-9]\d*(?:millisecond|second|minute|hour|day|week|month)$/i.test(value.trim())),
  },
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
  const spec = familyConfigSpec(kind)
  if (!spec) return []
  const config = section(root, spec.section)
  const diagnostics: ConfigDiagnostic[] = []
  const warn = (field: string, expected: string): void => {
    diagnostics.push({ code: 'INEFFECTIVE_CONFIG', field, message: `${field} must be ${expected}; the invalid value has no effect.` })
  }
  if (kind === 'mindmap') {
    const rootRecord = root && typeof root === 'object' && !Array.isArray(root) ? root as Record<string, unknown> : undefined
    if (rootRecord && 'layout' in rootRecord && !['tidy-tree', 'cose-bilkent', 'radial'].includes(String(rootRecord.layout))) warn('layout', '"cose-bilkent", "radial", or "tidy-tree" for mindmap diagrams')
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

export function familyNoopConfigDiagnostics(kind: DiagramKind, root: unknown): ConfigDiagnostic[] {
  const spec = familyConfigSpec(kind)
  if (!spec) return []
  const config = section(root, spec.section)
  if (!config) return []
  const noop = new Set(spec.noopKeys ?? [])
  return Object.keys(config).filter(key => noop.has(key)).sort().map(key => ({
    code: 'INEFFECTIVE_CONFIG' as const,
    field: `${spec.section}.${key}`,
    message: `${kind} config field "${key}" is accepted for Mermaid compatibility but has no effect on this renderer.`,
  }))
}

function stableDiagnostics(diagnostics: ConfigDiagnostic[]): ConfigDiagnostic[] {
  const seen = new Set<string>()
  return diagnostics
    .sort((a, b) => compareCodePointStrings(a.field, b.field) || compareCodePointStrings(a.message, b.message))
    .filter(diagnostic => {
      const key = `${diagnostic.code}\u0000${diagnostic.field}\u0000${diagnostic.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** Schema-owned diagnostics for source wrappers or explicit config roots. */
export function familyConfigDiagnostics(kind: DiagramKind, roots: readonly unknown[]): ConfigDiagnostic[] {
  const spec = familyConfigSpec(kind)
  if (!spec) return []
  const diagnostics = roots.flatMap(root => {
    const unknown = familyUnknownConfigDiagnostics(kind, root)
    const config = section(root, spec.section)
    if (kind === 'state') return config ? stateConfigDiagnostics([config], true) : unknown
    return [
      ...unknown,
      ...familyConfigValueDiagnostics(kind, root),
      ...familyNoopConfigDiagnostics(kind, root),
    ]
  })
  return stableDiagnostics(diagnostics)
}

/** Diagnostics for the explicit RenderOptions.mermaidConfig entry path. */
export function explicitFamilyConfigDiagnostics(kind: string, root: unknown): ConfigDiagnostic[] {
  const descriptor = getFamily(kind)
  const spec = descriptor?.config
  if (!descriptor || !spec) return []
  if (kind.includes(':')) {
    const record = root && typeof root === 'object' && !Array.isArray(root) ? root as Record<string, unknown> : undefined
    const config = section(root, spec.section)
    if (!config) return record && spec.section in record ? [{
      code: 'INEFFECTIVE_CONFIG', field: spec.section,
      message: `${kind} config section "${spec.section}" must be an object; the invalid value has no effect.`,
    }] : []
    const known = new Set(spec.keys)
    const noop = new Set(spec.noopKeys ?? [])
    return stableDiagnostics(Object.keys(config).flatMap(key => {
      if (!known.has(key)) return [{ code: 'INEFFECTIVE_CONFIG' as const, field: `${spec.section}.${key}`, message: `${kind} config field "${key}" is unknown and has no effect; check the spelling or remove it.` }]
      if (noop.has(key)) return [{ code: 'INEFFECTIVE_CONFIG' as const, field: `${spec.section}.${key}`, message: `${kind} config field "${key}" is accepted for compatibility but has no effect on this renderer.` }]
      return []
    }))
  }
  return familyConfigDiagnostics(kind as DiagramKind, [root])
}
