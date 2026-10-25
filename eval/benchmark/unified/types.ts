export type { BenchmarkStatus, UnifiedWorkload, BenchmarkObservation, UnifiedSuiteResult } from '../portable/observation.ts'
export interface UnifiedRunOptions {
  out: string
  root: string
  harnessRoot?: string
  packageRoot?: string
  site?: string
  mermaidDir?: string
  referenceDir?: string
  fidelityZenumlRoot?: string
  upstreamRunnerRoot?: string
  benchmarkRecordStore?: string
  benchmarkForce?: boolean
  benchmarkResumeAttempt?: string
  startupSamples?: number
  startupSurfaces?: readonly ('library' | 'cli' | 'mcp' | 'browser')[]
  nodeExecutable?: string
  bunExecutable?: string
  observerExecutable?: string
  nativeExecutable?: string
  communityArtifacts?: string
  /** Limit acquisition and execution before preparing any unrelated project. */
  communityProjects?: string[]
  communityCatalogFile?: string
  communityRecordStore?: string
  communityForce?: boolean
  /** Assigned by the controller; retained CLI summaries must belong to this call. */
  communityInvocationId?: string
  portableProject?: string
  portableArtifactRoot?: string
  portableAdapter?: string
  portableObserver?: string
  modernEditorRoot?: string
  communityCoverageOnce?: boolean
  /** Explicit partial output lane; absent means every bound output. */
  communityOutputs?: string[]
  /** Fresh directory for a new qualification helper; old assets remain immutable. */
  communityQualificationAssetDir?: string
  communityQualificationProtocol?: string
  communityArtifactPolicy?: 'frozen' | 'latest'
  communityPreparedFile?: string
  communityInputsFile?: string
  communityBrowserPreparedFile?: string
  rounds: number
  profile: 'smoke' | 'full'
  /** All timing campaigns run sequentially. */
  executable?: string
}
