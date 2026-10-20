/** Internal diagnostic observation. No clock reads occur in normal renders. */
export type RenderStage = 'request' | 'layout' | 'graph-preparation' | 'agentic' | 'elk' | 'scene' | 'drawing' | 'paint-certification' | 'backend' | 'svg-security'
export interface RenderStageSample { readonly stage: RenderStage; readonly ms: number }
let observer: ((sample: RenderStageSample) => void) | undefined

export function withRenderStageObserver<T>(observe: (sample: RenderStageSample) => void, run: () => T): T {
  const previous = observer
  observer = observe
  try { return run() } finally { observer = previous }
}

export function measureRenderStage<T>(stage: RenderStage, run: () => T): T {
  const observe = observer
  if (!observe) return run()
  const start = performance.now()
  try { return run() } finally { observe(Object.freeze({ stage, ms: performance.now() - start })) }
}
