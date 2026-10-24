import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { layoutMermaidWithReceipt, renderMermaidSVGWithReceipt } from '../../src/agent/index.ts'
import type { RenderedLayout } from '../../src/agent/types.ts'
import type { RenderOptions } from '../../src/types.ts'
import { editSequences } from './edit-sequences.ts'
import { measureEditStability } from './stability.ts'

const out = process.argv[process.argv.indexOf('--out') + 1]
if (!process.argv.includes('--out') || !out) throw new Error('edit-run.ts requires --out <json>; set cache startup environment explicitly')
const results: unknown[] = []
for (const mode of ['elk', 'agentic', 'agentic-with-elk'] as const) for (const sequence of editSequences()) {
  const graphLayout: RenderOptions['graphLayout'] = mode === 'elk' ? { backend: 'elk' } : { backend: 'agentic', fallback: mode === 'agentic-with-elk' ? 'elk' : 'none' }
  let previous: RenderedLayout | undefined, initialSvg: string | undefined
  for (const step of [{ name: 'initial', source: sequence.base, affected: [] as string[], options: undefined }, ...sequence.steps]) {
    const options: RenderOptions = { graphLayout, ...step.options, security: 'strict', onConfigDiagnostic: () => {} }
    try {
      const artifact = layoutMermaidWithReceipt(step.source, { ...options, debug: true }), rendered = renderMermaidSVGWithReceipt(step.source, options)
      const receipt = JSON.parse(JSON.stringify(rendered.receipt))
      const transition = previous ? measureEditStability(previous, artifact.layout, new Set(step.affected)) : undefined
      initialSvg ??= rendered.svg
      results.push({ family: sequence.family, mode, edit: step.name, source: step.source, affected: step.affected, ok: true, transition,
        receipt, layoutReceipt: JSON.parse(JSON.stringify(artifact.receipt)), svg: rendered.svg,
        ...(step.name === 'undo' ? { undoByteIdentical: initialSvg === rendered.svg } : {}) })
      previous = artifact.layout
    } catch (error) {
      results.push({ family: sequence.family, mode, edit: step.name, source: step.source, affected: step.affected, ok: false, error: String(error),
        code: error && typeof error === 'object' && 'code' in error ? error.code : undefined })
      previous = undefined
    }
  }
}
const report = { protocol: 'layout-edit-stability@1', revision: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(), dirty: execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0,
  cache: process.env.AGENTIC_MERMAID_ELK_CACHE, experiments: process.env.AGENTIC_MERMAID_EXPERIMENTS,
  limitations: ['Quality-only public layout reruns, not performance measurements.', 'Raw and aligned motion are both retained; directly affected IDs are declared in edit-sequences.ts.', 'Backend fallback discontinuities remain visible in receipts.'], results }
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ out, observations: results.length }))
