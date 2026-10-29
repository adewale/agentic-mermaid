import type { FamilyOperations } from '../agent/families.ts'
import { boolean, nonNegative } from '../shared/config-value-rules.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'

export const diagnoseIshikawaConfig: NonNullable<FamilyOperations['configDiagnostics']> = context => diagnoseFamilyConfig('ishikawa', context, { diagramPadding: nonNegative, useMaxWidth: boolean })
