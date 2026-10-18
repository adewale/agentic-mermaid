import { describe, expect, test } from 'bun:test'
import { knownBuiltinFamilies, getFamily } from '../agent/families.ts'
import { renderMermaidSVGWithReceipt as complete } from '../index.ts'
import { renderMermaidSVGWithReceipt as focused } from '../svg.ts'
import { withRenderStageObserver, type RenderStageSample } from '../render-stages.ts'
import { convertToElkFormat, layoutGraphSync } from '../layout-engine.ts'
import { elkLayoutSync } from '../elk-instance.ts'
import { parseMermaid } from '../parser.ts'

describe('focused SVG entry', () => {
  test('preserves complete-library SVG and receipts for every native family', () => {
    for (const id of knownBuiltinFamilies()) {
      const source = getFamily(id)!.example
      expect(focused(source, { security: 'strict' }), id).toEqual(complete(source, { security: 'strict' }))
    }
  })

  test('loads optional sketch support explicitly in an isolated consumer', async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import { renderMermaidSVG } from ${JSON.stringify(new URL('../svg.ts', import.meta.url).pathname)};
      const source = 'flowchart LR\\n A --> B';
      if (!renderMermaidSVG(source).includes('<svg')) throw new Error('no SVG');
      let rejected = false;
      try { renderMermaidSVG(source, { style: 'hand-drawn' }) } catch (e) { rejected = /unavailable/.test(String(e)) }
      if (!rejected) throw new Error('sketch backend loaded eagerly');
      await import(${JSON.stringify(new URL('../svg-styles.ts', import.meta.url).pathname)});
      if (!renderMermaidSVG(source, { style: 'hand-drawn' }).includes('<svg')) throw new Error('no styled SVG');
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited])
    expect(exitCode, stderr).toBe(0)
  })

  test('places unconnected leaves identically to ELK without invoking its solver', () => {
    for (const direction of ['TD', 'BT', 'LR', 'RL'] as const) {
      for (const label of ['A[One]', 'A{Two lines<br>of text}', 'A((Round))']) {
        const graph = parseMermaid(`flowchart ${direction}\n ${label}`)
        const options = { padding: 29, font: 'Inter' }
        const reference = elkLayoutSync(convertToElkFormat(graph, options))
        const stages: RenderStageSample[] = []
        const positioned = withRenderStageObserver(sample => stages.push(sample), () => layoutGraphSync(graph, options))
        expect(positioned.nodes[0]!.x).toBe(reference.children![0]!.x!)
        expect(positioned.nodes[0]!.y).toBe(reference.children![0]!.y!)
        expect(positioned.width).toBe(reference.width!)
        expect(positioned.height).toBe(reference.height!)
        expect(positioned.edges).toEqual([])
        expect(stages.some(sample => sample.stage === 'elk')).toBe(false)
      }
    }
    const stages: RenderStageSample[] = []
    withRenderStageObserver(sample => stages.push(sample), () => focused('flowchart LR\n A --> B'))
    expect(stages.some(sample => sample.stage === 'elk')).toBe(true)
    for (const source of ['classDiagram\n A <|-- B', 'erDiagram\n A ||--o{ B : has']) {
      const samples: RenderStageSample[] = []
      withRenderStageObserver(sample => samples.push(sample), () => focused(source))
      expect(samples.filter(sample => sample.stage === 'elk').length).toBeGreaterThan(0)
      expect(samples.some(sample => sample.stage === 'paint-certification')).toBe(true)
    }
  })
})
