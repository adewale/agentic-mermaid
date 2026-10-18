import { describe, expect, test } from 'bun:test'
import { parseC4Diagram, readC4Source, emptyC4Body } from '../c4/parser.ts'
import { planC4Identity } from '../c4/identity.ts'
import { buildC4SourceMap, c4BodyProblem, mutateC4, renderC4 } from '../agent/c4-body.ts'
import type { C4Body, C4MutationOp } from '../c4/types.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { breakLineTags } from '../multiline-utils.ts'
import { parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../index.ts'
import { c4ShapeOverride, effectiveC4Shape } from '../c4/config.ts'

function edit(body: C4Body, op: C4MutationOp): C4Body {
  const result = mutateC4(body, op)
  if (!result.ok) throw new Error(result.error.message)
  // A successful edit must describe exactly the artifact both renderers parse.
  expect(result.value).toEqual(readC4Source(renderC4(result.value)))
  return result.value
}

describe('C4 authored semantics', () => {
  test('explicit shape overrides paint both outputs without changing authored role or macro', () => {
    const source = 'C4Context\nSystem_Ext(a,"Storage")\nUpdateElementStyle(a,$shape="database")'
    const body = parseC4Diagram(source)
    expect(body.elements[0]).toMatchObject({ kind: 'system', external: true, shape: 'rectangle', macro: 'System_Ext', style: { shape: 'database' } })
    expect(renderC4(body)).toBe(source)
    expect(renderMermaidSVG(source)).toContain('<ellipse')
    expect(body.diagnostics.some(record => record.message.includes('style shape'))).toBe(false)
    const terminal = renderMermaidASCII(source, { useAscii: true, colorMode: 'none' })
    expect(terminal).not.toBe(renderMermaidASCII('C4Context\nSystem_Ext(a,"Storage")', { useAscii: true, colorMode: 'none' }))
    const person = edit(body, { kind: 'update_directive', id: body.directives[0]!.id, args: [{ value: 'a' }, { name: 'shape', value: 'person' }] })
    expect(person.elements[0]).toMatchObject({ kind: 'system', external: true, shape: 'rectangle', style: { shape: 'person' } })
    expect(renderMermaidASCII(renderC4(person), { colorMode: 'none' })).toContain('/|\\')
  })
  test('shape style cascade is explicit and never reinterprets tags, sprites or boundary kinds', () => {
    const source = 'C4Context\nAddElementTag("storage",$shape="database")\nSystem(a,"A",$tags="storage")\nSystem(b,"B",$tags="database",$sprite="queue")\nSystem_Boundary(g,"Group") {\nSystem(c,"C")\n}\nUpdateElementStyle(g,$shape="person")'
    const body = parseC4Diagram(source)
    expect(body.elements.map(effectiveC4Shape)).toEqual(['database', 'rectangle', 'rectangle'])
    const overridden = edit(body, { kind: 'add_directive', name: 'UpdateElementStyle', args: [{ value: 'a' }, { name: 'shape', value: 'pipe' }] })
    expect(effectiveC4Shape(overridden.elements[0]!)).toBe('queue')
    expect(overridden.elements[0]).toMatchObject({ macro: 'System', shape: 'rectangle', tags: ['storage'] })
    expect(overridden.boundaries[0]).toMatchObject({ kind: 'system', style: { shape: 'person' } })
    expect(overridden.diagnostics.some(record => record.statementId === overridden.boundaries[0]!.statementId && record.message.includes('style shape'))).toBe(true)
    const fallback = edit(overridden, { kind: 'update_directive', id: overridden.directives.at(-1)!.id, args: [{ value: 'a' }, { name: 'shape', value: 'future-shape' }] })
    expect(effectiveC4Shape(fallback.elements[0]!)).toBe('rectangle')
    expect(fallback.elements[0]!.style.shape).toBe('future-shape')
    expect(fallback.diagnostics.some(record => record.message.includes('style shape'))).toBe(true)
    const restored = edit(overridden, { kind: 'remove_directive', id: overridden.directives.at(-1)!.id })
    expect(effectiveC4Shape(restored.elements[0]!)).toBe('database')
    expect(renderC4(restored).trimEnd()).toBe(source)
    for (const [name, shape] of Object.entries({ Person: 'person', box: 'rectangle', rectangle: 'rectangle', cylinder: 'database', database: 'database', db: 'database', queue: 'queue', pipe: 'queue' } as const)) expect(c4ShapeOverride(` ${name} `)).toBe(shape)
    for (const alias of ['constructor', 'rounded', 'component']) expect(c4ShapeOverride(alias)).toBeUndefined()
  })
  test('public routing decodes only encoded headers and preserves leading comments and case', () => {
    for (const source of ['C4&#67;ontext\nSystem(a,"Visible")', '%% leading\nc4context\nSystem(a,"Visible")', 'C4&#67;ontext; System(a,"Visible")']) {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(parsed.error[0]?.message)
      expect(parsed.value.body.kind).toBe('c4')
      expect(serializeMermaid(parsed.value)).toBe(source)
      expect(renderMermaidSVG(source)).toContain('Visible')
      expect(renderMermaidASCII(source, { colorMode: 'none' })).toContain('Visible')
    }
  })
  test('all twenty element macros retain role, storage shape and external status', () => {
    const source = `C4Component\nPerson(p, "Person")\nPerson_Ext(px, "External person")\n` +
      ['System', 'Container', 'Component'].flatMap(role => ['', 'Db', 'Queue'].flatMap(shape => ['', '_Ext'].map(external => {
        const macro = `${role}${shape}${external}`
        return `${macro}(${macro}, "${macro}"${role === 'System' ? ', "description"' : ', "technology", "description"'})`
      }))).join('\n')
    const body = parseC4Diagram(source)
    expect(body.elements).toHaveLength(20)
    expect(body.elements.slice(0, 2).map(record => [record.kind, record.shape, record.external])).toEqual([['person', 'person', false], ['person', 'person', true]])
    expect(body.elements.find(record => record.id === 'ComponentDb_Ext')).toMatchObject({ kind: 'component', shape: 'database', external: true, technology: 'technology', description: 'description' })
    expect(body.elements.find(record => record.id === 'SystemQueue')).toMatchObject({ kind: 'system', shape: 'queue', external: false, description: 'description' })
    expect(renderC4(body)).toBe(source)
    expect(() => parseC4Diagram('C4Context\nPersonDb(a, "not an official macro")')).toThrow('unsupported')
  })

  test.each(['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'])('%s preserves variant and empty labels', variant => {
    const source = `${variant}\nSystem(a, "")\nSystem(b, "B")\nRel(a,b,"")`
    const body = parseC4Diagram(source)
    expect(body.variant).toBe(variant)
    expect(body.elements[0]!.label).toBe('')
    expect(body.relationships[0]!.label).toBe('')
    expect(renderC4(body)).toBe(source)
  })

  test('all boundary macros nest independently, including deployment alignment and empty groups', () => {
    const source = `C4Deployment
Enterprise_Boundary(e, "Enterprise") {
  System_Boundary(s, "System") {
    Container_Boundary(c, "Container") {
      Boundary(b, "Custom", "custom type") {
        Deployment_Node(d, "Deployment", "cloud", "Region") {
          Node(n, "Node", "VM") {
            Node_L(l, "Left", "VM") {
              Node_R(r, "Right", "VM") { }
            }
          }
        }
      }
    }
  }
}
Rel(e,r,"Nested endpoints")`
    const body = parseC4Diagram(source)
    expect(body.boundaries.map(record => record.parentId)).toEqual([undefined, 'e', 's', 'c', 'b', 'd', 'n', 'l'])
    expect(body.boundaries.at(-1)).toMatchObject({ kind: 'deployment', alignment: 'right' })
    expect(body.boundaries.at(-2)).toMatchObject({ alignment: 'left' })
    expect(body.relationships[0]).toMatchObject({ source: 'e', target: 'r' })
    expect(body.diagnostics.some(diagnostic => diagnostic.message.includes('empty boundary'))).toBe(true)
    expect(renderC4(body)).toBe(source)
  })

  test('ordered repeated relationships retain authored and effective endpoints and index', () => {
    const source = `C4Dynamic
System(a, "A")
System(b, "B")
RelIndex(7,a,b,"First",$tags="critical",$link="https://example.com")
Rel(a,b,"Second","HTTPS","Description")
Rel_Back(a,b,"Reply")
BiRel(a,b,"Both")
Rel(a,a,"Retry")
Rel_L(a,b,"Left")
Rel_Up(a,b,"Up")
Rel_Down(a,b,"Down")
Rel_Right(a,b,"Right")
UpdateRelStyle(a,b,$lineColor="blue",$offsetY="-12")`
    const body = parseC4Diagram(source)
    expect(body.relationships.map(record => record.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(new Set(body.relationships.map(record => record.id)).size).toBe(9)
    expect(body.relationships[0]).toMatchObject({ index: '7', tags: ['critical'], link: 'https://example.com' })
    expect(body.relationships[1]).toMatchObject({ technology: 'HTTPS', description: 'Description' })
    expect(body.relationships[2]).toMatchObject({ from: 'a', to: 'b', source: 'b', target: 'a', reversed: true })
    expect(body.relationships[3]!.bidirectional).toBe(true)
    expect(body.relationships.slice(5).map(record => record.direction)).toEqual(['RL', 'BT', 'TB', 'LR'])
    expect(body.relationships.filter(record => record.to === 'b').every(record => record.style.lineColor === 'blue')).toBe(true)
    expect(body.relationships[4]!.style).toEqual({})
  })

  test('named arguments occupy their source slots; positional placeholders and literal punctuation remain visible', () => {
    const source = `C4Container
Person_Ext(p, "A, (B) {C} %% text", "First<br/>Second", , "public+important", "https://example.com")
ContainerDb(db, "資料 é 👩‍💻", $descr="Stores #quot;quoted#quot; values", $techn="SQL", $tags="data")
Rel(p,db,"Reads",$techn="HTTPS",$descr="A, B",$link="https://example.com/rel")
UpdateElementStyle(db,"#ffffff","#111111","#336699")
UpdateLayoutConfig($c4BoundaryInRow="2",$c4ShapeInRow="3")`
    const body = parseC4Diagram(source)
    expect(body.elements[0]).toMatchObject({ label: 'A, (B) {C} %% text', description: 'First\nSecond', tags: ['public', 'important'], link: 'https://example.com' })
    expect(body.elements[1]).toMatchObject({ technology: 'SQL', description: 'Stores "quoted" values', style: { bgColor: '#ffffff', fontColor: '#111111', borderColor: '#336699' } })
    expect(body.layout).toMatchObject({ shapesPerRow: 3, boundariesPerRow: 2 })
    expect(renderC4(body)).toBe(source)
  })

  test('display breaks are interpreted before entities; IDs and links never interpret display syntax', () => {
    const body = parseC4Diagram('C4Context\nSystem("A<br/>B", "first<br/>#lt;br/#gt; #lt;b#gt;literal#lt;/b#gt;",$link="https://example.com/<br/>")')
    expect(body.elements[0]).toMatchObject({ id: 'A<br/>B', label: 'first\n<br/> <b>literal</b>', link: 'https://example.com/<br/>' })
    const changed = edit(body, { kind: 'update_element', id: 'A<br/>B', changes: { description: 'Literal <br/> and #quot; plus "quotes"\nNext' } })
    expect(changed.elements[0]!.description).toBe('Literal <br/> and #quot; plus "quotes"\nNext')
    expect(changed.elements[0]!.label).toBe(body.elements[0]!.label)
  })

  test('untouched CRLF source, comments, unknown calls and balanced unknown blocks survive byte for byte', () => {
    const source = 'C4Context\r\n%% first\r\nSystem(a,"Alpha") %% trailing\r\nFutureStyle(a,"literal { brace }")\r\nUnknownBlock("retain") {\r\n unknown payload\r\n}\r\nSystem(b,"Beta")\r\nRel(a,b,"after")'
    const body = readC4Source(source)
    expect(body.elements.map(record => record.id)).toEqual(['a', 'b'])
    expect(renderC4(body)).toBe(source)
    expect(body.diagnostics.filter(record => record.severity === 'error')).toHaveLength(2)
    expect(() => parseC4Diagram(source)).toThrow('unsupported')
    expect(mutateC4(body, { kind: 'rename_element', from: 'a', to: 'renamed' }).ok).toBe(false)
    expect(renderC4(body)).toBe(source)
  })

  test('accessibility is retained for both current and legacy spellings', () => {
    const source = 'C4Context\naccTitle: Context\naccDescr {\n  A person uses a system.\n}\nSystem(a,"A")'
    const body = parseC4Diagram(source)
    expect(body).toMatchObject({ accessibilityTitle: 'Context', accessibilityDescription: 'A person uses a system.' })
    expect(renderC4(body)).toBe(source)
    expect(parseC4Diagram('C4Context\naccDescription Legacy description\nSystem(a,"A")').accessibilityDescription).toBe('Legacy description')
  })

  test('tag and link extensions resolve without altering authored fields or source', () => {
    const source = `C4Context
AddElementTag("critical",$bgColor="red")
AddRelTag("async",$lineStyle="dashed")
System(a,"A",$tags="critical",$link="https://original.example")
System(b,"B")
Rel(a,b,"Event",$tags="async")
AddElementLink(a,"https://override.example")
UpdateElementStyle(a,$fontColor="white")
SHOW_LEGEND()`
    const body = parseC4Diagram(source)
    expect(body.elements[0]).toMatchObject({ style: { bgColor: 'red', fontColor: 'white' }, link: 'https://original.example', effectiveLink: 'https://override.example' })
    expect(body.relationships[0]!.style.lineStyle).toBe('dashed')
    expect(renderC4(body)).toBe(source)
    const changed = edit(body, { kind: 'remove_directive', id: body.directives.find(record => record.name === 'AddElementLink')!.id })
    expect(changed.elements[0]!.effectiveLink).toBeUndefined()
    expect(changed.elements[0]!.link).toBe('https://original.example')
    expect(body.diagnostics.some(record => record.message.includes('reader extension'))).toBe(true)
    const unsupportedStyle = parseC4Diagram('C4Context\nAddRelTag("line",$lineStyle="rainbow")\nSystem(a,"A")\nSystem(b,"B")\nRel(a,b,"Uses",$tags="line")')
    expect(unsupportedStyle.relationships[0]!.style.lineStyle).toBe('rainbow')
    expect(unsupportedStyle.diagnostics.some(record => record.message.includes('lineStyle "rainbow"') && record.message.includes('solid strokes'))).toBe(true)
  })

  test('malformed source terminates with explicit errors after long skipped input', () => {
    const skipped = '\n  %% ignored comment\n'.repeat(5000)
    expect(parseC4Diagram(`C4Context${skipped}System(a,"A")`).elements).toHaveLength(1)
    for (const tail of ['System(a,"unclosed)', 'System(a,"A"', 'System_Boundary(g,"G") {', '}', 'System(a,"A")\nSystem(a,"Again")', 'Rel(a,b,"missing")']) {
      expect(() => parseC4Diagram(`C4Context${skipped}${tail}`)).toThrow()
    }
  })
})

describe('C4 typed edits and current artifact identity', () => {
  const source = `C4Dynamic
%% retain this comment
System_Boundary(g,"Group") {
  System(a,"A")
  System(b,"B")
}
System(c,"C")
Rel(a,b,"First")
Rel(a,b,"Second")
Rel_Back(b,c,"Reply")
UpdateRelStyle(a,b,$lineColor="blue")
UpdateElementStyle(g,$borderColor="navy")`

  test('editing one repeated interaction touches only that declaration', () => {
    const body = parseC4Diagram(source)
    const changed = edit(body, { kind: 'update_relationship', id: body.relationships[1]!.id, changes: { label: 'Changed "second"' } })
    expect(changed.relationships.map(record => record.label)).toEqual(['First', 'Changed "second"', 'Reply'])
    expect(renderC4(changed)).toBe(source.replace('Rel(a,b,"Second")', 'Rel(a, b, "Changed #quot;second#quot;")'))
  })

  test('rename updates typed parent/endpoints/style references without changing prose', () => {
    const body = parseC4Diagram(source)
    const renamed = edit(edit(body, { kind: 'rename_boundary', from: 'g', to: 'new group' }), { kind: 'rename_element', from: 'a', to: '資料 é 👩‍💻' })
    expect(renamed.elements[0]).toMatchObject({ id: '資料 é 👩‍💻', label: 'A', parentId: 'new group' })
    expect(renamed.boundaries[0]!.style.borderColor).toBe('navy')
    expect(renamed.relationships[0]).toMatchObject({ from: '資料 é 👩‍💻', style: { lineColor: 'blue' } })
    expect(renderC4(renamed)).toContain('%% retain this comment')
  })

  test('reparent preserves descendants, rejects cycles and requires explicit cascade to remove references', () => {
    const body = parseC4Diagram(source)
    const grouped = edit(body, { kind: 'add_boundary', boundary: { id: 'outer', label: 'Outer', kind: 'deployment' } })
    const moved = edit(grouped, { kind: 'reparent_boundary', id: 'g', parentId: 'outer' })
    expect(moved.boundaries.find(record => record.id === 'g')!.parentId).toBe('outer')
    expect(moved.elements.filter(record => record.parentId === 'g').map(record => record.id)).toEqual(['a', 'b'])
    expect(mutateC4(moved, { kind: 'reparent_boundary', id: 'outer', parentId: 'g' }).ok).toBe(false)
    expect(mutateC4(moved, { kind: 'remove_boundary', id: 'g' }).ok).toBe(false)
    const removed = edit(moved, { kind: 'remove_boundary', id: 'g', cascade: true })
    expect(removed.elements.map(record => record.id)).toEqual(['c'])
    expect(removed.relationships).toHaveLength(0)
    expect(removed.directives).toHaveLength(0)
    expect(renderC4(moved)).toContain('System(a,"A")')
  })

  test('generated identities reserve newly authored aliases and reparse agrees after deletion', () => {
    const body = parseC4Diagram(source)
    const collided = edit(body, { kind: 'add_element', element: { id: 'c4-rel-1', label: 'Authored alias' } })
    expect(collided.elements.some(record => record.id === 'c4-rel-1')).toBe(true)
    expect(collided.relationships[0]!.id).toBe('c4-rel-1#1')
    const removed = edit(collided, { kind: 'remove_relationship', id: collided.relationships[0]!.id })
    expect(removed.relationships.map(record => [record.id, record.label])).toEqual([['c4-rel-1#1', 'Second'], ['c4-rel-2', 'Reply']])
    const identity = planC4Identity(removed)
    expect(identity.nodes.get('c4-rel-1')).toBe('c4-rel-1')
    expect(identity.generated('c4-rel-1', ['decoration', 0])).not.toBe('c4-rel-1')
    expect(mutateC4(removed, { kind: 'add_relationship', relationship: { id: 'arbitrary', from: 'a', to: 'b', label: 'No hidden ID syntax' } }).ok).toBe(false)
  })

  test('create, alter macro, styles and remove leave a coherent reparsable artifact', () => {
    let body = edit(emptyC4Body('C4Component'), { kind: 'add_element', element: { id: 'api', label: 'API', kind: 'component' } })
    body = edit(body, { kind: 'update_element', id: 'api', changes: { macro: 'ContainerDb_Ext', technology: 'SQL' } })
    body = edit(body, { kind: 'add_directive', name: 'UpdateElementStyle', args: [{ value: 'api' }, { name: 'bgColor', value: 'red' }] })
    expect(body.elements[0]).toMatchObject({ kind: 'container', shape: 'database', external: true, technology: 'SQL', style: { bgColor: 'red' } })
    expect(c4BodyProblem(body)).toBeNull()
    body = edit(body, { kind: 'remove_element', id: 'api', cascade: true })
    expect(body.elements).toHaveLength(0)
    expect(body.directives).toHaveLength(0)
  })

  test('failed operations are atomic and cannot smuggle fields or invalid directives', () => {
    const body = parseC4Diagram(source), before = renderC4(body)
    const ops = [
      { kind: 'update_element', id: 'a', changes: { id: 'c' } },
      { kind: 'add_element', element: { id: 'extra', label: 'Wrong', kind: 'system', shape: 'person' } },
      { kind: 'add_element', element: { id: 'a', label: 'Collision' } },
      { kind: 'add_relationship', relationship: { from: 'missing', to: 'b', label: 'No endpoint' } },
      { kind: 'add_element', element: { id: 'extra', label: 'System', technology: 'unsupported slot' } },
      { kind: 'add_boundary', boundary: { id: 'extra', label: 'Boundary', description: 'only deployment has this slot' } },
      { kind: 'add_relationship', relationship: { macro: 'RelIndex', index: '2', from: 'a', to: 'b', label: 'Indexed', technology: 'unsupported documented slot' } },
      { kind: 'add_directive', name: 'UpdateRelStyle', args: [{ value: 'a' }, { value: 'b' }, { name: 'offsetY', value: 'Infinity' }] },
      { kind: 'add_directive', name: 'FutureStyle', args: [] },
    ]
    for (const op of ops) expect(mutateC4(body, op as C4MutationOp).ok).toBe(false)
    expect(renderC4(body)).toBe(before)
  })

  test('direct typed payloads refuse stale derived flags, styles and source correspondence', () => {
    const body = parseC4Diagram(source)
    for (const change of [
      (draft: C4Body) => { draft.elements[0]!.kind = 'component' },
      (draft: C4Body) => { draft.elements[0]!.style.bgColor = 'red' },
      (draft: C4Body) => { draft.relationships[0]!.bidirectional = true },
      (draft: C4Body) => { draft.elements.push({ ...draft.elements[0]!, id: 'missing-statement' }) },
      (draft: C4Body) => { draft.relationships[0]!.args[2]!.value = 'stale arg metadata' },
    ]) {
      const draft = structuredClone(body)
      change(draft)
      expect(c4BodyProblem(draft)).not.toBeNull()
      expect(() => renderC4(draft)).toThrow()
    }
    expect(renderC4(body)).toBe(source)
  })

  test('canonical edited quotes, literal entities, Unicode and whitespace aliases parse in Mermaid 11.16', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const label = 'He said "hello"; #quot; <br/> <b>literal</b>\nNext, %% text'
      let body = edit(emptyC4Body('C4Container'), { kind: 'add_element', element: { id: '資料 é 👩‍💻', kind: 'container', label, technology: 'HTTPS' } })
      body = edit(body, { kind: 'add_element', element: { id: 'A\nB', label: 'Line identity' } })
      body = edit(body, { kind: 'add_element', element: { id: 'A\tB', label: 'Tab identity' } })
      body = edit(body, { kind: 'add_relationship', relationship: { from: '資料 é 👩‍💻', to: 'A\nB', label: 'Quoted "edge"' } })
      const result = await upstream.project(renderC4(body), diagram => ({
        elements: diagram.db.getC4ShapeArray('global').map((record: any) => ({ id: record.alias, label: record.label.text })),
        relationships: diagram.db.getRels().map((record: any) => ({ from: record.from, to: record.to, label: record.label.text })),
      }))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      expect(result.value.elements.map((record: { id: string }) => projectEntityMarkers(record.id))).toEqual(body.elements.map(record => record.id))
      expect(projectEntityMarkers(breakLineTags(result.value.elements[0].label))).toBe(label)
      expect(result.value.relationships.map((record: { from: string; to: string; label: string }) => ({ from: projectEntityMarkers(record.from), to: projectEntityMarkers(record.to), label: projectEntityMarkers(record.label) }))).toEqual([{ from: '資料 é 👩‍💻', to: 'A\nB', label: 'Quoted "edge"' }])
    } finally { upstream.close() }
  })

  test('source map addresses independent relationships and exact label starts', () => {
    const body = parseC4Diagram(source)
    const map = buildC4SourceMap(body, source)
    expect(map.edges.get(body.relationships[0]!.id)).toEqual({ line: 8, col: 1 })
    expect(map.edges.get(body.relationships[1]!.id)).toEqual({ line: 9, col: 1 })
    expect(map.labels.get('node:a')).toEqual({ line: 4, col: 13 })
    expect(map.groups.get('g')).toEqual({ line: 3, col: 1 })
  })
})
