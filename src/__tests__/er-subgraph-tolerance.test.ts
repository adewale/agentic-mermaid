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
import { describe, it, expect, spyOn } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'
import * as elkProducer from '../elk-instance.ts'
import { parseErDiagram } from '../er/parser.ts'
import { parseRegisteredMermaid as parseMermaid, serializeMermaid, verifyMermaid, layoutMermaid } from '../agent/index.ts'
import { toMermaidLines } from '../mermaid-source.ts'
import { assessRenderedLayout, familyHardViolations } from '../family-rubric.ts'
import { layoutErDiagram, ER_STYLE_DEFAULTS, ErRouteWorkLimitError } from '../er/layout.ts'
import { separateRelationshipLabels } from '../er/renderer.ts'
import { resolveRenderStyle } from '../styles.ts'
import { renderLoadedFamilySvg } from '../browser-lazy/render-core.ts'
import { resolveRenderRequestForExecution } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import { inspectScenePrimitives, scenePrimitiveSource } from '../scene/inspection.ts'
import { nodePaintBounds } from '../scene/bounds.ts'
import type { PositionedErDiagram } from '../er/types.ts'

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
  it('native and lazy rendering expose exhausted contained-route work', async () => {
    const source = ['erDiagram', 'subgraph p', 'subgraph c', 'A', 'end', ...Array.from({ length: 40 }, (_, i) => `B${i}`), 'end', ...Array.from({ length: 1000 }, () => 'p ||--|| c : contains')].join('\n')
    expect(() => renderMermaidSVG(source)).toThrow(ErRouteWorkLimitError)
    const elk = spyOn(elkProducer, 'elkLayoutSync')
    try {
      // This request genuinely spends the common family allowance. A typed
      // Native refusal cannot buy another 400000 checks by asking for ELK.
      expect(() => layoutErDiagram(parseErDiagram(toMermaidLines(source)), { graphLayout: { backend: 'agentic', fallback: 'elk' } })).toThrow(ErRouteWorkLimitError)
      expect(elk).not.toHaveBeenCalled()
    } finally { elk.mockRestore() }
    const { default: browser } = await import('../browser-lazy/families/er.ts')
    await expect(renderLoadedFamilySvg(source, {}, browser)).rejects.toMatchObject({ name: 'ErRouteWorkLimitError', code: 'ER_ROUTE_WORK_LIMIT' })
  })

  it('native and lazy rendering expose exhausted retained-label work', async () => {
    const source = ['erDiagram', ...Array.from({ length: 500 }, (_, i) => `N${i} ||--|| N${i + 1} : links`)].join('\n')
    expect(() => renderMermaidSVG(source)).toThrow(/ER_LABEL_WORK_LIMIT/)
    const { default: browser } = await import('../browser-lazy/families/er.ts')
    await expect(renderLoadedFamilySvg(source, {}, browser)).rejects.toThrow(/ER_LABEL_WORK_LIMIT/)
  })

  for (const [name, source] of Object.entries({
    // Separating the compound from the components below it moves one end of
    // V's relationship, so its route is rebuilt past X and T.
    'an entity relationship into a group past separated components': `erDiagram
X
subgraph g
N C1 ||--|| C2 : r
end
T ||--|| U : r
V ||--|| C2 : r`,
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
    'ancestor frame to descendant frame beside retained content': `erDiagram
subgraph commerce [Commerce Domain]
CUSTOMER
subgraph orders [Order Domain]
ORDER
end
end
commerce ||--o{ orders : contains
"This **is** _Markdown_"
C ||--|| D : unrelated`,
    'descendant frame to ancestor frame': `erDiagram
subgraph commerce
CUSTOMER
subgraph orders
ORDER
end
end
orders }o--|| commerce : belongs`,
    'indirect ancestor with repeated and entity relationships': `erDiagram
subgraph outer
subgraph middle
subgraph inner
ITEM
end
end
end
outer ||--o{ inner : contains
inner }o--|| outer : belongs
outer ||--|| ITEM : owns`,
    'empty nested frames in both directions': `erDiagram
subgraph outer
subgraph inner
end
end
outer ||--o{ inner : contains
inner }o--|| outer : belongs`,
    'descendant frame before a lower sibling card': `erDiagram
subgraph p
subgraph c
A
end
B
end
p ||--|| c : contains`,
    'empty nested frame to an external frame beyond its parent header': `erDiagram
direction TB
subgraph ext
end
subgraph outer
subgraph inner
end
end
inner ||--|| ext : links`,
    'a descendant frame and unrelated entity with the same authored name': `erDiagram
subgraph p
subgraph q
X
end
q
end
p ||--|| q : contains`,
    'different descendant frame lanes': `erDiagram
subgraph p
subgraph c
A
end
subgraph d
B
end
end
p ||--|| c : first
p ||--|| d : second`,
    'indirect descendant frame before a lower sibling': `erDiagram
subgraph p
subgraph middle
subgraph c
A
end
B
end
end
p ||--|| c : contains`,
    'tracked repeated ancestor labels': `erDiagram
subgraph p
subgraph c
A
end
B
end
p ||--|| c : first
p ||--|| c : second
c ||--|| p : reply`,
    'tracked empty reverse frame labels': `erDiagram
subgraph p
subgraph c
end
end
p ||--|| c : contains
c ||--|| p : belongs`,
    'tracked empty external frame label': `erDiagram
direction TB
subgraph ext
end
subgraph outer
subgraph inner
end
end
inner ||--|| ext : links`,
  })) {
    it(`separates ${name} without losing ownership or relationships`, () => {
      const options = name.startsWith('tracked ') ? { style: { roles: { relationship: { fontSize: 22, letterSpacing: 1 }, group: { fontSize: 18 } } } } : {}
      expect(() => renderMermaidSVG(source, options)).not.toThrow()
      if (name.startsWith('tracked ')) expect(() => renderMermaidSVG(source, { ...options, layoutSafety: 'strict' })).not.toThrow()
      expect(verifyMermaid(source, { renderOptions: options }).ok).toBe(true)
      const parsed = parseMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      const view = layoutMermaid(parsed.value, options)
      const rubric = assessRenderedLayout(view)
      expect(familyHardViolations(rubric)).toEqual([])
      expect(rubric.metrics.regionIntrusions).toBe(0)
      const model = parseErDiagram(toMermaidLines(source))
      const request = resolveRenderRequestForExecution(source, options, 'svg')
      const artifact = positionResolvedFamily('er', request)
      const positioned = artifact.positioned as PositionedErDiagram
      const paint = inspectScenePrimitives(lowerPositionedFamilyScene(request, artifact))
      const markers = paint.primitives.filter(primitive => primitive.role === 'cardinality')
      const pills = paint.primitives.filter(primitive => primitive.id.startsWith('rel-label:') && primitive.id.endsWith(':bg'))
      expect(markers).toHaveLength(positioned.relationships.length * 2)
      for (const marker of markers) {
        const node = scenePrimitiveSource(marker)!
        if (node.kind !== 'shape' || node.geometry.kind !== 'compound') throw new Error('Expected native cardinality pieces')
        expect(node.geometry.children.length).toBeGreaterThan(0)
        for (const pill of pills) {
          expect(pill.bounds).toBeDefined()
          for (const geometry of node.geometry.children) {
            const a = nodePaintBounds({ ...node, geometry })!, b = pill.bounds!
            expect(Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > .01 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > .01).toBe(false)
          }
        }
      }
      const unrelated = positioned.relationships.find(relation => relation.label === 'unrelated')
      if (unrelated) {
        const baseline = layoutErDiagram({ ...model, relationships: model.relationships.filter(relation => relation.label !== 'contains') }).relationships.find(relation => relation.label === 'unrelated')!
        expect(unrelated.points).toHaveLength(2)
        const dx = unrelated.points[0]!.x - baseline.points[0]!.x, dy = unrelated.points[0]!.y - baseline.points[0]!.y
        unrelated.points.forEach((point, i) => {
          expect(point.x - dx).toBeCloseTo(baseline.points[i]!.x, 6)
          expect(point.y - dy).toBeCloseTo(baseline.points[i]!.y, 6)
        })
      }
      expect(positioned.entities.map(entity => entity.id)).toEqual(model.entities.map(entity => entity.id))
      expect(positioned.groups.map(group => [group.id, group.parentId])).toEqual(model.groups.map(group => [group.id, group.parentId]))
      expect(positioned.relationships.map(relation => [relation.entity1, relation.entity2, relation.label])).toEqual(model.relationships.map(relation => [relation.entity1, relation.entity2, relation.label]))
      const byId = new Map([...positioned.entities, ...positioned.groups].map(box => [box.id, box]))
      const routeObstacles = [...positioned.entities.map(box => ({ box, header: false })), ...positioned.groups.map(group => ({ box: { ...group, height: group.headerHeight }, header: true }))]
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
            for (const other of [...positioned.entities, ...positioned.groups.map(group => ({ ...group, height: group.headerHeight })), ...labelBoxes]) {
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
          for (const { box: entity, header } of routeObstacles) {
            if (!header && !positioned.groups.some(group => group.id === entity.id) && (entity.id === relationship.entity1 || entity.id === relationship.entity2)) continue
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
      if (name === 'different descendant frame lanes') {
        expect(new Set(positioned.relationships.map(relation => JSON.stringify(relation.points[0]))).size).toBe(2)
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
