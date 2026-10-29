// Phase C: structured class diagram support.

import { describe, expect, test } from 'bun:test'
import { decodeHTML } from 'entities'
import { classUnsupportedSyntaxWarnings } from '../agent/class-body.ts'
import { applyOps, asClass, mutate, mutateChecked, mutatePreservingSource, parseRegisteredMermaid as parseMermaid, renderMermaidSVG, renderMermaidASCII, serializeMermaid, verifyMermaid, synthesizeFromGraph } from '../agent/index.ts'
import { renderMermaidSVG as renderSourceSVG, renderMermaidASCII as renderSourceASCII } from '../index.ts'
import type { ClassMutationOp } from '../agent/types.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { normalizeMermaidSource, withFrontmatterTitle } from '../mermaid-source.ts'
import { withAccessibilityFields } from '../shared/accessibility-directives.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

// Independent consumer projection: Mermaid resolves DB markers in HTML.
function logicalStyle(field: string): string {
  const decoded = decodeHTML(field.replace(/ﬂ°°(\d+)¶ß|ﬂ°(\w+)¶ß/g, (_token, numeric, named) => numeric ? `&#${numeric};` : `&${named};`))
  const colon = decoded.indexOf(':')
  return `${decoded.slice(0, colon).trim()}:${decoded.slice(colon + 1).trim()}`
}

const parse = (s: string) => {
  const r = parseMermaid(s)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}

describe('class — explicit source-preserving member edits', () => {
  const native = (source: string) => {
    const normalized = normalizeMermaidSource(source, {}, 'render')
    return withFrontmatterTitle(withAccessibilityFields(parseClassDiagram(normalized.familyLines, normalized.authoredFamilyLines ?? normalized.familyLines), normalized.accessibility), normalized.frontmatter)
  }

  test.each([
    ['classDiagram\nnamespace `~`{class `P`}', 'P'],
    ['classDiagram\nnamespace `~` {class P; class Q}\nP --> Q : Keep relation\nclick P href "https://example.com" "Keep tooltip"', 'P'],
    ['classDiagram\nnamespace `~T~A::B` {\n\tclass `IPC::Sender`\n}', 'IPC::Sender'],
    ['classDia&#103;ram\nnamespace `~` {\nclass P["Keep &amp;amp; label"]\n}', 'P'],
    ['classDiagram\nnamespace `~` {\nclass P\n}\nclick P href "https://example.com" "Keep &quot;tooltip&quot;"', 'P'],
    ['---\r\ntitle: Delivery\r\n---\r\n%% keep wrapper\r\nclassDiagram\r\naccTitle: Classes\r\ndirection LR\r\nnamespace `~`["Keep group"] {\r\nclass P["Keep label"] {\r\n+String name\r\n}\r\n}\r\nclass Q\r\nP --> Q : Keep relation\r\nnote for P "Keep note"\r\nclass P:::hot\r\nclassDef hot fill:#f96\r\nstyle P stroke:#333\r\nclick P href "https://example.com" "Keep tooltip"\r\n', 'P'],
  ] as const)('preserves original bytes and every unrelated native field in %s', (source, id) => {
    const original = parse(source)
    expect(original.body.kind).toBe('opaque')
    const originalJson = JSON.stringify(original)
    const before = native(source)
    const first = mutatePreservingSource(original, { kind: 'add_member', class: id, text: '+read()' })
    if (!first.ok) throw new Error(first.error.message)
    expect(first.value.source.startsWith(source)).toBe(true)
    expect(first.value.diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(first.value.diagram)).toBe(first.value.source)
    const expected = { ...before, classes: before.classes.map(node => node.id === id ? { ...node, methods: [...node.methods, { visibility: '+' as const, name: 'read', type: undefined, isStatic: false, isAbstract: false, isMethod: true, params: undefined }] } : node) }
    expect(native(first.value.source)).toEqual(expected)
    const second = mutatePreservingSource(first.value.diagram, { kind: 'add_member', class: id, text: '+ready()' })
    if (!second.ok) throw new Error(second.error.message)
    expect(second.value.source.startsWith(first.value.source)).toBe(true)
    expect(serializeMermaid(parse(second.value.source))).toBe(second.value.source)
    expect(native(second.value.source).classes.find(node => node.id === id)?.methods.map(member => member.name)).toEqual(['read', 'ready'])
    const third = mutatePreservingSource(second.value.diagram, { kind: 'add_member', class: id, text: '+int count' })
    if (!third.ok) throw new Error(third.error.message)
    expect(third.value.source.startsWith(second.value.source)).toBe(true)
    const secondMeaning = native(second.value.source)
    expect(native(third.value.source)).toEqual({ ...secondMeaning, classes: secondMeaning.classes.map(node => node.id === id ? { ...node, attributes: [...node.attributes, { visibility: '+' as const, name: 'count', sourceText: '+int count', type: 'int', isStatic: false, isAbstract: false, isMethod: false }] } : node) })
    const syntaxes = (diagram: typeof original) => verifyMermaid(diagram).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX').map(warning => warning.syntax)
    expect(syntaxes(second.value.diagram)).toEqual(syntaxes(original))
    expect(renderSourceSVG(second.value.source)).toContain('ready()')
    expect(renderSourceASCII(second.value.source)).toContain('ready()')
    expect(renderMermaidSVG(second.value.diagram)).toBe(renderSourceSVG(second.value.source))
    expect(renderMermaidASCII(second.value.diagram)).toBe(renderSourceASCII(second.value.source))
    expect(mutate(original, { kind: 'add_member', class: id, text: '+read()' }).ok).toBe(false)
    expect(JSON.stringify(original)).toBe(originalJson)
  })

  test('refuses unsupported operations, annotations and structural injection atomically', () => {
    const original = parse('classDiagram\nnamespace `~` {\nclass P\n}\nP --() API')
    const unchanged = JSON.stringify(original)
    for (const op of [
      { kind: 'remove_class', id: 'P' },
      { kind: 'remove_member', class: 'P', index: 0 },
      { kind: 'add_member', class: 'missing', text: '+read()' },
      { kind: 'add_member', class: 'interface0', text: '+read()' },
      { kind: 'remove_member', class: 'interface0', index: 0 },
      ...['<<interface>>', '+read()\nclass Injected', 'x}\nclass Injected {', 'x} class Injected {', 'x&#125; class Injected {', '%%{init: {}}%%', '%&percnt;{init: {"theme":"dark"}}%%', 'accTitle: Changed', ''].map(text => ({ kind: 'add_member', class: 'P', text })),
    ]) expect(mutatePreservingSource(original, op).ok).toBe(false)
    expect(JSON.stringify(original)).toBe(unchanged)
    const ordinary = parse('classDiagram\nclass A')
    const editable = mutate(ordinary, { kind: 'add_member', class: 'A', text: '+read()' })
    expect(editable.ok && editable.value.body.kind).toBe('class')
  })

  test('removes the addressed whole-line member in authored order across attributes, methods, annotations and reopened classes', () => {
    const source = '---\r\ntitle: Keep\r\n---\r\nclassDiagram\r\nnamespace `~` {\r\nclass P {\r\n<<service>>\r\n  +int first\r\n  +read()\r\n  +int second\r\n}\r\n}\r\n%% Keep this comment\r\nclass P {\r\n  +read()\r\n}\r\n'
    const original = parse(source), before = native(source)
    const removed = mutatePreservingSource(original, { kind: 'remove_member', class: 'P', index: 3 })
    if (!removed.ok) throw new Error(removed.error.message)
    expect(removed.value.source).toBe(source.replace('  +int second\r\n', ''))
    const target = before.classes.find(node => node.id === 'P')!
    expect(native(removed.value.source)).toEqual({ ...before, classes: before.classes.map(node => node === target ? { ...node, attributes: node.attributes.slice(0, 1) } : node) })
    const repeated = mutatePreservingSource(removed.value.diagram, { kind: 'remove_member', class: 'P', index: 3 })
    if (!repeated.ok) throw new Error(repeated.error.message)
    expect(repeated.value.source).toBe(removed.value.source.replace('class P {\r\n  +read()\r\n}', 'class P {\r\n}'))
    expect(native(repeated.value.source).classes.find(node => node.id === 'P')?.methods.map(member => member.name)).toEqual(['read'])
    const appended = mutatePreservingSource(repeated.value.diagram, { kind: 'add_member', class: 'P', text: '+ready()' })
    if (!appended.ok) throw new Error(appended.error.message)
    const reverted = mutatePreservingSource(appended.value.diagram, { kind: 'remove_member', class: 'P', index: 3 })
    if (!reverted.ok) throw new Error(reverted.error.message)
    expect(native(reverted.value.source)).toEqual(native(repeated.value.source))
    expect(reverted.value.source).toContain('%% Keep this comment\r\n')
    expect(renderMermaidSVG(reverted.value.diagram)).toBe(renderSourceSVG(reverted.value.source))
    expect(renderMermaidASCII(reverted.value.diagram)).toBe(renderSourceASCII(reverted.value.source))
  })

  test.each([
    ['class P {+read()}', 0],
    ['class P {\n+read() }', 0],
    ['class P {\n<<service>>\n+read()\n}', 0],
    ['class P {\n+int first&#10;+read()\n}', 1],
    ['class P\nP : +read() %% Keep comment', 0],
    ['class P {\n+read()\n}', 0.5],
  ] as const)('refuses member deletion without exclusive authored line ownership in %s', (declaration, index) => {
    const source = `classDiagram\nnamespace \`~\` {\n${declaration}\n}`
    const original = parse(source), unchanged = JSON.stringify(original)
    expect(mutatePreservingSource(original, { kind: 'remove_member', class: 'P', index }).ok).toBe(false)
    expect(JSON.stringify(original)).toBe(unchanged)
  })
})

describe('class — parse', () => {
  test('classDiagram-v2 uses the native Class reader, editing and output paths', async () => {
    const body = '\nclass Account {\n+int balance\n}\nAccount --> Ledger : records\n'
    const ordinary = parse('classDiagram' + body)
    const source = 'classDiagram-v2' + body
    const alias = parse(source)
    expect(alias.kind).toBe('class')
    expect(alias.body).toEqual(ordinary.body)
    expect(renderSourceSVG(source)).toBe(renderSourceSVG('classDiagram' + body))
    expect(renderSourceASCII(source)).toBe(renderSourceASCII('classDiagram' + body))
    const edited = mutate(alias, { kind: 'rename_class', from: 'Account', to: 'Wallet' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const output = serializeMermaid(edited.value)
    expect(output).toStartWith('classDiagram\n')
    expect(asClass(parse(output))!.body.classes.map(node => node.id)).toEqual(['Wallet', 'Ledger'])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(output)).toBe(true)
    } finally { upstream.close() }
  })

  test.each([
    'class Animal:::somecl--ass {\n-int sizeInFeet\n-canE1..*t()\n}\nclassDef someclass fill:#f96',
    'class A:::a-b',
    'class A:::note',
    'class A\nclassDef a-b fill:#f96',
    'class A\nclassDef class fill:#f96',
  ])('keeps unspellable style identities source-only: %s', async statement => {
    const source = `classDiagram\n${statement}\n`
    const upstream = startUpstreamMermaid()
    try { expect(await upstream.accepts(source)).toBe(false) }
    finally { upstream.close() }
    const diagram = parse(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)
    expect(renderMermaidSVG(diagram)).toBe(renderSourceSVG(source))
    expect(renderMermaidASCII(diagram)).toBe(renderSourceASCII(source))
    expect(verifyMermaid(diagram).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_name' }))
    expect(mutate(diagram, { kind: 'add_class', id: 'Another' }).ok).toBe(false)
  })

  test('uses declaration references for portable style names outside cssClass grammar', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const name of ['-', 'class', 'classDef', 'classDiagram', 'namespace', 'style', 'call', '__proto__', 'classOne']) {
        const diagram = asClass(parse(`classDiagram\nclass A:::${name}\n`))!
        expect(diagram).not.toBeNull()
        const edited = mutate(diagram, { kind: 'rename_class', from: 'A', to: 'Renamed' })
        expect(edited.ok).toBe(true)
        if (!edited.ok) continue
        const output = serializeMermaid(edited.value)
        expect(await upstream.accepts(output)).toBe(true)
        expect(asClass(parse(output))!.body).toEqual(edited.value.body)
        expect(await upstream.project(output, value => [...value.db.getClasses().values()].map((node: { id: string; cssClasses: string }) => ({ id: node.id, classes: node.cssClasses.split(' ').filter(name => name !== 'default') }))))
          .toEqual({ ok: true, value: [{ id: 'Renamed', classes: [name] }] })
        expect(renderSourceSVG(serializeMermaid(diagram))).toBe(renderSourceSVG(`classDiagram\nclass A:::${name}\n`))
      }
    } finally { upstream.close() }
  })

  test('rejects unspellable new style identities while keeping safe definition neighbors editable', async () => {
    const diagram = asClass(parse('classDiagram\nclass A'))!
    for (const name of ['a-b', 'somecl--ass', 'note', 'o', '_blank']) {
      expect(mutate(diagram, { kind: 'set_css_class', class: 'A', className: name }).ok).toBe(false)
      expect(synthesizeFromGraph({ kind: 'class', body: { ...diagram.body, classes: [{ id: 'A', members: [], className: name }] } }).ok).toBe(false)
    }
    for (const name of ['a-b', 'class', 'classDef', 'call']) {
      expect(mutate(diagram, { kind: 'define_class', name, style: 'fill:#f96' }).ok).toBe(false)
      expect(synthesizeFromGraph({ kind: 'class', body: { ...diagram.body, classDefs: { [name]: { fill: '#f96' } } } }).ok).toBe(false)
    }
    const upstream = startUpstreamMermaid()
    try {
      for (const name of ['classOne', '__proto__', 'title', 'direction']) {
        const edited = mutate(diagram, { kind: 'define_class', name, style: 'fill:#f96' })
        expect(edited.ok).toBe(true)
        if (!edited.ok) continue
        const output = serializeMermaid(edited.value)
        expect(await upstream.accepts(output)).toBe(true)
        expect(asClass(parse(output))!.body).toEqual(edited.value.body)
      }
    } finally { upstream.close() }
  })

  test.each(['class `"`', 'class `"start`', 'class `"start`\n`"start` --> B'])('keeps a leading double quote in class identity source-only: %s', async statement => {
    const source = `classDiagram\n${statement}\n`
    const upstream = startUpstreamMermaid()
    try { expect(await upstream.accepts(source)).toBe(false) }
    finally { upstream.close() }
    const diagram = parse(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram)).toBe(source)
    expect(renderMermaidSVG(diagram)).toBe(renderSourceSVG(source))
    expect(renderMermaidASCII(diagram)).toBe(renderSourceASCII(source))
    expect(verifyMermaid(diagram).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_id' }))
    expect(mutate(diagram, { kind: 'add_class', id: 'Another' }).ok).toBe(false)
  })

  test('refuses new leading-quote identities but retains portable embedded quotes after editing', async () => {
    const diagram = asClass(parse('classDiagram\nclass A'))!
    for (const id of ['"', '"start']) {
      expect(mutate(diagram, { kind: 'add_class', id }).ok).toBe(false)
      expect(mutate(diagram, { kind: 'rename_class', from: 'A', to: id }).ok).toBe(false)
      expect(synthesizeFromGraph({ kind: 'class', body: { ...diagram.body, classes: [{ id, members: [] }] } }).ok).toBe(false)
    }
    const upstream = startUpstreamMermaid()
    try {
      const portable = asClass(parse('classDiagram\nclass `a"b`\n`a"b` --> B'))!
      const changed = mutate(portable, { kind: 'add_member', class: 'a"b', text: '+String name' })
      expect(changed.ok).toBe(true)
      if (!changed.ok) return
      const written = serializeMermaid(changed.value)
      expect(await upstream.accepts(written)).toBe(true)
      expect(asClass(parse(written))!.body).toEqual(changed.value.body)
      expect(await upstream.project(written, value => [...value.db.getClasses().keys()])).toEqual({ ok: true, value: ['a"b', 'B'] })
    } finally { upstream.close() }
  })

  test('deep namespaces retain editable source identity while native work obeys the host limit', () => {
    const depth = 15000
    const lines = [...Array<string>(depth).fill('namespace N {'), 'class A', ...Array<string>(depth).fill('}')]
    const source = `classDiagram\n${lines.join('\n')}`
    const diagram = parse(source)
    if (diagram.body.kind !== 'class') throw new Error('expected editable nested Class body')
    expect(diagram.body.namespaces).toHaveLength(depth)
    expect(diagram.body.classes.map(node => ({ id: node.id, namespace: node.namespace }))).toEqual([{ id: 'A', namespace: `${'N.'.repeat(depth - 1)}N` }])
    expect(diagram.source.nodes.get('A')).toEqual({ line: depth + 2, col: 7 })
    expect(() => parseClassDiagram(['classDiagram', ...lines])).toThrow(/DIAGRAM_WORK_LIMIT/)
    expect(classUnsupportedSyntaxWarnings(source)).toEqual([])
  })

  test.each(['class A\nfuture statement', 'class A {\n+String name', 'namespace Domain {\nclass A', 'class A\n}', 'class A\nclass A,bad/id hot', 'note "A &#10; B"', 'note for A "A &#13; B"'])('preserves source rather than exposing a partial editable model: %s', body => {
    const source = `classDiagram\n${body}`
    const diagram = parse(source)
    expect(diagram.body.kind).toBe('opaque')
    expect(serializeMermaid(diagram).trimEnd()).toBe(source)
    expect(verifyMermaid(diagram).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX' }))
  })

  test('compact namespaces keep quoted semicolons through editing and reload', () => {
    const diagram = parse('classDiagram\nnamespace Domain { class A["Before; after"]; class B }')
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    expect(typed.body.classes.map(node => ({ id: node.id, label: node.label, namespace: node.namespace }))).toEqual([
      { id: 'A', label: 'Before; after', namespace: 'Domain' },
      { id: 'B', label: undefined, namespace: 'Domain' },
    ])
    const changed = mutate(typed, { kind: 'add_member', class: 'A', text: '+String name' })
    if (!changed.ok) throw new Error(JSON.stringify(changed.error))
    const reloaded = asClass(parse(serializeMermaid(changed.value)))
    expect(reloaded?.body.classes).toEqual([expect.objectContaining({ id: 'A', label: 'Before; after', namespace: 'Domain', members: ['+String name'] }), expect.objectContaining({ id: 'B', namespace: 'Domain', members: [] })])
  })

  test('quoted notes create their target and survive escaping on reload', () => {
    const diagram = parse(String.raw`classDiagram
note for A "A \"quote\" and \\ path"`)
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    expect(typed.body.classes.map(node => node.id)).toEqual(['A'])
    expect(typed.body.notes).toEqual([{ for: 'A', text: 'A "quote" and \\ path' }])
    expect(verifyMermaid(diagram).warnings).toContainEqual(
      expect.objectContaining({
        code: 'UNSUPPORTED_SYNTAX',
        syntax: 'class_escaped_note_quotes',
        line: 2,
      }),
    )
    expect(asClass(parse(serializeMermaid(diagram)))?.body.notes).toEqual([{ for: 'A', text: 'A "quote" and \\ path' }])
  })

  test('writes Class membership before definitions and keeps inline overrides last at the renderer consumer', async () => {
    const original = asClass(parse('classDiagram\nclass A:::hot\nclassDef hot fill:red\nstyle A stroke:blue'))!
    const upstream = startUpstreamMermaid()
    try {
      const written = serializeMermaid(original)
      expect(await upstream.project(written, diagram => diagram.db.getData().nodes.filter((node: { id: string }) => node.id === 'A').map((node: { id: string; cssClasses: string; styles: string[] }) => ({ id: node.id, classes: node.cssClasses, styles: node.styles })))).toEqual({
        ok: true, value: [{ id: 'A', classes: 'default hot', styles: ['fill:red', 'stroke:blue'] }],
      })
      expect(asClass(parse(written))!.body).toEqual(original.body)
    } finally { upstream.close() }
  })

  test('Class functional paints retain exact channel tokens and alpha through construction and actual renderer data', async () => {
    const paints = [
      ['rgb(1,2,3)', 'rgb(1,2,3)'],
      ['rgba(1.125,2.25,3.5,.375)', 'rgba(1.125,2.25,3.5,.375)'],
      ['hsl(.125turn,20.25%,30.5%)', 'hsl(.125turn,20.25%,30.5%)'],
      ['hsla(10.125,20.25%,30.5%,37.5%)', 'hsla(10.125,20.25%,30.5%,37.5%)'],
      ['hsl(0 0% 0% / 0)', 'hsl(0 0% 0% / 0)'],
      ['var(--brand)', 'var(--brand)'],
    ] as const
    const upstream = startUpstreamMermaid()
    try {
      for (const [input, expected] of paints) {
        let diagram = asClass(parse('classDiagram\nclass A'))!
        for (const op of [
          { kind: 'define_class', name: 'hot', style: `fill:${input}` },
          { kind: 'set_css_class', class: 'A', className: 'hot' },
          { kind: 'set_class_style', class: 'A', style: `stroke:${input}` },
          { kind: 'add_member', class: 'A', text: '+ready()' },
        ] as ClassMutationOp[]) {
          const result = mutate(diagram, op)
          if (!result.ok) throw new Error(result.error.message)
          diagram = asClass(result.value)!
        }
        expect(diagram.body.classDefs?.hot?.fill).toBe(expected)
        expect(diagram.body.classes[0]!.style?.stroke).toBe(expected)
        const written = serializeMermaid(diagram)
        const reference = await upstream.project<string[]>(written, d => d.db.getData().nodes.find((node: { id: string }) => node.id === 'A').styles)
        if (!reference.ok) throw new Error(reference.error)
        expect(reference.value.map(logicalStyle)).toEqual([`fill:${expected}`, `stroke:${expected}`])
        expect(asClass(parse(written))!.body).toEqual(diagram.body)
        expect(renderMermaidSVG(diagram)).toBe(renderSourceSVG(written))
        const raw = asClass(parse(`classDiagram\nclass A:::hot\nclassDef hot fill:${input}\nstyle A stroke:${input}`))!
        expect(raw.body.classDefs?.hot?.fill).toBe(expected)
        expect(raw.body.classes[0]!.style?.stroke).toBe(expected)
      }
      const original = asClass(parse('classDiagram\nclass A'))!, before = serializeMermaid(original)
      const fontOnly = mutate(original, { kind: 'set_class_style', class: 'A', style: 'font-family:Inter\\,serif' })
      if (!fontOnly.ok) throw new Error(fontOnly.error.message)
      expect(asClass(parse(serializeMermaid(fontOnly.value)))!.body.classes[0]!.style).toEqual({ 'font-family': 'Inter,serif' })
      expect(serializeMermaid(original)).toBe(before)
      expect(synthesizeFromGraph({ kind: 'class', body: { ...original.body, classDefs: { hot: { 'font-family': 'Inter,serif' } } } }).ok).toBe(true)
      const source = 'classDiagram\nclass A\nstyle A fill:red,font-family:Inter\\,serif\n'
      const retained = parse(source)
      expect(asClass(retained)!.body.classes[0]!.style).toEqual({ fill: 'red', 'font-family': 'Inter,serif' })
      expect(asClass(parse(serializeMermaid(retained)))!.body).toEqual(asClass(retained)!.body)
      expect(renderMermaidSVG(retained)).toBe(renderSourceSVG(source))
      expect(verifyMermaid(retained).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_commas' }))
    } finally { upstream.close() }
  })

  test('Class style statements keep payloads out of lexer productions and preserve every field', async () => {
    const style = {
      fill: 'rgb(1,2,3)',
      'font-family': 'direction TB, "Inter, Text", serif',
      custom: 'var(--brand,rgb(1,2,3)) literal:#44; ﬂ°°44¶ß %%{wrap}%% <tag a="b"> \\\ end',
      stroke: '#123',
    }
    const upstream = startUpstreamMermaid()
    try {
      for (const id of ['A', '123', 'classOne']) {
        const original = asClass(parse(`classDiagram\nclass \`${id}\``))!
        const built = synthesizeFromGraph({ kind: 'class', body: { ...original.body, classes: original.body.classes.map(node => ({ ...node, style })) } })
        if (!built.ok) throw new Error(JSON.stringify(built.error))
        const written = serializeMermaid(built.value)
        const reload = asClass(parse(written))!
        expect(reload.body.classes[0]!.style).toEqual(style)
        const reference = await upstream.project(written, d => ({ direction: d.db.getDirection(), nodes: d.db.getData().nodes.map((node: { id: string; styles?: string[]; cssStyles?: string[] }) => ({ id: node.id, styles: node.styles ?? node.cssStyles })) }))
        if (!reference.ok) throw new Error(reference.error)
        expect(reference.value.direction).toBe('TB')
        expect(reference.value.nodes).toHaveLength(1)
        expect(reference.value.nodes[0]!.id).toBe(id)
        expect(reference.value.nodes[0]!.styles.map(logicalStyle)).toEqual([
          'fill:rgb(1,2,3)',
          'font-family:direction TB, "Inter, Text", serif',
          'custom:var(--brand,rgb(1,2,3)) literal:#44; ﬂ°°44¶ß %%{wrap}%% <tag a="b"> \\ end',
          'stroke:#123',
        ])
        expect(renderMermaidSVG(built.value)).toBe(renderSourceSVG(written))
      }
      // A mutable string also retains commas inside a quoted CSS font name.
      const original = asClass(parse('classDiagram\nclass A'))!
      const changed = mutate(original, { kind: 'set_class_style', class: 'A', style: 'fill:red,font-family:"Inter, Text"' })
      if (!changed.ok) throw new Error(JSON.stringify(changed.error))
      expect(asClass(parse(serializeMermaid(changed.value)))!.body.classes[0]!.style).toEqual({ fill: 'red', 'font-family': '"Inter, Text"' })
    } finally { upstream.close() }
  })

  test.each(['style:#x', 'style:#xclassDef:#y', 'has space', 'style', 'call', 'class', '$dollar'])('refuses inline paint for a Class target outside the style ALPHA production: %s', async id => {
    const original = asClass(parse(`classDiagram\nclass \`${id}\``))!
    const before = serializeMermaid(original)
    expect(mutate(original, { kind: 'set_class_style', class: id, style: 'fill:red' })).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
    expect(synthesizeFromGraph({ kind: 'class', body: { ...original.body, classes: original.body.classes.map(node => ({ ...node, style: { fill: 'red' } })) } }).ok).toBe(false)
    expect(serializeMermaid(original)).toBe(before)
    const source = `classDiagram\nclass \`${id}\`\nstyle \`${id}\` fill:red\n`
    const pin = startUpstreamMermaid()
    try { expect(await pin.publicAccepts(source)).toBe(false) } finally { pin.close() }
    const retained = parse(source)
    expect(retained.body.kind).toBe('opaque')
    expect(serializeMermaid(retained)).toBe(source)
  })

  test('style entities are read before CSS backslash escapes without losing the following text', async () => {
    const source = String.raw`classDiagram\nclass A\nstyle A fill: blue,font-family: A\#44;B`.replaceAll('\\n', '\n')
    const diagram = asClass(parse(source))!
    expect(diagram.body.classes[0]!.style).toEqual({ fill: 'blue', 'font-family': String.raw`A\,B` })
    const written = serializeMermaid(diagram)
    expect(asClass(parse(written))!.body.classes[0]!.style).toEqual({ fill: 'blue', 'font-family': String.raw`A\,B` })
    const pin = startUpstreamMermaid()
    try {
      const fields = await pin.project<string[]>(written, d => d.db.getData().nodes[0].styles)
      if (!fields.ok) throw new Error(fields.error)
      expect(fields.value.map(logicalStyle)).toEqual(['fill:blue', String.raw`font-family:A\,B`])
    } finally { pin.close() }
  })

  test('Class style construction opens its lexer with an empty CSS declaration, preserving lone and reserved properties', async () => {
    const needsPrologue = ['stroke-width', 'font-family', String.raw`font\-family`, 'class', 'classDef', 'classDiagram', 'namespace', 'note', 'click', 'link', 'cssClass', 'href', 'callback', 'o', '_self', '_blank', '_parent', '_top', 'accTitle', 'accDescr']
    const upstream = startUpstreamMermaid()
    try {
      for (const property of needsPrologue) {
        const original = asClass(parse('classDiagram\nclass A:::hot'))!, before = serializeMermaid(original)
        const style = `${property}:x`
        for (const op of [{ kind: 'set_class_style', class: 'A', style }, { kind: 'define_class', name: 'hot', style }] as ClassMutationOp[]) {
          const edited = mutate(original, op)
          if (!edited.ok) throw new Error(edited.error.message)
          const projected = await upstream.project<string[]>(serializeMermaid(edited.value), d => d.db.getData().nodes[0].styles)
          if (!projected.ok) throw new Error(projected.error)
          expect(projected.value.map(logicalStyle)).toEqual(['style:', style])
          expect(serializeMermaid(parse(serializeMermaid(edited.value)))).toBe(serializeMermaid(edited.value))
          expect(serializeMermaid(original)).toBe(before)
        }
        expect(synthesizeFromGraph({ kind: 'class', body: { ...original.body, classDefs: { hot: { [property]: 'x' } } } }).ok).toBe(true)
        const source = `classDiagram\nclass A\nstyle A ${style}\n`
        const retained = parse(source)
        expect(retained.body.kind).toBe('class')
        expect(renderMermaidSVG(retained)).toBe(renderSourceSVG(source))
        expect(verifyMermaid(retained).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'class_style_text' }))
        expect(await upstream.publicAccepts(source)).toBe(false)
        expect(await upstream.publicAccepts(serializeMermaid(retained))).toBe(true)
        expect(verifyMermaid(serializeMermaid(retained)).warnings.filter(w => w.code === 'UNSUPPORTED_SYNTAX' && w.syntax === 'class_style_text')).toEqual([])

        const typed = asClass(parse(`classDiagram\nclass A:::hot\nclassDef hot ${property}:x,fill:red\nstyle A ${property}:y,stroke:blue`))!
        expect(typed).not.toBeNull()
        const written = serializeMermaid(typed)
        const projected = await upstream.project<string[]>(written, d => d.db.getData().nodes.find((node: { id: string }) => node.id === 'A').styles)
        if (!projected.ok) throw new Error(projected.error)
        expect(projected.value.map(logicalStyle)).toEqual(['style:', `${property}:x`, 'fill:red', 'style:', `${property}:y`, 'stroke:blue'])
        expect(asClass(parse(written))!.body).toEqual(typed.body)
        expect(renderMermaidSVG(typed)).toBe(renderSourceSVG(written))
      }
      for (const property of ['style', 'call', 'output', 'classOne', 'ACCTitle']) {
        const original = asClass(parse('classDiagram\nclass A'))!
        const edited = mutate(original, { kind: 'set_class_style', class: 'A', style: `${property}:x` })
        expect(edited.ok).toBe(true)
        if (!edited.ok) continue
        expect(await upstream.project(serializeMermaid(edited.value), d => d.db.getData().nodes.find((node: { id: string }) => node.id === 'A').styles)).toEqual({ ok: true, value: [`${property}:x`] })
      }
    } finally { upstream.close() }
  })

  test.each([
    { style: 'font-size:24px,font:12px serif', fields: ['style:', 'font-size:24px', 'font:12px serif'] },
    { style: 'font:12px serif,font-size:24px', fields: ['font:12px serif', 'font-size:24px'] },
    { style: 'margin-left:8px,margin:0', fields: ['style:', 'margin-left:8px', 'margin:0'] },
    { style: 'margin:0,margin-left:8px', fields: ['margin:0', 'margin-left:8px'] },
  ])('Class style cascade survives typed edits, JSON and reload: $style', async ({ style, fields }) => {
    const upstream = startUpstreamMermaid()
    try {
      const original = asClass(parse('classDiagram\nclass A:::hot'))!
      for (const op of [{ kind: 'set_class_style', class: 'A', style }, { kind: 'define_class', name: 'hot', style }] as ClassMutationOp[]) {
        const edited = mutate(original, op)
        if (!edited.ok) throw new Error(edited.error.message)
        const synthesized = synthesizeFromGraph(JSON.parse(JSON.stringify({ kind: 'class', body: edited.value.body })))
        if (!synthesized.ok) throw new Error(JSON.stringify(synthesized.error))
        const written = serializeMermaid(synthesized.value)
        const reloaded = asClass(parse(written))!
        expect(serializeMermaid(reloaded)).toBe(written)
        const renamed = mutate(reloaded, { kind: 'rename_class', from: 'A', to: 'B' })
        if (!renamed.ok) throw new Error(renamed.error.message)
        for (const source of [written, serializeMermaid(renamed.value)]) {
          expect(await upstream.project(source, d => {
            return d.db.getData().nodes[0].styles
          })).toEqual({ ok: true, value: fields })
        }
      }
    } finally { upstream.close() }
  })

  test('Class repeated styles keep the final declaration at its authored position across source statements', async () => {
    const source = 'classDiagram\nclass A\nstyle A font:10px serif,font-size:24px\nstyle A font:12px serif'
    const typed = asClass(parse(source))!
    expect(Object.entries(typed.body.classes[0]!.style!)).toEqual([['font-size', '24px'], ['font', '12px serif']])
    expect(verifyMermaid(typed).warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'class_style_text')).toEqual([])
    expect(Object.entries(parseClassDiagram(source.split('\n')).classes[0]!.inlineStyle!)).toEqual([['font-size', '24px'], ['font', '12px serif']])
    const upstream = startUpstreamMermaid()
    try {
      const written = serializeMermaid(typed)
      expect(serializeMermaid(parse(written))).toBe(written)
      expect(await upstream.project(written, d => {
        return d.db.getData().nodes[0].styles
      })).toEqual({ ok: true, value: ['font:10px serif', 'font-size:24px', 'font:12px serif'] })
    } finally { upstream.close() }
  })

  test.each([
    { fields: ['font:24px monospace!important', 'font:12px serif'] },
    { fields: ['font:24px monospace', 'font:bogus'] },
    { fields: ['font:10px serif', 'font-size:24px', 'font:12px serif'] },
  ])('Class preserves repeated CSS values, priority and fallback: %j', async ({ fields }) => {
    const upstream = startUpstreamMermaid()
    try {
      for (const source of [
        `classDiagram\nclass A\nstyle A ${fields.join(',')}`,
        `classDiagram\nclass A\nstyle A ${fields.slice(0, -1).join(',')}\nstyle A ${fields.at(-1)}`,
        `classDiagram\nclass A:::hot\nclassDef hot ${fields.slice(0, -1).join(',')}\nclassDef hot ${fields.at(-1)}`,
      ]) {
        const typed = asClass(parse(source))!
        const synthesized = synthesizeFromGraph(JSON.parse(JSON.stringify({ kind: 'class', body: typed.body })))
        if (!synthesized.ok) throw new Error(JSON.stringify(synthesized.error))
        const canonical = serializeMermaid(synthesized.value)
        expect(serializeMermaid(parse(canonical))).toBe(canonical)
        expect(await upstream.project(canonical, d => d.db.getData().nodes[0].styles)).toEqual({ ok: true, value: fields })
      }
      for (const op of [{ kind: 'set_class_style', class: 'A', style: fields.join(',') }, { kind: 'define_class', name: 'hot', style: fields.join(',') }] as const) {
        const original = asClass(parse('classDiagram\nclass A:::hot'))!
        const edited = mutate(original, op)
        if (!edited.ok) throw new Error(edited.error.message)
        const renamed = mutate(edited.value, { kind: 'rename_class', from: 'A', to: 'B' })
        if (!renamed.ok) throw new Error(renamed.error.message)
        expect(await upstream.project(serializeMermaid(renamed.value), d => d.db.getData().nodes[0].styles)).toEqual({ ok: true, value: fields })
        const replaced = mutate(edited.value, { ...op, style: 'font:32px serif' })
        if (!replaced.ok) throw new Error(replaced.error.message)
        expect(await upstream.project(serializeMermaid(replaced.value), d => d.db.getData().nodes[0].styles)).toEqual({ ok: true, value: ['font:32px serif'] })
        const body = structuredClone(edited.value.body)
        if (body.kind !== 'class') throw new Error('expected Class')
        if (op.kind === 'define_class') body.classDefs!.hot!.font = '32px serif'
        else body.classes[0]!.style!.font = '32px serif'
        expect(synthesizeFromGraph({ kind: 'class', body }).ok).toBe(false)
      }
    } finally { upstream.close() }
  })

  test('declaration shorthand stays editable and its member source belongs to the declared class', () => {
    const diagram = parse('classDiagram\nclass A:::hot\nclass B:::cold {\n+int count\n}\nclassDef hot fill:red\nclassDef cold fill:blue')
    const typed = asClass(diagram)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('expected editable Class body')
    const expected = [
      { id: 'A', className: 'hot', members: [] },
      { id: 'B', className: 'cold', members: ['+int count'] },
    ]
    const facts = (body: typeof typed.body) => body.classes.map(node => ({ id: node.id, className: node.className, members: node.members }))
    expect(facts(typed.body)).toEqual(expected)
    expect(diagram.source.labels.get('class:B:member#0')).toEqual({ line: 4, col: 1 })
    const reloaded = asClass(parse(serializeMermaid(diagram)))
    if (!reloaded) throw new Error('reload lost the editable Class body')
    expect(facts(reloaded.body)).toEqual(expected)
  })

  test('basic class with members', () => {
    const d = parse('classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }')
    expect(d.body.kind).toBe('class')
    if (d.body.kind !== 'class') throw new Error('expected editable Class body')
    expect(d.body.classes).toEqual([{ id: 'Animal', label: undefined, members: ['+String name', '+eat()'] }])
  })

  test('bare class + separate-decl members', () => {
    const d = parse('classDiagram\n  class Animal\n  Animal : +String name\n  Animal : +eat()')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.classes[0]!.members).toEqual(['+String name', '+eat()'])
  })

  test('class with bracket label', () => {
    const d = parse('classDiagram\n  class Animal["The animal kingdom"]')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.classes[0]!.label).toBe('The animal kingdom')
  })

  test('inheritance + composition + aggregation + association + dependency + realization', () => {
    const d = parse(`classDiagram
  class A
  class B
  class C
  class D
  class E
  class F
  class G
  A <|-- B
  C *-- D
  E o-- F
  A --> C
  D ..> E
  F ..|> G`)
    if (d.body.kind !== 'class') throw new Error()
    const kinds = d.body.relations.map(r => r.kind)
    expect(kinds).toEqual(['inheritance', 'composition', 'aggregation', 'association', 'dependency', 'realization'])
  })

  test('relation with cardinality + label', () => {
    const d = parse('classDiagram\n  Customer "1" --> "*" Ticket : buys')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.relations[0]).toEqual({
      from: 'Customer',
      to: 'Ticket',
      kind: 'association',
      markerAt: 'to',
      label: 'buys',
      fromCardinality: '1',
      toCardinality: '*',
    })
  })

  test('notes (attached and free)', () => {
    const d = parse('classDiagram\n  class Animal\n  note for Animal "lives in nature"\n  note "this is free"')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.notes).toEqual([
      { text: 'lives in nature', for: 'Animal' },
      { text: 'this is free', for: undefined },
    ])
  })

  test('title', () => {
    const d = parse('classDiagram\n  title Animal Kingdom\n  class A')
    if (d.body.kind !== 'class') throw new Error()
    expect(d.body.title).toBe('Animal Kingdom')
  })

  test('unmodeled syntax → opaque fallback', () => {
    const d = parse('classDiagram\n  direction TB\n  class A')
    expect(d.body.kind).toBe('opaque')
  })
})

describe('class — mutate', () => {
  test.each(['\n', '\r', '\r\n', '&#10;', '&#13;', '&#13;&#10;'])('refuses multiline members through either authoring op without changing the diagram: %j', lineBreak => {
    const original = asClass(parse('classDiagram\nclass A'))!
    const text = `+foo()${lineBreak}+bar()`
    for (const op of [
      { kind: 'add_member', class: 'A', text },
      { kind: 'add_class', id: 'B', members: ['+valid()', text] },
    ] satisfies ClassMutationOp[]) {
      for (const apply of [mutate, mutateChecked]) {
        expect(apply(original, op)).toEqual({
          ok: false,
          error: {
            code: 'INVALID_OP',
            message: 'Class members must be single lines; add each member separately',
          },
        })
        expect(original.body.classes).toEqual([{ id: 'A', label: undefined, generic: undefined, members: [] }])
        expect(serializeMermaid(original)).toBe('classDiagram\n  class A\n')
      }
      expect(applyOps({ source: 'classDiagram\nclass A', ops: [op] })).toMatchObject({
        ok: false,
        opIndex: 0,
        error: { code: 'INVALID_OP', message: 'Class members must be single lines; add each member separately' },
      })
    }
  })

  test.each([
    ...['%% comment', ' \t%% comment', '%%{init: {"theme":"dark"}}%%', '&#37;&#37; comment', ' \t'].map(text => ({
      text,
      message: 'Class members must contain text, not blank lines, comments or init directives',
    })),
    ...['accTitle: lost', ' \tACCTITLE lost', 'accDescr: lost', 'accDescr { lost }', 'accDescr {}', 'accDescr { lost } +kept()', '&#97;ccDescr&#123;lost&#125;', 'accDescr {'].map(text => ({
      text,
      message: 'Class members cannot be accessibility directives',
    })),
    // Mermaid removes a directive wherever it stands, before it reads a member.
    ...['+literal(%%{init: {}}%%)', '+x %%{wrap}%%'].map(text => ({
      text, message: 'Class members cannot hold a %%{…}%% directive, which Mermaid removes from the source',
    })),
  ])('refuses member text that source preprocessing would remove: $text', ({ text, message }) => {
    const source = 'classDiagram\nclass A'
    const original = asClass(parse(source))!
    const before = JSON.stringify(original)
    const error = { code: 'INVALID_OP', message } as const
    for (const op of [
      { kind: 'add_member', class: 'A', text },
      { kind: 'add_class', id: 'B', namespace: 'New.Nested', members: ['+valid()', text] },
    ] satisfies ClassMutationOp[]) {
      const supplied = JSON.stringify(op)
      for (const apply of [mutate, mutateChecked]) {
        expect(apply(original, op)).toEqual({ ok: false, error })
        expect(JSON.stringify(original)).toBe(before)
        expect(JSON.stringify(op)).toBe(supplied)
      }
      expect(applyOps({ source, ops: [op] })).toEqual({ ok: false, family: 'class', opIndex: 0, error })
      expect(JSON.stringify(op)).toBe(supplied)
    }
  })

  test.each([String.raw`+foo()\n +bar()`, '+foo();+bar()', '+value: 50%%', '+literal(%%{ }%%)', String.raw`\%% literal`, '+accTitle: String', '+accDescr { kept }', 'accTitle() lost', 'accTitle:'])('keeps single-line member text through either authoring op and reload: %j', text => {
    const original = asClass(parse('classDiagram\nclass A'))!
    for (const op of [
      { kind: 'add_member', class: 'A', text },
      { kind: 'add_class', id: 'B', members: [text] },
    ] satisfies ClassMutationOp[]) {
      for (const apply of [mutate, mutateChecked]) {
        const edited = apply(original, op)
        if (!edited.ok) throw new Error(JSON.stringify(edited.error))
        const reloaded = asClass(parse(serializeMermaid(edited.value)))!
        expect(reloaded.body.classes.at(-1)!.members).toEqual([text])
        expect(verifyMermaid(edited.value).warnings).toEqual([])
      }
      const declarative = applyOps({ source: 'classDiagram\nclass A', ops: [op] })
      if (!declarative.ok) throw new Error(JSON.stringify(declarative.error))
      expect(asClass(parse(declarative.source))!.body.classes.at(-1)!.members).toEqual([text])
    }
  })

  test('added classes own their member arrays across direct, checked and declarative edits', () => {
    const source = 'classDiagram\nclass A'
    const original = asClass(parse(source))!
    const before = JSON.stringify(original)
    const expected = 'classDiagram\n  class A\n  class B {\n    +original()\n  }\n'
    for (const apply of [mutate, mutateChecked]) {
      const members = ['+original()']
      const op = { kind: 'add_class', id: 'B', members } as const
      const edited = apply(original, op)
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      const added = asClass(edited.value)!
      expect(members).toEqual(['+original()'])
      expect(serializeMermaid(edited.value)).toBe(expected)
      expect(verifyMermaid(edited.value).warnings).toEqual([])
      const rendered = renderMermaidSVG(edited.value)
      members[0] = '+replaced()'
      members.push('+later()')
      expect(added.body.classes.at(-1)!.members).toEqual(['+original()'])
      expect(edited.value.canonicalSource).toBe(expected)
      expect(serializeMermaid(edited.value)).toBe(expected)
      expect(renderMermaidSVG(edited.value)).toBe(rendered)
      expect(asClass(parse(expected))!.body.classes).toEqual(added.body.classes)
      expect(JSON.stringify(original)).toBe(before)
    }
    const members = ['+original()']
    const edited = applyOps({ source, ops: [{ kind: 'add_class', id: 'B', members }] })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    expect(members).toEqual(['+original()'])
    members.push('+later()')
    expect(edited.source).toBe(expected)
    expect(asClass(parse(edited.source))!.body.classes.at(-1)!.members).toEqual(['+original()'])
  })

  test.each(['\n', '\r', '\r\n'])('refuses an unsupported multiline note without changing the diagram: %j', lineBreak => {
    const original = parse('classDiagram\nclass A')
    const typed = asClass(original)
    if (!typed) throw new Error('expected editable Class body')
    const result = mutate(typed, { kind: 'add_note', for: 'A', text: `Before${lineBreak}after` })
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INVALID_OP',
        message: 'Class note text must be a single line; use <br/> for displayed line breaks',
      },
    })
    expect(typed.body.notes).toEqual([])
    expect(serializeMermaid(typed)).toBe('classDiagram\n  class A\n')
  })

  test('add_class + add_relation', () => {
    const d0 = parse('classDiagram\n  class Animal')
    const c = asClass(d0)!
    const r1 = mutate(c, { kind: 'add_class', id: 'Dog' })
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = mutate(r1.value, { kind: 'add_relation', from: 'Animal', to: 'Dog', relKind: 'inheritance' })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.value.body.classes.map(c => c.id)).toEqual(['Animal', 'Dog'])
    expect(r2.value.body.relations[0]!.kind).toBe('inheritance')
  })

  test.each([
    { relKind: 'association', markerAt: 'from', arrow: '<--' },
    { relKind: 'aggregation', markerAt: 'both', fromKind: 'aggregation', toKind: 'composition', lineStyle: 'dashed', arrow: 'o..*' },
    { relKind: 'lollipop', markerAt: 'both', fromKind: 'lollipop', toKind: 'lollipop', lineStyle: 'dashed', arrow: '()..()' },
    { relKind: 'lollipop', markerAt: 'both', toKind: 'association', arrow: '()-->' },
  ] as const)('authors relation metadata without changing its meaning: $arrow', ({ arrow, ...metadata }) => {
    const source = 'classDiagram\nclass A\nclass B'
    const original = asClass(parse(source))!
    const op = { kind: 'add_relation', from: 'A', to: 'B', label: 'uses', ...metadata } as const
    const expected = `classDiagram\n  class A\n  class B\n  A ${arrow} B : uses\n`
    for (const apply of [mutate, mutateChecked]) {
      const edited = apply(original, op)
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      expect(asClass(edited.value)!.body.relations[0]).toMatchObject({ kind: metadata.relKind, markerAt: metadata.markerAt })
      expect(serializeMermaid(edited.value)).toBe(expected)
      expect(serializeMermaid(parse(expected))).toBe(expected)
      expect(original.body.relations).toEqual([])
    }
    const declarative = applyOps({ source, ops: [op] })
    if (!declarative.ok) throw new Error(JSON.stringify(declarative.error))
    expect(declarative.source).toBe(expected)
  })

  test.each([
    { relKind: 'inheritance', lineStyle: 'dashed' },
    { relKind: 'dependency', lineStyle: 'solid' },
    { relKind: 'inheritance', markerAt: 'none' },
    { relKind: 'association', markerAt: 'to', fromKind: 'composition' },
    { relKind: 'association', markerAt: 'both', fromKind: 'link-solid' },
    { relKind: 'lollipop', markerAt: 'both', fromKind: 'aggregation', toKind: 'lollipop' },
  ] as const)('refuses relation metadata whose arrow would change or ignore meaning: %j', metadata => {
    const source = 'classDiagram\nclass A\nclass B'
    const original = asClass(parse(source))!
    const before = JSON.stringify(original)
    const op = { kind: 'add_relation', from: 'A', to: 'B', ...metadata } as const
    const supplied = JSON.stringify(op)
    for (const apply of [mutate, mutateChecked]) {
      expect(apply(original, op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
      expect(JSON.stringify(original)).toBe(before)
      expect(JSON.stringify(op)).toBe(supplied)
    }
    expect(applyOps({ source, ops: [op] })).toMatchObject({ ok: false, opIndex: 0, error: { code: 'INVALID_OP' } })
  })

  test('rename_class updates relations and notes', () => {
    const d0 = parse('classDiagram\n  class A\n  class B\n  A <|-- B\n  note for A "hi"')
    const c = asClass(d0)!
    const r = mutate(c, { kind: 'rename_class', from: 'A', to: 'X' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.relations[0]!.from).toBe('X')
    expect(r.value.body.notes[0]!.for).toBe('X')
  })

  test('remove_class cascades to relations and notes', () => {
    const d0 = parse('classDiagram\n  class A\n  class B\n  A <|-- B\n  note for A "hi"')
    const c = asClass(d0)!
    const r = mutate(c, { kind: 'remove_class', id: 'A' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.relations).toEqual([])
    expect(r.value.body.notes).toEqual([])
  })

  test('add_member / remove_member', () => {
    const d0 = parse('classDiagram\n  class A')
    const c = asClass(d0)!
    const r1 = mutate(c, { kind: 'add_member', class: 'A', text: '+foo()' })
    if (!r1.ok) throw new Error()
    expect(r1.value.body.classes[0]!.members).toEqual(['+foo()'])
    const r2 = mutate(r1.value, { kind: 'remove_member', class: 'A', index: 0 })
    if (!r2.ok) throw new Error()
    expect(r2.value.body.classes[0]!.members).toEqual([])
  })

  test('add_class refuses duplicate', () => {
    const d0 = parse('classDiagram\n  class A')
    const r = mutate(asClass(d0)!, { kind: 'add_class', id: 'A' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('DUPLICATE_CLASS')
  })

  // Mermaid's class lexer reads these as keywords even in backticks, so the
  // reader refuses a class named so; the edits refuse to create one.
  test.each(['note', 'click', 'link', 'cssClass', 'href', 'callback'])('refuses a class id Mermaid reads as a keyword even in backticks: %s', id => {
    const d0 = asClass(parse('classDiagram\n  class A'))!
    const error = { code: 'INVALID_OP' as const, message: `Class id "${id}" is a keyword to Mermaid's class lexer, which reads \`${id}\` as a keyword even in backticks; choose another id` }
    for (const op of [{ kind: 'add_class', id }, { kind: 'rename_class', from: 'A', to: id }] satisfies ClassMutationOp[]) {
      for (const apply of [mutate, mutateChecked]) expect(apply(d0, op)).toEqual({ ok: false, error })
    }
    expect(parse(`classDiagram\n  class \`${id}\``).body.kind).toBe('opaque')
  })

  test('remove_class on missing id', () => {
    const d0 = parse('classDiagram\n  class A')
    const r = mutate(asClass(d0)!, { kind: 'remove_class', id: 'Missing' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('CLASS_NOT_FOUND')
  })
})

describe('class — round-trip', () => {
  test.each([
    { arrow: '()..*', lineBreak: '<br>' },
    { arrow: '()..()', lineBreak: '<br/>' },
    { arrow: '-->', lineBreak: '<br />' },
  ])('keeps $lineBreak relation text and entities portable through edits of $arrow', async ({ arrow, lineBreak }) => {
    const source = `classDiagram\nA "&amp;amp;${lineBreak}one" ${arrow} "&amp;quot;${lineBreak}two" B : top & middle${lineBreak}bottom`
    const original = asClass(parse(source))!
    expect(original.body.relations).toEqual([
      expect.objectContaining({
        label: 'top & middle\nbottom',
        fromCardinality: '&amp;amp;\none',
        toCardinality: '&amp;quot;\ntwo',
      }),
    ])
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      for (const apply of [mutate, mutateChecked]) {
        const edited = apply(original, { kind: 'add_member', class: 'B', text: '+active()' })
        if (!edited.ok) throw new Error(JSON.stringify(edited.error))
        const exported = serializeMermaid(edited.value)
        expect(exported).toContain(`A "&amp;amp;<br/>one" ${arrow} "&amp;quot;<br/>two" B : top & middle<br/>bottom`)
        expect(await upstream.accepts(exported)).toBe(true)
        expect(asClass(parse(exported))?.body.relations).toEqual(original.body.relations)
        expect(verifyMermaid(edited.value).warnings).toEqual([])
        for (const input of [edited.value, exported]) {
          const svg = renderMermaidSVG(input)
          expect(svg).toContain('data-from-cardinality="&amp;amp;&#10;one"')
          expect(svg).toContain('data-to-cardinality="&amp;quot;&#10;two"')
        }
      }
    } finally {
      await upstream.close()
    }
  })

  test('keeps directive targets valid when their class names need relation quoting', async () => {
    const upstream = startUpstreamMermaid()
    try {
      for (const id of ['title', 'accTitle', 'accDescr', 'class', 'classDiagram']) {
        const style = ['title', 'accTitle', 'accDescr'].includes(id) ? `\nstyle ${id} stroke:blue` : ''
        const source = `classDiagram\nclass ${id}\nclass ${id} chosen\nclassDef chosen fill:red${style}`
        expect(await upstream.accepts(source)).toBe(true)
        const original = asClass(parse(source))!
        const edited = mutate(original, { kind: 'add_member', class: id, text: '+active()' })
        if (!edited.ok) throw new Error(JSON.stringify(edited.error))
        const exported = serializeMermaid(edited.value)
        expect(await upstream.accepts(exported)).toBe(true)
        const reloaded = asClass(parse(exported))!
        expect(reloaded.body.classes).toEqual(edited.value.body.classes)
        expect(reloaded.body.classDefs).toEqual(original.body.classDefs)
      }
    } finally {
      await upstream.close()
    }
  })

  test.each(['o', 'class', 'namespace', 'style', 'classDef', '$A', 'title', 'TITLE', 'accTitle', 'ACCDESCR', 'classDiagram'])('keeps required quoting for endpoint %s through edits and rendering', async id => {
    const forward = `\`${id}\` ()..* B`
    const reverse = `B -- \`${id}\` : linked`
    const source = `classDiagram\n${forward}\n${reverse}\nnote for \`${id}\` "attached"\nclick \`${id}\` href "https://example.com"`
    const original = asClass(parse(source))!
    expect(original.body.relations).toEqual([
      { from: id, to: 'B', kind: 'lollipop', markerAt: 'both', fromKind: 'lollipop', toKind: 'composition', lineStyle: 'dashed' },
      { from: 'B', to: id, kind: 'link-solid', markerAt: 'none', label: 'linked' },
    ])
    const edited = mutate(original, { kind: 'add_member', class: 'B', text: '+active()' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const exported = serializeMermaid(edited.value)
    const upstream = startUpstreamMermaid()
    try {
      expect(await upstream.accepts(source)).toBe(true)
      expect(await upstream.accepts(exported)).toBe(true)
    } finally {
      await upstream.close()
    }
    expect(exported).toContain(`class \`${id}\``)
    expect(exported).toContain(forward)
    expect(exported).toContain(reverse)
    const reloaded = asClass(parse(exported))!
    expect(reloaded.body.classes.map(node => node.id)).toEqual([id, 'B'])
    expect(reloaded.body.classes.find(node => node.id === id)?.href).toBe('https://example.com')
    expect(reloaded.body.relations).toEqual(original.body.relations)
    expect(reloaded.body.notes).toEqual([{ for: id, text: 'attached' }])
    expect(verifyMermaid(edited.value).warnings).toEqual([])
    for (const input of [edited.value, exported]) {
      const relations = renderMermaidSVG(input).match(/<polyline\b[^>]*class="class-relationship"[^>]*>/g) ?? []
      expect(relations).toHaveLength(2)
      expect(relations[0]).toContain(`data-from="${id}" data-to="B"`)
      expect(relations[0]).toContain('marker-start="url(#cls-lollipop)"')
      expect(relations[0]).toContain('marker-end="url(#cls-composition)"')
      expect(relations[0]).toContain('stroke-dasharray=')
      expect(relations[1]).toContain(`data-from="B" data-to="${id}"`)
      expect(relations[1]).not.toContain('marker-start=')
      expect(relations[1]).not.toContain('marker-end=')
    }
  })

  test.each([
    { arrow: '<|--', kind: 'inheritance', markerAt: 'from', start: 'cls-inherit', end: '' },
    { arrow: '--|>', kind: 'inheritance', markerAt: 'to', start: '', end: 'cls-inherit' },
    { arrow: '*--', kind: 'composition', markerAt: 'from', start: 'cls-composition', end: '' },
    { arrow: '--*', kind: 'composition', markerAt: 'to', start: '', end: 'cls-composition' },
    { arrow: 'o--', kind: 'aggregation', markerAt: 'from', start: 'cls-aggregation', end: '' },
    { arrow: '--o', kind: 'aggregation', markerAt: 'to', start: '', end: 'cls-aggregation' },
    { arrow: '<--', kind: 'association', markerAt: 'from', start: 'cls-arrow', end: '' },
    { arrow: '-->', kind: 'association', markerAt: 'to', start: '', end: 'cls-arrow' },
    { arrow: '<..', kind: 'dependency', markerAt: 'from', start: 'cls-arrow', end: '' },
    { arrow: '..>', kind: 'dependency', markerAt: 'to', start: '', end: 'cls-arrow' },
    { arrow: '<|..', kind: 'realization', markerAt: 'from', start: 'cls-inherit', end: '' },
    { arrow: '..|>', kind: 'realization', markerAt: 'to', start: '', end: 'cls-inherit' },
    { arrow: '()--', kind: 'lollipop', markerAt: 'from', start: 'cls-lollipop', end: '' },
    { arrow: '--()', kind: 'lollipop', markerAt: 'to', start: '', end: 'cls-lollipop' },
    { arrow: '--', kind: 'link-solid', markerAt: 'none', start: '', end: '' },
    { arrow: '..', kind: 'link-dashed', markerAt: 'none', start: '', end: '' },
    { arrow: '<-->', kind: 'association', markerAt: 'both', start: 'cls-arrow', end: 'cls-arrow' },
    { arrow: 'o--*', kind: 'aggregation', markerAt: 'both', start: 'cls-aggregation', end: 'cls-composition' },
  ])('keeps $arrow marker ownership after an unrelated edit, export and reload', ({ arrow, kind, markerAt, start, end }) => {
    const relationSource = kind === 'lollipop' ? `Person ${arrow} Animal : related` : `Person "one" ${arrow} "many" Animal : related`
    const source = `classDiagram\n${relationSource}`
    const original = asClass(parse(source))!
    const from = kind === 'lollipop' && markerAt === 'from' ? 'interface0' : 'Person'
    const to = kind === 'lollipop' && markerAt === 'to' ? 'interface0' : 'Animal'
    const expected = { from, to, kind, markerAt, label: 'related', ...(kind === 'lollipop' ? {} : { fromCardinality: 'one', toCardinality: 'many' }) }
    expect(original.body.relations).toEqual([expect.objectContaining(expected)])
    const edited = mutate(original, { kind: 'add_member', class: from === 'interface0' ? 'Animal' : 'Person', text: '+name: String' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    const exported = serializeMermaid(edited.value)
    expect(exported).toContain(relationSource)
    const reloaded = asClass(parse(exported))!
    expect(edited.value.body.relations).toEqual([expect.objectContaining(expected)])
    expect(reloaded.body.relations).toEqual(edited.value.body.relations)
    expect(verifyMermaid(edited.value).warnings).toEqual([])
    for (const input of [edited.value, exported]) {
      const svg = renderMermaidSVG(input)
      const relation = svg.match(/<polyline\b[^>]*class="class-relationship"[^>]*>/)?.[0]
      expect(relation).toBeDefined()
      expect(relation).toContain(`data-from="${from}" data-to="${to}"`)
      expect(relation!.match(/marker-start="url\(#([^)]*)\)"/)?.[1] ?? '').toBe(start)
      expect(relation!.match(/marker-end="url\(#([^)]*)\)"/)?.[1] ?? '').toBe(end)
    }
  })

  test('serialize → parse → serialize is stable', () => {
    const src = `classDiagram\n  class Animal {\n    +String name\n    +eat()\n  }\n  class Dog\n  Animal <|-- Dog`
    const d = parse(src)
    const out1 = serializeMermaid(d)
    const reloaded = parse(out1)
    const typed = asClass(reloaded)
    expect(typed).not.toBeNull()
    if (!typed) throw new Error('round-trip lost the editable Class model')
    expect(typed.body.classes.map(node => ({ id: node.id, members: node.members }))).toEqual([
      { id: 'Animal', members: ['+String name', '+eat()'] },
      { id: 'Dog', members: [] },
    ])
    expect(typed.body.relations).toEqual([{ from: 'Animal', to: 'Dog', kind: 'inheritance', markerAt: 'from' }])
    const out2 = serializeMermaid(reloaded)
    expect(out2).toBe(out1)
  })
})

describe('class — verify', () => {
  test('empty class diagram → EMPTY_DIAGRAM', () => {
    const d = parse('classDiagram')
    const v = verifyMermaid(d)
    expect(v.warnings.some(w => w.code === 'EMPTY_DIAGRAM')).toBe(true)
  })

  test('long label → LABEL_OVERFLOW', () => {
    const long = 'X'.repeat(80)
    const d = parse(`classDiagram\n  class A\n  A : +${long}`)
    const v = verifyMermaid(d)
    expect(v.warnings.filter(w => w.code === 'LABEL_OVERFLOW').length).toBeGreaterThan(0)
  })

  test('orphan relation → EDGE_MISANCHORED', () => {
    // The parser upserts both endpoints and remove_class cascades, so neither
    // can produce an orphan: doctor the body to drop class B but keep A <|-- B.
    const c = asClass(parse('classDiagram\n  class A\n  class B\n  A <|-- B'))!
    const orphaned = { ...c, body: { ...c.body, classes: c.body.classes.filter(k => k.id !== 'B') } }
    const v = verifyMermaid(orphaned)
    expect(v.warnings).toContainEqual({ code: 'EDGE_MISANCHORED', edge: 'rel#0:A->B', from: 'A' })
    expect(v.ok).toBe(false)
  })
})
