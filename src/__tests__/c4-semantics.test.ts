import { describe, expect, test } from 'bun:test'
import { parseC4Diagram, readC4Source, emptyC4Body } from '../c4/parser.ts'
import { planC4Identity } from '../c4/identity.ts'
import { buildC4SourceMap, c4BodyProblem, mutateC4, renderC4 } from '../agent/c4-body.ts'
import type { C4Body, C4MutationOp } from '../c4/types.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'
import { projectEntityMarkers } from '../shared/mermaid-entity-display.ts'
import { breakLineTags } from '../multiline-utils.ts'
import { layoutMermaid, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../agent/index.ts'
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
  test('unchanged reader extensions use portable argument and title tokens', async () => {
    for (const source of [
        'C4Context\ntitle #\nPerson(A, "")',
        'C4Dynamic\ntitle ;\nContainer(A, "")',
        'C4Context\nPerson(A",", $tags="a")',
        'C4Context\nPerson_Ext(s"", ""\u2028)',
        'C4Context\nPerson(A, $tags=\u00a0"1")',
        'C4Context\naccDescr{}\nSystem(a, "A")',
        'C4Deployment\nDeployment_Node(n, "Node") {\ntitle Nested\nContainer(a, "App")\n}',
        'C4Deployment\nDeployment_Node(n, "Node") {\naccTitle: Accessible\nContainer(a, "App")\n}',
        'C4Deployment\nDeployment_Node(n, "Node") {\naccDescr: Description\n}',
        'C4Deployment\nDeployment_Node(n, "Node") {\naccDescr{}\n}',
    ]) {
      // C4's reference DB retains accessibility values between parses.
      const upstream = startUpstreamMermaid()
      try {
        const body = readC4Source(source)
        const written = renderC4(body)
        if (body.accessibilityDescription === '') expect(body.diagnostics.some(item => item.syntax === 'c4_empty_accessibility_description')).toBe(true)
        expect(await upstream.publicAccepts(written), written).toBe(true)
        const metadata = await upstream.project(written, diagram => ({ title: diagram.db.getTitle(), accTitle: diagram.db.getAccTitle(), accDescr: diagram.db.getAccDescription() }))
        expect(metadata.ok).toBe(true)
        if (!metadata.ok) throw new Error(metadata.error)
        // Pinned C4 routes accTitle to setTitle. Our native fields stay distinct.
        expect({ title: projectEntityMarkers(metadata.value.title), accTitle: projectEntityMarkers(metadata.value.accTitle), accDescr: projectEntityMarkers(metadata.value.accDescr) }).toEqual({ title: body.accessibilityTitle ?? body.title ?? '', accTitle: '', accDescr: body.accessibilityDescription ?? '' })
        const reloaded = readC4Source(written)
        expect(reloaded.diagnostics.some(item => item.syntax === 'c4_empty_accessibility_description')).toBe(false)
        expect(reloaded.title).toBe(body.title)
        expect(reloaded.accessibilityTitle).toBe(body.accessibilityTitle)
        expect(reloaded.accessibilityDescription).toBe(body.accessibilityDescription)
        expect(reloaded.boundaries.map(({ id, parentId }) => ({ id, parentId }))).toEqual(body.boundaries.map(({ id, parentId }) => ({ id, parentId })))
        expect(reloaded.elements.map(({ parentId }) => parentId)).toEqual(body.elements.map(({ parentId }) => parentId))
        expect(reloaded.elements.map(({ id, label, tags }) => ({ id, label, tags }))).toEqual(body.elements.map(({ id, label, tags }) => ({ id, label, tags })))
      } finally { upstream.close() }
    }
  })

  test('complete C4 productions protect style prepasses across aliases, values and titles', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [id, label] of [['a', 'style:a"'], ['style', 'a:#35;'], ['classDef', 'a:#35;']]) {
        let body = readC4Source(`C4Context\nPerson(${id}, "Person")\nSystem(b, "Other")`)
        body = edit(body, { kind: 'update_element', id: id!, changes: { label: label!, description: 'Later #35;' } })
        body = edit(body, { kind: 'set_title', title: 'style:a#35;' })
        body = edit(body, { kind: 'add_relationship', relationship: { from: id!, to: 'b', label: 'style:a"', technology: 'Later #35;' } })
        const written = renderC4(body)
        expect(await upstream.publicAccepts('C4Context\nPerson(control, "Control")')).toBe(true)
        const actual = await upstream.project(written, diagram => ({
          node: diagram.db.getC4ShapeArray('global')[0],
          edge: diagram.db.getRels()[0], title: diagram.db.getTitle(),
        }))
        expect(actual.ok).toBe(true)
        if (!actual.ok) throw new Error(actual.error)
        expect(projectEntityMarkers(actual.value.node.alias)).toBe(id!)
        expect(projectEntityMarkers(actual.value.node.label.text)).toBe(label!)
        expect(projectEntityMarkers(actual.value.node.descr.text)).toBe('Later #35;')
        expect(projectEntityMarkers(actual.value.edge.from)).toBe(id!)
        expect(projectEntityMarkers(actual.value.edge.to)).toBe('b')
        expect(projectEntityMarkers(actual.value.edge.label.text)).toBe('style:a"')
        expect(projectEntityMarkers(actual.value.edge.techn.text)).toBe('Later #35;')
        expect(projectEntityMarkers(actual.value.title)).toBe('style:a#35;')
        expect(readC4Source(written)).toEqual(body)
      }
      const imported = readC4Source('C4Context\nPerson(a, "style:a#quot;")')
      expect(imported.diagnostics).toContainEqual(expect.objectContaining({ syntax: 'c4_entity_prepass' }))
      const exported = await upstream.project(renderC4(imported), diagram => diagram.db.getC4ShapeArray('global')[0].label.text)
      expect(exported.ok).toBe(true)
      if (!exported.ok) throw new Error(exported.error)
      expect(projectEntityMarkers(exported.value)).toBe('style:a"')
    } finally { upstream.close() }
  })
  test('explicit shape overrides paint both outputs without changing authored role or macro', () => {
    const source = 'C4Context\nSystem_Ext(a,"Storage")\nUpdateElementStyle(a,$shape="database")'
    const body = parseC4Diagram(source)
    expect(body.elements[0]).toMatchObject({ kind: 'system', external: true, shape: 'rectangle', macro: 'System_Ext', style: { shape: 'database' } })
    expect(renderC4(body)).toBe(source)
    expect(renderMermaidSVG(source)).toContain('<ellipse')
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(layoutMermaid(parsed.value).nodes[0]!.shape).toBe('database')
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
    // A `;` separator is written as the line break Mermaid reads.
    for (const [source, written] of [['C4&#67;ontext\nSystem(a,"Visible")'], ['%% leading\nc4context\nSystem(a,"Visible")'], ['C4&#67;ontext; System(a,"Visible")', 'C4&#67;ontext\nSystem(a,"Visible")']] as const) {
      const parsed = parseRegisteredMermaid(source)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) throw new Error(parsed.error[0]?.message)
      expect(parsed.value.body.kind).toBe('c4')
      expect(serializeMermaid(parsed.value)).toBe(written ?? source)
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
    expect(body.elements.map(record => [record.id, record.kind, record.shape, record.external])).toEqual([
      ['p', 'person', 'person', false], ['px', 'person', 'person', true],
      ['System', 'system', 'rectangle', false], ['System_Ext', 'system', 'rectangle', true],
      ['SystemDb', 'system', 'database', false], ['SystemDb_Ext', 'system', 'database', true],
      ['SystemQueue', 'system', 'queue', false], ['SystemQueue_Ext', 'system', 'queue', true],
      ['Container', 'container', 'rectangle', false], ['Container_Ext', 'container', 'rectangle', true],
      ['ContainerDb', 'container', 'database', false], ['ContainerDb_Ext', 'container', 'database', true],
      ['ContainerQueue', 'container', 'queue', false], ['ContainerQueue_Ext', 'container', 'queue', true],
      ['Component', 'component', 'rectangle', false], ['Component_Ext', 'component', 'rectangle', true],
      ['ComponentDb', 'component', 'database', false], ['ComponentDb_Ext', 'component', 'database', true],
      ['ComponentQueue', 'component', 'queue', false], ['ComponentQueue_Ext', 'component', 'queue', true],
    ])
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

  test.each(['Person', 'Person_Ext'])('%s keeps named fields occupying the label slot through a label edit', async macro => {
    const upstream = startUpstreamMermaid()
    try {
      for (const [name, value, fields] of [
        ['sprite', 'users', { sprite: 'users' }],
        ['link', 'https://example.com', { link: 'https://example.com' }],
        ['tags', 'one+two', { tags: ['one', 'two'] }],
      ] as const) {
        const source = `C4Context\n${macro}(p, $${name}="${value}")`
        const body = readC4Source(source)
        expect(body.elements[0]).toMatchObject({ id: 'p', label: '', ...fields })
        expect(renderC4(body)).toBe(source)
        const parsed = parseRegisteredMermaid(source)
        if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
        expect(parsed.value.body.kind).toBe('c4')
        const result = mutateC4(body, { kind: 'update_element', id: 'p', changes: { label: 'Edited' } })
        if (!result.ok) throw new Error(result.error.message)
        const written = renderC4(result.value)
        expect(readC4Source(written).elements[0]).toMatchObject({ id: 'p', label: 'Edited', ...fields })
        expect(await upstream.accepts(written), written).toBe(true)
      }
    } finally { upstream.close() }
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
    const written = renderC4(body)
    expect(written).toContain('UpdateLayoutConfig("")')
    expect(parseC4Diagram(written).boundaries).toEqual(body.boundaries)
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
    const written = renderC4(body)
    const reloaded = readC4Source(written)
    expect(reloaded.elements[0]).toMatchObject({ label: 'A, (B) {C} %% text', description: 'First\nSecond', tags: ['public', 'important'], link: 'https://example.com' })
    expect(reloaded.elements[1]).toMatchObject({ technology: 'SQL', description: 'Stores "quoted" values', style: { bgColor: '#ffffff', fontColor: '#111111', borderColor: '#336699' } })
    expect(reloaded.layout).toMatchObject({ shapesPerRow: 3, boundariesPerRow: 2 })
    expect(written).toContain('$tags="public+important"')
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

  test('layout no-ops construct a real attribute without inventing settings or children', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const source = 'C4Context\nUpdateLayoutConfig("5","3")\nSystem(a,"A")'
      for (const noop of ['UpdateLayoutConfig()', 'UpdateLayoutConfig ( )', 'UpdateLayoutConfig("")']) {
        const body = readC4Source(`${source}\n${noop}`)
        expect(body.directives).toHaveLength(1)
        expect(body.layout).toMatchObject({ shapesPerRow: 5, boundariesPerRow: 3 })
        expect(body.diagnostics.some(item => item.syntax === 'c4_empty_layout_arguments')).toBe(noop !== 'UpdateLayoutConfig("")')
        const written = renderC4(body)
        expect(await upstream.publicAccepts(written), written).toBe(true)
        expect(readC4Source(written).diagnostics).toEqual([])
        expect(readC4Source(written).elements.map(node => node.id)).toEqual(['a'])
        expect(renderC4(readC4Source(written))).toBe(written)
      }
      const edited = edit(readC4Source(source), { kind: 'add_directive', name: 'UpdateLayoutConfig', args: [] })
      expect(edited.directives).toHaveLength(1)
      expect(edited.layout).toMatchObject({ shapesPerRow: 5, boundariesPerRow: 3 })
      const result = await upstream.project(renderC4(edited), diagram => ({ shapes: diagram.db.getC4ShapeInRow(), boundaries: diagram.db.getC4BoundaryInRow() }))
      expect(result).toEqual({ ok: true, value: { shapes: 5, boundaries: 3 } })
    } finally { upstream.close() }
  })

  test('directive constructors retain logical fields across positional runtime slots', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const source = 'C4Context\nUpdateLayoutConfig("5","3")\nSystem(a,"A")\nSystem(b,"B")\nRel(a,b,"Uses")'
      for (const args of [
        [{ name: 'c4BoundaryInRow', value: '2' }],
        [{ name: 'c4BoundaryInRow', value: '2' }, { name: 'c4ShapeInRow', value: '4' }],
      ]) {
        const body = edit(readC4Source(source), { kind: 'add_directive', name: 'UpdateLayoutConfig', args })
        const written = renderC4(body)
        const result = await upstream.project(written, diagram => ({ shapes: diagram.db.getC4ShapeInRow(), boundaries: diagram.db.getC4BoundaryInRow() }))
        expect(result).toEqual({ ok: true, value: { shapes: args.length === 1 ? 5 : 4, boundaries: 2 } })
        expect(body.layout).toMatchObject({ shapesPerRow: args.length === 1 ? 5 : 4, boundariesPerRow: 2 })
        expect(body.directives.at(-1)!.args.map(arg => arg.name)).toEqual([undefined, undefined])
      }
      let body = edit(readC4Source(source), { kind: 'add_directive', name: 'UpdateElementStyle', args: [{ name: 'fontColor', value: 'blue' }, { name: 'elementName', value: 'a' }, { name: 'bgColor', value: 'red' }] })
      body = edit(body, { kind: 'add_directive', name: 'UpdateRelStyle', args: [{ name: 'to', value: 'b' }, { name: 'lineColor', value: 'green' }, { name: 'from', value: 'a' }] })
      expect(body.elements[0]!.style).toMatchObject({ bgColor: 'red', fontColor: 'blue' })
      expect(body.relationships[0]!.style).toMatchObject({ lineColor: 'green' })
      const result = await upstream.project(renderC4(body), diagram => ({
        element: diagram.db.getC4ShapeArray('global')[0], relationship: diagram.db.getRels()[0],
      }))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      expect(result.value.element).toMatchObject({ alias: 'a', bgColor: 'red', fontColor: 'blue' })
      expect(result.value.relationship).toMatchObject({ from: 'a', to: 'b', lineColor: 'green' })
    } finally { upstream.close() }
  })

  test('named declaration identities cannot leak objects into positional runtime slots', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const source = 'C4Container\nBoundary($label="Group",$alias="g") {\nSystem($label="Alpha",$alias="a")\nContainer(b,"Beta",$techn="HTTP")\nRel($label="Uses",$to="b",$from="a")\n}'
      const body = readC4Source(source)
      const written = renderC4(body)
      const result = await upstream.project(written, diagram => ({
        groups: diagram.db.getBoundaries().map((group: any) => ({ id: group.alias, label: group.label.text, parent: group.parentBoundary })),
        nodes: diagram.db.getC4ShapeArray('g').map((node: any) => ({ id: node.alias, label: node.label.text, parent: node.parentBoundary })),
        edges: diagram.db.getRels().map((edge: any) => ({ from: edge.from, to: edge.to, label: edge.label.text })),
      }))
      expect(result).toEqual({ ok: true, value: {
        groups: [{ id: 'global', label: 'global', parent: '' }, { id: 'g', label: 'Group', parent: 'global' }],
        nodes: [{ id: 'a', label: 'Alpha', parent: 'g' }, { id: 'b', label: 'Beta', parent: 'g' }],
        edges: [{ from: 'a', to: 'b', label: 'Uses' }],
      } })
      const reloaded = readC4Source(written)
      expect(reloaded.boundaries.map(node => [node.id, node.label, node.parentId])).toEqual([['g', 'Group', undefined]])
      expect(reloaded.elements.map(node => [node.id, node.label, node.parentId])).toEqual([['a', 'Alpha', 'g'], ['b', 'Beta', 'g']])
      expect(reloaded.relationships.map(edge => [edge.from, edge.to, edge.label])).toEqual([['a', 'b', 'Uses']])
      expect(renderC4(reloaded)).toBe(written)
    } finally { upstream.close() }
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

  test('canonical edited quotes, literal entities, Unicode and whitespace aliases parse in pinned Mermaid', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const label = 'He said "hello"; #quot; <br/> <b>literal</b>\nNext, %% text'
      let body = edit(emptyC4Body('C4Container'), { kind: 'add_element', element: { id: '資料 é 👩‍💻', kind: 'container', label, technology: 'HTTPS' } })
      body = edit(body, { kind: 'add_element', element: { id: 'A\nB', label: 'Line identity' } })
      body = edit(body, { kind: 'add_element', element: { id: 'A\tB', label: 'Tab identity' } })
      body = edit(body, { kind: 'add_relationship', relationship: { from: '資料 é 👩‍💻', to: 'A\nB', label: 'Quoted "edge"' } })
      // Mermaid trims each argument, so blanks at either end must survive as entity codes.
      body = edit(body, { kind: 'add_element', element: { id: ' Padded ', label: '\u3000 Padded label ' } })
      const result = await upstream.project(renderC4(body), diagram => ({
        elements: diagram.db.getC4ShapeArray('global').map((record: any) => ({ id: record.alias, label: record.label.text })),
        relationships: diagram.db.getRels().map((record: any) => ({ from: record.from, to: record.to, label: record.label.text })),
      }))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      expect(result.value.elements.map((record: { id: string }) => projectEntityMarkers(record.id))).toEqual(body.elements.map(record => record.id))
      expect(projectEntityMarkers(breakLineTags(result.value.elements[0].label))).toBe(label)
      expect(projectEntityMarkers(result.value.elements[3].label)).toBe('\u3000 Padded label ')
      expect(result.value.relationships.map((record: { from: string; to: string; label: string }) => ({ from: projectEntityMarkers(record.from), to: projectEntityMarkers(record.to), label: projectEntityMarkers(record.label) }))).toEqual([{ from: '資料 é 👩‍💻', to: 'A\nB', label: 'Quoted "edge"' }])
    } finally { upstream.close() }
  })

  test('new directive-like C4 argument text keeps exact identities and values in portable output', async () => {
    const upstream = startUpstreamMermaid()
    try {
      const original = 'C4Context\nPerson(a,"A")\nSystem(b,"B")\nRel(a,b,"Uses")'
      for (const text of ['%%{text', 'prefix %%{init: {}}%% suffix', '%%{literal #37; and "quote"']) {
        let body = readC4Source(original)
        body = edit(body, { kind: 'update_element', id: 'a', changes: { label: text, description: text, link: text } })
        body = edit(body, { kind: 'rename_element', from: 'a', to: text })
        body = edit(body, { kind: 'update_relationship', id: body.relationships[0]!.id, changes: { label: text, technology: text } })
        body = edit(body, { kind: 'set_title', title: text })
        const written = renderC4(body)
        // The public prepass sees directive openers before quoted arguments.
        // The same worker must recover from that rejected source and parse
        // the corrected export with its literal text intact.
        expect(await upstream.publicAccepts('C4Context\nPerson(a,"%%{text")')).toBe(false)
        expect(await upstream.publicAccepts(written), written).toBe(true)
        expect(written).toContain('System(b,"B")')
        const reloaded = readC4Source(written)
        expect(reloaded.elements[0]).toMatchObject({ id: text, label: text, description: text, link: text })
        expect(reloaded.relationships[0]).toMatchObject({ from: text, to: 'b', label: text, technology: text })
        expect(reloaded.title).toBe(text)
        const upstreamValues = await upstream.project(written, diagram => ({
          element: diagram.db.getC4ShapeArray('global')[0],
          relationship: diagram.db.getRels()[0],
          title: diagram.db.getTitle(),
        }))
        expect(upstreamValues.ok).toBe(true)
        if (!upstreamValues.ok) throw new Error(upstreamValues.error)
        expect(projectEntityMarkers(upstreamValues.value.element.alias)).toBe(text)
        expect(projectEntityMarkers(upstreamValues.value.element.label.text)).toBe(text)
        expect(projectEntityMarkers(upstreamValues.value.relationship.from)).toBe(text)
        expect(projectEntityMarkers(upstreamValues.value.relationship.label.text)).toBe(text)
        expect(projectEntityMarkers(upstreamValues.value.title)).toBe(text)
        const publicParsed = parseRegisteredMermaid(written)
        expect(publicParsed.ok).toBe(true)
        if (!publicParsed.ok) throw new Error(JSON.stringify(publicParsed.error))
        expect(publicParsed.value.body.kind).toBe('c4')
        expect(renderMermaidSVG(publicParsed.value)).toBe(renderMermaidSVG(written))
        expect(renderMermaidASCII(publicParsed.value)).toBe(renderMermaidASCII(written))
      }
      const authored = 'C4Context\nPerson(a,"%%{text")'
      const portable = renderC4(readC4Source(authored))
      expect(await upstream.publicAccepts(portable)).toBe(true)
      expect(readC4Source(portable).elements[0]).toMatchObject({ id: 'a', label: '%%{text' })
    } finally { upstream.close() }
  })

  test.each([
    ['C4Context\nSystem(s,b)', 'C4Context\nSystem(s, "b")', 'b'],
    ['C4Context\nPerson(c,$)', 'C4Context\nPerson(c, "$")', '$'],
    ['C4Context\nSystem(s,"B",description)', 'C4Context\nSystem(s, "B", $descr="description")', 'B'],
    ['C4Context\nSystem(s,"B",$descr=description)', 'C4Context\nSystem(s, "B", $descr="description")', 'B'],
    ['C4Context\nSystem(s,$,"description")', 'C4Context\nSystem(s, "$", $descr="description")', '$'],
  ] as const)('unquoted arguments with a clear value are written as quoted Mermaid: %s', (source, written, label) => {
    const body = parseC4Diagram(source)
    expect(body.elements[0]!.label).toBe(label)
    expect(body.diagnostics).toContainEqual(expect.objectContaining({ syntax: 'c4_unquoted_argument' }))
    expect(renderC4(body)).toBe(written)
    const reparsed = parseC4Diagram(written)
    expect(reparsed.elements[0]).toMatchObject({ id: body.elements[0]!.id, label, description: body.elements[0]!.description })
    expect(reparsed.diagnostics).not.toContainEqual(expect.objectContaining({ syntax: 'c4_unquoted_argument' }))
    expect(renderC4(reparsed)).toBe(written)
  })

  test.each(['C4Context\nSystem(s,b,"description")', 'C4Context\nSystem(s,"$",$descr="description")'])('accepted argument spellings retain their exact source: %s', source => {
    const body = parseC4Diagram(source)
    expect(body.diagnostics).not.toContainEqual(expect.objectContaining({ syntax: 'c4_unquoted_argument' }))
    expect(renderC4(body)).toBe(source)
  })

  test.each([
    ['System(s,cost $currency=GBP,"description")', { id: 's', label: 'cost $currency=GBP', description: 'description' }],
    ['System(s,cost $currency="GBP","description")', { id: 's', label: 'cost $currency="GBP"', description: 'description' }],
    ['Container(s,"Label",runtime $version=12,"description")', { id: 's', label: 'Label', technology: 'runtime $version=12', description: 'description' }],
    ['System(s,"Label",cost $currency=GBP,$link="https://example.com")', { id: 's', label: 'Label', description: 'cost $currency=GBP', link: 'https://example.com' }],
    ['System(system$x=1,"Label")', { id: 'system$x=1', label: 'Label' }],
    ['System(s,"cost $currency=GBP","description")', { id: 's', label: 'cost $currency=GBP', description: 'description' }],
  ] as const)('comma-delimited positional dollar text survives parsing and typed edits: %s', (call, expected) => {
    const source = `C4Context\n${call}`
    const body = parseC4Diagram(source)
    expect(body.elements[0]).toMatchObject(expected)
    expect(body.diagnostics).toEqual([])
    expect(verifyMermaid(source).ok).toBe(true)
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    expect(serializeMermaid(parsed.value)).toBe(source)
    const updated = edit(body, { kind: 'update_element', id: expected.id, changes: { link: 'https://example.com/updated' } })
    expect(updated.elements[0]).toMatchObject({ ...expected, link: 'https://example.com/updated' })
    expect(parseC4Diagram(renderC4(updated)).elements[0]).toMatchObject({ ...expected, link: 'https://example.com/updated' })
  })

  test.each([
    'System(s, "S", $tadb"cyl&inder")',
    'Person_Ext(customerA,b2 $link="https://github.com/mermaidjs")',
    'System(s, "S", $descr=text $link="https://example.com")',
    'System(s, "S", $descr=text $link="https://example.com", $tags="tag")',
    'System(s, "Label" $link="https://example.com")',
  ])('damaged named arguments are refused instead of converted to literal metadata: %s', call => {
    const source = `C4Context\n${call}`
    expect(() => readC4Source(source)).toThrow('C4 argument is ambiguous')
    expect(() => parseC4Diagram(source)).toThrow('C4 argument is ambiguous')
  })

  test('quoted text resembling named arguments remains literal display text', () => {
    const source = 'C4Context\nPerson_Ext(customerA,"b2 $link=#quot;https://github.com/mermaidjs#quot;")'
    const body = parseC4Diagram(source)
    expect(body.elements[0]).toMatchObject({ id: 'customerA', label: 'b2 $link="https://github.com/mermaidjs"', link: undefined })
    expect(renderC4(body)).toBe(source)
  })

  // Pinned Mermaid C4 needs a line break after each statement and after `{`
  // (a closing `}` may share the line before it), and its comments take the
  // line breaks after them. Ours reads these layouts, reports each, and writes
  // the line break Mermaid needs (a comment sharing the line moves to a line
  // of its own, a statement after `{` one level deeper); a comment ending the
  // source or a block is Mermaid's.
  test.each([
    ['C4Context\nSystem_Boundary(b, "B") { Person(a, "A") }', true, 'C4Context\nSystem_Boundary(b, "B") {\n  Person(a, "A") }'],
    ['C4Context\n  System_Boundary(b, "B") { Person(a, "A"); Person(c, "C") }', true, 'C4Context\n  System_Boundary(b, "B") {\n    Person(a, "A")\n    Person(c, "C") }'],
    ['C4Context\nPerson(a, "A") Person(b, "B")', true, 'C4Context\nPerson(a, "A")\nPerson(b, "B")'],
    ['C4Context\nSystem_Boundary(b, "B") {\nPerson(a, "A")\n} Person(c, "C")', true, 'C4Context\nSystem_Boundary(b, "B") {\nPerson(a, "A")\n}\nPerson(c, "C")'],
    ['C4Context\nPerson(a, "A") %% note\nPerson(b, "B")', true, 'C4Context\nPerson(a, "A")\n%% note\nPerson(b, "B")'],
    ['C4Context\nPerson(a, "A") %% note', false, 'C4Context\nPerson(a, "A") %% note'],
    ['C4Context\nSystem_Boundary(b, "B") {\nPerson(a, "A") %% note\n}', false, 'C4Context\nSystem_Boundary(b, "B") {\nPerson(a, "A") %% note\n}'],
  ] as const)('%j is reported as a reader extension: %p', (source, reported, written) => {
    const body = parseC4Diagram(source)
    expect(body.diagnostics.some(record => record.message.includes('Statements sharing a line'))).toBe(reported)
    expect(renderC4(body)).toBe(written)
  })

  test('source map addresses independent relationships and exact label starts', () => {
    const body = parseC4Diagram(source)
    const map = buildC4SourceMap(body, source)
    expect(map.edges.get(body.relationships[0]!.id)).toEqual({ line: 8, col: 1 })
    expect(map.edges.get(body.relationships[1]!.id)).toEqual({ line: 9, col: 1 })
    expect(map.labels.get('node:a')).toEqual({ line: 4, col: 13 })
    // A label starts after the blanks the reader trims inside its quotes.
    const padded = 'C4Context\nPerson(a, "  Ann")'
    expect(buildC4SourceMap(parseC4Diagram(padded), padded).labels.get('node:a')).toEqual({ line: 2, col: 14 })
    expect(map.groups.get('g')).toEqual({ line: 3, col: 1 })
  })
})
