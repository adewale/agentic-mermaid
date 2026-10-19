import { describe, expect, test } from 'bun:test'

import { lowerClassScene } from '../class/renderer.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalMarker } from '../ascii/terminal-document.ts'
import type { MarkerDescriptor } from '../scene/ir.ts'
import { DefaultBackend, getFamily } from '../agent/core.ts'
import type { PositionedClassDiagram, PositionedClassRelationship } from '../class/types.ts'

function publicClassScene(relationships: PositionedClassRelationship[], edgeBendRadius = 0) {
  const lower = getFamily('class')?.lowerScene
  if (!lower) throw new Error('public Class family lowering is unavailable')
  const positioned: PositionedClassDiagram = {
    width: 600, height: 240, notes: [], namespaces: [], relationships,
    classes: ['A', 'B'].map((id, index) => ({
      id, label: id, attributes: [], methods: [], x: index ? 440 : 20, y: 60,
      width: 140, height: 120, headerHeight: 40, attrHeight: 40, methodHeight: 40,
    })),
  }
  return lower({ positioned, colors: { bg: '#ffffff', fg: '#111111' },
    resolved: { renderOptions: {}, styleFace: { edge: { bendRadius: edgeBendRadius } } } })
}

function publicRelationship(): PositionedClassRelationship {
  return { from: 'A', to: 'B', type: 'association', markerAt: 'none', lineStyle: 'solid',
    label: '', fromCardinality: '界', toCardinality: '1', points: [{ x: 160, y: 120 }, { x: 440, y: 120 }] }
}

function markerResources(): readonly MarkerDescriptor[] {
  const scene = lowerClassScene({
    positioned: {
      width: 100,
      height: 100,
      classes: [],
      notes: [],
      namespaces: [],
      relationships: [],
    },
    colors: { bg: '#ffffff', fg: '#111111' },
    resolved: { renderOptions: {} },
  })
  const definitions = scene.parts.find(part => part.id === 'defs')
  if (definitions?.kind !== 'document' || !definitions.markerResources) {
    throw new Error('class Scene is missing typed marker resources')
  }
  return definitions.markerResources
}

function markerById(resources: readonly MarkerDescriptor[], id: string): MarkerDescriptor {
  const marker = resources.find(resource => resource.id === id)
  if (!marker) throw new Error(`missing marker ${id}`)
  return marker
}

function markerTag(svg: string, id: string): string {
  const tag = svg.match(new RegExp(`<marker id="${id}"[^>]*>`))?.[0]
  if (!tag) throw new Error(`missing serialized marker ${id}`)
  return tag
}

function lowerPositionedRelationships(relationships: PositionedClassRelationship[]) {
  return lowerClassScene({
    positioned: {
      width: 600, height: 240, notes: [], namespaces: [], relationships,
      classes: ['A', 'B'].map((id, index) => ({
        id, label: id, attributes: [], methods: [], x: index ? 440 : 20, y: 60,
        width: 140, height: 120, headerHeight: 40, attrHeight: 40, methodHeight: 40,
      })),
    },
    colors: { bg: '#ffffff', fg: '#111111' },
    resolved: { renderOptions: {} },
  })
}

describe('class endpoint marker geometry (#178)', () => {
  test('the public Class lowerer preserves authored metadata getter reads and current shaft values', () => {
    const reads: string[] = []
    const caller = publicRelationship()
    const relationship = new Proxy(caller, { get(target, key, receiver) {
      if (key === 'markerAt' || key === 'label' || key === 'fromCardinality' || key === 'toCardinality') reads.push(key)
      return Reflect.get(target, key, receiver)
    } })
    const scene = publicClassScene([relationship])
    const svg = DefaultBackend.render(scene, { seed: 0 })
    const shafts = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/g) ?? []
    expect(shafts).toHaveLength(1)
    expect(shafts[0]).toContain('data-id="rel:A-&gt;B#0"')
    expect(shafts[0]).toContain('data-marker-at="none" data-from-cardinality="界" data-to-cardinality="1"')
    expect(shafts[0]).toContain('points="160,120 440,120"')
    expect(shafts[0]).not.toContain('data-label=')
    expect(shafts[0]).not.toContain('marker-start=')
    expect(shafts[0]).not.toContain('marker-end=')
    // These caller-visible reads come from the authored marker decisions,
    // metadata condition/value expressions and later cardinality labels.
    expect(reads.filter(key => key === 'markerAt')).toHaveLength(9)
    expect(reads.filter(key => key === 'label')).toHaveLength(4)
    expect(reads.filter(key => key === 'fromCardinality')).toHaveLength(6)
    expect(reads.filter(key => key === 'toCardinality')).toHaveLength(5)
    expect(Object.isFrozen(caller)).toBe(false)
  })

  test('the public Class lowerer distinguishes cardinality presence from its second getter value', () => {
    const absent = { ...publicRelationship(), fromCardinality: undefined }
    let reads = 0
    const empty = { ...publicRelationship(), get fromCardinality() { return ++reads === 1 ? 'present' : reads === 2 ? '' : '0' } }
    const svg = DefaultBackend.render(publicClassScene([absent, empty]), { seed: 0 })
    const shafts = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/g) ?? []
    expect(shafts).toHaveLength(2)
    expect(shafts[0]).not.toContain('data-from-cardinality=')
    expect(shafts[1]).toContain('data-id="rel:A-&gt;B#1"')
    expect(shafts[1]).toContain('data-from-cardinality="" data-to-cardinality="1"')
    const cardinal = svg.match(/<text\b[^>]*data-id="rel-card:A-&gt;B#1:from"[^>]*>([\s\S]*?)<\/text>/)?.[1]
    expect(cardinal?.replace(/<[^>]*>/g, '')).toBe('0')
    let invalidReads = 0
    const missing = { ...publicRelationship(), get fromCardinality() { return ++invalidReads === 1 ? 'present' : undefined } }
    expect(() => publicClassScene([absent, missing])).toThrow('SVG metadata values must be scalars')
    expect(invalidReads).toBe(2)
    const healthy = DefaultBackend.render(publicClassScene([publicRelationship()]), { seed: 0 })
    expect(healthy).toContain('data-marker-at="none" data-from-cardinality="界" data-to-cardinality="1"')
  })

  test('the public Class lowerer reads metadata getters before rounded geometry but snapshots values afterwards', () => {
    let geometryReads = 0
    const points = () => [{ get x(): number { geometryReads++; throw new Error('authored rounded-geometry stop') }, y: 120 },
      { x: 300, y: 120 }, { x: 440, y: 120 }]
    let metadataReads = 0
    const throwing = { ...publicRelationship(), points: points(), get fromCardinality() {
      if (++metadataReads === 2) throw new Error('authored cardinality-read stop')
      return 'present'
    } }
    expect(() => publicClassScene([throwing], 8)).toThrow('authored cardinality-read stop')
    expect(metadataReads).toBe(2)
    expect(geometryReads).toBe(0)
    let nestedReads = 0
    const accessor = Object.defineProperty({}, 'payload', { enumerable: true, get() { nestedReads++; return 'unsafe' } })
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    let toJSONCalls = 0
    for (const value of [accessor, cycle, { toJSON() { toJSONCalls++; return 'unsafe' } }]) {
      geometryReads = 0
      expect(() => publicClassScene([{ ...publicRelationship(), points: points(), fromCardinality: value as unknown as string }], 8))
        .toThrow('authored rounded-geometry stop')
      expect(geometryReads).toBe(1)
    }
    expect(nestedReads).toBe(0)
    expect(toJSONCalls).toBe(0)
  })

  test.each([
    { arrow: 'o..*', start: 'cls-aggregation', end: 'cls-composition', glyphs: ['◇', '◆'], dashed: true },
    { arrow: '*..o', start: 'cls-composition', end: 'cls-aggregation', glyphs: ['◆', '◇'], dashed: true },
    { arrow: 'o..o', start: 'cls-aggregation', end: 'cls-aggregation', glyphs: ['◇', '◇'], dashed: true },
    { arrow: '*..*', start: 'cls-composition', end: 'cls-composition', glyphs: ['◆', '◆'], dashed: true },
    { arrow: '()--()', start: 'cls-lollipop', end: 'cls-lollipop', glyphs: ['○', '○'], dashed: false },
    { arrow: '()..()', start: 'cls-lollipop', end: 'cls-lollipop', glyphs: ['○', '○'], dashed: true },
    { arrow: '()-->', start: 'cls-lollipop', end: 'cls-arrow', glyphs: ['○'], dashed: false },
    { arrow: '<--()', start: 'cls-arrow', end: 'cls-lollipop', glyphs: ['○'], dashed: false },
    { arrow: 'o..|>', start: 'cls-aggregation', end: 'cls-inherit', glyphs: ['◇'], dashed: true },
    { arrow: '()..*', start: 'cls-lollipop', end: 'cls-composition', glyphs: ['○', '◆'], dashed: true },
  ])('$arrow draws its shaft and both endpoint markers in SVG and terminal', ({ arrow, start, end, glyphs, dashed }) => {
    const source = `classDiagram\nA ${arrow} B`
    const svg = renderMermaidSVG(source)
    const relation = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/)?.[0]
    expect(relation).toBeDefined()
    expect(relation).toContain('data-from="A" data-to="B"')
    expect(relation).toContain(`marker-start="url(#${start})"`)
    expect(relation).toContain(`marker-end="url(#${end})"`)
    expect(relation!.includes('stroke-dasharray="6 4"')).toBe(dashed)
    const shapes: Record<string, TerminalMarker['shape']> = {
      'cls-aggregation': 'hollow-diamond', 'cls-composition': 'filled-diamond',
      'cls-lollipop': 'lollipop', 'cls-arrow': 'triangle', 'cls-inherit': 'open-arrow',
    }
    for (const useAscii of [false, true]) {
      const terminal = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
      const document = terminalDocumentOf(terminal)!
      const edge = document.regions().find(region => region.kind === 'edge')!
      expect([edge.from, edge.to]).toEqual(['A', 'B'])
      expect(edge.ports).toHaveLength(2)
      for (const port of edge.ports!) {
        expect(port.nodeId).toBe(port.end === 'start' ? 'A' : 'B')
        const cell = document.cell(port.x, port.y)!
        expect(cell.marker?.shape).toBe(shapes[port.end === 'start' ? start : end])
        expect(cell.owners.some(owner => owner.id === edge.id && owner.kind === 'edge')).toBe(true)
        expect(terminal.text.split('\n')[port.y]?.[port.x]).toBe(cell.glyph)
      }
      const shaft = [...document.entries()].filter(([, , cell]) => cell.stroke
        && cell.owners.some(owner => owner.id === edge.id && owner.kind === 'edge'))
      expect(shaft.length).toBeGreaterThan(0)
      expect(shaft.some(([, , cell]) => cell.stroke?.style === 'dashed')).toBe(dashed)
      if (!useAscii) {
        for (const glyph of new Set(glyphs)) {
          expect([...terminal.text].filter(character => character === glyph)).toHaveLength(glyphs.filter(value => value === glyph).length)
        }
        expect(/[┄┊]/.test(terminal.text)).toBe(dashed)
      }
    }
  })

  test('mixed relationships retain each marker, cardinality and label within one rendering', () => {
    const svg = renderMermaidSVG(`classDiagram
A "0" o..* "1" B : 界
B "0" *..o "1" C : plain
C "0" o..* "many" D : line<br/>break
D "" o..* "0" E
E -- F`)
    const relations = svg.match(/<(?:polyline|path)\b[^>]*class="class-relationship"[^>]*>/g) ?? []
    expect(relations).toHaveLength(5)
    const cases = [
      { from: 'A', to: 'B', start: 'cls-aggregation', end: 'cls-composition', fromCardinality: '0', toCardinality: '1', label: '界' },
      { from: 'B', to: 'C', start: 'cls-composition', end: 'cls-aggregation', fromCardinality: '0', toCardinality: '1', label: 'plain' },
      { from: 'C', to: 'D', start: 'cls-aggregation', end: 'cls-composition', fromCardinality: '0', toCardinality: 'many', label: 'line&#10;break' },
      { from: 'D', to: 'E', start: 'cls-aggregation', end: 'cls-composition', fromCardinality: undefined, toCardinality: '0', label: undefined },
      { from: 'E', to: 'F', start: undefined, end: undefined, fromCardinality: undefined, toCardinality: undefined, label: undefined },
    ]
    for (const [index, item] of cases.entries()) {
      const relation = relations[index]!
      expect(relation).toContain(`data-from="${item.from}" data-to="${item.to}"`)
      expect(relation).toContain(`data-marker-at="${item.start ? 'both' : 'none'}"`)
      expect(relation.includes('stroke-dasharray="6 4"')).toBe(index < 4)
      for (const [name, value] of [
        ['marker-start', item.start && `url(#${item.start})`], ['marker-end', item.end && `url(#${item.end})`],
        ['data-from-cardinality', item.fromCardinality], ['data-to-cardinality', item.toCardinality], ['data-label', item.label],
      ]) {
        if (value === undefined) expect(relation).not.toContain(`${name}=`)
        else expect(relation).toContain(`${name}="${value}"`)
      }
    }
    const overlays = svg.match(/<(?:polyline|path)\b[^>]*class="class-marker-overlay"[^>]*>/g) ?? []
    expect(overlays).toHaveLength(4)
    expect(overlays[0]).toContain('marker-start="url(#cls-aggregation)" marker-end="url(#cls-composition)"')
    expect(overlays[1]).toContain('marker-start="url(#cls-composition)" marker-end="url(#cls-aggregation)"')
  })

  test('positioned relationships retain authored profiles through misses, saturation and later repeats', () => {
    const cardinal256 = '😀'.repeat(128)
    const cardinal257 = cardinal256 + '界'
    const relationship = (fromCardinality: string, label?: string): PositionedClassRelationship => ({
      from: 'A', to: 'B', type: 'aggregation', fromType: 'aggregation', toType: 'composition',
      markerAt: 'both', lineStyle: 'dashed', fromCardinality, toCardinality: '1', label,
      points: [{ x: 160, y: 120 }, { x: 440, y: 120 }],
    })
    // More than128 distinct short cardinalities, plus an early hit and a late
    // repeated miss. Long Unicode values retain their full authored spelling.
    const profiles = Array.from({ length: 129 }, (_, index) => relationship(`count-${index + 1}`, `label-${index + 1}`))
    const relationships = [
      relationship(cardinal256, 'unicode-256'), relationship(cardinal257, 'unicode-257'),
      relationship('count-0'), relationship('count-0'), relationship('count-0', 'early-repeat'), ...profiles,
      relationship('count-129', 'late-miss-repeat'), relationship(cardinal257, 'long-repeat'),
      { ...relationship(cardinal256, '界-late-hit'), type: 'composition' as const,
        fromType: 'composition' as const, toType: 'aggregation' as const,
        points: [{ x: 160, y: 130 }, { x: 440, y: 130 }] },
      relationship('count-0'),
    ]
    const scene = lowerPositionedRelationships(relationships)
    const svg = DefaultBackend.render(scene, { seed: 0 })
    const shafts = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/g) ?? []
    const overlays = svg.match(/<polyline\b[^>]*class="class-marker-overlay"[^>]*>/g) ?? []
    const texts = svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g) ?? []
    expect(shafts).toHaveLength(relationships.length)
    expect(overlays).toHaveLength(relationships.length)
    for (const [index, authored] of relationships.entries()) {
      const swapped = authored.label === '界-late-hit'
      const start = swapped ? 'cls-composition' : 'cls-aggregation'
      const end = swapped ? 'cls-aggregation' : 'cls-composition'
      const shaft = shafts[index]!
      expect(shaft).toContain(`data-id="rel:A-&gt;B#${index}"`)
      expect(shaft).toContain('data-from="A" data-to="B"')
      expect(shaft).toContain(`data-type="${swapped ? 'composition' : 'aggregation'}"`)
      expect(shaft).toContain(`data-from-cardinality="${authored.fromCardinality}" data-to-cardinality="1"`)
      expect(shaft).toContain('data-marker-at="both"')
      expect(shaft).toContain('stroke-dasharray="6 4"')
      expect(shaft).toContain(swapped ? 'points="160,130 440,130"' : 'points="160,120 440,120"')
      for (const tag of [shaft, overlays[index]!]) {
        expect(tag).toContain(`marker-start="url(#${start})"`)
        expect(tag).toContain(`marker-end="url(#${end})"`)
      }
      const label = scene.parts.find(part => part.id === `rel-label:A->B#${index}`)
      if (authored.label === undefined) {
        expect(shaft).not.toContain('data-label=')
        expect(label).toBeUndefined()
      } else {
        expect(shaft).toContain(`data-label="${authored.label}"`)
        expect(label).toMatchObject({ kind: 'text', text: authored.label })
      }
      const cardinal = texts.find(text => text.includes(`data-id="rel-card:A-&gt;B#${index}:from"`))
      if (!cardinal) throw new Error(`missing drawn cardinality for relationship ${index}`)
      expect(cardinal.replace(/<[^>]*>/g, '')).toBe(authored.fromCardinality!)
    }
  })

  test('invalid cardinality data cannot execute toJSON or contaminate a later lowering', () => {
    let toJSONCalls = 0
    const invalid = { toJSON() { toJSONCalls++; return '0' } }
    const ordinary: PositionedClassRelationship = {
      from: 'A', to: 'B', type: 'aggregation', markerAt: 'both', toType: 'composition',
      fromCardinality: '0', toCardinality: '1', label: 'ordinary',
      points: [{ x: 160, y: 120 }, { x: 440, y: 120 }],
    }
    expect(() => DefaultBackend.render(lowerPositionedRelationships([
      ordinary, { ...ordinary, fromCardinality: invalid as unknown as string },
    ]), { seed: 0 })).toThrow('SVG emission metadata must be plain data')
    expect(toJSONCalls).toBe(0)
    expect(Object.isFrozen(invalid)).toBe(false)
    const svg = DefaultBackend.render(lowerPositionedRelationships([ordinary]), { seed: 0 })
    const shaft = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/)?.[0]
    expect(shaft).toContain('data-id="rel:A-&gt;B#0"')
    expect(shaft).toContain('data-from-cardinality="0" data-to-cardinality="1"')
    expect(shaft).toContain('data-label="ordinary"')
    expect(shaft).toContain('marker-start="url(#cls-aggregation)" marker-end="url(#cls-composition)"')
  })

  test('typed diamond and lollipop resources anchor their node-facing tip or tangent', () => {
    const resources = markerResources()
    const diamondPoints = [
      { x: 7, y: 1 },
      { x: 13, y: 6 },
      { x: 7, y: 11 },
      { x: 1, y: 6 },
    ]

    for (const id of ['cls-composition', 'cls-aggregation']) {
      expect(markerById(resources, id)).toMatchObject({
        size: { width: 14, height: 12 },
        viewBox: { x: 0, y: 0, width: 14, height: 12 },
        ref: { x: 13, y: 6 },
        orient: 'auto-start-reverse',
        overflow: 'hidden',
        geometry: { kind: 'polygon', points: diamondPoints },
      })
    }

    const lollipop = markerById(resources, 'cls-lollipop')
    expect(lollipop).toMatchObject({
      size: { width: 14, height: 14 },
      viewBox: { x: 0, y: 0, width: 14, height: 14 },
      ref: { x: 12, y: 7 },
      orient: 'auto-start-reverse',
      overflow: 'hidden',
      geometry: { kind: 'circle', cx: 7, cy: 7, r: 5 },
    })
    if (lollipop.geometry?.kind !== 'circle' || !lollipop.ref) {
      throw new Error('lollipop marker must have circle geometry and a reference point')
    }
    expect(lollipop.geometry.cx + lollipop.geometry.r).toBe(lollipop.ref.x)
  })

  test('already-correct triangle and open-arrow tip anchors stay unchanged', () => {
    const resources = markerResources()
    expect(markerById(resources, 'cls-inherit')).toMatchObject({
      ref: { x: 12, y: 5 },
      orient: 'auto-start-reverse',
      geometry: {
        kind: 'polygon',
        points: [{ x: 0, y: 0 }, { x: 12, y: 5 }, { x: 0, y: 10 }],
      },
    })
    expect(markerById(resources, 'cls-arrow')).toMatchObject({
      ref: { x: 8, y: 3 },
      orient: 'auto-start-reverse',
      geometry: {
        kind: 'polyline',
        points: [{ x: 0, y: 0 }, { x: 8, y: 3 }, { x: 0, y: 6 }],
      },
    })
  })

  test('default and rough SVG serialize the same affected marker attachment contract', () => {
    const source = `classDiagram
      Whole *-- Part
      Team o-- Member
      Service ()-- Port`
    const outputs = [
      renderMermaidSVG(source),
      renderMermaidSVG(source, { style: 'hand-drawn', seed: 7 }),
    ]

    for (const svg of outputs) {
      for (const id of ['cls-composition', 'cls-aggregation']) {
        expect(markerTag(svg, id)).toContain('refX="13"')
        expect(markerTag(svg, id)).toContain('refY="6"')
        expect(markerTag(svg, id)).toContain('orient="auto-start-reverse"')
      }
      expect(markerTag(svg, 'cls-lollipop')).toContain('refX="12"')
      expect(markerTag(svg, 'cls-lollipop')).toContain('refY="7"')
      expect(markerTag(svg, 'cls-lollipop')).toContain('orient="auto-start-reverse"')
      expect(svg).toContain('<circle cx="7" cy="7" r="5"')
    }
  })

  const directions = ['TB', 'BT', 'LR', 'RL'] as const
  const relationships = [
    { syntax: '*--', id: 'cls-composition', side: 'start' },
    { syntax: '--*', id: 'cls-composition', side: 'end' },
    { syntax: 'o--', id: 'cls-aggregation', side: 'start' },
    { syntax: '--o', id: 'cls-aggregation', side: 'end' },
    { syntax: '()--', id: 'cls-lollipop', side: 'start' },
    { syntax: '--()', id: 'cls-lollipop', side: 'end' },
  ] as const

  for (const direction of directions) {
    test(`${direction} preserves prefix and suffix marker placement`, () => {
      for (const relationship of relationships) {
        const svg = renderMermaidSVG(`classDiagram
          direction ${direction}
          A ${relationship.syntax} B`)
        expect(svg).toContain(`marker-${relationship.side}="url(#${relationship.id})"`)
        expect(markerTag(svg, relationship.id)).toContain(relationship.id === 'cls-lollipop' ? 'refX="12"' : 'refX="13"')
        expect(markerTag(svg, relationship.id)).toContain('orient="auto-start-reverse"')
      }
    })
  }
})
