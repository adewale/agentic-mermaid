import type { PortableCase } from './cohorts.ts'

export const PORTABLE_MEASUREMENT_PROTOCOL = 'portable-svg-processes-v2'
export type Replica = 'A0' | 'A1' | 'B'
export type Track = 'first-use' | 'warm-repeat' | 'warm-new-source' | 'warm-label-edit'
export interface PortableArtifact {
  project: string
  root: string
  entry: string
  version: string
  adapter: 'pele' | 'agentic' | 'beautiful' | 'ondine'
}
export interface PortableJob {
  artifact: PortableArtifact
  testCase: PortableCase
  mode: 'warm' | 'cold' | 'memory' | 'baseline' | 'retention'
  samples: number
  round: number
  replica: Replica
  sample: number
  /** Legacy direct-worker file destination; controllers now use dedicated pipes. */
  resultFile?: string
  diagnosticFile?: string
  svgFile?: string
  fullEvidence?: boolean
  minSampleMs?: number
}
export interface MemorySnapshot {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
}
export interface PortableWorkerResult {
  protocol: typeof PORTABLE_MEASUREMENT_PROTOCOL | 'portable-svg-processes-v1'
  caseId: string
  family: string
  mode: PortableJob['mode']
  round: number
  replica: Replica
  sample: number
  status: 'passed' | 'failed' | 'blocked' | 'partial'
  importMs: number
  tracks: Partial<Record<Track, number[]>>
  outputBytes: number
  qualification: { accepted: boolean; passed: boolean; semanticComplete: boolean; checks: { name: string; status: string; expected: unknown; actual: unknown; scope: string }[]; unmeasuredScopes: string[]; scope: string } | null
  prelude: { source: string; expectedAccepted: boolean; actualAccepted: boolean; passed: boolean }[]
  memory?: { before: MemorySnapshot; atReturn: MemorySnapshot; afterGc: MemorySnapshot; gcAvailable: boolean }
  retention?: { calls: number; snapshot: MemorySnapshot }[]
  iterations?: Partial<Record<Track, number[]>>
  apiWindow?: { startNs: string; endNs: string }
  resource?: { userSeconds: number; systemSeconds: number; peakRssBytes: number; scope: string }
  error?: string
  runtime: { executable: string; node: string; platform: string; arch: string }
}
