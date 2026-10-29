import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { BUILTIN_FAMILY_METADATA, type BuiltinFamilyMetadata, isBuiltinFamilyId } from '../../agent/families.ts'
import { parseRegisteredMermaid } from '../../agent/parse.ts'
import type { AnyMutationOp, DiagramKind, ParsedDiagram, RenderedLayout } from '../../agent/types.ts'
import type { StructuralCount } from '../../agent/structural-count.ts'
import type { SceneRole } from '../../scene/roles.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'
import type { RenderOptions } from '../../types.ts'
import { METAMORPHIC_FAMILIES } from './metamorphic-families.ts'

const ROOT = join(import.meta.dir, '..', '..', '..')
const FAMILY_DEMOS = join(ROOT, 'docs', 'design', 'families')
const EVAL_ROOT = join(ROOT, 'eval')

export const COMPLEXITY_STRATA = ['minimal', 'representative', 'dense', 'text-stress', 'family-risk', 'corpus-outlier'] as const
export type ComplexityStratum = (typeof COMPLEXITY_STRATA)[number]

interface AuthoredClassRelationship {
  from: string
  to: string
  arrow: string
  type: 'association' | 'dependency' | 'aggregation' | 'inheritance' | 'link-solid'
  markerAt: 'from' | 'to' | 'none'
  marker?: string
  label?: string
  fromCardinality?: string
  toCardinality?: string
}

/** Development inputs, not the sequestered 0.6 holdout. Expectations are authored
 * before source construction; neither a parser nor layout supplies this model. */
export function classDevelopmentCase(count: number, variant: number, directed = true) {
  if (!Number.isInteger(count) || count < 8 || count > 24 || !Number.isInteger(variant) || variant < 0 || variant > 7) throw new RangeError('Bounded Class development case')
  const split = Math.floor(count / 3)
  const classes = Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? 'ns:Domain' : index === 1 ? 'class-namespace:Domain' : `C${index}`,
    label: index < 2 ? 'Shared record' : `Record ${index}${variant % 2 ? ' café 東京 with retained payload and ownership' : ''}`,
    namespace: index === count - 1 ? undefined : index < split ? 'Domain' : index < 2 * split ? 'Domain.Inner' : 'App',
    attribute: `+String field${index}`,
    method: `+read${index}() String`,
    methodDisplay: `+ read${index}(): String`,
  }))
  const namespaces = [
    { id: 'Domain', name: 'Domain', parentId: undefined },
    { id: 'Domain.Inner', name: 'Inner', parentId: 'Domain' },
    { id: 'App', name: 'App', parentId: undefined },
  ].map(namespace => ({ ...namespace, classIds: classes.filter(cls => cls.namespace === namespace.id).map(cls => cls.id) }))
  const kinds = [
    { arrow: '-->', type: 'association', markerAt: 'to', marker: 'cls-arrow' },
    { arrow: '..>', type: 'dependency', markerAt: 'to', marker: 'cls-arrow' },
    { arrow: 'o--', type: 'aggregation', markerAt: 'from', marker: 'cls-aggregation' },
    { arrow: '<|--', type: 'inheritance', markerAt: 'from', marker: 'cls-inherit' },
  ] as const
  const relationships: AuthoredClassRelationship[] = Array.from({ length: count - 2 }, (_, index) => ({
    ...kinds[(index + variant) % kinds.length]!,
    from: classes[index]!.id,
    to: classes[index + 1]!.id,
    label: `step ${index}`,
    fromCardinality: '1',
    toCardinality: '*',
  }))
  // Identical occurrences and a reciprocal must remain a multiset, not a set.
  relationships.push({ ...relationships[0]! })
  relationships.push({ ...relationships[0]!, from: classes[1]!.id, to: classes[0]!.id })
  const self: AuthoredClassRelationship = { from: classes[2]!.id, to: classes[2]!.id, arrow: '--', type: 'link-solid', markerAt: 'none' }
  const notes = [
    { for: classes[0]!.id, text: `Keep record identity ${variant}` },
    { for: classes.at(-1)!.id, text: `Isolated declaration ${variant} remains authored` },
  ]
  const quote = (id: string) => `\`${id}\``
  const declaration = (cls: (typeof classes)[number]) => [`class ${quote(cls.id)}["${cls.label}"] {`, cls.attribute, cls.method, '}']
  const direction = variant % 2 ? 'LR' : 'TB'
  const body = [
    'classDiagram',
    ...(directed ? [`direction ${direction}`] : []),
    'namespace Domain {',
    ...classes.filter(cls => cls.namespace === 'Domain').flatMap(declaration),
    'namespace Inner {',
    ...classes.filter(cls => cls.namespace === 'Domain.Inner').flatMap(declaration),
    '}',
    '}',
    'namespace App {',
    ...classes.filter(cls => cls.namespace === 'App').flatMap(declaration),
    '}',
    ...declaration(classes.at(-1)!),
    ...relationships.map(rel => `${quote(rel.from)} "${rel.fromCardinality}" ${rel.arrow} "${rel.toCardinality}" ${quote(rel.to)} : ${rel.label}`),
    `${quote(self.from)} ${self.arrow} ${quote(self.to)}`,
    ...notes.map(note => `note for ${quote(note.for)} "${note.text}"`),
  ].join('\n')
  const prefix = variant % 3 === 0 ? '%% retained development prefix\n' : variant % 3 === 1 ? '%%{init: {"class":{"hierarchicalNamespaces":true}}}%%\n%% retained development prefix\n' : '---\ntitle: Class development\n---\n%% retained development prefix\n'
  return { source: prefix + body, bodySource: body, directed, expected: { classes, namespaces, relationships: [...relationships, self], notes, direction: (directed ? direction : 'TB') as 'LR' | 'TB' } }
}

export const FAMILY_CITIZENSHIP_GALLERY_OPTIONS = { style: 'publication-figure', seed: 17, security: 'strict', embedFontImport: false } as const satisfies RenderOptions

export interface FamilyCitizenshipWitness {
  readonly source: string
  readonly options?: RenderOptions
  /** Hand-authored semantic expectations, never a source-length complexity score. */
  readonly count: Readonly<StructuralCount>
  readonly facts: readonly [string, ...string[]]
  readonly visibleText: readonly [string, ...string[]]
  readonly edit: { readonly op: AnyMutationOp; readonly beforeFacts: readonly [string, ...string[]]; readonly afterFacts: readonly [string, ...string[]] }
  /** Features not exposed by public atomic facts retain their own domain oracle. */
  readonly assertDomain?: (diagram: ParsedDiagram, layout: RenderedLayout) => void
  readonly pngGolden?: string
}

export interface FamilyConformanceProfile {
  readonly family: DiagramKind
  readonly citizenship: FamilyCitizenshipWitness
  /** Required role coverage across the portfolio; every automatic outline is inspected. */
  readonly outlines: { readonly kind: 'automatic'; readonly roles: readonly [SceneRole, ...SceneRole[]] } | { readonly kind: 'none'; readonly reason: string }
  readonly riskFixture: string
  readonly riskOptions: RenderOptions
  readonly textStressSource: string
  readonly externalReferenceSource?: string
}

/**
 * Mandatory family conformance material. This is deliberately exact-closed:
 * adding a DiagramKind cannot compile until its rich/text witnesses exist.
 * Tests iterate the runtime registry; this object never opts a family into a
 * particular test.
 */
export const FAMILY_CONFORMANCE_PROFILES: Readonly<Record<DiagramKind, FamilyConformanceProfile>> = {
  zenuml: {
    family: 'zenuml',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'layout-compare/fixtures/zenuml-native-checkout.mmd'), 'utf8'),
      options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS,
      count: { nodes: 4, edges: 7, groups: 1 },
      facts: ['participant Buyer : Customer', 'message Buyer -> API : checkout()', 'message API -> Buyer : ready'],
      visibleText: ['Customer', 'checkout()', 'result = reserve()', 'accepted', 'rejected'],
      edit: { op: { kind: 'rename_participant', id: 'Stock', newId: 'Inventory' }, beforeFacts: ['message API -> Stock : result = reserve()', 'message Stock -> API : accepted', 'message Stock -> API : rejected'], afterFacts: ['message API -> Inventory : result = reserve()', 'message Inventory -> API : accepted', 'message Inventory -> API : rejected'] },
      assertDomain: (diagram, layout) => {
        if (diagram.body.kind !== 'zenuml') throw Error('Expected native ZenUML')
        expect(diagram.body.participants.slice(0, 2).map(participant => participant.id)).toEqual(['Buyer', 'API'])
        expect(diagram.body.participants.length).toBe(3)
        const store = diagram.body.participants[2]!.id
        expect(['Stock', 'Inventory']).toContain(store)
        expect(layout.edges.map(edge => [edge.from, edge.to])).toEqual([['Buyer', 'API'], ['API', store], [store, 'API'], [store, 'API'], ['API', 'ticket:Ticket'], ['ticket:Ticket', 'API'], ['API', 'Buyer']])
        expect(layout.edges.filter(edge => edge.parentId).length).toBe(2)
      },
    },
    outlines: { kind: 'automatic', roles: ['actor', 'block'] },
    riskFixture: '../../../eval/layout-compare/fixtures/zenuml-native-checkout.mmd', riskOptions: {},
    textStressSource: 'zenuml\nA->B: 東京 café é 👩‍💻 שלום مرحبا',
  },
  eventmodeling: {
    family: 'eventmodeling',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'stable-families/fixtures/eventmodeling.mmd'), 'utf8'),
      options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS,
      count: { nodes: 7, edges: 6, groups: 5 },
      facts: ['relation 01 -> 02 inferred', 'relation 02 -> 03 inferred', 'relation 03 -> 06 explicit', 'relation 04 -> 06 explicit', 'relation 06 -> 07 inferred'],
      visibleText: ['Cart.UI', 'Cart.AddItem', 'description: string', 'Show the latest cart items'],
      edit: { op: { kind: 'set_data', id: 'Items', data: { type: 'jsobj', text: 'count: 2' } }, beforeFacts: ['data Items {"type":"jsobj","text":"count: 1"}'], afterFacts: ['data Items {"type":"jsobj","text":"count: 2"}'] },
      assertDomain: (diagram, layout) => {
        if (diagram.body.kind !== 'eventmodeling') throw Error('Expected Event Modeling')
        expect(diagram.body.frames.map(frame => frame.id)).toEqual(['01', '02', '03', '04', '05', '06', '07'])
        expect(diagram.body.frames[3]!.reset).toBe(true)
        expect(diagram.body.frames[3]!.sources).toEqual([])
        expect(diagram.body.frames[5]).toMatchObject({ reset: true, sources: ['03', '04'], dataReference: 'Items' })
        expect(diagram.body.notes).toEqual([{ frame: '06', data: { text: 'Show the latest cart items' } }])
        expect(diagram.body.specifications[0]).toMatchObject({ frame: '06', given: [{ type: 'event', entity: 'InitialItems' }], when: [{ type: 'command', entity: 'AddItem' }], then: [{ type: 'event', entity: 'ItemAdded' }] })
        expect(layout.groups.find(group => group.members.includes('01'))?.members).toEqual(['01', '07'])
      },
    },
    outlines: { kind: 'automatic', roles: ['node', 'group'] },
    riskFixture: 'eventmodeling-demo.mmd', riskOptions: {},
    textStressSource: 'eventmodeling\ntf 01 ui Cart.UI { 東京 café é 👩‍💻 שלום مرحبا }',
  },
  packet: {
    family: 'packet',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'stable-families/fixtures/packet.mmd'), 'utf8'), options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS, pngGolden: 'packet.png',
      count: { nodes: 13, edges: 0, groups: 0 },
      facts: ['field#1 4-6 : "Flags"', 'field#2 7-7 : "K"', 'field#5 32-55 : "Stream ID"', 'field#6 56-79 : "Sequence"', 'field#10 112-127 : "CRC"', 'field#11 128-191 : "Authentication tag"', 'field#12 192-255 : "Payload begins"'],
      visibleText: ['Stream ID', 'Sequence', 'Authentication tag'],
      edit: { op: { kind: 'set_field_label', index: 0, label: 'Protocol version' }, beforeFacts: ['field#0 0-3 : "Version"'], afterFacts: ['field#0 0-3 : "Protocol version"'] },
      assertDomain: (diagram, layout) => {
        expect(diagram.meta.frontmatter?.packet).toMatchObject({ bitsPerRow: 32, bitWidth: 40, bitOrder: 'descending' })
        const segments = layout.nodes.filter(node => node.id.startsWith('field-6:row-'))
        expect(segments.map(node => node.id)).toEqual(['field-6:row-1', 'field-6:row-2'])
        expect(segments[0]!.x).toBeLessThan(segments[1]!.x)
        expect(segments[0]!.y).toBeLessThan(segments[1]!.y)
      },
    },
    riskFixture: 'packet-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node'] },
    textStressSource: '---\ntitle: 東京 café é 👩‍💻\nconfig:\n  packet:\n    bitsPerRow: 16\n    bitOrder: descending\n---\npacket\n+8: "שלום مرحبا"\n+8: "長いラベル"\n+5: "界"',
  },
  kanban: {
    family: 'kanban',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'stable-families/fixtures/kanban.mmd'), 'utf8'), options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS, pngGolden: 'kanban.png',
      count: { nodes: 9, edges: 0, groups: 4 },
      facts: ['column#0 "backlog" : "Backlog"', 'column#1 "active" : "In progress"', 'column#2 "review" : "Validation"', 'column#3 "done" : "Released"', 'task#0.0 metadata "assigned" "Maya"', 'task#0.0 metadata "ticket" "GW-201"', 'task#2.0 metadata "assigned" "Iris"', 'task#2.0 metadata "priority" "Very High"', 'task#2.0 metadata "ticket" "GW-210"', 'task#3.0 metadata "priority" "Very Low"'],
      visibleText: ['Run failure rehearsal', 'Review threat model', 'GW-210'],
      edit: { op: { kind: 'set_task_label', id: 'schema', label: 'Finalize API schema' }, beforeFacts: ['task#0.0 "schema" : "Agree API schema"'], afterFacts: ['task#0.0 "schema" : "Finalize API schema"'] },
      assertDomain: (diagram, layout) => {
        if (diagram.body.kind !== 'kanban') throw new Error('Expected structured Kanban')
        expect(diagram.body.columns.map(column => [column.id, column.tasks.map(task => task.id)])).toEqual([['backlog', ['schema', 'limits', 'baseline']], ['active', ['replay', 'metrics']], ['review', ['rehearsal', 'accessibility']], ['done', ['framing', 'threat']]])
        expect(layout.nodes.map(node => [node.id, node.parentId])).toEqual([['schema', 'backlog'], ['limits', 'backlog'], ['baseline', 'backlog'], ['replay', 'active'], ['metrics', 'active'], ['rehearsal', 'review'], ['accessibility', 'review'], ['framing', 'done'], ['threat', 'done']])
      },
    },
    riskFixture: 'kanban-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node', 'group'] },
    textStressSource: '---\ntitle: 東京 café é 👩‍💻\n---\nkanban\nTodo[שלום مرحبا]\n  task[長いラベル]@{assigned: "東京 👩‍💻", ticket: ID-42, priority: High}\nDone',
    externalReferenceSource: '---\nconfig:\n  kanban:\n    ticketBaseUrl: https://example.com/#TICKET#\n---\nkanban\nTodo\n  task[Docs]@{ticket: ID-42}',
  },
  requirement: {
    family: 'requirement',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'stable-families/fixtures/requirement.mmd'), 'utf8'), options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS, pngGolden: 'requirement.png',
      count: { nodes: 8, edges: 8, groups: 0 },
      facts: ['direction TB', 'requirement "delivery" "Requirement" id "G-1" text "Deliver accepted events" risk "High" verify "Test"', 'requirement "latency" "Performance Requirement" id "G-2" text "Publish within 200 ms" risk "Medium" verify "Analysis"', 'requirement "replay" "Functional Requirement" id "G-3" text "Reject duplicate events" risk "High" verify "Test"', 'requirement "contract" "Interface Requirement" id "G-4" text "Keep wire compatibility" risk "Medium" verify "Inspection"', 'requirement "legacy" "Interface Requirement" id "G-0" text "Version 1 framing" risk "Low" verify "Inspection"', 'relation#0 "delivery" contains "replay"', 'relation#1 "replay" derives "delivery"', 'relation#2 "latency" refines "delivery"', 'relation#3 "contract" traces "delivery"', 'relation#4 "contract" copies "legacy"', 'relation#5 "gateway" satisfies "delivery"', 'relation#6 "replay_suite" verifies "replay"', 'relation#7 "latency_bench" verifies "latency"'],
      visibleText: ['G-1', 'replay_suite', 'p95 under load'],
      edit: { op: { kind: 'update_element', id: 'gateway', changes: { docRef: 'release v2 certified' } }, beforeFacts: ['element "gateway" type "gateway service" docref "release v2"'], afterFacts: ['element "gateway" type "gateway service" docref "release v2 certified"'] },
      assertDomain: (_diagram, layout) => {
        expect(layout.edges.map(edge => [edge.from, edge.to, edge.label?.text])).toEqual([['delivery', 'replay', '<<contains>>'], ['replay', 'delivery', '<<derives>>'], ['latency', 'delivery', '<<refines>>'], ['contract', 'delivery', '<<traces>>'], ['contract', 'legacy', '<<copies>>'], ['gateway', 'delivery', '<<satisfies>>'], ['replay_suite', 'replay', '<<verifies>>'], ['latency_bench', 'latency', '<<verifies>>']])
      },
    },
    riskFixture: 'requirement-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node'] },
    textStressSource: 'requirementDiagram\nrequirement r {\nid: R1\ntext: "東京 café é 👩‍💻 שלום مرحبا"\nrisk: high\nverifymethod: test\n}\nelement suite {\ntype: "test"\n}\nsuite - verifies -> r',
  },
  treemap: {
    family: 'treemap',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'stable-families/fixtures/treemap.mmd'), 'utf8'), options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS, pngGolden: 'treemap.png',
      count: { nodes: 10, edges: 0, groups: 4 },
      facts: ['node#0 treemap-0 parent root : "Build" section', 'node#1 treemap-1 parent treemap-0 : "Client" value 32', 'node#3 treemap-3 parent treemap-0 : "Platform" section', 'node#4 treemap-4 parent treemap-3 : "Authentication" value 24', 'node#5 treemap-5 parent treemap-3 : "Event delivery" value 16', 'node#7 treemap-7 parent treemap-6 : "Conformance" value 40', 'node#8 treemap-8 parent treemap-6 : "Failure drills" value 35', 'node#9 treemap-9 parent treemap-6 : "Accessibility" value 25', 'node#11 treemap-11 parent treemap-10 : "Observability" value 50', 'node#12 treemap-12 parent treemap-10 : "Documentation" value 30', 'node#13 treemap-13 parent treemap-10 : "Release" value 20'],
      visibleText: ['Authentication', 'Conformance', 'Observability'],
      edit: { op: { kind: 'set_label', id: 'treemap-2', label: 'Gateway services' }, beforeFacts: ['node#2 treemap-2 parent treemap-0 : "Gateway" value 28'], afterFacts: ['node#2 treemap-2 parent treemap-0 : "Gateway services" value 28'] },
      assertDomain: (_diagram, layout) => {
        const authentication = layout.nodes.find(node => node.id === 'treemap-4')!, delivery = layout.nodes.find(node => node.id === 'treemap-5')!
        expect(authentication.w * authentication.h / (delivery.w * delivery.h)).toBeCloseTo(1.5, 2)
        expect(layout.groups.find(group => group.id === 'treemap-3')?.parentId).toBe('treemap-0')
        expect(authentication.parentId).toBe('treemap-3')
      },
    },
    riskFixture: 'treemap-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'none', reason: 'Treemap areas encode values with categorical fills and page-colored separators; they do not use the shared automatic node outline.' },
    textStressSource: 'treemap\ntitle 東京 café é 👩‍💻\n"שלום مرحبا"\n  "長いラベル": 60\n  "café 東京": 40',
  },
  ishikawa: {
    family: 'ishikawa',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'stable-families/fixtures/ishikawa.mmd'), 'utf8'), options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS, pngGolden: 'ishikawa.png',
      count: { nodes: 16, edges: 15, groups: 0 },
      facts: ['effect#0 effect : "Late gateway release"', 'cause#1 cause-1 parent effect : "Process"', 'cause#2 cause-2 parent cause-1 : "Manual approvals"', 'cause#3 cause-3 parent cause-2 : "No approval deadline"', 'cause#5 cause-5 parent effect : "Tooling"', 'cause#6 cause-6 parent cause-5 : "Slow CI"', 'cause#7 cause-7 parent cause-6 : "Cold caches"', 'cause#8 cause-8 parent cause-6 : "Repeated font loading"', 'cause#10 cause-10 parent effect : "People"', 'cause#13 cause-13 parent effect : "Environment"'],
      visibleText: ['Process', 'Tooling', 'Cold caches'],
      edit: { op: { kind: 'set_label', id: 'cause-9', label: 'Record load results' }, beforeFacts: ['cause#9 cause-9 parent cause-5 : "Missing load results"'], afterFacts: ['cause#9 cause-9 parent cause-5 : "Record load results"'] },
      assertDomain: (_diagram, layout) => {
        expect(layout.edges).toHaveLength(15)
        expect(Object.fromEntries(layout.edges.map(edge => [edge.from, edge.to]))).toEqual({ 'cause-1': 'effect', 'cause-2': 'cause-1', 'cause-3': 'cause-2', 'cause-4': 'cause-1', 'cause-5': 'effect', 'cause-6': 'cause-5', 'cause-7': 'cause-6', 'cause-8': 'cause-6', 'cause-9': 'cause-5', 'cause-10': 'effect', 'cause-11': 'cause-10', 'cause-12': 'cause-10', 'cause-13': 'effect', 'cause-14': 'cause-13', 'cause-15': 'cause-13' })
      },
    },
    riskFixture: 'ishikawa-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node'] },
    textStressSource: 'ishikawa\n  東京 café é 👩‍💻\n  שלום مرحبا\n    長いラベル\n  Environment\n    café 東京',
  },
  block: {
    family: 'block',
    citizenship: {
      source: readFileSync(join(EVAL_ROOT, 'stable-families/fixtures/block.mmd'), 'utf8'), options: FAMILY_CITIZENSHIP_GALLERY_OPTIONS, pngGolden: 'block.png',
      count: { nodes: 7, edges: 6, groups: 4 },
      facts: ['columns root 3', 'block "services" parent null type composite span 2 columns 2 label "Gateway plane"', 'block "delivery" parent "services" type composite span 1 columns 1 label "Delivery"', 'block "persistence" parent "services" type composite span 1 columns 1 label "Persistence"', 'block "queue" parent "delivery" type cylinder span 1 columns -1 label "Queue"', 'block "store" parent "persistence" type cylinder span 1 columns -1 label "Event store"'],
      visibleText: ['Ingress', 'Event store', 'Dispatch'],
      edit: { op: { kind: 'update_block', id: 'audit', changes: { label: 'Compliance log' } }, beforeFacts: ['block "audit" parent "persistence" type square span 1 columns -1 label "Audit log"'], afterFacts: ['block "audit" parent "persistence" type square span 1 columns -1 label "Compliance log"'] },
      assertDomain: (diagram, layout) => {
        if (diagram.body.kind !== 'block') throw new Error('Expected structured Block')
        const pending = [...(diagram.body.root.children ?? [])], entries = []
        while (pending.length) { const node = pending.shift()!; entries.push(node); pending.push(...node.children ?? []) }
        expect(entries.filter(node => node.type === 'space')).toHaveLength(2)
        expect(entries.filter(node => node.classes?.includes('durable')).map(node => node.id)).toEqual(['queue', 'store'])
        expect(layout.groups.filter(group => group.parentId === 'services').map(group => group.id)).toEqual(['delivery', 'persistence'])
        expect(layout.nodes.map(node => [node.id, node.parentId])).toEqual([['browser', 'clients'], ['sdk', 'clients'], ['ingress', 'delivery'], ['queue', 'delivery'], ['worker', 'delivery'], ['store', 'persistence'], ['audit', 'persistence']])
        expect(layout.edges.map(edge => [edge.from, edge.to, edge.label?.text])).toEqual([['browser', 'ingress', 'HTTPS'], ['sdk', 'ingress', 'Batch'], ['ingress', 'queue', 'Enqueue'], ['queue', 'worker', 'Dispatch'], ['worker', 'store', 'Persist'], ['worker', 'audit', 'Record']])
      },
    },
    riskFixture: 'block-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node', 'group'] },
    textStressSource: 'block\ncolumns 2\nblock:domain:2\nA["東京 café é 👩‍💻"] B["שלום مرحبا 長いラベル"]\nend\nA --> B',
  },
  c4: {
    family: 'c4',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'c4-context-demo.mmd'), 'utf8'),
      count: { nodes: 5, edges: 5, groups: 1 },
      facts: ['variant C4Context', 'boundary company enterprise : Shop company', 'element shop parent company', 'element orders parent company', 'element events parent company', 'element payments system external rectangle : Payment provider'],
      visibleText: ['Customer', 'Order events', 'Payment provider'],
      edit: { op: { kind: 'update_element', id: 'orders', changes: { label: 'Order archive' } }, beforeFacts: ['element orders system internal database : Order store'], afterFacts: ['element orders system internal database : Order archive'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'c4') throw new Error('Expected structured C4')
        expect(diagram.body.relationships.map(relation => [relation.source, relation.target, relation.label, relation.technology])).toEqual([
          ['customer', 'shop', 'Places order', 'HTTPS'], ['shop', 'orders', 'Stores order', 'SQL'], ['shop', 'events', 'Publishes order', 'AMQP'], ['shop', 'payments', 'Requests payment', 'HTTPS'], ['payments', 'shop', 'Returns authorization', 'HTTPS'],
        ])
        expect(diagram.body.relationships.at(-1)).toMatchObject({ macro: 'Rel_Back', from: 'shop', to: 'payments', reversed: true })
      },
    },
    riskFixture: 'c4-context-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node', 'group', 'group-header'] },
    textStressSource: 'C4Container\n  Person(user, "東京 café é 👩‍💻", "שלום")\n  Container(api, "مرحبا بالعالم", "HTTP", "長い説明")\n  Rel(user, api, "長いラベル", "HTTPS")',
    externalReferenceSource: 'C4Context\n  System(docs, "Docs", $link="https://example.com/docs")',
  },
  flowchart: {
    family: 'flowchart',
    citizenship: {
      source: 'flowchart LR\nsubgraph app[Application]\n  subgraph core[Core]\n    A@{shape: manual-input, label: "Intake"} --> B{Valid?}\n    B -->|yes| C[(Store)]\n    C --> D@{shape: docs, label: "Audit"}\n  end\n  B -->|retry| A\nend\nD -->|publish| E([Released])',
      count: { nodes: 5, edges: 5, groups: 2 },
      facts: ['group core parent app', 'group core contains A', 'group core contains C', 'edge A -> B', 'edge B -> C : yes', 'edge C -> D', 'edge B -> A : retry', 'edge D -> E : publish'],
      visibleText: ['Intake', 'Audit', 'retry'],
      edit: { op: { kind: 'set_label', target: 'E', label: 'Published' }, beforeFacts: ['node E : Released'], afterFacts: ['node E : Published'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'flowchart') throw new Error('Expected structured Flowchart')
        expect(diagram.body.graph.nodes.get('A')).toMatchObject({ authoredShape: 'manual-input', semanticShape: 'sl-rect' })
        expect(diagram.body.graph.nodes.get('D')).toMatchObject({ semanticShape: 'docs' })
      },
    },
    riskFixture: 'flowchart-v11-shapes-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node', 'group', 'group-header'] },
    textStressSource: 'flowchart LR\n  subgraph app[Application]\n    A["東京 café é 👩‍💻 שלום"] -->|長いラベル| B["مرحبا بالعالم"]\n  end',
    externalReferenceSource: 'flowchart LR\n  A[Docs] --> B[Done]\n  click A href "https://example.com/docs"',
  },
  state: {
    family: 'state',
    citizenship: {
      source: 'stateDiagram-v2\n[*] --> Active\nstate Active {\n  state Review {\n    [*] --> Queued\n    Queued --> Approved : accept\n    Approved --> [*]\n  }\n  --\n  state Delivery {\n    [*] --> Ready\n    Ready --> Sent : ship\n    Sent --> [*]\n  }\n}\nActive --> Choice\nstate Choice <<choice>>\nChoice --> Done : yes\nChoice --> Active : retry\nDone --> [*]',
      count: { nodes: 9, edges: 11, groups: 0 },
      facts: ['composite Active', 'composite Review', 'state Review parent Active', 'state Delivery parent Active', 'state Active region 0', 'state Active region 1', 'state Queued parent Review', 'state Ready parent Delivery', 'state Choice stereotype choice', 'edge Choice -> Active : retry', 'edge Choice -> Done : yes'],
      visibleText: ['Queued', 'Approved', 'retry'],
      edit: { op: { kind: 'set_transition_label', from: 'Ready', to: 'Sent', parent: 'Delivery', label: 'deliver' }, beforeFacts: ['edge Ready -> Sent : ship'], afterFacts: ['edge Ready -> Sent : deliver'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'state') throw new Error('Expected structured State')
        expect(diagram.body.states.find(state => state.id === 'Active')?.regions?.map(region => region.states.map(state => state.id))).toEqual([['Review'], ['Delivery']])
      },
    },
    riskFixture: 'state-pseudostates-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['node', 'group', 'group-header'] },
    textStressSource: 'stateDiagram-v2\n  state "東京 café 👩‍💻" as A\n  state "שלום é" as B\n  A --> B : 長いラベル',
  },
  sequence: {
    family: 'sequence',
    citizenship: {
      source: 'sequenceDiagram\nautonumber\nactor U as User\nparticipant A as API\nparticipant D as Database\nU->>A: Submit\nactivate A\nalt Cached\n  A-->>U: Cached result\nelse Fresh\n  A->>D: Read\n  D-->>A: Rows\n  A-->>U: Fresh result\nend\ndeactivate A\nA->>A: Audit',
      count: { nodes: 3, edges: 6, groups: 0 },
      facts: ['actor U : User', 'participant A : API', 'participant D : Database', 'fragment#0 alt', 'fragment#0 branch#0 : Cached', 'fragment#0 branch#1 : Fresh', 'message#1 fragment#0 branch#0 A -> U : Cached result', 'message#3 fragment#0 branch#1 D -> A : Rows', 'message#5 top-level A -> A : Audit'],
      visibleText: ['Cached result', 'Fresh result', 'Database'],
      edit: { op: { kind: 'set_fragment_message_text', fragmentIndex: 0, branchIndex: 1, index: 0, text: 'Read snapshot' }, beforeFacts: ['message#2 fragment#0 branch#1 A -> D : Read'], afterFacts: ['message#2 fragment#0 branch#1 A -> D : Read snapshot'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'sequence') throw new Error('Expected structured Sequence')
        const retained = diagram.body.statements.flatMap(statement => statement.kind === 'opaque-block' ? statement.lines.map(line => line.trim()) : [])
        expect(retained).toEqual(expect.arrayContaining(['autonumber', 'activate A', 'deactivate A']))
        const fragment = diagram.body.statements.find(statement => statement.kind === 'fragment')
        expect(fragment?.kind === 'fragment' ? fragment.fragment.branches.map(branch => branch.messages.map(message => [message.from, message.to, message.style])) : undefined)
          .toEqual([[['A', 'U', 'reply']], [['A', 'D', 'sync'], ['D', 'A', 'reply'], ['A', 'U', 'reply']]])
      },
    },
    riskFixture: 'sequence-config-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['actor', 'activation', 'block', 'note'] },
    textStressSource: 'sequenceDiagram\n  participant A as 東京 👩‍💻\n  participant B as שלום é\n  A->>B: مرحبا بالعالم\n  activate B\n  alt Accepted\n    B-->>A: 長いラベル\n  else Retry\n    Note right of B: café 👩‍💻\n    B-->>A: שלום\n  end\n  deactivate B',
    externalReferenceSource: 'sequenceDiagram\n  participant A as Alice\n  link A: profile @ https://example.com/alice\n  A->>A: inspect',
  },
  timeline: {
    family: 'timeline',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'timeline-vertical-demo.mmd'), 'utf8'),
      count: { nodes: 16, edges: 0, groups: 3 },
      facts: ['period 2020 section Founding', 'event#0.1.0 2020 : Seed round', 'event#0.1.1 2020 : First hire', 'period 2022 section Growth', 'event#1.1.1 2022 : SOC 2', 'period 2024 section Scale'],
      visibleText: ['Founding', 'First hire', 'SOC 2'],
      edit: { op: { kind: 'set_event_text', sectionIndex: 2, periodIndex: 1, eventIndex: 0, text: 'Public offering' }, beforeFacts: ['event 2025 : IPO'], afterFacts: ['event 2025 : Public offering'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'timeline') throw new Error('Expected structured Timeline')
        expect(diagram.body.direction).toBe('TD')
        expect(diagram.body.sections.map(section => section.periods.map(period => period.label))).toEqual([['2019', '2020'], ['2021', '2022', '2023'], ['2024', '2025']])
      },
    },
    riskFixture: 'timeline-vertical-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['event', 'section', 'group-header'] },
    textStressSource: 'timeline\n  title 東京 café 👩‍💻\n  section שלום é\n    2026 : مرحبا بالعالم : 長いイベント',
  },
  class: {
    family: 'class',
    citizenship: {
      source: 'classDiagram\nnamespace Domain {\n  class Box~T~ {\n    +value T\n    +map(fn) Box~T~\n  }\n  class Item {\n    +sku string\n  }\n}\nnamespace App {\n  class Repository {\n    +save(item) void\n  }\n}\nBox~T~ "1" o-- "*" Item : stores\nRepository ..> Box~T~ : persists\nnote for Repository "Keep item identity"',
      count: { nodes: 3, edges: 2, groups: 2 },
      facts: ['class Box generic T', 'class Box in namespace Domain', 'class Item in namespace Domain', 'class Repository in namespace App', 'member Box +value T', 'relation#0 Box aggregation Item 1 * : stores', 'relation#1 Repository dependency Box : persists', 'note#0 Repository : Keep item identity'],
      visibleText: ['Repository', 'stores', 'persists'],
      edit: { op: { kind: 'add_member', class: 'Repository', text: '+load(id) Item' }, beforeFacts: ['member Repository +save(item) void'], afterFacts: ['member Repository +save(item) void', 'member Repository +load(id) Item'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'class') throw new Error('Expected structured Class')
        expect(diagram.body.classes.find(node => node.id === 'Box')?.members).toEqual(['+value T', '+map(fn) Box~T~'])
      },
    },
    riskFixture: 'class-generics-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['class-box', 'group-header', 'chrome', 'note'] },
    textStressSource: 'classDiagram\n  class Account {\n    +名前: string\n    +café()\n  }\n  note for Account "東京 👩‍💻 שלום é"',
    externalReferenceSource: 'classDiagram\n  class Docs\n  click Docs href "https://example.com/docs"',
  },
  er: {
    family: 'er',
    citizenship: {
      source: 'erDiagram\nsubgraph Commerce\n  CUSTOMER["Customer"] {\n    int id PK\n    string email UK\n  }\n  ORDER {\n    int id PK\n    int customer_id FK\n  }\n  CUSTOMER ||--o{ ORDER : places\nend\nsubgraph Catalog\n  PRODUCT {\n    int id PK\n    string sku UK\n  }\n  LINE_ITEM {\n    int order_id PK, FK\n    int product_id FK\n  }\nend\nORDER ||--|{ LINE_ITEM : contains\nPRODUCT ||..o{ LINE_ITEM : appears',
      count: { nodes: 4, edges: 3, groups: 2 },
      facts: ['entity CUSTOMER label Customer group Commerce', 'entity PRODUCT group Catalog', 'entity LINE_ITEM group Catalog', 'attribute CUSTOMER int id PK', 'attribute CUSTOMER string email UK', 'attribute ORDER int customer_id FK', 'relation CUSTOMER one-only -- zero-or-many ORDER : places', 'relation ORDER one-only -- one-or-many LINE_ITEM : contains', 'relation PRODUCT one-only .. zero-or-many LINE_ITEM : appears'],
      visibleText: ['Customer', 'customer_id', 'LINE_ITEM'],
      edit: { op: { kind: 'set_entity_label', entity: 'ORDER', label: 'Sales order' }, beforeFacts: ['entity ORDER group Commerce'], afterFacts: ['entity ORDER label Sales order group Commerce'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'er') throw new Error('Expected structured ER')
        expect(diagram.body.entities.find(node => node.id === 'LINE_ITEM')?.attributes.map(attribute => attribute.text)).toEqual(['int order_id PK, FK', 'int product_id FK'])
      },
    },
    riskFixture: 'er-direction-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['entity', 'group-header', 'chrome'] },
    textStressSource: 'erDiagram\n  CUSTOMER ||--o{ ORDER : "東京 café 👩‍💻"\n  CUSTOMER {\n    string name "שלום é مرحبا"\n  }',
  },
  journey: {
    family: 'journey',
    citizenship: {
      source: 'journey\ntitle Release request\nsection Discover\n  Find docs: 2: User\n  Plan: 4: User, Agent\nsection Build\n  Author: 3: Agent\n  Review: 5: Agent, Reviewer\nsection Ship\n  Export: 4: User, Agent',
      count: { nodes: 5, edges: 0, groups: 3 },
      facts: ['journey task Plan score 4 actors User, Agent', 'journey task Review score 5 actors Agent, Reviewer', 'journey task Review section Build', 'journey task Export section Ship', 'journey actor Agent tasks 4', 'journey actor User tasks 3', 'journey actor Reviewer tasks 1'],
      visibleText: ['Discover', 'Review', 'Export'],
      edit: { op: { kind: 'set_task_score', sectionIndex: 0, taskIndex: 0, score: 3 }, beforeFacts: ['journey task Find docs score 2 actors User', 'journey average score 3.6'], afterFacts: ['journey task Find docs score 3 actors User', 'journey average score 3.8'] },
    },
    riskFixture: 'journey-section-overlap-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['task'] },
    textStressSource: 'journey\n  title 東京 café 👩‍💻\n  section שלום é\n    مرحبا بالعالم: 4: 利用者',
  },
  architecture: {
    family: 'architecture',
    citizenship: {
      source: 'architecture-beta\ngroup cloud(cloud)[Cloud]\ngroup data(database)[Data] in cloud\nservice api(server)[API] in cloud\nservice cache(disk)[Cache] in data\nservice db(database)[Store] in data\njunction bus in data\napi:R --> L:bus\nbus:R --> L:cache\nbus:B --> T:db\ncache:R --> L:db\nalign row cache db',
      count: { nodes: 4, edges: 4, groups: 2 },
      facts: ['group data parent cloud', 'service api parent cloud', 'service cache parent data', 'service db parent data', 'junction bus parent data', 'edge api:R -> bus:L', 'edge bus:R -> cache:L', 'edge bus:B -> db:T', 'edge cache:R -> db:L'],
      visibleText: ['Cloud', 'Cache', 'Store'],
      edit: { op: { kind: 'set_service_label', id: 'api', label: 'Gateway' }, beforeFacts: ['service api : API'], afterFacts: ['service api : Gateway'] },
      assertDomain: (diagram, layout) => {
        if (diagram.body.kind !== 'architecture') throw new Error('Expected structured Architecture')
        expect(diagram.body.alignments).toEqual([{ axis: 'row', members: ['cache', 'db'] }])
        const cache = layout.nodes.find(node => node.id === 'cache')!, store = layout.nodes.find(node => node.id === 'db')!
        expect(cache.y + cache.h / 2).toBeCloseTo(store.y + store.h / 2, 1)
        expect(layout.groups.find(group => group.id === 'data')?.parentId).toBe('cloud')
      },
    },
    riskFixture: 'architecture-align-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['service', 'group'] },
    textStressSource: 'architecture-beta\n  group g(cloud)["東京 café 👩‍💻"]\n  service a(server)["שלום é"] in g\n  service b(database)["مرحبا بالعالم"] in g\n  a:R --> L:b',
  },
  xychart: {
    family: 'xychart',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'xychart-legend-demo.mmd'), 'utf8'),
      count: { nodes: 2, edges: 0, groups: 0 },
      facts: ['x-axis categories Mon, Tue, Wed, Thu, Fri', 'y-axis range 0 -> 300', 'series avg line [80,95,70,120,90]'],
      visibleText: ['p95', 'avg', 'Mon'],
      edit: { op: { kind: 'set_data_point', seriesIndex: 0, index: 3, value: 225 }, beforeFacts: ['series p95 bar [180,210,165,240,195]'], afterFacts: ['series p95 bar [180,210,165,225,195]'] },
    },
    riskFixture: 'xychart-legend-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'none', reason: 'Data-series bars and lines use series paints; axes and grids do not use the shared automatic node outline.' },
    textStressSource: 'xychart-beta\n  title "東京 café 👩‍💻"\n  x-axis [שלום, مرحبا, é]\n  y-axis 0 --> 10\n  bar [2, 5, 8]',
  },
  pie: {
    family: 'pie',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'pie-donut-labels-demo.mmd'), 'utf8'),
      count: { nodes: 8, edges: 0, groups: 0 },
      facts: ['slice Data = 25', 'slice ML = 12.5', 'slice Web = 8', 'slice Mobile = 6', 'slice QA = 4', 'slice Docs = 1.8', 'slice Misc = 0.7'],
      visibleText: ['Platform', 'Docs', 'Misc'],
      edit: { op: { kind: 'set_slice_value', label: 'Platform', value: 45 }, beforeFacts: ['slice Platform = 42'], afterFacts: ['slice Platform = 45'] },
      assertDomain: diagram => {
        expect(diagram.meta.frontmatter?.pie).toMatchObject({ donutHole: 0.45, textPosition: 0.8 })
      },
    },
    riskFixture: 'pie-donut-labels-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['legend'] },
    textStressSource: 'pie title 東京 café 👩‍💻\n  "שלום é" : 4\n  "مرحبا بالعالم" : 3\n  "長いラベル" : 2',
  },
  quadrant: {
    family: 'quadrant',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'quadrant-styling-demo.mmd'), 'utf8'),
      count: { nodes: 6, edges: 0, groups: 0 },
      facts: ['quadrant 1 : Expand', 'quadrant 2 : Promote', 'quadrant 3 : Re-evaluate', 'quadrant 4 : Improve', 'point Campaign A @ 0.85,0.9', 'point Campaign B @ 0.45,0.23', 'point Campaign C @ 0.57,0.69'],
      visibleText: ['Campaign A', 'Expand', 'Re-evaluate'],
      edit: { op: { kind: 'move_point', label: 'Campaign F', x: 0.3, y: 0.75 }, beforeFacts: ['point Campaign F @ 0.35,0.78'], afterFacts: ['point Campaign F @ 0.3,0.75'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'quadrant') throw new Error('Expected structured Quadrant')
        expect(diagram.body.classDefs?.hot).toMatchObject({ radius: 9, color: '#d33682', strokeColor: '#93216b', strokeWidth: '2px' })
        expect(diagram.body.points.find(point => point.label === 'Campaign B')?.style).toMatchObject({ radius: 8, color: '#268bd2' })
        expect(diagram.body.points.filter(point => point.className === 'hot').map(point => point.label)).toEqual(['Campaign A', 'Campaign C'])
      },
    },
    riskFixture: 'quadrant-styling-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['chrome'] },
    textStressSource: 'quadrantChart\n  title 東京 café 👩‍💻\n  x-axis שלום --> مرحبا\n  y-axis é --> 長い\n  نقطة: [0.3, 0.7]',
  },
  gantt: {
    family: 'gantt',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'gantt-dependency-overlay-demo.mmd'), 'utf8'),
      options: { gantt: { dependencyArrows: true, criticalPath: true } },
      count: { nodes: 5, edges: 0, groups: 2 },
      facts: ['task Core engine id core', 'task API layer start after core', 'task Docs start after core', 'task Launch tag milestone', 'task Launch start after itest', 'task Launch end 0d'],
      visibleText: ['Core engine', 'Docs', 'Launch'],
      edit: { op: { kind: 'rename_task', sectionIndex: 1, taskIndex: 0, label: 'Integration checks' }, beforeFacts: ['task Integration tests id itest', 'task Integration tests start after api'], afterFacts: ['task Integration checks id itest', 'task Integration checks start after api'] },
    },
    riskFixture: 'gantt-dependency-overlay-demo.mmd',
    outlines: { kind: 'none', reason: 'Tasks and milestones use status paints; their outlines and the grid do not use the shared automatic node outline.' },
    riskOptions: { gantt: { dependencyArrows: true, criticalPath: true } },
    textStressSource: 'gantt\n  title 東京 café 👩‍💻\n  dateFormat YYYY-MM-DD\n  section שלום é\n  مرحبا بالعالم :a, 2026-01-01, 2d\n  長いタスク :after a, 1d',
    externalReferenceSource: 'gantt\n  dateFormat YYYY-MM-DD\n  section Links\n  Docs :docs, 2026-01-01, 1d\n  click docs href "https://example.com/docs"',
  },
  mindmap: {
    family: 'mindmap',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'mindmap-demo.mmd'), 'utf8'),
      count: { nodes: 16, edges: 15, groups: 0 },
      facts: ['edge root -> discovery', 'edge discovery -> constraints', 'edge root -> delivery', 'edge delivery -> quality', 'node discovery icon fa fa-book', 'node discovery class urgent large', 'node beta shape bang', 'node launch shape cloud'],
      visibleText: ['Discovery', 'Quality gates', 'Terminal width'],
      edit: { op: { kind: 'set_label', id: 'constraints', label: 'Runtime constraints' }, beforeFacts: ['node constraints : Constraints'], afterFacts: ['node constraints : Runtime constraints'] },
    },
    riskFixture: 'mindmap-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'none', reason: 'Root and branch outlines use categorical root and branch paints, not the shared automatic node outline.' },
    textStressSource: 'mindmap\n  root((東京 café 👩‍💻))\n    שלום é\n      مرحبا بالعالم\n    長いラベル',
  },
  gitgraph: {
    family: 'gitgraph',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'gitgraph-demo.mmd'), 'utf8'),
      count: { nodes: 8, edges: 9, groups: 3 },
      facts: ['branch main order 0', 'branch develop order 2', 'branch release order 3', 'commit API type HIGHLIGHT', 'commit API tag beta', 'commit HOTFIX type REVERSE', 'edge HOTFIX -> MERGE : merge', 'edge UI -> MERGE : merge', 'commit MERGE tag v2.0.0'],
      visibleText: ['develop', 'release', 'v2.0.0'],
      edit: { op: { kind: 'set_commit_message', id: 'API', message: 'Harden API' }, beforeFacts: ['commit API message Build API'], afterFacts: ['commit API message Harden API'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'gitgraph') throw new Error('Expected structured GitGraph')
        expect(diagram.body.commits.find(commit => commit.source === 'cherry-pick')).toMatchObject({ branch: 'release', cherrySource: 'MERGE', cherryParent: 'UI', parents: ['RC', 'MERGE'], tags: ['backport'] })
        expect(diagram.body.branches.map(branch => [branch.name, branch.head])).toEqual([['main', 'MERGE'], ['develop', 'UI'], ['release', 'PATCH']])
      },
    },
    riskFixture: 'gitgraph-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'none', reason: 'Commit, branch, and rail marks use branch or status paints, not the shared automatic node outline.' },
    textStressSource: 'gitGraph\n  commit id:"base" msg:"東京 café 👩‍💻"\n  branch feature\n  commit id:"work" msg:"שלום é مرحبا"',
  },
  radar: {
    family: 'radar',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'radar-demo.mmd'), 'utf8'),
      count: { nodes: 18, edges: 0, groups: 6 },
      facts: ['axis#0 speed : Speed', 'axis#1 accuracy : Accuracy', 'axis#5 safety : Safety', 'curve#1 b : Model B {5,3,4,3,5,3}', 'curve#2 c : Model C {3,4,5,4,3,4}'],
      visibleText: ['Speed', 'Safety', 'Model B'],
      edit: { op: { kind: 'set_curve_value', curve: 'a', axis: 'accuracy', value: 4 }, beforeFacts: ['curve#0 a : Model A {4,5,3,4,4,5}'], afterFacts: ['curve#0 a : Model A {4,4,3,4,4,5}'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'radar') throw new Error('Expected structured Radar')
        expect(diagram.body.axes.map(axis => axis.id)).toEqual(['speed', 'accuracy', 'cost', 'latency', 'context', 'safety'])
        expect(diagram.body.max).toBe(5)
      },
    },
    riskFixture: 'radar-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['legend'] },
    textStressSource: 'radar-beta\n  title 東京 café 👩‍💻\n  axis a["שלום é"], b["مرحبا"], c["長い"]\n  curve now["現在 👩‍💻"]{3,4,5}\n  max 5',
  },
  sankey: {
    family: 'sankey',
    citizenship: {
      source: readFileSync(join(FAMILY_DEMOS, 'sankey-flows-demo.mmd'), 'utf8'),
      count: { nodes: 9, edges: 8, groups: 0 },
      facts: ['link#1 Gas -> Electricity : 80', 'link#2 Solar -> Electricity : 40', 'link#3 Nuclear -> Electricity : 50', 'link#4 Electricity -> Homes : 90', 'link#5 Electricity -> Industry : 80', 'link#6 Electricity -> Transport : 40', 'link#7 Electricity -> Losses : 20'],
      visibleText: ['Electricity', 'Industry', 'Losses'],
      edit: { op: { kind: 'rename_node', from: 'Coal', to: 'Biomass' }, beforeFacts: ['link#0 Coal -> Electricity : 60'], afterFacts: ['link#0 Biomass -> Electricity : 60'] },
      assertDomain: diagram => {
        if (diagram.body.kind !== 'sankey') throw new Error('Expected structured Sankey')
        expect(diagram.body.links.filter(link => link.target === 'Electricity').reduce((sum, link) => sum + link.value, 0)).toBe(230)
        expect(diagram.body.links.filter(link => link.source === 'Electricity').reduce((sum, link) => sum + link.value, 0)).toBe(230)
      },
    },
    riskFixture: 'sankey-flows-demo.mmd',
    riskOptions: {},
    outlines: { kind: 'automatic', roles: ['bar'] },
    textStressSource: 'sankey-beta\n  東京 café 👩‍💻,שלום é,10\n  שלום é,مرحبا بالعالم,10',
  },
}

export interface ConformanceSource {
  readonly family: DiagramKind
  readonly stratum: ComplexityStratum
  readonly id: string
  readonly source: string
  readonly options: RenderOptions
  readonly origin: 'registry-example' | 'metamorphic-generator' | 'family-risk-fixture' | 'eval-corpus'
}

function allMmdFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return allMmdFiles(path)
    return entry.isFile() && entry.name.endsWith('.mmd') ? [path] : []
  })
}

function sourceProxyComplexity(source: string): number {
  const lines = source.split(/\r?\n/)
  const indentation = lines.reduce((sum, line) => sum + Math.floor((/^\s*/.exec(line)?.[0].length ?? 0) / 2), 0)
  const structure = (source.match(/-->|==>|->>|-->>|\|\||\{\{|\b(?:section|subgraph|state|class|group|service|commit|curve)\b/g) ?? []).length
  return source.length + lines.length * 32 + indentation * 16 + structure * 64
}

let corpusOutlierCache: Record<DiagramKind, { path: string; source: string }> | undefined

export function collectCorpusOutliers(): Record<DiagramKind, { path: string; source: string }> {
  if (corpusOutlierCache) return corpusOutlierCache
  const selected = new Map<DiagramKind, { path: string; source: string; score: number }>()
  for (const path of allMmdFiles(EVAL_ROOT).sort(compareCodePointStrings)) {
    const source = readFileSync(path, 'utf8')
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind === 'opaque' || !isBuiltinFamilyId(parsed.value.kind)) continue
    const family = parsed.value.kind
    const score = sourceProxyComplexity(source)
    const current = selected.get(family)
    if (!current || score > current.score || (score === current.score && compareCodePointStrings(path, current.path) < 0)) {
      selected.set(family, { path, source, score })
    }
  }
  const missing = BUILTIN_FAMILY_METADATA.map(entry => entry.id).filter(id => !selected.has(id))
  if (missing.length > 0) throw new Error(`Eval corpus has no structured source for: ${missing.join(', ')}`)
  corpusOutlierCache = Object.fromEntries(
    BUILTIN_FAMILY_METADATA.map(({ id }) => {
      const entry = selected.get(id)!
      return [id, { path: entry.path, source: entry.source }]
    }),
  ) as Record<DiagramKind, { path: string; source: string }>
  return corpusOutlierCache
}

function metadataFor(family: DiagramKind): BuiltinFamilyMetadata {
  const metadata = BUILTIN_FAMILY_METADATA.find(entry => entry.id === family)
  if (!metadata) throw new Error(`Missing built-in family metadata for ${family}`)
  return metadata
}

export function conformanceSourceFor(family: DiagramKind, stratum: ComplexityStratum): ConformanceSource {
  const profile = FAMILY_CONFORMANCE_PROFILES[family]
  const generator = METAMORPHIC_FAMILIES[family]
  const [min, max] = generator.kRange
  switch (stratum) {
    case 'minimal':
      return {
        family,
        stratum,
        id: `${family}:minimal`,
        source: metadataFor(family).example,
        options: {},
        origin: 'registry-example',
      }
    case 'representative':
      return {
        family,
        stratum,
        id: `${family}:representative`,
        source: generator.build(Math.floor((min + max) / 2), 'rep'),
        options: {},
        origin: 'metamorphic-generator',
      }
    case 'dense': {
      let source = generator.build(max, 'dense')
      if (generator.addPrimary) source += generator.addPrimary.snippet(max, 'dense')
      if (generator.addRelation) source += generator.addRelation(max, 'dense')
      return { family, stratum, id: `${family}:dense`, source, options: {}, origin: 'metamorphic-generator' }
    }
    case 'text-stress':
      return {
        family,
        stratum,
        id: `${family}:text-stress`,
        source: profile.textStressSource,
        options: {},
        origin: 'family-risk-fixture',
      }
    case 'family-risk':
      return {
        family,
        stratum,
        id: `${family}:family-risk`,
        source: readFileSync(join(FAMILY_DEMOS, profile.riskFixture), 'utf8'),
        options: profile.riskOptions,
        origin: 'family-risk-fixture',
      }
    case 'corpus-outlier': {
      const outlier = collectCorpusOutliers()[family]
      return { family, stratum, id: `${family}:corpus-outlier:${outlier.path.slice(ROOT.length + 1)}`, source: outlier.source, options: {}, origin: 'eval-corpus' }
    }
  }
}

export function allConformanceSources(): ConformanceSource[] {
  return BUILTIN_FAMILY_METADATA.flatMap(({ id }) => COMPLEXITY_STRATA.map(stratum => conformanceSourceFor(id, stratum)))
}
