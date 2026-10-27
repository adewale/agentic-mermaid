import { seatMeasuredMarkers, assertMarkerPaint, writtenParallelSupportsOverlap } from '../layout/compound-marker-seating.ts'
import { buildClassEndpointMarkerTemplates } from '../class/marker-measurement.ts'
import { classMarkerPiecesOverlap } from '../layout/measured-marker-overlap.ts'
import { classMarkerPieces, classMarkerResources } from '../class/relationship-paint.ts'
import { formatSvgNumber } from '../shared/svg-number.ts'

import { describe, expect, test } from 'bun:test'

import { lowerClassScene } from '../class/renderer.ts'
import { renderMermaidSVG } from '../index.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalMarker } from '../ascii/terminal-document.ts'
import type { MarkerDescriptor } from '../scene/ir.ts'
import { DefaultBackend, getFamily } from '../agent/core.ts'
import type { PositionedClassDiagram, PositionedClassRelationship } from '../class/types.ts'

function publicClassScene(relationships: PositionedClassRelationship[]) {
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
    resolved: { renderOptions: {} } })
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
  test('the public Class lowerer preserves current shaft metadata without freezing caller input', () => {
    const caller = publicRelationship()
    const scene = publicClassScene([caller])
    const svg = DefaultBackend.render(scene, { seed: 0 })
    const shafts = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/g) ?? []
    expect(shafts).toHaveLength(1)
    expect(shafts[0]).toContain('data-id="rel:A-&gt;B#0"')
    expect(shafts[0]).toContain('data-marker-at="none" data-from-cardinality="界" data-to-cardinality="1"')
    expect(shafts[0]).toContain('points="160,120 440,120"')
    expect(shafts[0]).not.toContain('data-label=')
    expect(shafts[0]).not.toContain('marker-start=')
    expect(shafts[0]).not.toContain('marker-end=')
    expect(Object.isFrozen(caller)).toBe(false)
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
    ]), { seed: 0 })).toThrow('data-from-cardinality must be a string')
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

describe('measured endpoint marker placement', () => {
const fail=(reason:string):never=>{throw new Error(reason)},budget=()=>({pairs:1000000,arcs:65536,swaps:1000000}),style={lineWidth:1,edgeStrokeColor:'#333'} as any
const resources=classMarkerResources(style),aggregate=resources.find(m=>m.id==='cls-aggregation')!,inherit=resources.find(m=>m.id==='cls-inherit')!
const templates=[{start:classMarkerPieces(aggregate,{x:0,y:0},{x:1,y:0},'start',1)},{start:classMarkerPieces(inherit,{x:0,y:0},{x:1,y:0},'start',1)}]
const shape=(type:string,role:'start'|'end'='start',width=1)=>buildClassEndpointMarkerTemplates([{from:'A',to:'B',type,markerAt:role==='start'?'from':'to'} as any],{...style,lineWidth:width})[0]!

test('a nearby opaque inheritance hides earlier aggregation with exact canonical pieces',()=>{
 const earlier=classMarkerPieces(aggregate,{x:100,y:20},{x:-1,y:0},'start',1)
 const later=classMarkerPieces(inherit,{x:100,y:24},{x:-1,y:0},'start',1)
 expect(classMarkerPiecesOverlap(earlier,later)).toBe(true)
})
for(const start of [true,false])test(`template role ${start} retains canonical marker orientation and units`,()=>{
 const rel={from:'A',to:'B',type:'inheritance',markerAt:start?'from':'to'} as any
 const bank=buildClassEndpointMarkerTemplates([rel],{...style,lineWidth:3})[0]!
 const template=start?bank.start!:bank.end!
 const expected=classMarkerPieces(inherit,{x:0,y:0},{x:start?1:-1,y:0},start?'start':'end',3)
 expect(template).toEqual(expected);assertMarkerPaint(bank)
})
for(const transpose of [false,true])for(const sign of [-1,1])test(`primary/local marker reseating reflection ${transpose}/${sign}`,()=>{
 const point=(x:number,y:number)=>transpose?{x:y,y:x*sign}:{x:x*sign,y}
 const a=point(100,20),b=point(120,20),q=point(120,80),t=point(150,80)
 const c=point(100,24),d=point(130,24),r=point(130,90),u=point(150,90)
 const box=transpose?{x:0,y:sign===1?80:-100,width:100,height:20}:{x:sign===1?80:-100,y:0,width:20,height:100}
 const routes=[{points:[a,b,q,t]},{points:[c,d,r,u]}],before=structuredClone(routes),work=budget();let changed:number[]=[];let allocated=0
 seatMeasuredMarkers(templates.map(markerPaint=>({source:0,target:1,markerPaint})),routes,[box,box],work,n=>allocated+=n,fail,(_i,p)=>p.every((v,i)=>!i||v.x===p[i-1]!.x||v.y===p[i-1]!.y),i=>changed.push(i))
 expect(changed).toEqual([1]);expect(routes[0]).toEqual(before[0]);expect(routes[1]!.points.slice(2)).toEqual(before[1]!.points.slice(2));expect(allocated).toBeGreaterThan(2)
 const p=routes[1]!.points[0]!,s=routes[1]!.points[1]!,normal={x:Math.sign(s.x-p.x),y:Math.sign(s.y-p.y)}
 const actual=classMarkerPieces(inherit,p,normal,'start',1),old=classMarkerPieces(aggregate,a,{x:Math.sign(b.x-a.x),y:Math.sign(b.y-a.y)},'start',1)
 expect(classMarkerPiecesOverlap(old,actual)).toBe(false)
})
test('exact AABB overlap does not veto nonoverlapping actual glyph pieces',()=>{
 const a=[{kind:'polygon' as const,points:[{x:0,y:0},{x:2,y:0},{x:0,y:2}]}],b=[{kind:'polygon' as const,points:[{x:2,y:2},{x:2,y:1.5},{x:1.5,y:2}]}]
 expect(classMarkerPiecesOverlap(a,b)).toBe(false)
})
test('complete path rejection is respected, with immutable input points and no refund',()=>{
 const routes=[{points:[{x:100,y:20},{x:120,y:20},{x:120,y:80}]},{points:[{x:100,y:24},{x:130,y:24},{x:130,y:90}]}],old=structuredClone(routes),work=budget();let attempts=0
 expect(()=>seatMeasuredMarkers(templates.map(markerPaint=>({source:0,target:1,markerPaint})),routes,[{x:80,y:0,width:20,height:100},{x:110,y:80,width:30,height:20}],work,()=>{},fail,()=>{attempts++;return false},()=>{})).toThrow('No physically clear measured marker seat')
 expect(attempts).toBeGreaterThan(0);expect(routes).toEqual(old);expect(work.arcs).toBeLessThan(65536)
})
test('resource failures preserve exact thrown identity before capacity allocations',()=>{
 const error=new Error('fixed pool'),work=budget();work.arcs=0;let points=0
 expect(()=>seatMeasuredMarkers([],[],[],work,n=>points+=n,()=>{throw error},()=>true,()=>{})).toThrow(error);expect(points).toBe(0)
})
test('absent marker metadata keeps every route reference unchanged',()=>{
 const routes=[{points:[{x:0,y:0},{x:1,y:0}]}],before=routes[0]!.points
 seatMeasuredMarkers([{source:0,target:1}],routes,[],budget(),()=>{},fail,()=>{throw new Error('no candidate')},()=>{})
 expect(routes[0]!.points).toBe(before)
})
for(const value of [{start:[{kind:'circle',cx:0,cy:0,r:NaN}]},{start:[{kind:'polygon',points:[{x:0,y:0},{x:2,y:0},{x:1,y:1},{x:2,y:2},{x:0,y:2}]}]}])test('invalid marker metadata fails rather than weakening proof',()=>expect(()=>assertMarkerPaint(value as any)).toThrow())
test('resolved-width mutation changes actual measured marker bank/cache authority',()=>{
 const one=shape('inheritance','start',1),three=shape('inheritance','start',3)
 expect(JSON.stringify(one)).not.toBe(JSON.stringify(three));assertMarkerPaint(one);assertMarkerPaint(three)
})
test('normalizing an already-reserved opposite endpoint requires exact actual writer spelling',()=>{
 const routes=[{points:[{x:100,y:20},{x:150,y:20},{x:150,y:.12345678}]},{points:[{x:100,y:24},{x:160,y:24},{x:160,y:.12345674}]}],work=budget();let accepted=0
 expect(()=>seatMeasuredMarkers(templates.map(markerPaint=>({source:0,target:1,markerPaint})),routes,[{x:80,y:0,width:20,height:100},{x:140,y:-10,width:40,height:10.12345678}],work,()=>{},fail,()=>{accepted++;return true},()=>{})).toThrow('No physically clear measured marker seat')
 expect(accepted).toBe(0)
})
test('an actual paint-surface rejection can trigger seating even without a peer marker',()=>{
 const routes=[{points:[{x:100,y:20},{x:130,y:20},{x:130,y:100}]}],work=budget();let moved=0
 seatMeasuredMarkers([{source:0,target:1,markerPaint:templates[0]}],routes,[{x:80,y:0,width:20,height:100},{x:120,y:100,width:20,height:20}],work,()=>{},fail,()=>true,()=>moved++,(_i,_source,_pieces,bounds)=>bounds.minY>=40)
 expect(moved).toBe(1);expect(routes[0]!.points[0]!.y).toBeGreaterThan(40)
})

})
describe('marker versus foreign internal carrier', () => {
const fail=(m:string):never=>{throw new Error(m)},work=()=>({pairs:1000000,arcs:65536,swaps:1000000})
const resource=classMarkerResources({lineWidth:1} as any).find(m=>m.id==='cls-inherit')!,marker={end:classMarkerPieces(resource,{x:0,y:0},{x:-1,y:0},'end',1)}
const fixture=()=>({
 edges:[{source:1,target:0,markerPaint:marker},{source:2,target:3}],
 routes:[{points:[{x:200,y:180},{x:220,y:180},{x:220,y:140},{x:60,y:140},{x:60,y:80}]},{points:[{x:0,y:20},{x:8,y:20},{x:8,y:60},{x:20,y:60},{x:20,y:88},{x:120,y:88},{x:120,y:120},{x:140,y:120},{x:140,y:128}]}],
 boxes:[{x:40,y:40,width:40,height:40},{x:160,y:160,width:40,height:40},{x:-20,y:10,width:20,height:20},{x:130,y:128,width:20,height:20}],
 bounds:{x:-30,y:0,width:270,height:240}
})
const check=(routes:any[])=>{
 const path=routes[0].points,p=path.at(-1),q=path.at(-2),pieces=classMarkerPieces(resource,p,{x:p.x-q.x,y:p.y-q.y},'end',1)
 for(const [a,b] of routes[1].points.slice(1).map((p:any,i:number)=>[routes[1].points[i],p])){
  const l=Math.hypot(b.x-a.x,b.y-a.y);if(!l)continue
  const nx=-(b.y-a.y)/l*.5,ny=(b.x-a.x)/l*.5
  expect(classMarkerPiecesOverlap(pieces,[{kind:'polygon',points:[{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny},{x:b.x-nx,y:b.y-ny},{x:a.x-nx,y:a.y-ny}]}])).toBe(false)
 }
}
test('same-source foreign ink never inherits the marker owner exemption',()=>{
 const f=fixture();f.edges[1]!.source=1;const old=structuredClone(f.routes),changes:number[]=[]
 seatMeasuredMarkers(f.edges,f.routes,f.boxes,work(),()=>{},fail,()=>true,i=>changes.push(i),undefined,1,0,{bounds:f.bounds,obstacles:f.boxes})
 expect(changes).toEqual([1]);expect(f.routes[0]).toEqual(old[0]);expect(f.routes[1]!.points[0]).toEqual(old[1]!.points[0]);expect(f.routes[1]!.points.at(-1)).toEqual(old[1]!.points.at(-1));check(f.routes)
})
for(const transpose of [false,true])for(const sx of [-1,1])for(const sy of [-1,1])test(`internal carrier yield reflection ${transpose}/${sx}/${sy}`,()=>{
 const f=fixture(),p=(v:any)=>transpose?{x:v.y*sy,y:v.x*sx}:{x:v.x*sx,y:v.y*sy},box=(r:any)=>{const a=p(r),b=p({x:r.x+r.width,y:r.y+r.height});return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}}
 const routes=f.routes.map(r=>({points:r.points.map(p)})),old=structuredClone(routes),changes:number[]=[]
 seatMeasuredMarkers(f.edges,routes,f.boxes.map(box),work(),()=>{},fail,(_i,path)=>path.every((v,i)=>!i||v.x===path[i-1]!.x||v.y===path[i-1]!.y),i=>changes.push(i),undefined,1,0,{bounds:box(f.bounds),obstacles:f.boxes.map(box)})
 expect(changes).toEqual([1]);expect(routes[0]).toEqual(old[0]);expect(routes[1]!.points.slice(0,4)).toEqual(old[1]!.points.slice(0,4));expect(routes[1]!.points.slice(6)).toEqual(old[1]!.points.slice(6))
})
test('label spine is protected rather than moved to clear another owner glyph',()=>{
 const f=fixture();const edges:any=f.edges,routes:any=f.routes;edges[1].label={width:20,height:10};routes[1].labelPosition={x:60,y:88};const before=structuredClone(routes[1])
 expect(()=>seatMeasuredMarkers(edges,routes,f.boxes,work(),()=>{},fail,()=>true,()=>{},undefined,1,0,{bounds:f.bounds,obstacles:f.boxes})).toThrow('No physically clear measured marker seat')
 expect(routes[1]).toEqual(before)
})
test('terminal run is never slid as a forced-conflict internal track',()=>{
 const f=fixture();f.routes[1]!.points=[{x:0,y:88},{x:120,y:88},{x:120,y:128}];const old=structuredClone(f.routes[1])
 expect(()=>seatMeasuredMarkers(f.edges,f.routes,f.boxes,work(),()=>{},fail,()=>true,()=>{},undefined,1,0,{bounds:f.bounds,obstacles:f.boxes})).toThrow('No physically clear measured marker seat')
 expect(f.routes[1]).toEqual(old)
})
test('yield and endpoint shapes share at most eight actual whole-path proposals',()=>{
 const f=fixture();let accepted=0
 expect(()=>seatMeasuredMarkers(f.edges,f.routes,f.boxes,work(),()=>{},fail,()=>{accepted++;return false},()=>{},undefined,1,0,{bounds:f.bounds,obstacles:f.boxes})).toThrow('No physically clear measured marker seat')
 expect(accepted).toBeGreaterThan(0);expect(accepted).toBeLessThanOrEqual(8)
})
test('failed full proof never publishes a candidate track or refunds spent work',()=>{
 const f=fixture(),before=structuredClone(f.routes),budget=work()
 expect(()=>seatMeasuredMarkers(f.edges,f.routes,f.boxes,budget,()=>{},fail,()=>false,()=>{throw Error('published rejected candidate')},undefined,1,0,{bounds:f.bounds,obstacles:f.boxes})).toThrow()
 expect(f.routes).toEqual(before);expect(budget.pairs).toBeLessThan(1000000);expect(budget.arcs).toBeLessThan(65536)
})

})
describe('actual written parallel support', () => {
const point=(x:number,y:number)=>({x,y}),check=(a:any,b:any,c:any,d:any,w=1)=>writtenParallelSupportsOverlap(a,b,c,d,w,Number(formatSvgNumber(w)),()=>{},()=>{})
for(const transpose of[false,true])test(`actual width1 .74346 shared support reflection ${transpose}`,()=>{
 const p=(x:number,y:number)=>transpose?point(y,x):point(x,y)
 expect(check(p(1804.82254011,900.5),p(1804.82254011,929.5625),p(1805.566,915.5),p(1805.566,960.5))).toBe(true)
})
test('zero-measure touch and actual written width contact remain permitted',()=>{
 expect(check(point(0,0),point(0,10),point(1,2),point(1,8))).toBe(false)
 expect(check(point(.00000000000000001,0),point(.00000000000000001,10),point(1.0000000000000002,2),point(1.0000000000000002,8))).toBe(false)
 expect(check(point(0,0),point(0,10),point(.25,10),point(.25,20))).toBe(false)
})
test('proper perpendicular crossing is not forbidden parallel ink',()=>expect(check(point(0,5),point(10,5),point(5,0),point(5,10))).toBe(false))
test('longitudinal written endpoint collapse is tested after canonical spelling',()=>{
 expect(check(point(0,0),point(0,1000.1234567891),point(.5,1000.1234567890999),point(.5,1001))).toBe(false)
 expect(check(point(0,0),point(0,1000.1234567890999),point(.5,1000.1234567891),point(.5,1001))).toBe(true)
})
test('far support requires no formatting capacity; exact narrow work fails before strings',()=>{
 let slots=0
 expect(writtenParallelSupportsOverlap(point(0,0),point(0,10),point(20,0),point(20,10),1,1,()=>{},n=>slots+=n)).toBe(false);expect(slots).toBe(0)
 const error=new Error('original capacity');expect(()=>writtenParallelSupportsOverlap(point(0,0),point(0,10),point(.75,0),point(.75,10),1,1,()=>{},()=>{throw error})).toThrow(error)
})

})


describe('internal track sharing a protected endpoint normal', () => {
 const fail=(message:string):never=>{throw new Error(message)},budget=()=>({pairs:1_000_000,arcs:65536,swaps:1_000_000})
 for(const transpose of [false,true])for(const sx of [-1,1])for(const sy of [-1,1])test(`keeps both real endpoints and normals in reflection ${transpose}/${sx}/${sy}`,()=>{
  const p=(x:number,y:number)=>transpose?{x:y*sy,y:x*sx}:{x:x*sx,y:y*sy},r=(x:number,y:number,w:number,h:number)=>{const a=p(x,y),b=p(x+w,y+h);return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}}
  const resource=classMarkerResources({lineWidth:1} as any).find(m=>m.id==='cls-inherit')!,marker={end:classMarkerPieces(resource,{x:0,y:0},{x:-1,y:0},'end',1)}
  const routes=[{points:[p(200,180),p(220,180),p(220,140),p(60,140),p(60,80)]},{points:[p(20,20),p(20,88),p(120,88),p(120,128)]}],before=structuredClone(routes),boxes=[r(40,40,40,40),r(160,160,40,40),r(0,0,40,20),r(110,128,20,20)],changed:number[]=[]
  seatMeasuredMarkers([{source:1,target:0,markerPaint:marker},{source:2,target:3}],routes,boxes,budget(),()=>{},fail,(i,path)=>{
   expect(i).toBe(1);expect(path[0]).toEqual(before[1]!.points[0]);expect(path.at(-1)).toEqual(before[1]!.points.at(-1))
   for(const first of [true,false]){const a=first?path[0]!:path.at(-1)!,b=first?path[1]!:path.at(-2)!,oldA=first?before[1]!.points[0]!:before[1]!.points.at(-1)!,oldB=first?before[1]!.points[1]!:before[1]!.points.at(-2)!;expect(Math.sign(b.x-a.x)).toBe(Math.sign(oldB.x-oldA.x));expect(Math.sign(b.y-a.y)).toBe(Math.sign(oldB.y-oldA.y));expect(Math.abs(b.x-a.x)+Math.abs(b.y-a.y)).toBeGreaterThanOrEqual(8)}
   return true
  },i=>changed.push(i),undefined,1,0,{bounds:r(-30,0,270,240),obstacles:boxes})
  expect(changed).toEqual([1]);expect(routes[0]).toEqual(before[0]);expect(routes[1]!.points[1]).not.toEqual(before[1]!.points[1])
 })
})

test('reseating one end cannot sweep its shaft across its already seated opposite glyph', () => {
  const style = { lineWidth: 1, edgeStrokeColor: '#333' } as any
  const markerPaint = buildClassEndpointMarkerTemplates([{ from: 'S', to: 'T', type: 'aggregation', markerAt: 'both' } as any], style)[0]!
  const points = [{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 15, y: -20 }, { x: -30, y: -20 }, { x: -30, y: 40 }, { x: 5, y: 40 }, { x: 5, y: 20 }, { x: 100, y: 20 }]
  const bodies = [{ x: -20, y: -10, width: 20, height: 20 }, { x: 100, y: -15, width: 20, height: 36 }]
  const obstruction = [{ kind: 'polygon' as const, points: [{ x: 93, y: 23 }, { x: 95, y: 23 }, { x: 95, y: 24 }, { x: 93, y: 24 }] }]
  const resource = classMarkerResources(style).find(marker => marker.id === 'cls-aggregation')!
  const start = classMarkerPieces(resource, points[0]!, { x: 1, y: 0 }, 'start', 1)
  const end = (y: number) => classMarkerPieces(resource, { x: 100, y }, { x: 1, y: 0 }, 'end', 1)
  expect(classMarkerPiecesOverlap(start, obstruction)).toBe(false)
  expect(classMarkerPiecesOverlap(end(20), obstruction)).toBe(true)
  expect(classMarkerPiecesOverlap(end(3), obstruction)).toBe(false)
  const sweptShaft = [{ kind: 'polygon' as const, points: [{ x: 5, y: 2.5 }, { x: 100, y: 2.5 }, { x: 100, y: 3.5 }, { x: 5, y: 3.5 }] }]
  expect(classMarkerPiecesOverlap(start, sweptShaft)).toBe(true)
  const valid = (path: typeof points): boolean => {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!
      if (a.x !== b.x && a.y !== b.y) return false
      for (const box of bodies) {
        if (a.x === b.x ? a.x > box.x && a.x < box.x + box.width && Math.max(a.y, b.y) > box.y && Math.min(a.y, b.y) < box.y + box.height : a.y > box.y && a.y < box.y + box.height && Math.max(a.x, b.x) > box.x && Math.min(a.x, b.x) < box.x + box.width) return false
      }
      for (let j = i + 2; j < path.length; j++) {
        const c = path[j - 1]!, d = path[j]!
        if (a.x === b.x && c.x === d.x ? a.x === c.x && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >= Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) : a.y === b.y && c.y === d.y ? a.y === c.y && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >= Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) : a.x === b.x ? a.x >= Math.min(c.x, d.x) && a.x <= Math.max(c.x, d.x) && c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y) : c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && a.y >= Math.min(c.y, d.y) && a.y <= Math.max(c.y, d.y)) return false
      }
    }
    return true
  }
  const proposed = points.map(p => ({ ...p })); proposed[6]!.y = proposed[7]!.y = 3
  expect(valid(points)).toBe(true)
  expect(valid(proposed)).toBe(true)
  const routes = [{ points }], original = structuredClone(routes), budget = { pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 }
  expect(() => seatMeasuredMarkers([{ source: 0, target: 1, markerPaint }], routes, bodies, budget, () => {}, reason => { throw new Error(reason) }, (_i, path) => valid(path), () => {}, (_i, _source, pieces) => !classMarkerPiecesOverlap(pieces, obstruction), 1)).toThrow('No physically clear measured marker seat')
  expect(routes).toEqual(original)
})

describe('straight measured carriers can reserve a normal dogleg', () => {
 const fail=(message:string):never=>{throw new Error(message)},budget=()=>({pairs:1_000_000,arcs:65536,swaps:1_000_000})
 for(const transpose of [false,true])for(const sign of [-1,1])test(`retains the opposite pose and both normal leads in reflection ${transpose}/${sign}`,()=>{
  const p=(x:number,y:number)=>transpose?{x:y,y:x*sign}:{x:x*sign,y},r=(x:number,y:number,w:number,h:number)=>{const a=p(x,y),b=p(x+w,y+h);return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)}}
  const resource=classMarkerResources({lineWidth:1} as any).find(m=>m.id==='cls-inherit')!,marker={start:classMarkerPieces(resource,{x:0,y:0},{x:1,y:0},'start',1)}
  const edges=[{source:0,target:1,markerPaint:marker},{source:0,target:1}],routes=[{points:[p(100,20),p(200,20)]},{points:[p(100,24),p(150,24),p(150,90),p(200,90)]}],before=structuredClone(routes),boxes=[r(80,0,20,100),r(200,0,20,100)],changed:number[]=[]
  seatMeasuredMarkers(edges,routes,boxes,budget(),()=>{},fail,(index,path)=>{
   expect(index).toBe(0);expect(path).toHaveLength(4);expect(path.at(-1)).toEqual(before[0]!.points.at(-1))
   for(let i=1;i<path.length;i++)expect(path[i]!.x===path[i-1]!.x||path[i]!.y===path[i-1]!.y).toBe(true)
   const a=path[0]!,b=path[1]!,z=path.at(-1)!,y=path.at(-2)!
   expect(Math.sign(b.x-a.x)).toBe(Math.sign(before[0]!.points[1]!.x-before[0]!.points[0]!.x));expect(Math.sign(b.y-a.y)).toBe(Math.sign(before[0]!.points[1]!.y-before[0]!.points[0]!.y));expect(Math.sign(y.x-z.x)).toBe(Math.sign(before[0]!.points[0]!.x-before[0]!.points[1]!.x));expect(Math.sign(y.y-z.y)).toBe(Math.sign(before[0]!.points[0]!.y-before[0]!.points[1]!.y))
   expect(Math.abs(b.x-a.x)+Math.abs(b.y-a.y)).toBeGreaterThan(13)
   expect(Math.abs(y.x-z.x)+Math.abs(y.y-z.y)).toBeGreaterThanOrEqual(8)
   return true
  },i=>changed.push(i),undefined,1)
  expect(changed).toEqual([0]);expect(routes[0]!.points).toHaveLength(4);expect(routes[1]).toEqual(before[1])
 })
 test('new dogleg cannot discard a measured label on the original straight shaft',()=>{
  const resource=classMarkerResources({lineWidth:1} as any).find(m=>m.id==='cls-inherit')!,marker={start:classMarkerPieces(resource,{x:0,y:0},{x:1,y:0},'start',1)},label={x:110,y:20}
  const routes=[{points:[{x:100,y:20},{x:200,y:20}],labelPosition:label},{points:[{x:100,y:24},{x:150,y:24},{x:150,y:90},{x:200,y:90}]}],before=structuredClone(routes)
  expect(()=>seatMeasuredMarkers([{source:0,target:1,markerPaint:marker,label:{width:20,height:10}},{source:0,target:1}],routes,[{x:80,y:0,width:20,height:100},{x:200,y:0,width:20,height:100}],budget(),()=>{},fail,(_i,path)=>path.some((b,i)=>i>0&&((path[i-1]!.x===b.x&&label.x===b.x&&label.y>=Math.min(path[i-1]!.y,b.y)&&label.y<=Math.max(path[i-1]!.y,b.y))||(path[i-1]!.y===b.y&&label.y===b.y&&label.x>=Math.min(path[i-1]!.x,b.x)&&label.x<=Math.max(path[i-1]!.x,b.x)))),()=>{},undefined,1)).toThrow('No physically clear measured marker seat')
  expect(routes).toEqual(before)
 })
})


test('a straight marker dogleg retains the measured label and its halo on the fixed spine',()=>{
 const fail=(reason:string):never=>{throw new Error(reason)},resource=classMarkerResources({lineWidth:1} as any).find(m=>m.id==='cls-inherit')!,marker={start:classMarkerPieces(resource,{x:0,y:0},{x:1,y:0},'start',1)},label={x:150,y:20}
 const routes=[{points:[{x:100,y:20},{x:200,y:20}],labelPosition:label},{points:[{x:100,y:24},{x:150,y:24},{x:150,y:90},{x:200,y:90}]}]
 seatMeasuredMarkers([{source:0,target:1,markerPaint:marker,label:{width:20,height:10}},{source:0,target:1}],routes,[{x:80,y:0,width:20,height:100},{x:200,y:0,width:20,height:100}],{pairs:1_000_000,arcs:65536,swaps:1_000_000},()=>{},fail,(_i,path)=>{expect(path[2]!.x).toBeLessThan(138);expect(path[2]!.y).toBe(20);expect(path.at(-1)).toEqual({x:200,y:20});return true},()=>{},undefined,1)
 expect(routes[0]!.labelPosition).toEqual(label);expect(routes[0]!.points).toHaveLength(4)
})

describe('yield completeness within the original marker proposal allowance',()=>{
 const budget=()=>({pairs:1_000_000,arcs:65536,swaps:1_000_000}),fail=(reason:string):never=>{throw Error(reason)}
 const on=(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>(a.x===b.x&&p.x===a.x&&p.y>=Math.min(a.y,b.y)&&p.y<=Math.max(a.y,b.y))||(a.y===b.y&&p.y===a.y&&p.x>=Math.min(a.x,b.x)&&p.x<=Math.max(a.x,b.x))
 for(const kind of ['partial face','same-end normal extension'] as const)test(`retains owned meaning while yielding a ${kind}`,()=>{
  const inherited=classMarkerResources({lineWidth:1} as any).find(resource=>resource.id==='cls-inherit')!,diamond=classMarkerResources({lineWidth:1} as any).find(resource=>resource.id==='cls-aggregation')!
  const partial=kind==='partial face',label={x:60,y:partial?132:140}
  const routes=partial?[{points:[{x:200,y:180},{x:220,y:180},{x:220,y:140},{x:60,y:140},{x:60,y:80}],labelPosition:label},{points:[{x:50,y:120},{x:50,y:88},{x:120,y:88},{x:120,y:150}]}]:[{points:[{x:60,y:80},{x:60,y:160},{x:200,y:160},{x:200,y:200}],labelPosition:label},{points:[{x:20,y:120},{x:20,y:102},{x:30,y:102},{x:30,y:88},{x:120,y:88},{x:120,y:80}]}]
  const boxes=partial?[{x:40,y:40,width:40,height:40},{x:160,y:160,width:40,height:40},{x:46,y:120,width:8,height:20},{x:116,y:150,width:8,height:20}]:[{x:40,y:40,width:40,height:40},{x:190,y:200,width:20,height:20},{x:10,y:120,width:20,height:20},{x:110,y:60,width:20,height:20}]
  const marker=partial?{end:classMarkerPieces(inherited,{x:0,y:0},{x:-1,y:0},'end',1)}:{start:classMarkerPieces(diamond,{x:0,y:0},{x:1,y:0},'start',1)}
  const edges=partial?[{source:1,target:0,markerPaint:marker,label:{width:2,height:4}},{source:2,target:3}]:[{source:0,target:1,markerPaint:marker,label:{width:2,height:4}},{source:2,target:3,markerPaint:{end:classMarkerPieces(inherited,{x:0,y:0},{x:-1,y:0},'end',1)}}]
  const original=structuredClone(routes),changed:number[]=[],ink=classMarkerPieces(partial?inherited:diamond,{x:60,y:80},{x:0,y:partial?-1:1},partial?'end':'start',1)
  const blocker=[{kind:'polygon' as const,points:[{x:partial?50:30,y:87.5},{x:120,y:87.5},{x:120,y:88.5},{x:partial?50:30,y:88.5}]}]
  expect(classMarkerPiecesOverlap(ink,blocker)).toBe(true)
  const accepts=(index:number,path:{x:number;y:number}[])=>{
   if(index===0&&!path.some((b,i)=>i>0&&on(label,path[i-1]!,b)))return false
   for(let cursor=1;cursor<path.length;cursor++){
    const a=path[cursor-1]!,b=path[cursor]!
    if(a.x!==b.x&&a.y!==b.y)return false
    for(const box of boxes){if(a.x===b.x?a.x>box.x&&a.x<box.x+box.width&&Math.max(a.y,b.y)>box.y&&Math.min(a.y,b.y)<box.y+box.height:a.y>box.y&&a.y<box.y+box.height&&Math.max(a.x,b.x)>box.x&&Math.min(a.x,b.x)<box.x+box.width)return false}
   }
   return true
  }
  seatMeasuredMarkers(edges,routes,boxes,budget(),()=>{},fail,accepts,index=>changed.push(index),undefined,1,0,{bounds:{x:0,y:0,width:240,height:240},obstacles:[...boxes,{x:57,y:label.y-4,width:6,height:8}]})
  expect(changed).toEqual([1]);expect(routes[0]).toEqual(original[0]);expect(routes[1]!.points[0]).toEqual(original[1]!.points[0]);expect(routes[1]!.points.at(-1)).toEqual(original[1]!.points.at(-1));expect(routes[1]!.points).not.toEqual(original[1]!.points)
  for(const first of [true,false]){const path=routes[1]!.points,a=first?path[0]!:path.at(-1)!,b=first?path[1]!:path.at(-2)!,before=original[1]!.points,c=first?before[0]!:before.at(-1)!,d=first?before[1]!:before.at(-2)!;expect(Math.sign(b.x-a.x)).toBe(Math.sign(d.x-c.x));expect(Math.sign(b.y-a.y)).toBe(Math.sign(d.y-c.y));expect(Math.abs(b.x-a.x)+Math.abs(b.y-a.y)).toBeGreaterThanOrEqual(8)}
 })
})
