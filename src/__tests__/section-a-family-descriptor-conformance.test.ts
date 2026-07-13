import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import '../render-family-hooks.ts'
import {
  FAMILY_CAPABILITY_COLUMNS,
  getFamily,
  knownBuiltinFamilies,
  type BuiltinFamilyId,
} from '../agent/families.ts'
import { BUILTIN_SCENE_ROLE_TRAITS } from '../scene/roles.ts'
import { CORE_SCENE_PRIMITIVES, sceneNodePrimitives } from '../scene/capabilities.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from '../types.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { assertRenderableMarker, serializeMarkerResource } from '../scene/marker-resources.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'

const ROOT = join(import.meta.dir, '..', '..')

/** Extra syntax broadens role coverage beyond each descriptor's minimal
 * discovery example. This is test stimulus, not a family/capability roster. */
const RICH_SCENE_FIXTURES: Partial<Record<BuiltinFamilyId, string>> = {
  flowchart: `flowchart LR
  subgraph ops[Operations]
    A@{ icon: "fa fa-book", form: "circle", label: "Start" }
    U@{ icon: "acme:unknown", label: "Fallback" }
  end
  U --> A -->|go| B{Ready?}`,
  state: `stateDiagram-v2
  state Work {
    [*] --> Draft
    Draft --> Done : finish
  }
  note right of Work : Review
  [*] --> Work`,
  sequence: `sequenceDiagram
  box Aqua Team
    actor A as Alice
    participant B@{ "type": "database", "alias": "Bob" }
  end
  link A: profile @ https://example.com
  activate A
  A->>B: request
  alt accepted
    B-->>A: response
  else delayed
    Note over A,B: wait
  end
  deactivate A
  destroy B
  A->>()B: publish
  A-xB: done`,
  timeline: `timeline
  title Launch
  section Alpha
    2026 Q1 : Design : Build
  section Beta
    2026 Q2 : Ship`,
  class: `classDiagram
  namespace Domain {
    class Account {
      +id: string
      +close()
    }
  }
  class Ledger
  note for Account "Aggregate root"
  Account "1" o-- "*" Ledger : records`,
  er: `erDiagram
  subgraph Commerce
    CUSTOMER ||--o{ ORDER : places
    CUSTOMER {
      string id PK
      string name
    }
  end
  ORDER {
    string id PK
  }`,
  journey: `journey
  title Checkout
  section Browse
    Find product: 4: Shopper, Assistant
  section Buy
    Pay: 2: Shopper`,
  architecture: `architecture-beta
  title Platform
  group app(cloud)[Application]
  service api(server)[API] in app
  service db(database)[Database] in app
  junction bus in app
  api:R --> L:bus
  bus:R -[writes]-> L:db`,
  xychart: `---
config:
  xyChart:
    showDataLabel: true
---
xychart-beta
  title Revenue
  x-axis [Q1, Q2, Q3]
  y-axis USD 0 --> 100
  bar Online [30, 55, 80]
  line Forecast [25, 60, 75]`,
  pie: `pie showData
  title Plans
  "Free" : 60
  "Pro" : 30
  "Enterprise" : 10`,
  quadrant: `quadrantChart
  title Prioritize
  x-axis Low Effort --> High Effort
  y-axis Low Value --> High Value
  quadrant-1 Invest
  Quick win: [0.2, 0.8]
  Money pit: [0.8, 0.2]`,
  gantt: `gantt
  title Delivery
  dateFormat YYYY-MM-DD
  section Build
  Implement :crit, build, 2026-01-05, 5d
  Release :milestone, release, after build, 0d
  Cutover :vert, cutover, 2026-01-09, 0d`,
  mindmap: `mindmap
  root((Product))
    Research
      ::icon(fa fa-book)
      Interviews
      Evidence
    Delivery
      ::icon(acme:unknown)
      Launch`,
  gitgraph: `---
title: Release train
---
gitGraph
  commit id:"base" tag:"v1"
  branch feature
  commit id:"work"
  checkout main
  merge feature id:"merge"`,
}

function lowerFixture(id: BuiltinFamilyId, sourceText: string): SceneDoc {
  const descriptor = getFamily(id)!
  const options: RenderOptions = {
    interactive: true,
    shadow: true,
    ganttToday: '2026-01-08',
    gantt: { dependencyArrows: true, criticalPath: true },
  }
  const request = resolveRenderRequest(sourceText, options, 'svg')
  const result = positionResolvedFamily(id, request)
  const context: RenderContext = {
    positioned: result.positioned,
    colors: request.appearance.colors,
    options: request.renderOptions,
  }
  return descriptor.lowerScene!(context)
}

function visitScene(nodes: readonly SceneNode[], visit: (node: SceneNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'group') visitScene(node.children.map(child => child.node), visit)
  }
}

describe('family descriptor capability authority', () => {
  test('every built-in declares a complete, unique, repository-backed capability ledger', () => {
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      expect(descriptor.renderSvg, `${id} duplicate graphical waist`).toBeUndefined()
      expect(descriptor.capabilityEvidence.map(claim => claim.capability), `${id} capability columns`)
        .toEqual([...FAMILY_CAPABILITY_COLUMNS])
      expect(new Set(descriptor.semanticRoles).size, `${id} duplicate role declarations`)
        .toBe(descriptor.semanticRoles.length)
      expect(descriptor.scenePrimitiveEvidence.length, `${id} complete role/primitive matrix`)
        .toBe(descriptor.semanticRoles.length * CORE_SCENE_PRIMITIVES.length)
      for (const role of descriptor.semanticRoles) {
        for (const primitive of CORE_SCENE_PRIMITIVES) {
          const cells = descriptor.scenePrimitiveEvidence.filter(cell => cell.role === role && cell.primitive === primitive)
          expect(cells, `${id}/${role}/${primitive} unique evidence cell`).toHaveLength(1)
          const cell = cells[0]!
          expect(cell.evidence.length, `${id}/${role}/${primitive} evidence`).toBeGreaterThan(0)
          if (cell.applicability === 'not-applicable') {
            expect(cell.realization, `${id}/${role}/${primitive} explicit negative realization`).toBe('unsupported')
            expect(cell.diagnostic?.trim().length, `${id}/${role}/${primitive} negative diagnostic`).toBeGreaterThan(0)
          } else {
            expect(cell.realization, `${id}/${role}/${primitive} positive realization`).not.toBe('unsupported')
          }
        }
      }
      for (const claim of descriptor.capabilityEvidence) {
        expect(claim.evidence.length, `${id}/${claim.capability} evidence`).toBeGreaterThan(0)
        for (const path of claim.evidence) {
          expect(existsSync(join(ROOT, path)), `${id}/${claim.capability}: ${path}`).toBe(true)
        }
      }
    }
  })

  test('recursive Scene lowering emits only declared, valid roles on valid mark kinds', () => {
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      expect(descriptor.layout, `${id} layout`).toBeDefined()
      expect(descriptor.lowerScene, `${id} Scene lowering`).toBeDefined()
      expect(descriptor.example, `${id} canonical example`).toBeDefined()
      if (!descriptor.layout || !descriptor.lowerScene || !descriptor.example) continue

      const observed = new Set<string>()
      const observedCells = new Set<string>()
      const sources = [descriptor.example, RICH_SCENE_FIXTURES[id]].filter((source): source is string => source !== undefined)
      for (const source of sources) {
        const scene = lowerFixture(id, source)
        const markerResources = new Map<string, NonNullable<Extract<SceneNode, { kind: 'document' }>['markerResources']>[number]>()
        visitScene(scene.parts, node => {
          if (node.kind !== 'document') return
          if (node.crisp.includes('<marker')) expect(node.markerResources?.length, `${id} has untyped marker XML`).toBeGreaterThan(0)
          for (const marker of node.markerResources ?? []) {
            assertRenderableMarker(marker)
            expect(markerResources.has(marker.id), `${id} duplicate marker resource ${marker.id}`).toBe(false)
            expect(node.crisp, `${id} marker ${marker.id} serializer ownership`).toContain(serializeMarkerResource(marker))
            markerResources.set(marker.id, marker)
          }
        })
        visitScene(scene.parts, node => {
          observed.add(node.role)
          for (const primitive of sceneNodePrimitives(node)) {
            const key = `${node.role}:${primitive}`
            observedCells.add(key)
            expect(descriptor.scenePrimitiveEvidence, `${id} emitted undeclared primitive cell ${key}`).toContainEqual(
              expect.objectContaining({ role: node.role, primitive, applicability: 'applicable' }),
            )
          }
          expect(descriptor.semanticRoles, `${id} emitted undeclared role ${node.role}`).toContain(node.role)
          const traits = (BUILTIN_SCENE_ROLE_TRAITS as Partial<Record<string, (typeof BUILTIN_SCENE_ROLE_TRAITS)[keyof typeof BUILTIN_SCENE_ROLE_TRAITS]>>)[node.role]
          expect(traits, `${id} emitted unknown built-in role ${node.role}`).toBeDefined()
          expect(traits?.applicableKinds, `${id}/${node.role} cannot apply to ${node.kind}`).toContain(node.kind)
          if (node.kind === 'connector') {
            for (const marker of [node.markers.start, ...node.markers.mid, node.markers.end]) {
              if (!marker) continue
              expect(markerResources.get(marker.id), `${id} connector references unowned marker ${marker.id}`).toEqual(marker)
            }
          }
        })
      }
      expect(observed.size, `${id} emitted no semantic roles`).toBeGreaterThan(0)
      const declaredPositiveCells = descriptor.scenePrimitiveEvidence
        .filter(cell => cell.applicability === 'applicable')
        .map(cell => `${cell.role}:${cell.primitive}`)
        .sort()
      expect([...observedCells].sort(), `${id} must exercise every declared positive cell`)
        .toEqual(declaredPositiveCells)
    }
  })
})
