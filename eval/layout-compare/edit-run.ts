import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { layoutMermaidWithReceipt, renderMermaidSVGWithReceipt } from '../../src/agent/index.ts'
import type { RenderedLayout } from '../../src/agent/types.ts'
import type { RenderOptions } from '../../src/types.ts'
import { editSequences } from './edit-sequences.ts'
import { measureEditStability } from './stability.ts'
import { attemptApi, failureCode } from './outcomes.ts'

export function buildEditResults(): unknown[] {
const results: unknown[] = []
for (const mode of ['elk', 'agentic', 'agentic-with-elk'] as const) for (const sequence of editSequences()) {
  const graphLayout: RenderOptions['graphLayout'] = mode === 'elk' ? { backend: 'elk' } : { backend: 'agentic', fallback: mode === 'agentic-with-elk' ? 'elk' : 'none' }
  let previous: RenderedLayout | undefined, initialSvg: string | undefined
  for (const step of [{ name: 'initial', source: sequence.base, affected: [] as string[], options: undefined }, ...sequence.steps]) {
    const options: RenderOptions = { graphLayout, ...step.options, security: 'strict', onConfigDiagnostic: () => {} }
    const artifact = attemptApi(() => layoutMermaidWithReceipt(step.source, { ...options, debug: true }))
    const rendered = attemptApi(() => renderMermaidSVGWithReceipt(step.source, options))
    const previousLayout = previous
    const transition = artifact.ok && previousLayout ? attemptApi(() => measureEditStability(previousLayout, artifact.value.layout, new Set(step.affected))) : undefined
    const failure = !artifact.ok ? artifact.error : !rendered.ok ? rendered.error : transition && !transition.ok ? transition.error : undefined
    if (step.name === 'initial' && rendered.ok) initialSvg = rendered.value.svg
    results.push({ family: sequence.family, mode, edit: step.name, source: step.source, affected: step.affected,
      ok: artifact.ok && rendered.ok && (!transition || transition.ok), ...(transition?.ok ? { transition: transition.value } : {}),
      ...(failure ? { error: `${failure.name}: ${failure.message}`, code: failureCode(failure) } : {}),
      ...(!artifact.ok || !rendered.ok || transition && !transition.ok ? { failures: { ...(!artifact.ok ? { layout: artifact.error } : {}), ...(!rendered.ok ? { svg: rendered.error } : {}), ...(transition && !transition.ok ? { transition: transition.error } : {}) } } : {}),
      ...(artifact.ok ? { layout: artifact.value.layout, layoutReceipt: JSON.parse(JSON.stringify(artifact.value.receipt)) } : {}),
      ...(rendered.ok ? { svg: rendered.value.svg, receipt: JSON.parse(JSON.stringify(rendered.value.receipt)),
        ...(step.name === 'undo' && initialSvg !== undefined ? { undoByteIdentical: initialSvg === rendered.value.svg } : {}) } : {}) })
    previous = artifact.ok ? artifact.value.layout : undefined
  }
}
return results
}

if (import.meta.main) {
const out = process.argv[process.argv.indexOf('--out') + 1]
if (!process.argv.includes('--out') || !out) throw new Error('edit-run.ts requires --out <json>; set cache startup environment explicitly')
const results = buildEditResults()
const report = { protocol: 'layout-edit-stability@1', revision: execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(), dirty: execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0,
  cache: process.env.AGENTIC_MERMAID_ELK_CACHE, experiments: process.env.AGENTIC_MERMAID_EXPERIMENTS,
  limitations: ['Quality-only public layout reruns, not performance measurements.', 'Raw and aligned motion are both retained; directly affected IDs are declared in edit-sequences.ts.', 'Backend fallback discontinuities remain visible in receipts.'], results }
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ out, observations: results.length }))
}
