import type { PositionedDiagram } from '../types.ts'

export type GitGraphDirection = 'LR' | 'TB' | 'BT'
export type GitGraphCommitType = 'NORMAL' | 'REVERSE' | 'HIGHLIGHT' | 'MERGE' | 'CHERRY_PICK'

export interface GitGraphCommit {
  id: string
  message?: string
  type: GitGraphCommitType
  /** Visual override authored on a semantic merge commit. */
  customType?: Exclude<GitGraphCommitType, 'MERGE' | 'CHERRY_PICK'>
  tags: string[]
  branch: string
  parents: string[]
  sequence: number
  source: 'commit' | 'merge' | 'cherry-pick'
  mergeBranch?: string
  cherrySource?: string
  cherryParent?: string
  /** Parser-owned visual tag synthesized only when cherry-pick has no authored tags. */
  syntheticCherryTag?: string
  /** True when the author supplied id:, false for deterministic c<N> ids. */
  customId: boolean
}

export interface GitGraphBranch {
  name: string
  order: number
  head?: string
}

export type GitGraphStatement =
  | { kind: 'commit'; ref: string }
  | { kind: 'branch'; name: string; order?: number }
  | { kind: 'checkout'; branch: string; keyword: 'checkout' | 'switch' }
  | { kind: 'merge'; ref: string; branch: string }
  | { kind: 'cherry-pick'; ref: string; source: string; parent?: string }

export interface GitGraphDiagram {
  direction: GitGraphDirection
  mainBranchName: string
  commits: GitGraphCommit[]
  branches: GitGraphBranch[]
  statements: GitGraphStatement[]
  accessibilityTitle?: string
  accessibilityDescription?: string
}

export interface PositionedGitGraphCommit extends GitGraphCommit {
  x: number
  y: number
  lane: number
}

export interface PositionedGitGraphBranch extends GitGraphBranch {
  lane: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface PositionedGitGraphEdge {
  from: string
  to: string
  kind: 'parent' | 'merge' | 'cherry-pick'
  points: Array<{ x: number; y: number }>
}

export interface PositionedGitGraphDiagram extends PositionedDiagram {
  direction: GitGraphDirection
  commits: PositionedGitGraphCommit[]
  branches: PositionedGitGraphBranch[]
  edges: PositionedGitGraphEdge[]
  accessibilityTitle?: string
  accessibilityDescription?: string
  showBranches: boolean
  showCommitLabel: boolean
  rotateCommitLabel: boolean
}
