// The file protocol between the release benchmark and its isolated Node worker.
export interface BenchInput {
  id: string
  family: string
  source: string
  expectedSvgLabels?: readonly string[]
  workflow?: 'edit-flowchart'
}
export type LayoutMode = 'elk' | 'agentic' | 'agentic-with-elk'
export type LayoutCache = 'off' | 'normal'
export type Outcome = { ok: true; output: string } | {
  ok: false
  error: string
  code?: string
  category?: 'unsupported' | 'candidate-rejected' | 'error'
}
export interface LayoutObservation {
  receipt: OutputFingerprint
  decisions: readonly import('../../src/layout/backend.ts').GraphLayoutDecision[]
  certification?: unknown
  /** The timed receipt proves paint; aesthetics require a separate projection. */
  quality: 'not-collected'
}
export type QualityObservation = {
  status: 'measured'
  scope: 'separate-public-layout-after-timing'
  metrics: unknown
  decisions: readonly import('../../src/layout/backend.ts').GraphLayoutDecision[]
  certification?: unknown
  unavailable: readonly string[]
} | { status: 'unavailable'; reason: string; code?: string }
export interface OutputFingerprint {
  ok: boolean
  sha256: string
  bytes: number
  error?: string
  code?: string
  category?: 'unsupported' | 'candidate-rejected' | 'error'
}
export interface TimeResult {
  node: string
  importMs: number
  firstRenderMs: number
  firstRender: OutputFingerprint
  firstLayout?: LayoutObservation
  results: Array<{
    id: string
    svg: Outcome
    ascii: OutputFingerprint
    deterministic: boolean
    ms: number
    samplesMs: number[]
    missingSvgLabels: string[]
    layout?: LayoutObservation
    asciiLayout?: LayoutObservation
    quality?: QualityObservation
  }>
}
export interface MemoryResult {
  perInput: Array<{ id: string; allocatedBytes: number; peakHeapBytes: number }>
  passAllocatedBytes: number
  passPeakHeapBytes: number
  retainedGrowthBytes: number
  peakRssBytes: number
}
