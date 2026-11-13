import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { useTestChildren } from './helpers/test-child.ts'

const runChild = useTestChildren(20_000)

// The labelled edge is deliberately ineligible for the forest solver: observing
// zero ELK calls on the repeat then proves positioned reuse, not forest dispatch.
test.each([
  { id: 'default', setting: undefined, browser: false, flags: ['text-spans', 'indexed-layout', 'position-cache'], cached: true },
  { id: 'disabled', setting: '', browser: false, flags: [], cached: false },
  { id: 'explicit subset', setting: 'text-spans', browser: false, flags: ['text-spans'], cached: false },
  { id: 'browser disabled', setting: '', browser: true, flags: [], cached: false },
  { id: 'browser selected', setting: 'text-spans,indexed-layout,position-cache', browser: true, flags: ['text-spans', 'indexed-layout', 'position-cache'], cached: true },
])('startup $id preserves complete SVG and selects the requested layout paths', async ({ setting, browser, flags, cached }) => {
  const env: Record<string, string | undefined> = { ...process.env, AGENTIC_MERMAID_ELK_CACHE: '1' }
  delete env.AGENTIC_MERMAID_EXPERIMENTS
  if (!browser && setting !== undefined) env.AGENTIC_MERMAID_EXPERIMENTS = setting
  // Keep the worker event loop free; the helper owns SIGKILL cleanup and
  // captures output even when a child never completes startup.
  const child = await runChild(process.execPath, ['-e', `
    console.error('startup: entered child', JSON.stringify({ pid: process.pid, bunWorker: process.env.BUN_TEST_WORKER_ID, jestWorker: process.env.JEST_WORKER_ID }))
    ${browser ? `globalThis.AGENTIC_MERMAID_EXPERIMENTS = ${JSON.stringify(setting)}` : ''}
    const { renderMermaidSVG } = await import('./src/index.ts')
    const { PERFORMANCE_EXPERIMENTS, performanceExperimentEnabled } = await import('./src/experimental-performance.ts')
    const { clearElkLayoutCache } = await import('./src/elk-instance.ts')
    const { withRenderStageObserver } = await import('./src/render-stages.ts')
    const { layoutGraphSync } = await import('./src/layout-engine.ts')
    const { parseMermaid } = await import('./src/parser.ts')
    console.error('startup: imports complete')
    const source = 'flowchart LR\\nStartupA[First] -- message --> StartupB[Second]'
    const first = renderMermaidSVG(source)
    console.error('startup: first render complete')
    clearElkLayoutCache()
    let elkCalls = 0
    const second = withRenderStageObserver(sample => { if (sample.stage === 'elk') elkCalls++ }, () => renderMermaidSVG(source))
    const forest = layoutGraphSync(parseMermaid('flowchart LR\\nRoot --> Child'))
    console.error('startup: rendering and layout complete')
    console.log(JSON.stringify({ flags: PERFORMANCE_EXPERIMENTS.filter(performanceExperimentEnabled),
      equal: first === second, bytes: Buffer.byteLength(second), elkCalls, strategy: forest.certification.strategy }))
  `], { cwd: resolve(import.meta.dir, '../..'), env })
  expect(child.status, JSON.stringify(child)).toBe(0)
  const result = JSON.parse(child.stdout) as { flags: string[]; equal: boolean; bytes: number; elkCalls: number; strategy: string }
  expect(result.flags).toEqual([...flags])
  expect(result.equal).toBe(true)
  expect(result.bytes).toBeGreaterThan(0)
  if (cached) expect(result.elkCalls).toBe(0)
  else expect(result.elkCalls).toBeGreaterThan(0)
  expect(result.strategy === 'indexed-forest').toBe((flags as readonly string[]).includes('indexed-layout'))
})
