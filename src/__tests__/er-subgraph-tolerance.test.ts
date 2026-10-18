/**
 * ER subgraphs (repo #103). Upstream's parser accepts flowchart-style
 * `subgraph … direction RL … end` inside an erDiagram (one upstream test pins
 * it, with the subgraph clause riding the header line). This renderer used to
 * hard-fail on the header-riding form ("Invalid mermaid header") because the
 * strict family detector only accepted a bare `erDiagram` header; subgraphs
 * are now modelled natively.
 *
 * Contract:
 *   - the header-riding form parses and renders instead of hard-failing,
 *   - body-form subgraph blocks render as semantic `er-subgraph` frames with
 *     their entities and relationships,
 *   - `direction` INSIDE a subgraph block is scoped to that group and does
 *     NOT leak into the diagram-level direction,
 *   - native subgraphs verify with no `er_subgraph` UNSUPPORTED_SYNTAX lint
 *     and no RENDER_FAILED,
 *   - the agent body models subgraph identity and ordered group boundaries
 *     around typed relations, and serialization round-trips canonically.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import { parseErDiagram } from '../er/parser.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid, layoutMermaid } from '../agent/index.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { assessRenderedLayout, familyHardViolations } from '../family-rubric.ts'
import { layoutErDiagram, ER_STYLE_DEFAULTS } from '../er/layout.ts'
import { separateRelationshipLabels } from '../er/renderer.ts'
import { resolveRenderStyle } from '../styles.ts'

const UPSTREAM_FORM = `erDiagram subgraph WithRL
direction RL
A
B
end`

const BODY_FORM = `erDiagram
  subgraph Domain
    CUSTOMER ||--o{ ORDER : places
  end
  ORDER ||--|| INVOICE : bills`

describe('er subgraph native rendering (#103)', () => {
  for (const [name, source] of Object.entries({
    'nested group beside an unrelated group': `erDiagram
subgraph title1
CUSTOMER
CUSTOMER {
string name
string custNumber
string sector
}
end
subgraph title2
CAR ||--o{ NAMED-DRIVER : allows
subgraph title3
PERSON
PERSON {
string firstName
string lastName
int age
}
end
end`,
    'relationships between neighboring group frames': `erDiagram
subgraph title1
A1 ||--|| A2 : links
end
subgraph title2
B1 ||--|| B2 : links
end
subgraph title3
C1 ||--|| C2 : links
end
title1 ||--|| title2 : links
title2 ||--|| title3 : links
title2 ||--|| C2 : links`,
    'nested groups with distinct scoped directions': `erDiagram
direction LR
subgraph TOP
direction TB
subgraph B1
direction RL
I1 ||--|| F1 : links
end
subgraph B2
direction BT
I2 ||--|| F2 : links
end
end
A ||--|| TOP : links
TOP ||--|| B : links
B1 ||--|| B2 : links`,
  })) {
    it(`separates ${name} without losing ownership or relationships`, () => {
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const view = layoutMermaid(parsed.value)
      const rubric = assessRenderedLayout(view)
      expect(familyHardViolations(rubric)).toEqual([])
      expect(rubric.metrics.regionIntrusions).toBe(0)
      const model = parseErDiagram(toMermaidLines(source))
      const positioned = layoutErDiagram(model)
      expect(positioned.entities.map(entity => entity.id)).toEqual(model.entities.map(entity => entity.id))
      expect(positioned.groups.map(group => [group.id, group.parentId])).toEqual(model.groups.map(group => [group.id, group.parentId]))
      expect(positioned.relationships.map(relation => [relation.entity1, relation.entity2, relation.label])).toEqual(model.relationships.map(relation => [relation.entity1, relation.entity2, relation.label]))
      const byId = new Map([...positioned.entities, ...positioned.groups].map(box => [box.id, box]))
      const labels = separateRelationshipLabels(positioned, resolveRenderStyle({}, ER_STYLE_DEFAULTS))
      const labelBoxes: { x: number; y: number; width: number; height: number }[] = []
      for (const relationship of positioned.relationships) {
        const at = labels.get(relationship)
        if (relationship.label) {
          expect(at).toBeDefined()
          if (at) {
            // Text must describe its own connector, including when every
            // relationship has the same authored label.
            const onRoute = relationship.points.some((b, i) => {
              if (i === 0) return false
              const a = relationship.points[i - 1]!
              return Math.abs(a.x - b.x) < 0.01
                ? Math.abs(at.x - a.x) < 0.01 && at.y >= Math.min(a.y, b.y) && at.y <= Math.max(a.y, b.y)
                : Math.abs(at.y - a.y) < 0.01 && at.x >= Math.min(a.x, b.x) && at.x <= Math.max(a.x, b.x)
            })
            expect(onRoute).toBe(true)
            const block = relationship.labelBlock!
            const pill = { x: at.x - (block.width + 8) / 2, y: at.y - (block.height + 6) / 2, width: block.width + 8, height: block.height + 6 }
            for (const other of [...positioned.entities, ...labelBoxes]) {
              const overlapX = Math.min(pill.x + pill.width, other.x + other.width) - Math.max(pill.x, other.x)
              const overlapY = Math.min(pill.y + pill.height, other.y + other.height) - Math.max(pill.y, other.y)
              expect(overlapX > 0.5 && overlapY > 0.5).toBe(false)
            }
            labelBoxes.push(pill)
          }
        }
        expect(relationship.points.length).toBeGreaterThanOrEqual(2)
        for (let i = 1; i < relationship.points.length; i++) {
          const a = relationship.points[i - 1]!, b = relationship.points[i]!
          expect(Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01).toBe(true)
          for (const entity of positioned.entities) {
            if (entity.id === relationship.entity1 || entity.id === relationship.entity2) continue
            const throughVertical = Math.abs(a.x - b.x) < 0.01 && a.x > entity.x + 0.5 && a.x < entity.x + entity.width - 0.5 &&
              Math.min(Math.max(a.y, b.y), entity.y + entity.height) - Math.max(Math.min(a.y, b.y), entity.y) > 0.5
            const throughHorizontal = Math.abs(a.y - b.y) < 0.01 && a.y > entity.y + 0.5 && a.y < entity.y + entity.height - 0.5 &&
              Math.min(Math.max(a.x, b.x), entity.x + entity.width) - Math.max(Math.min(a.x, b.x), entity.x) > 0.5
            expect(throughVertical || throughHorizontal).toBe(false)
          }
        }
        for (const [id, point] of [[relationship.entity1, relationship.points[0]!], [relationship.entity2, relationship.points.at(-1)!]] as const) {
          const box = byId.get(id)!
          const onVertical = Math.min(Math.abs(point.x - box.x), Math.abs(point.x - box.x - box.width)) < 0.01 && point.y >= box.y - 0.01 && point.y <= box.y + box.height + 0.01
          const onHorizontal = Math.min(Math.abs(point.y - box.y), Math.abs(point.y - box.y - box.height)) < 0.01 && point.x >= box.x - 0.01 && point.x <= box.x + box.width + 0.01
          expect(onVertical || onHorizontal).toBe(true)
        }
      }
      if (model.groups.some(group => group.id === 'B1')) {
        expect(byId.get('I1')!.x).toBeGreaterThan(byId.get('F1')!.x)
        expect(byId.get('I2')!.y).toBeGreaterThan(byId.get('F2')!.y)
      }
    })
  }

  it('the upstream header-riding form renders instead of hard-failing', () => {
    const svg = renderMermaidSVG(UPSTREAM_FORM)
    expect(svg).toContain('<svg')
    expect(svg).toContain('>A<')
    expect(svg).toContain('>B<')
    expect(svg).not.toContain('width="0" height="0"')
  })

  it('body-form subgraph blocks render as semantic frames with their content', () => {
    const svg = renderMermaidSVG(BODY_FORM)
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('ORDER')
    expect(svg).toContain('INVOICE')
    expect(svg).toContain('class="er-subgraph"')
    expect(svg).toContain('Domain')
  })

  it('direction inside a subgraph is scoped to that group and does not leak', () => {
    const d = parseErDiagram(toMermaidLines(BODY_FORM.replace('subgraph Domain', 'subgraph Domain\ndirection RL')))
    expect(d.direction).toBeUndefined()
    expect(d.groups[0]?.direction).toBe('RL')
    // top-level direction still works with subgraph blocks present
    const d2 = parseErDiagram(toMermaidLines(`erDiagram\ndirection TB\nsubgraph G\nA ||--|| B : x\nend`))
    expect(d2.direction).toBe('TB')
  })

  it('native subgraphs verify without unsupported-syntax or render-failure diagnostics', () => {
    const v = verifyMermaid(BODY_FORM)
    expect(v.warnings.some(w => w.code === 'UNSUPPORTED_SYNTAX' && (w as { syntax?: string }).syntax === 'er_subgraph')).toBe(false)
    expect(v.warnings.map(w => w.code)).not.toContain('RENDER_FAILED')
  })

  it('the legacy header-riding compatibility form remains renderable', () => {
    const v = verifyMermaid(UPSTREAM_FORM)
    expect(v.warnings.map(w => w.code)).not.toContain('RENDER_FAILED')
  })

  it('agent body models subgraph identity and ordered boundaries around typed relations', () => {
    const r = parseMermaid(BODY_FORM)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.kind).toBe('er')
    if (r.value.body.kind === 'er') {
      expect(r.value.body.groups).toEqual([{ id: 'Domain', label: 'Domain' }])
      expect(r.value.body.statements?.map(statement => statement.kind)).toEqual(['group-open', 'relation', 'group-close', 'relation'])
    }
    const canonical = serializeMermaid(r.value)
    expect(canonical).toContain('subgraph Domain')
    expect(canonical).toContain('end')
    const reparsed = parseMermaid(canonical)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(serializeMermaid(reparsed.value)).toBe(canonical)
  })
})
