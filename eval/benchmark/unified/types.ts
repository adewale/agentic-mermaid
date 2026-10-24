/** A shared envelope; an unavailable capability never becomes a zero-cost win. */
export type BenchmarkStatus = 'passed' | 'failed' | 'unsupported' | 'blocked' | 'not-applicable' | 'skipped'
export interface UnifiedWorkload {
  id: string
  family: string
  source: string
  features: readonly string[]
  provenance: string
  expectedLabels?: readonly string[]
}
export interface BenchmarkObservation {
  suite: string
  surface: string
  runtime: string
  family: string
  caseId: string
  operation: string
  format: string
  mode: string
  status: BenchmarkStatus
  samplesMs?: number[]
  bytes?: number
  metrics?: Record<string, number | string | boolean | null>
  findings?: string[]
  detail?: string
}
export interface UnifiedSuiteResult {
  id: string
  status: BenchmarkStatus
  startedAt: string
  finishedAt: string
  observations: BenchmarkObservation[]
  gaps: string[]
  artifacts?: string[]
}
export interface UnifiedRunOptions {
  out: string
  root: string
  harnessRoot?: string
  packageRoot?: string
  communityArtifacts?: string
  communityCoverageOnce?: boolean
  communityArtifactPolicy?: 'frozen' | 'latest'
  communityPreparedFile?: string
  communityInputsFile?: string
  communityBrowserPreparedFile?: string
  rounds: number
  profile: 'smoke' | 'full'
  /** All timing campaigns run sequentially. */
  executable?: string
}
