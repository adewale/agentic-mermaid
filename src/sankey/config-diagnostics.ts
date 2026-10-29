import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { rule, boolean, stringValue, oneOf, range, boundedNonNegative, type ConfigValueRule } from '../shared/config-value-rules.ts'
import { SANKEY_CONFIG_LIMITS } from './config.ts'
import { drawableAuthoredCssPaint } from '../shared/css-color.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = {
  width: range(SANKEY_CONFIG_LIMITS.width.min, SANKEY_CONFIG_LIMITS.width.max),
  height: range(SANKEY_CONFIG_LIMITS.height.min, SANKEY_CONFIG_LIMITS.height.max),
  nodeWidth: range(SANKEY_CONFIG_LIMITS.nodeWidth.min, SANKEY_CONFIG_LIMITS.nodeWidth.max),
  nodePadding: boundedNonNegative(SANKEY_CONFIG_LIMITS.nodePadding.max),
  linkColor: rule('source, target, gradient, or a drawable CSS color', value =>
    typeof value === 'string'
    && (['source', 'target', 'gradient'].includes(value) || drawableAuthoredCssPaint(value, true) !== undefined),
  ),
  nodeAlignment: oneOf('justify', 'center', 'left', 'right'),
  showValues: boolean,
  prefix: stringValue,
  suffix: stringValue,
  labelStyle: oneOf('legacy', 'outlined'),
  nodeColors: rule('an object mapping node labels to drawable CSS colors', value =>
    Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(color => drawableAuthoredCssPaint(color, true) !== undefined),
  ),
}

export const diagnoseSankeyConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('sankey', context, VALUE_RULES)
