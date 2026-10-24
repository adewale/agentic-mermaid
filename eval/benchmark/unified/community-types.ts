import type { UnifiedWorkload } from './types.ts'
export interface CommunityBenchmarkConfig {
  adapter: string
  package?: string
  subpath?: string
  terminalSubpath?: string
  outputs?: string[]
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
}
