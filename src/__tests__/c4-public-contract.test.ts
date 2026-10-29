import { describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeXML } from 'entities'
import {
  asC4, describeMermaid, describeMermaidFacts, layoutMermaid, mutate, parseRegisteredMermaid, renderMermaidASCII,
  renderMermaidASCIIWithReceipt, renderMermaidPNGWithReceipt, renderMermaidSVG, renderMermaidWithActions,
  serializeMermaid, verifyMermaid,
} from '../agent/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { runCli } from '../cli/index.ts'
import { captureCli } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs()
const SOURCE = `C4Deployment
  Deployment_Node(prod, "Production", "Linux") {
    Container(api, "API", "TypeScript")
    ContainerDb(db, "Orders", "PostgreSQL")
  }
  Rel(api, db, "First", "SQL")
  Rel(api, db, "Second", "SQL")`

// These are public transport and action contracts; parser and geometric laws
// live in the C4 semantic/output tests, not a second support inventory.
describe('C4 public contract', () => {
  test('accessible read-back retains C4 roles, hierarchy and one record per authored interaction', () => {
    const parsed = parseRegisteredMermaid(`C4Dynamic
Deployment_Node(prod,"Production","Linux") {
  ContainerDb_Ext(store,"Orders","PostgreSQL","Managed store")
}
Person(client,"Customer")
RelIndex(7,client,store,"Reads")
Rel_Back(client,store,"Replies","TLS")
BiRel(client,store,"Synchronizes")`)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const tree = JSON.parse(describeMermaid(parsed.value, { format: 'json' }))
    expect(tree.nodes.find((node: { id: string }) => node.id === 'prod')).toMatchObject({ label: 'Production\n[Deployment Node: Linux]', c4: { category: 'boundary', kind: 'deployment' } })
    expect(tree.nodes.find((node: { id: string }) => node.id === 'store')).toMatchObject({ label: 'Orders\n[External Container: Database: PostgreSQL]\nManaged store', c4: { category: 'element', kind: 'container', external: true, shape: 'database', effectiveShape: 'database', parentId: 'prod' } })
    expect(tree.edges).toHaveLength(3)
    expect(tree.edges[0]).toMatchObject({ from: 'client', to: 'store', label: '7: Reads', c4: { order: 1, index: '7', macro: 'RelIndex' } })
    expect(tree.edges[1]).toMatchObject({ from: 'store', to: 'client', label: '2: Replies\n[TLS]', c4: { order: 2, authoredFrom: 'client', authoredTo: 'store', reversed: true } })
    expect(tree.edges[2]).toMatchObject({ from: 'client', to: 'store', label: '3: Synchronizes', c4: { order: 3, bidirectional: true } })
    expect(new Set(tree.edges.map((edge: { c4: { id: string } }) => edge.c4.id)).size).toBe(3)
    const both = parseRegisteredMermaid('C4Context\nSystem(a,"A")\nSystem(b,"B")\nBiRel(a,b,"Sync")')
    if (!both.ok) throw new Error(JSON.stringify(both.error))
    expect(JSON.parse(describeMermaid(both.value, { format: 'json' }))).toMatchObject({ entryPoints: [], sinks: [] })
  })

  test('SVG has a fallback accessible name while authored metadata and prefixed references retain authority', () => {
    const fallback = renderMermaidSVG('C4Context\nSystem(a,"A")')
    expect(fallback).toContain('role="img"')
    expect(fallback).toContain('aria-label="C4 architecture diagram"')
    const authored = renderMermaidSVG('C4Context\naccTitle: Service context\naccDescr: The application and its users.\nSystem(a,"A")', { idPrefix: 'c4-access-' })
    expect(authored).toContain('aria-labelledby="c4-access-svg-title"')
    expect(authored).toContain('aria-describedby="c4-access-svg-desc"')
    expect(authored).toContain('id="c4-access-svg-title">Service context</title>')
    expect(authored).toContain('id="c4-access-svg-desc">The application and its users.</desc>')
    expect(authored).not.toContain('aria-label="C4 architecture diagram"')
  })

  test('verification reports rejected conflicting placement hints without losing interactions', () => {
    const source = 'C4Context\nSystem(a,"A")\nSystem(b,"B")\nRel_L(a,b,"Left")\nRel_R(a,b,"Right")'
    const verified = verifyMermaid(source)
    expect(verified.warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX')).toEqual([
      { code: 'UNSUPPORTED_SYNTAX', syntax: 'c4_layout_conflict', line: 5, message: expect.stringMatching(/^C4_LAYOUT_CONFLICT: .*\(in: Rel_R\(a,b,"Right"\)\)$/) },
    ])
    expect(verified.layout.edges).toHaveLength(2)
  })

  test('frontmatter title has one terminal owner and SVG provenance uses authored physical lines', () => {
    const source = '---\ntitle: Heading\n---\n%% wrapper\nC4Context\nSystem(a,"A")\n'
    const terminal = renderMermaidASCII(source, { colorMode: 'none' })
    expect(terminal.match(/Heading/g)).toHaveLength(1)
    expect(renderMermaidSVG(source)).toContain('data-source-line="6"')
  })

  test('facts keep distinct authored whitespace identities and effective metadata', () => {
    const parsed = parseRegisteredMermaid('C4Context\nSystem("A B", "Space")\nSystem("A\tB", "Tab", $tags="data", $link="https://example.com")\nRel("A B","A\tB","Sends")')
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const facts = describeMermaidFacts(parsed.value)
    expect(facts).toContain('element "A B" system internal rectangle : Space')
    expect(facts).toContain('element "A\\tB" system internal rectangle : Tab')
    expect(facts).toContain('c4 "A\\tB" link "https://example.com"')
    expect(facts).toContain('interaction#1 c4-rel-1 "A B" -> "A\\tB" : Sends')
  })

  test('Code Mode creates, narrows, edits and renders the current typed body', async () => {
    const result = await executeInSandbox(`
      const d = mermaid.buildMermaid('c4', [
        {kind:'add_boundary',boundary:{id:'prod',label:'Production',kind:'deployment',type:'Linux'}},
        {kind:'add_element',element:{id:'api',label:'API',kind:'container',technology:'TypeScript',parentId:'prod'}},
        {kind:'add_element',element:{id:'db',label:'Orders',kind:'container',shape:'database',technology:'PostgreSQL',parentId:'prod'}},
        {kind:'add_relationship',relationship:{from:'api',to:'db',label:'Stores',technology:'SQL'}}
      ], {c4Variant:'C4Deployment'});
      if (!d.ok) return {error:d.error};
      const c4 = mermaid.asC4(d.value);
      if (!c4) return {error:'narrow failed'};
      const edited = mermaid.mutate(c4,{kind:'update_element',id:'api',changes:{label:'Order service'}});
      if (!edited.ok) return {error:edited.error};
      const checked = mermaid.verifyMermaid(edited.value);
      return {ok:checked.ok,source:mermaid.serializeMermaid(edited.value),text:mermaid.renderMermaidASCII(edited.value)};
    `)
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({ ok: true })
    expect((result.value as { source: string }).source).toContain('Order service')
    expect((result.value as { text: string }).text).toContain('Order service')
    expect((result.value as { text: string }).text).toContain('PostgreSQL')
  })

  test('CLI emits native C4 SVG and terminal output with separate repeated interactions', () => {
    const file = join(temp.dir('c4-cli-'), 'deployment.mmd')
    writeFileSync(file, SOURCE)
    const svg = captureCli(() => runCli(['render', file, '--format', 'svg']))
    const text = captureCli(() => runCli(['render', file, '--format', 'ascii']))
    expect(svg.code).toBe(0)
    expect(svg.out).toContain('<svg')
    expect(text.code).toBe(0)
    for (const label of ['Production', 'TypeScript', 'PostgreSQL', 'First', 'Second', 'SQL']) {
      expect(svg.out).toContain(label)
      expect(text.out).toContain(label)
    }
    expect(readFileSync(file, 'utf8')).toBe(SOURCE)
  })

  test('current edits reach pixels, cells and actual offline PNG bytes', () => {
    const parsed = parseRegisteredMermaid(SOURCE)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const c4 = asC4(parsed.value)!
    const edited = mutate(c4, { kind: 'update_relationship', id: c4.body.relationships[1]!.id, changes: { label: 'Updated second' } })
    if (!edited.ok) throw new Error(edited.error.message)
    expect(serializeMermaid(edited.value)).toContain('Updated second')
    expect(renderMermaidSVG(edited.value)).toContain('Updated second')
    expect(renderMermaidASCII(edited.value)).toContain('Updated second')
    const options = { fitTo: { width: 640 }, background: '#fff' }
    const artifact = renderMermaidPNGWithReceipt(edited.value, options)
    const expectedSource = SOURCE.replace('Rel(api, db, "Second", "SQL")', 'Rel(api, db, "Updated second", "SQL")')
    expect(artifact.png).toEqual(renderMermaidPNGWithReceipt(expectedSource, options).png)
    expect(artifact.png).not.toEqual(renderMermaidPNGWithReceipt(SOURCE, options).png)
    expect(Array.from(artifact.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(artifact.receipt.output).toBe('png')
    expect(new DataView(artifact.png.buffer, artifact.png.byteOffset).getUint32(16)).toBe(640)
  })

  test.each([
    { authored: '<b>MiXeD</b>', expected: '<b>MiXeD</b>', edit: false },
    { authored: '#lt;i#gt;MiXeD#lt;/i#gt; #35;quot;', expected: '<i>MiXeD</i> #quot;', edit: false },
    { authored: 'Before', expected: 'He said "Hi"; #quot; <b>MiXeD</b>', edit: true },
  ])('literal relationship receipts survive casing and reload: $expected', ({ authored, expected, edit }) => {
    const source = `C4Context\nPerson(a,"A")\nSystem(b,"B")\nRel(a,b,"${authored}")`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const c4 = asC4(parsed.value)!
    const result = edit
      ? mutate(c4, { kind: 'update_relationship', id: c4.body.relationships[0]!.id, changes: { label: expected } })
      : parsed
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    const exported = serializeMermaid(result.value), reloaded = parseRegisteredMermaid(exported)
    if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error))
    expect(asC4(reloaded.value)!.body.relationships[0]!.label).toBe(expected)
    expect(describeMermaidFacts(reloaded.value)).toEqual(describeMermaidFacts(result.value))
    // Exercise the typed body as well as source dispatch. Pixel casing must
    // never replace the untransformed text claimed by terminal receipts.
    for (const input of [result.value, reloaded.value, edit ? exported : source]) {
      for (const style of [undefined, { roles: { edge: { textTransform: 'uppercase' as const, letterSpacing: 2 } } }]) {
        const svg = renderMermaidSVG(input, { style })
        const ink = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, '')))
        expect(ink).toContain(style ? expected.toUpperCase() : expected)
        for (const useAscii of [false, true]) {
          const terminal = renderMermaidASCIIWithReceipt(input, { colorMode: 'none', useAscii, style })
          expect(terminal.text).toContain(expected)
          expect(terminal.terminalStyle.connectorProjection.connectors.flatMap(connector => connector.labels.map(label => label.text))).toEqual([expected])
        }
      }
    }
  })

  test('element, boundary and interaction actions point to their rendered owners', () => {
    const source = `C4Context
      System_Boundary(b, "Boundary", $link="https://example.com/b") {
        System(a, "API", $link="https://example.com/a")
        System(z, "Store")
      }
      Rel(a, z, "Writes", $link="https://example.com/edge")`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const relationId = asC4(parsed.value)!.body.relationships[0]!.id
    const layout = layoutMermaid(parsed.value, { regions: true, actions: true })
    expect(layout.actions!.map(action => action.regionId).sort()).toEqual(['node:a', 'group:b', `edge:${relationId}`].sort())
    for (const format of ['svg', 'unicode'] as const) {
      const artifact = renderMermaidWithActions(parsed.value, { format })
      expect(artifact.actionSurface.actions.map(action => action.region?.id).sort()).toEqual(['node:a', 'group:b', `edge:${relationId}`].sort())
      expect(artifact.actionSurface.actions.every(action => action.security === 'safe' && !action.executable)).toBe(true)
    }
  })
})
