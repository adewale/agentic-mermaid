import type { ReleaseRssDiagnostics } from './release-memory.ts'

// The file protocol between the release benchmark and its isolated Node worker.
export interface BenchInput {
  id: string
  family: string
  source: string
  expectedSvgLabels?: readonly string[]
  workflow?: 'edit-flowchart'
}
export type Outcome = { ok: true; output: string } | { ok: false; error: string }
export interface OutputFingerprint {
  ok: boolean
  sha256: string
  bytes: number
  error?: string
}
export interface TimeResult {
  node: string
  importMs: number
  firstRenderMs: number
  firstRender: OutputFingerprint
  results: Array<{
    id: string
    svg: Outcome
    ascii: OutputFingerprint
    deterministic: boolean
    ms: number
    samplesMs: number[]
    missingSvgLabels: string[]
  }>
}
export interface MemoryResult {
  perInput: Array<{ id: string; allocatedBytes: number; peakHeapBytes: number }>
  passAllocatedBytes: number
  passPeakHeapBytes: number
  settledHeapBytes: number
  retainedHeapBytes: number
  retainedGrowthBytes: number
  /** Process-lifetime getrusage high-water mark; retained for compatibility. */
  peakRssBytes: number
  /** Diagnostic checkpoints only; absent from historical worker receipts. */
  rss?: ReleaseRssDiagnostics
}
