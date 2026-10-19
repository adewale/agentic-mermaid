// ============================================================================
// Scene-IR text marks and the writer that draws them.
//
// A text mark's position, anchor, typography and content are typed fields the
// writer draws, so a lowering cannot claim one label position while the SVG
// shows another (quadrant point labels once did exactly that). The fidelity
// oracle (src/scene/fidelity.ts) re-reads the written SVG independently; these
// tests run it over real lowerings and over the writer's harder text cases.
// ============================================================================

import { describe, it, expect } from 'bun:test'
import * as marks from '../scene/marks.ts'
import { sceneFidelityProblems, nodeProblems } from '../scene/fidelity.ts'
import { lowerQuadrantScene } from '../quadrant/renderer.ts'
import { parseQuadrantChart } from '../quadrant/parser.ts'
import { layoutQuadrantChart } from '../quadrant/layout.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import type { SceneDoc } from '../scene/ir.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import { pixelTextLine, preparePixelText } from '../shared/prepared-text.ts'

function textMark(semantic: { x: number; y: number; anchor: 'start' | 'middle' | 'end' }) {
  return marks.text({ id: 't', role: 'label', text: 'Hi', fontSize: 12, paint: {}, ...semantic })
}

describe('text marks', () => {
  it('writes retained native line wrappers, RTL shaping, tracking, projected Gantt lines and painted runs faithfully', () => {
    for (const [source, letterSpacing] of [['A B\nC D', 0], ['אב ג\nש ד', 0], ['界 é\n👩‍💻', 0], ['AB CD\nEF GH', -2], ['A B', 2], ['<i>Italic</i> <b>bold</b>', 0]] as const) {
      const block = preparePixelText(source, { fontSize: 12, fontWeight: 400, letterSpacing })
      for (const retained of [block, pixelTextLine(block, block.lines.length - 1)!]) {
        const mark = marks.text({ id: 'line', role: 'label', text: retained.text, block: retained, x: 10, y: 20, fontSize: 12, anchor: 'middle', paint: {} })
        const problems: string[] = []
        nodeProblems(mark, 'p', problems)
        expect({ source, letterSpacing, problems }).toEqual({ source, letterSpacing, problems: [] })
      }
    }
    const block = preparePixelText('+ field: String', { display: 'literal', fontSize: 12, fontWeight: 400 })
    const mark = marks.text({
      id: 'member', role: 'member', text: block.text, block, x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {},
      spans: [{ text: '+ ', fill: '#777' }, { text: 'field', fill: '#111' }, { text: ': String', fill: '#777' }],
    })
    const problems: string[] = []
    nodeProblems(mark, 'p', problems)
    expect(problems).toEqual([])
  })

  it('retains the family prepared block, source spans and font inputs', () => {
    const block = preparePixelText('Straße <b>release</b> notes', {
      display: 'formatted', transform: 'uppercase', fontSize: 14, fontWeight: 600,
      letterSpacing: 0.3, maxWidth: 100, fontFamily: 'Inter',
    })
    const mark = marks.text({
      id: 'caption', role: 'label', text: block.text, block,
      x: 10, y: 20, fontSize: 14, anchor: 'start', paint: {},
    })
    expect(mark.block).toBe(block)
    expect(mark.measurement).toBe('prepared')
    expect(mark.block!.prepared.source).toBe('Straße <b>release</b> notes')
    expect(mark.block!.prepared.transform).toBe('uppercase')
    expect(mark.block!.lineBlocks.flatMap(line => line.runs).some(run => run.bold)).toBe(true)
    expect(mark.block!.fontFamily).toBe('Inter')
    expect(mark.block!.breaks.length).toBeGreaterThan(0)
    // The measured face and transformed text are what the writer draws.
    const svg = sceneNodeSerialization(mark)
    expect(svg).toContain('font-family="Inter"')
    expect(svg.replace(/<[^>]+>/g, '').replace(/\s+/g, '')).toContain('STRASSERELEASENOTES')
  })

  it('marks fallback preparation explicitly instead of claiming retained family measurement', () => {
    const mark = textMark({ x: 10, y: 20, anchor: 'start' })
    expect(mark.measurement).toBe('fallback')
    expect(mark.prepared).toBeUndefined()
    expect(mark.block?.prepared.source).toBe('Hi')
    expect(mark.block?.width).toBe(mark.textLayout?.width)
  })

  it('inherits semantic group ownership without mutating reusable children or changing serialization', () => {
    const child = textMark({ x: 10, y: 20, anchor: 'start' })
    const inner = marks.group({ id: 'local-inner', role: 'node', open: '<g data-id="authored-inner">', close: '</g>', children: [{ node: child, indent: 2 }] })
    const outer = marks.group({ id: 'outer', role: 'group', open: '<g>', close: '</g>', children: [{ node: inner, indent: 2 }] })
    const sibling = marks.group({ id: 'sibling', role: 'node', open: '<g>', close: '</g>', children: [{ node: child, indent: 2 }] })
    expect(child.owner).toBeUndefined()
    expect(inner.children[0]!.node.owner).toEqual({ id: 'authored-inner', role: 'node' })
    expect((outer.children[0]!.node as typeof inner).children[0]!.node.owner).toEqual({ id: 'authored-inner', role: 'node' })
    expect(sibling.children[0]!.node.owner).toEqual({ id: 'sibling', role: 'node' })
    expect(sceneNodeSerialization(sibling.children[0]!.node)).toBe(sceneNodeSerialization(child))
  })

  it('preserves explicitly supplied ownership inside a different wrapper', () => {
    const child = marks.text({
      id: 'caption', role: 'label', owner: { id: 'edge-1', role: 'edge' },
      text: 'Hi', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {},
    })
    const wrapper = marks.group({ id: 'wrapper', role: 'group', open: '<g>', close: '</g>', children: [{ node: child, indent: 2 }] })
    expect(wrapper.children[0]!.node.owner).toEqual({ id: 'edge-1', role: 'edge' })
  })

  it('keeps typed public text identity separate from its bounded mark ID', () => {
    const mark = marks.text({
      id: 'local-caption', role: 'title', identity: { id: 'title#2' },
      text: 'Caption', x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {},
    })
    expect(mark.id).toBe('local-caption')
    expect(mark.identity).toEqual({ id: 'title#2', role: 'title' })
    expect(sceneNodeSerialization(mark)).toContain('data-id="title#2" data-role="title"')
  })

  it('draws authored angle brackets as text, never as markup', () => {
    const drawn = (text: string, display?: 'literal') => {
      const mark = marks.text({ id: 'm', role: 'member', text, ...(display ? { display } : {}), x: 10, y: 20, fontSize: 12, anchor: 'start', paint: {} })
      const problems: string[] = []
      nodeProblems(mark, 'p', problems)
      expect({ text, problems }).toEqual({ text, problems: [] })
      return sceneNodeSerialization(mark)
    }
    expect(drawn('List<List<int>> data')).toContain('List&lt;List&lt;int&gt;&gt; data')
    expect(drawn('A<script>B')).not.toContain('<script')
    const literal = drawn('A<BR>B', 'literal')
    expect(literal).toContain('A&lt;BR&gt;B')
    expect(literal).not.toContain('<tspan')
  })
})

describe('quadrant lowering is text-faithful', () => {
  function lower(src: string): SceneDoc {
    const positioned = layoutQuadrantChart(parseQuadrantChart(toMermaidLines(src)))
    return lowerQuadrantScene({
      positioned,
      colors: { bg: '#FFFFFF', fg: '#27272A', font: 'Inter' },
      resolved: { renderOptions: {} },
    })
  }

  it('point labels carry their REAL collision-aware position in the scene IR', () => {
    // Two nearby points force the second label off the default right-hand
    // slot; the semantic x/y/anchor must follow the drawn slot.
    const doc = lower(`quadrantChart
      Alpha long label: [0.5, 0.5]
      Beta long label: [0.55, 0.5]
      Gamma long label: [0.6, 0.5]
      Delta long label: [0.65, 0.5]`)
    expect(sceneFidelityProblems(doc)).toEqual([])
  })

  it('the classic campaign chart lowers faithfully', () => {
    const doc = lower(`quadrantChart
      title Reach and engagement of campaigns
      x-axis Low Reach --> High Reach
      y-axis Low Engagement --> High Engagement
      quadrant-1 We should expand
      Campaign A: [0.3, 0.6]
      Campaign B: [0.45, 0.23]`)
    expect(sceneFidelityProblems(doc)).toEqual([])
  })
})
