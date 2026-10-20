import type { FamilyOperations } from '../agent/families.ts'
import { boolean, nonNegative, positive, stringValue, numericLike } from '../shared/config-value-rules.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'

export const diagnoseRequirementConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('requirement', context, {
    rect_fill: stringValue,
    text_color: stringValue,
    rect_border_color: stringValue,
    rect_border_size: numericLike(0),
    rect_min_width: positive,
    rect_min_height: nonNegative,
    rect_padding: nonNegative,
    line_height: nonNegative,
    fontSize: positive,
    maxWidth: positive,
    nodeSpacing: nonNegative,
    rankSpacing: nonNegative,
    useMaxWidth: boolean,
    look: stringValue,
    theme: stringValue,
  })
