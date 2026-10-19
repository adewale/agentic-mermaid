import type { FamilyOperations } from '../agent/families.ts'
import { boolean, range, stringValue } from '../shared/config-value-rules.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'

export const diagnoseTreemapConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('treemap', context, {
    nodeWidth: range(1, 10000),
    nodeHeight: range(1, 10000),
    padding: range(0, 10000),
    diagramPadding: range(0, 10000),
    labelFontSize: range(1, 10000),
    valueFontSize: range(1, 10000),
    borderWidth: range(0, 10000),
    showValues: boolean,
    valueFormat: stringValue,
    useMaxWidth: boolean,
  })
