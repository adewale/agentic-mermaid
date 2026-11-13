import type { FamilyOperations } from '../agent/families.ts'
import { diagnoseFamilyConfig } from '../shared/family-config-diagnostics.ts'
import { finite, boolean, nonEmptyString, type ConfigValueRule } from '../shared/config-value-rules.ts'

const VALUE_RULES: Record<string, ConfigValueRule> = {
  showBranches: boolean, showCommitLabel: boolean, parallelCommits: boolean, rotateCommitLabel: boolean,
  mainBranchName: nonEmptyString, mainBranchOrder: finite,
}

export const diagnoseGitGraphConfig: NonNullable<FamilyOperations['configDiagnostics']> = context =>
  diagnoseFamilyConfig('gitgraph', context, VALUE_RULES)
