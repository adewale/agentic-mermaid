/**
 * ER `direction` wiring + spacing render options + typed `er` config section
 * with wire-or-warn (plan §ER 6; upstream shipped ER direction in v11.4;
 * beautiful-mermaid#131; addresses "ER gets really wide" #2807).
 *
 * This fork's default ER flow stays LR (a deliberate divergence from
 * upstream's TB default — changing it would reflow every existing ER golden),
 * so the wiring is: direction statement > er.layoutDirection config > LR.
 *
 * Invariant gates: for `A ||--o{ B : has`,
 *   TB ⇒ B strictly below A;  RL ⇒ B strictly left of A;
 *   BT ⇒ B strictly above A;  LR (default) ⇒ B strictly right of A.
 *
 * Config contract (verified against the upstream er config schema 2026-07):
 * layoutDirection + nodeSpacing/rankSpacing are WIRED; the other documented
 * keys (titleTopMargin, diagramPadding, minEntityWidth, minEntityHeight,
 * entityPadding, stroke, fill, fontSize) emit INEFFECTIVE_CONFIG (P4).
 */
import { describe, it, expect } from 'bun:test'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { renderMermaidSVG } from '../index.ts'
import { verifyMermaid } from '../agent/index.ts'
import { toMermaidLines } from '../mermaid-source.ts'

const AB = (direction?: string) => toMermaidLines(
  ['erDiagram', ...(direction ? [`direction ${direction}`] : []), 'A ||--o{ B : has'].join('\n'))

const positioned = (direction?: string) => {
  const pos = layoutErDiagram(parseErDiagram(AB(direction)))
  const a = pos.entities.find(e => e.id === 'A')!
  const b = pos.entities.find(e => e.id === 'B')!
  return { a, b }
}

describe('er direction statement', () => {
  it('parses direction into the diagram model', () => {
    expect(parseErDiagram(AB('TB')).direction).toBe('TB')
    expect(parseErDiagram(AB()).direction).toBeUndefined()
  })

  it('default stays left-right (B right of A)', () => {
    const { a, b } = positioned()
    expect(b.x).toBeGreaterThan(a.x + a.width - 0.5)
  })

  it('TB puts B below A', () => {
    const { a, b } = positioned('TB')
    expect(b.y).toBeGreaterThan(a.y + a.height - 0.5)
  })

  it('RL puts B left of A', () => {
    const { a, b } = positioned('RL')
    expect(b.x + b.width).toBeLessThan(a.x + 0.5)
  })

  it('BT puts B above A', () => {
    const { a, b } = positioned('BT')
    expect(b.y + b.height).toBeLessThan(a.y + 0.5)
  })

  it('a direction-RL ER diagram renders end-to-end', () => {
    const svg = renderMermaidSVG('erDiagram\n  direction RL\n  CUSTOMER ||--o{ ORDER : places')
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('ORDER')
  })
})

describe('er spacing render options', () => {
  it('layerSpacing widens the gap between layers', () => {
    const lines = AB()
    const near = layoutErDiagram(parseErDiagram(lines), { layerSpacing: 90 })
    const far = layoutErDiagram(parseErDiagram(lines), { layerSpacing: 260 })
    const gap = (pos: typeof near) => {
      const a = pos.entities.find(e => e.id === 'A')!
      const b = pos.entities.find(e => e.id === 'B')!
      return b.x - (a.x + a.width)
    }
    expect(gap(far)).toBeGreaterThan(gap(near) + 120)
  })

  it('nodeSpacing widens the gap between siblings', () => {
    const lines = toMermaidLines('erDiagram\nA ||--o{ B : x\nA ||--o{ C : y')
    const near = layoutErDiagram(parseErDiagram(lines), { nodeSpacing: 70 })
    const far = layoutErDiagram(parseErDiagram(lines), { nodeSpacing: 220 })
    const gap = (pos: typeof near) => {
      const [t, u] = [pos.entities.find(e => e.id === 'B')!, pos.entities.find(e => e.id === 'C')!]
        .sort((p, q) => p.y - q.y)
      return u!.y - (t!.y + t!.height)
    }
    expect(gap(far)).toBeGreaterThan(gap(near) + 100)
  })
})

describe('er config section — wire-or-warn', () => {
  const withConfig = (cfg: string, body = 'erDiagram\n  A ||--o{ B : has') =>
    `---\nconfig:\n  er:\n${cfg}\n---\n${body}`

  it('er.layoutDirection is wired (TB flows downward)', () => {
    const horizontal = renderMermaidSVG(withConfig('    layoutDirection: LR'))
    const vertical = renderMermaidSVG(withConfig('    layoutDirection: TB'))
    const dims = (svg: string) => {
      const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!
      return { w: Number(m[1]), h: Number(m[2]) }
    }
    expect(dims(vertical).h).toBeGreaterThan(dims(horizontal).h)
    expect(dims(vertical).w).toBeLessThan(dims(horizontal).w)
  })

  it('the direction statement wins over er.layoutDirection config', () => {
    const src = withConfig('    layoutDirection: TB', 'erDiagram\n  direction LR\n  A ||--o{ B : has')
    const svg = renderMermaidSVG(src)
    const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!
    expect(Number(m[1])).toBeGreaterThan(Number(m[2])) // wide, not tall
  })

  it('er.nodeSpacing/rankSpacing are wired into the rendered geometry', () => {
    const base = renderMermaidSVG(withConfig('    rankSpacing: 90'))
    const spaced = renderMermaidSVG(withConfig('    rankSpacing: 320'))
    const width = (svg: string) => Number(svg.match(/viewBox="0 0 ([\d.]+) /)![1])
    expect(width(spaced)).toBeGreaterThan(width(base) + 180)
  })

  it('documented-but-unwired er config keys emit INEFFECTIVE_CONFIG', () => {
    const v = verifyMermaid(withConfig('    stroke: gray\n    fill: honeydew\n    minEntityWidth: 100'))
    const fields = v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG').map(w => (w as { field: string }).field)
    expect(fields).toEqual(['fill', 'minEntityWidth', 'stroke'])
    expect(v.ok).toBe(true)
  })

  it('wired er config keys never warn', () => {
    const v = verifyMermaid(withConfig('    layoutDirection: TB\n    nodeSpacing: 140\n    rankSpacing: 80'))
    expect(v.warnings.filter(w => w.code === 'INEFFECTIVE_CONFIG')).toEqual([])
  })
})
