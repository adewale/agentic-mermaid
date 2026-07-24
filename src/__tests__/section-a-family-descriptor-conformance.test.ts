import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { layoutMermaid } from '../agent/core.ts'
import { type BuiltinFamilyId, FAMILY_CAPABILITY_COLUMNS, type FamilyDescriptor, getFamily, knownBuiltinFamilies, replaceFamilyForTest } from '../agent/families.ts'
import { mutate } from '../agent/mutate.ts'
import { parseRegisteredMermaid as parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import type { AnyMutationOp, MutableValidDiagram } from '../agent/types.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../index.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { CORE_SCENE_PRIMITIVES, sceneNodePrimitives } from '../scene/capabilities.ts'
import type { SceneDoc, SceneNode } from '../scene/ir.ts'
import { assertRenderableMarker, serializeMarkerResource } from '../scene/marker-resources.ts'
import { BUILTIN_SCENE_ROLE_TRAITS } from '../scene/roles.ts'
import { sceneNodeSerialization } from '../scene/serialization.ts'
import type { PositionedDiagram, RenderContext, RenderOptions } from '../types.ts'

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
      string id PK "stable customer identifier"
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
  pie: `%%{init: {"themeVariables": {"pieOuterStrokeWidth": "2px", "pieOuterStrokeColor": "#654321"}}}%%
pie showData
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
  sankey: `---
title: Energy flows
---
sankey-beta
  Coal,Electricity generation,127.93
  Gas,Electricity generation,151.89
  Electricity generation,Industry,342.16
  Electricity generation,Losses,56.69`,
}

const CAPABILITY_MUTATIONS: Readonly<Record<BuiltinFamilyId, AnyMutationOp>> = {
  flowchart: { kind: 'add_node', id: 'CapabilityWitness', label: 'Capability witness' },
  state: { kind: 'add_state', id: 'CapabilityWitness', label: 'Capability witness' },
  sequence: { kind: 'add_participant', id: 'CapabilityWitness', label: 'Capability witness' },
  timeline: { kind: 'set_title', title: 'Capability witness' },
  class: { kind: 'add_class', id: 'CapabilityWitness' },
  er: { kind: 'add_entity', id: 'CAPABILITY_WITNESS' },
  journey: { kind: 'set_title', title: 'Capability witness' },
  architecture: { kind: 'set_title', title: 'Capability witness' },
  xychart: { kind: 'set_title', title: 'Capability witness' },
  sankey: { kind: 'add_link', source: 'Capability witness', target: 'Capability sink', value: 1 },
  pie: { kind: 'set_title', title: 'Capability witness' },
  quadrant: { kind: 'set_title', title: 'Capability witness' },
  gantt: { kind: 'set_title', title: 'Capability witness' },
  mindmap: { kind: 'set_accessibility_title', title: 'Capability witness' },
  gitgraph: { kind: 'set_accessibility_title', title: 'Capability witness' },
  radar: { kind: 'set_title', title: 'Capability witness' },
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
    resolved: {
      renderOptions: request.renderOptions,
      ...(request.appearance.face ? { styleFace: request.appearance.face } : {}),
      ...(request.familyConfig ? { familyConfig: request.familyConfig } : {}),
      ...(request.appearance.family ? { familyAppearance: request.appearance.family } : {}),
    },
  }
  return descriptor.lowerScene!(context)
}

function visitScene(nodes: readonly SceneNode[], visit: (node: SceneNode) => void): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'group')
      visitScene(
        node.children.map(child => child.node),
        visit,
      )
  }
}

describe('family descriptor capability authority', () => {
  test('every built-in declares a complete, unique, repository-backed capability ledger', () => {
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      expect(descriptor.renderSvg, `${id} duplicate graphical waist`).toBeUndefined()
      expect(
        descriptor.capabilityEvidence.map(claim => claim.capability),
        `${id} capability columns`,
      ).toEqual([...FAMILY_CAPABILITY_COLUMNS])
      expect(new Set(descriptor.semanticRoles).size, `${id} duplicate role declarations`).toBe(descriptor.semanticRoles.length)
      expect(descriptor.scenePrimitiveEvidence.length, `${id} complete role/primitive matrix`).toBe(descriptor.semanticRoles.length * CORE_SCENE_PRIMITIVES.length)
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

  test('every native built-in capability is exercised through its real implementation path', () => {
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      const calls = new Map<string, number>()
      const hit = (name: string): void => {
        calls.set(name, (calls.get(name) ?? 0) + 1)
      }
      const wrapped: FamilyDescriptor = {
        ...descriptor,
        detect: line => {
          hit('detection')
          return descriptor.detect(line)
        },
        ...(descriptor.detectLoose
          ? {
              detectLoose: (line: string) => {
                hit('detection')
                return descriptor.detectLoose!(line)
              },
            }
          : {}),
        normalizeRequest: ctx => {
          hit('normalization')
          return descriptor.normalizeRequest!(ctx)
        },
        extractLabels: source => {
          hit('label-extraction')
          return descriptor.extractLabels!(source)
        },
        parse: ctx => {
          hit('parse')
          return descriptor.parse!(ctx)
        },
        ...(descriptor.buildSourceMap ? { buildSourceMap: (body, source) => descriptor.buildSourceMap!(body, source) } : {}),
        serialize: body => {
          hit('serialize')
          return descriptor.serialize!(body)
        },
        mutate: (body, op) => {
          hit('mutation')
          return descriptor.mutate!(body, op)
        },
        ...(descriptor.verify
          ? {
              verify: (body, options) => {
                hit('verify-hook')
                return descriptor.verify!(body, options)
              },
            }
          : {}),
        layout: ctx => {
          hit('layout')
          return descriptor.layout!(ctx)
        },
        projectPositioned: ctx => {
          hit('positioned-projection')
          return descriptor.projectPositioned!(ctx)
        },
        lowerScene: ctx => {
          hit('scene')
          return descriptor.lowerScene!(ctx)
        },
        renderAscii: ctx => {
          hit('terminal')
          return descriptor.renderAscii!(ctx)
        },
      }
      const restore = replaceFamilyForTest(id, wrapped)
      calls.clear() // registration validation executes detection; it is not the witness.
      try {
        expect(getFamily(id)!.extractLabels!(descriptor.example!), `${id} label-extraction witness`).toBeArray()
        const parsed = parseMermaid(descriptor.example!)
        expect(parsed.ok, `${id} parse witness`).toBe(true)
        if (!parsed.ok) continue
        const serialized = serializeMermaid(parsed.value)
        expect(serialized.length, `${id} serialize witness`).toBeGreaterThan(0)
        const reparsed = parseMermaid(serialized)
        expect(reparsed.ok, `${id} source-preservation reparse witness`).toBe(true)
        if (reparsed.ok) expect(serializeMermaid(reparsed.value), `${id} stable source-preservation witness`).toBe(serialized)
        hit('source-preservation')
        expect(mutate(parsed.value as MutableValidDiagram, CAPABILITY_MUTATIONS[id]).ok, `${id} mutation witness`).toBe(true)
        expect(verifyMermaid(parsed.value).warnings, `${id} verify witness`).toBeArray()
        hit('verify')
        expect(layoutMermaid(parsed.value).kind, `${id} layout projection witness`).toBe(id)
        expect(renderMermaidSVG(descriptor.example!, { embedFontImport: false }), `${id} SVG witness`).toContain('<svg')
        hit('svg')
        expect(renderMermaidASCII(descriptor.example!, { colorMode: 'none' }).trim().length, `${id} terminal witness`).toBeGreaterThan(0)

        for (const capability of FAMILY_CAPABILITY_COLUMNS) {
          expect(calls.get(capability) ?? 0, `${id} did not invoke ${capability}`).toBeGreaterThan(0)
        }
        expect(calls.get('label-extraction') ?? 0, `${id} label extraction`).toBeGreaterThan(0)
        expect(calls.get('normalization') ?? 0, `${id} request normalization`).toBeGreaterThan(0)
        expect(calls.get('positioned-projection') ?? 0, `${id} positioned projection`).toBeGreaterThan(0)
        if (descriptor.verify) expect(calls.get('verify-hook') ?? 0, `${id} verify hook`).toBeGreaterThan(0)
      } finally {
        restore()
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
          if (sceneNodeSerialization(node).includes('<marker')) expect(node.markerResources?.length, `${id} has untyped marker XML`).toBeGreaterThan(0)
          for (const marker of node.markerResources ?? []) {
            assertRenderableMarker(marker)
            expect(markerResources.has(marker.id), `${id} duplicate marker resource ${marker.id}`).toBe(false)
            expect(sceneNodeSerialization(node), `${id} marker ${marker.id} serializer ownership`).toContain(serializeMarkerResource(marker))
            markerResources.set(marker.id, marker)
          }
        })
        visitScene(scene.parts, node => {
          observed.add(node.role)
          for (const primitive of sceneNodePrimitives(node)) {
            const key = `${node.role}:${primitive}`
            observedCells.add(key)
            expect(descriptor.scenePrimitiveEvidence, `${id} emitted undeclared primitive cell ${key}`).toContainEqual(expect.objectContaining({ role: node.role, primitive, applicability: 'applicable' }))
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
      expect([...observedCells].sort(), `${id} must exercise every declared positive cell`).toEqual(declaredPositiveCells)
    }
  })
})
