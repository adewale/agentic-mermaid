import { expect, test } from 'bun:test'
import { resolve } from 'node:path'

test('startup positioned-reuse flag avoids layout while preserving complete SVG bytes', () => {
  // Exercise startup configuration in a fresh process. This test also runs
  // against revisions that predate the experimental implementation.
  const child = Bun.spawnSync([process.execPath, '-e', `
    import { renderMermaidSVG } from './src/index.ts'
    import { clearElkLayoutCache } from './src/elk-instance.ts'
    import { withRenderStageObserver } from './src/render-stages.ts'
    const source = 'flowchart LR\\nStartupA[First] --> StartupB[Second]'
    const first = renderMermaidSVG(source)
    clearElkLayoutCache()
    let elkCalls = 0
    const second = withRenderStageObserver(sample => { if (sample.stage === 'elk') elkCalls++ }, () => renderMermaidSVG(source))
    console.log(JSON.stringify({ equal: first === second, bytes: Buffer.byteLength(second), elkCalls }))
  `], { cwd: resolve(import.meta.dir, '../..'), stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, AGENTIC_MERMAID_EXPERIMENTS: 'position-cache', AGENTIC_MERMAID_ELK_CACHE: '1' } })
  expect(child.exitCode).toBe(0)
  const result = JSON.parse(child.stdout.toString()) as { equal: boolean; bytes: number; elkCalls: number }
  expect(result.equal).toBe(true)
  expect(result.bytes).toBeGreaterThan(0)
  expect(result.elkCalls).toBe(0)
})
