/**
 * Class `direction` wiring + spacing render options + typed `class` config
 * section with wire-or-warn (plan §Class 4's direction/spacing half).
 *
 * direction LR|RL|TB|BT parses today but was ignored at layout
 * (src/class/layout.ts pinned 'elk.direction': 'DOWN'). The fix reuses the
 * flowchart direction mapping (layout-engine's directionToElk) rather than a
 * parallel copy. Invariant gates: for `A --> B`,
 *   LR ⇒ B strictly right of A;  RL ⇒ B strictly left of A;
 *   TB ⇒ B strictly below A;     BT ⇒ B strictly above A.
 *
 * Config contract (verified against the upstream class config schema
 * 2026-07): nodeSpacing/rankSpacing are WIRED (→ RenderOptions
 * nodeSpacing/layerSpacing → ELK); the other documented keys emit the
 * INEFFECTIVE_CONFIG Tier-3 lint (journey's wire-or-warn pattern, P4).
 */
import { describe, it, expect } from 'bun:test'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { toMermaidLines } from '../mermaid-source.ts'

const AB = (direction?: string) => toMermaidLines(
  ['classDiagram', ...(direction ? [`direction ${direction}`] : []), 'class A', 'class B', 'A --> B'].join('\n'))

const positioned = (direction?: string) => {
  const pos = layoutClassDiagram(parseClassDiagram(AB(direction)))
  const a = pos.classes.find(c => c.id === 'A')!
  const b = pos.classes.find(c => c.id === 'B')!
  return { a, b }
}

describe('class direction statement', () => {
  it('parses direction into the diagram model', () => {
    expect(parseClassDiagram(AB('RL')).direction).toBe('RL')
    expect(parseClassDiagram(AB()).direction).toBeUndefined()
  })

  it('default stays top-down (B below A)', () => {
    const { a, b } = positioned()
    expect(b.y).toBeGreaterThan(a.y + a.height - 0.5)
  })

  it('LR puts B right of A', () => {
    const { a, b } = positioned('LR')
    expect(b.x).toBeGreaterThan(a.x + a.width - 0.5)
  })

  it('RL puts B left of A', () => {
    const { a, b } = positioned('RL')
    expect(b.x + b.width).toBeLessThan(a.x + 0.5)
  })

  it('BT puts B above A', () => {
    const { a, b } = positioned('BT')
    expect(b.y + b.height).toBeLessThan(a.y + 0.5)
  })

  it('TB keeps B below A', () => {
    const { a, b } = positioned('TB')
    expect(b.y).toBeGreaterThan(a.y + a.height - 0.5)
  })
})

describe('class spacing render options', () => {
  it('layerSpacing widens the gap between layers', () => {
    const lines = AB()
    const near = layoutClassDiagram(parseClassDiagram(lines), { layerSpacing: 60 })
    const far = layoutClassDiagram(parseClassDiagram(lines), { layerSpacing: 200 })
    const gap = (pos: typeof near) => {
      const a = pos.classes.find(c => c.id === 'A')!
      const b = pos.classes.find(c => c.id === 'B')!
      return b.y - (a.y + a.height)
    }
    expect(gap(far)).toBeGreaterThan(gap(near) + 100)
  })

  it('nodeSpacing widens the gap between siblings', () => {
    const lines = toMermaidLines('classDiagram\nclass A\nclass B\nclass C\nA --> B\nA --> C')
    const near = layoutClassDiagram(parseClassDiagram(lines), { nodeSpacing: 40 })
    const far = layoutClassDiagram(parseClassDiagram(lines), { nodeSpacing: 160 })
    const gap = (pos: typeof near) => {
      const [l, r] = [pos.classes.find(c => c.id === 'B')!, pos.classes.find(c => c.id === 'C')!]
        .sort((p, q) => p.x - q.x)
      return r!.x - (l!.x + l!.width)
    }
    expect(gap(far)).toBeGreaterThan(gap(near) + 80)
  })
})

describe('class config section — wire-or-warn', () => {
  const withConfig = (cfg: string, body = 'classDiagram\n  class A\n  class B\n  A --> B') =>
    `---\nconfig:\n  class:\n${cfg}\n---\n${body}`

  it('class.nodeSpacing/rankSpacing are wired into the rendered geometry', () => {
    const base = renderMermaidSVG(withConfig('    rankSpacing: 60'))
    const spaced = renderMermaidSVG(withConfig('    rankSpacing: 300'))
    const height = (svg: string) => Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1])
    expect(height(spaced)).toBeGreaterThan(height(base) + 200)
  })

  it('explicit RenderOptions win over frontmatter config', () => {
    const src = withConfig('    rankSpacing: 300')
    const fromConfig = renderMermaidSVG(src)
    const overridden = renderMermaidSVG(src, { layerSpacing: 60 })
    const height = (svg: string) => Number(svg.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)![1])
    expect(height(overridden)).toBeLessThan(height(fromConfig) - 200)
  })

  it('documented-but-unwired class config keys emit INEFFECTIVE_CONFIG', () => {
    const v = verifyMermaid(withConfig('    htmlLabels: true\n    dividerMargin: 12\n    hideEmptyMembersBox: true'))
    const fields = v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields).toEqual(['dividerMargin', 'hideEmptyMembersBox', 'htmlLabels'])
    expect(v.ok).toBe(true) // Tier-3 lint never flips the verdict
  })

  it('wired class config keys never warn', () => {
    const v = verifyMermaid(withConfig('    nodeSpacing: 80\n    rankSpacing: 120'))
    expect(v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })
})
