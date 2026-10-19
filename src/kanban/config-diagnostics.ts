import type { FamilyOperations } from '../agent/families.ts'
import { boolean, nonNegative, positive, stringValue } from '../shared/config-value-rules.ts'
import { configSection, diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { kanbanTicketUrl } from './config.ts'

export const diagnoseKanbanConfig: NonNullable<FamilyOperations['configDiagnostics']> = context => {
  const result = diagnoseFamilyConfig('kanban', context, { padding: nonNegative, sectionWidth: positive, ticketBaseUrl: stringValue, useMaxWidth: boolean })
  const base = configSection(context.root, 'kanban')?.ticketBaseUrl
  if (typeof base === 'string' && base && !kanbanTicketUrl(base, 'TICKET')) result.push({ code: 'INEFFECTIVE_CONFIG', field: 'kanban.ticketBaseUrl', message: 'kanban.ticketBaseUrl is not a safe inert link; ticket text is preserved without navigation.' })
  return result
}
