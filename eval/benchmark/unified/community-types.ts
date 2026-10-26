import type { UnifiedWorkload } from './types.ts'
export interface CommunityBenchmarkConfig {
  adapter: string
  package?: string
  subpath?: string
  terminalSubpath?: string
  outputs?: string[]
  version?: string
  versionPolicy?: string
  sourceAdapter?: string
  sourcePin?: string
  entry?: string
  runtime?: string
  [key: string]: unknown
}
export interface CommunityNode {
  id: string
  repo?: string
  head?: string
  roles: string[]
  outputs: string[]
  packages?: { registry: string; name: string; version: string }[]
  release?: { tag: string; commit: string }
  distribution?: { version: string; revision: string; path?: string; wasmSha256?: string }
  benchmark?: CommunityBenchmarkConfig
}
export interface CommunityArtifact {
  kind: 'node' | 'global' | 'franken' | 'jsonl-worker' | 'cli' | 'python'
  root?: string
  module?: string
  executable?: string
  args?: string[]
  input?: 'stdin' | 'file'
  format?: string
  outputBindings?: Record<string, { args: string[]; input?: 'stdin' | 'file' }>
  global?: string
  version: string
  revision?: string
  sha256?: string
  integrity?: string
  runtime?: string
  python?: string
  wasm?: string
  files?: { path: string; sha256: string }[]
  detail?: string
  apiBoundary?: string
  reviewed?: boolean
  buildRecipeId?: string
  runtimeCommandId?: string
  runtimeVersion?: string
  sourceRevision?: string
  sourceFiles?: { root: string; revision: string; gitPath: string; blob: string }[]
  dependencyPatches?: { root: string; revision: string; gitPath: string; blob: string }[]
  sourceProgramClass?: string
  artifactClass?: string
  nativeBinding?: unknown
  dependencies?: unknown
  apiAdmission?: string
  acquisitionOrigin?: string
  supportedFamilies?: readonly string[]
  sourceFallback?: 'framed-source'
}
export interface PreparedCommunity {
  node: CommunityNode
  artifact?: CommunityArtifact
  error?: string
}
export interface CommunityWorkerJob {
  prepared: PreparedCommunity
  workloads: UnifiedWorkload[]
  output: string
  out: string
  samples: number
  warmupMs: number
  minSampleMs: number
  harnessRoot: string
  packageRoot?: string
  coverageOnce?: boolean
}
