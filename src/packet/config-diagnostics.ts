import type { FamilyOperations } from '../agent/families.ts'
import { boolean, nonNegative, oneOf, positive, rule } from '../shared/config-value-rules.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'

export const diagnosePacketConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('packet', context, {
    bitsPerRow: rule('a positive safe integer', value => Number.isSafeInteger(value) && Number(value) >= 1),
    bitOrder: oneOf('ascending', 'descending'),
    showBits: boolean,
    rowHeight: positive,
    bitWidth: positive,
    paddingX: nonNegative,
    paddingY: nonNegative,
    useMaxWidth: boolean,
  })
