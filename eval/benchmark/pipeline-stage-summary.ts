import type { RenderStage, RenderStageSample } from '../../src/render-stages.ts'

export interface PipelineStageSummary {
  readonly rootMs: number
  readonly stages: Partial<Record<RenderStage, {
    inclusiveMs: number
    exclusiveMs: number
    occurrences: number
    nestedOccurrences: number
  }>>
}

/** Synchronous observer samples arrive in completion order. Keep each pending
 * occurrence until its parent completes; stage names alone cannot identify it. */
export function summarizePipelineStages(samples: readonly RenderStageSample[]): PipelineStageSummary {
  const pending: RenderStageSample[] = []
  const stages: PipelineStageSummary['stages'] = {}
  let rootMs = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample.ms) || sample.ms < 0 || !Number.isSafeInteger(sample.depth) || sample.depth < 0) {
      throw new Error('Invalid render stage duration or depth')
    }
    let childrenMs = 0
    while (pending.length && pending[pending.length - 1]!.depth > sample.depth) {
      const child = pending.pop()!
      if (child.depth !== sample.depth + 1 || child.parent !== sample.stage) throw new Error('Render stage parent is missing or out of order')
      childrenMs += child.ms
    }
    const exclusiveMs = sample.ms - childrenMs
    if (exclusiveMs < -1e-9 * Math.max(1, sample.ms)) throw new Error('Render stage children exceed their parent duration')
    const value = stages[sample.stage] ??= { inclusiveMs: 0, exclusiveMs: 0, occurrences: 0, nestedOccurrences: 0 }
    value.inclusiveMs += sample.ms
    value.exclusiveMs += Math.max(0, exclusiveMs)
    value.occurrences++
    if (sample.depth === 0) {
      if (sample.parent !== undefined) throw new Error('Root render stage cannot have a parent')
      rootMs += sample.ms
    } else {
      value.nestedOccurrences++
      pending.push(sample)
    }
  }
  if (pending.length) throw new Error('Render stage parent is missing or out of order')
  return { rootMs, stages }
}
