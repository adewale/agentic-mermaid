import type { FamilyOperations } from '../agent/families.ts'
import { configSection, familyUnknownConfigDiagnostics } from '../shared/family-config-diagnostics.ts'
import { stateConfigDiagnostics } from './config.ts'

export const diagnoseStateConfig: NonNullable<FamilyOperations['configDiagnostics']> = ({ root, config }) => {
  const section = configSection(root, config.section)
  return section ? stateConfigDiagnostics([section], true) : familyUnknownConfigDiagnostics('state', root, config)
}
