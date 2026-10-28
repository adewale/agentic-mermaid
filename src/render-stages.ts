/** Internal diagnostic observation. No clock reads occur in normal renders. */
export type RenderStage = 'request' | 'layout' | 'graph-preparation' | 'agentic' | 'elk' | 'scene' | 'drawing' | 'paint-certification' | 'backend' | 'svg-security'
export interface RenderStageSample {
  readonly stage: RenderStage
  /** Inclusive time; nested samples are not additional end-to-end work. */
  readonly ms: number
  readonly depth: number
  readonly parent?: RenderStage
}
let observer: ((sample: RenderStageSample) => void) | undefined
let activeStage: RenderStage | undefined
let depth = 0

export function withRenderStageObserver<T>(observe: (sample: RenderStageSample) => void, run: () => T): T {
  const previous = observer
  const previousStage = activeStage, previousDepth = depth
  observer = observe
  activeStage = undefined
  depth = 0
  try { return run() } finally { observer = previous; activeStage = previousStage; depth = previousDepth }
}

export function measureRenderStage<T>(stage: RenderStage, run: () => T): T {
  const observe = observer
  if (!observe) return run()
  const parent = activeStage, currentDepth = depth
  activeStage = stage
  depth++
  const start = performance.now()
  try { return run() } finally {
    const ms = performance.now() - start
    activeStage = parent
    depth = currentDepth
    observe(Object.freeze({ stage, ms, depth: currentDepth, ...(parent ? { parent } : {}) }))
  }
}
