import { describe, expect, test } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

const sharedPolicy = {
  semanticSlots: {
    selected: {
      fillColor: '#ff66cc',
      borderColor: '#2255aa',
      strokeColor: '#2255aa',
      textColor: '#111111',
      lineWidth: 4,
    },
  },
  bindings: [
    { channel: 'category', value: 'A', slot: 'selected', role: 'actor' },
    { channel: 'category', value: 'identifying', slot: 'selected', role: 'relationship' },
  ],
} as const

function actorBox(svg: string, id: string): string {
  const actorGroup = svg.match(new RegExp(`<g class="actor"[^>]*data-id="${id}"[\\s\\S]*?</g>`))?.[0]
  if (!actorGroup) throw new Error(`missing actor ${id}`)
  return actorGroup.match(/<rect\b[^>]*>/)?.[0] ?? ''
}

function relationship(svg: string, identifying: boolean): string {
  return svg.match(new RegExp(`<(?:path|polyline) class="er-relationship"[^>]*data-identifying="${identifying}"[^>]*>`))?.[0] ?? ''
}

describe('Section B structural/domain semantic bindings', () => {
  test('Sequence actor tracking is measured by the same resolved tuple that renders it', () => {
    const source = 'sequenceDiagram\n  participant A as Wide tracking witness\n  participant B\n  A->>B: ping'
    const baseline = renderMermaidSVG(source)
    const tracked = renderMermaidSVG(source, { style: { roles: { actor: { letterSpacing: 4 } } } })
    const width = (svg: string) => Number(actorBox(svg, 'A').match(/width="([^"]+)"/)?.[1])
    expect(width(tracked)).toBeGreaterThan(width(baseline))
    expect(tracked).toContain('letter-spacing="4"')
  })

  test('Journey section and ER relationship tracking participate in allocated geometry', () => {
    const journey = 'journey\n  section MeasuredTracking\n    x: 3: U'
    const journeyBaseline = renderMermaidSVG(journey)
    const journeyTracked = renderMermaidSVG(journey, { style: { roles: { 'group-header': { letterSpacing: 4 } } } })
    const sectionWidth = (svg: string) => Number(svg.match(/journey-section-bg[^>]+width="([^"]+)/)?.[1])
    expect(sectionWidth(journeyTracked)).toBeGreaterThan(sectionWidth(journeyBaseline))
    expect(journeyTracked).toContain('letter-spacing="4"')

    const er = 'erDiagram\n  A ||--o{ B : tracking witness'
    const erBaseline = renderMermaidSVG(er)
    const erTracked = renderMermaidSVG(er, { style: { roles: { relationship: { letterSpacing: 4 } } } })
    const pillWidth = (svg: string) => Number(svg.match(/<rect[^>]+width="([^"]+)"[^>]+stroke-width="0\.5"/)?.[1])
    expect(pillWidth(erTracked)).toBeGreaterThan(pillWidth(erBaseline))
    expect(erTracked).toContain('letter-spacing="4"')
  })

  test('one named slot styles Sequence actor and ER relationship without changing authored geometry or semantics', () => {
    const sequence = `sequenceDiagram
      box rgb(33,66,99) Ops
        participant A
        participant B
      end
      A->>B: ping`
    const er = `erDiagram
      A ||--o{ B : owns
      A ||..o{ C : observes`

    const sequenceBaseline = renderMermaidSVG(sequence)
    const sequenceBranded = renderMermaidSVG(sequence, { style: sharedPolicy })
    const baselineActor = actorBox(sequenceBaseline, 'A')
    const brandedActor = actorBox(sequenceBranded, 'A')
    expect(brandedActor).toContain('fill="#ff66cc"')
    expect(brandedActor).toContain('stroke="#2255aa"')
    expect(brandedActor).toContain('stroke-width="4"')
    for (const geometry of ['x', 'y', 'width', 'height', 'rx', 'ry']) {
      expect(brandedActor.match(new RegExp(`${geometry}="([^"]+)"`))?.[1], geometry)
        .toBe(baselineActor.match(new RegExp(`${geometry}="([^"]+)"`))?.[1])
    }
    // Family-authored box paint remains authoritative over its own mark.
    expect(sequenceBranded).toContain('data-label="Ops"')
    expect(sequenceBranded).toContain('fill="rgb(33,66,99)"')

    const erBaseline = renderMermaidSVG(er)
    const erBranded = renderMermaidSVG(er, { style: sharedPolicy })
    const baselineIdentifying = relationship(erBaseline, true)
    const brandedIdentifying = relationship(erBranded, true)
    expect(brandedIdentifying).toContain('stroke="#2255aa"')
    expect(brandedIdentifying).toContain('stroke-width="4"')
    expect(brandedIdentifying.match(/(?:d|points)="([^"]+)"/)?.[1])
      .toBe(baselineIdentifying.match(/(?:d|points)="([^"]+)"/)?.[1])
    // Authored ER relationship semantics still decide solid vs dashed.
    expect(brandedIdentifying).not.toContain('stroke-dasharray')
    expect(relationship(erBranded, false)).toContain('stroke-dasharray="6 4"')
    expect(erBranded).toMatch(/<text[^>]*fill="#111111"[^>]*>owns<\/text>/)
    expect(erBranded).toContain('data-cardinality1=')
    expect(erBranded).toContain('data-cardinality2=')
  })
})
