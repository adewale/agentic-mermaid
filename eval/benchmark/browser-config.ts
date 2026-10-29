import type { Page } from 'playwright'
import { PERFORMANCE_EXPERIMENTS } from '../../src/experimental-performance.ts'

export type BrowserElkCache = 'off' | 'on'

/** An absent list delegates to each installed artifact's startup defaults. */
export function browserPerformanceOptions(options: Map<string, string>): { features: string[] | undefined; elkCache: BrowserElkCache } {
  const requested = options.get('features')
  const features = requested === undefined ? undefined : requested === '' ? [] : requested.split(',')
  if (features?.some(feature => !PERFORMANCE_EXPERIMENTS.some(name => name === feature)) || features && new Set(features).size !== features.length) throw new Error('Invalid experimental feature selection')
  const elkCache = options.get('elk-cache') ?? 'off'
  if (elkCache !== 'off' && elkCache !== 'on') throw new Error('--elk-cache must be off or on')
  return { features, elkCache }
}

export function configureAgenticEngines(engines: Array<{ kind: string; experiments?: string }>, features: readonly string[] | undefined): void {
  for (const engine of engines) {
    if (engine.kind !== 'agentic') continue
    if (features === undefined) delete engine.experiments
    else engine.experiments = features.join(',')
  }
}

/** Apply before importing either a monolithic or lazy renderer. */
export async function configureBrowserPage(page: Page, experiments: string | undefined, elkCache: BrowserElkCache): Promise<void> {
  await page.evaluate(({ experiments, elkCache }) => {
    const host = globalThis as Record<string, unknown>
    if (experiments === undefined) delete host.AGENTIC_MERMAID_EXPERIMENTS
    else host.AGENTIC_MERMAID_EXPERIMENTS = experiments
    host.AGENTIC_MERMAID_ELK_CACHE = elkCache === 'on' ? '1' : '0'
    host.AGENTIC_MERMAID_SCENE_ASSERTIONS = '0'
  }, { experiments, elkCache })
}
