import type { FamilyOperations } from '../agent/families.ts'
import { boolean, nonNegative } from '../shared/config-value-rules.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'

export const diagnoseBlockConfig: NonNullable<FamilyOperations['configDiagnostics']> = context => diagnoseFamilyConfig('block', context, { padding: nonNegative, useMaxWidth: boolean })
