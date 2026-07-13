import { layoutGitGraph } from './layout.ts'
import type { GitGraphDiagram, PositionedGitGraphDiagram } from './types.ts'

export function resolveGitGraphCommitLabelFontSize(raw: unknown): number {
  const vars = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const value = vars.commitLabelFontSize
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : 11
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 11
}

export interface GitGraphPositionConfig {
  mainBranchName?: string
  mainBranchOrder?: number
  showBranches?: boolean
  showCommitLabel?: boolean
  rotateCommitLabel?: boolean
  parallelCommits?: boolean
  commitLabelFontSize?: number
}

export function resolveGitGraphPositionConfig(raw: unknown, themeVariables?: unknown): GitGraphPositionConfig {
  const resolved: GitGraphPositionConfig = {
    commitLabelFontSize: resolveGitGraphCommitLabelFontSize(themeVariables),
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return resolved
  const config = raw as Record<string, unknown>
  for (const key of ['showBranches', 'showCommitLabel', 'rotateCommitLabel', 'parallelCommits'] as const) {
    if (typeof config[key] === 'boolean') resolved[key] = config[key]
  }
  if (typeof config.mainBranchName === 'string' && config.mainBranchName.trim()) resolved.mainBranchName = config.mainBranchName.trim()
  if (typeof config.mainBranchOrder === 'number' && Number.isFinite(config.mainBranchOrder)) resolved.mainBranchOrder = config.mainBranchOrder
  return resolved
}

export function positionGitGraph(body: GitGraphDiagram, config: GitGraphPositionConfig): PositionedGitGraphDiagram {
  return layoutGitGraph(body, config)
}
