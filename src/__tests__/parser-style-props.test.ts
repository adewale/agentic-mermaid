// Loop 12 M4: style-statement props split on TOP-LEVEL commas only, so
// rgb()/rgba()/hsl() function values survive instead of being mangled.

import { afterAll, beforeAll, describe, test, expect } from 'bun:test'
import { parseMermaid } from '../parser.ts'
import { renderMermaidSVG } from '../index.ts'
import { mutate, parseRegisteredMermaid, renderMermaidSVG as renderDiagramSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { startUpstreamMermaid } from './helpers/upstream-mermaid.ts'

function nodeStyle(line: string, id = 'A'): Record<string, string> | undefined {
  return parseMermaid(`flowchart TD\n  A\n  ${line}`).nodeStyles.get(id)
}

describe('M4 style props — comma-aware splitting', () => {
  test.each(['style T', 'classDef hot', 'linkStyle default'])('%s refuses damaged property names at read and write boundaries', directive => {
    const source = `graph TD;style S background:#aaa;\n${directive} b] &   n4ackground:#bbb,border:1px solid red;`
    expect(() => parseMermaid(source)).toThrow('style property name')
    expect(parseRegisteredMermaid(source).ok).toBe(false)
    expect(verifyMermaid(source).ok).toBe(false)

    const parsed = parseRegisteredMermaid('flowchart TD\nS --> T')
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error('fixture rejected')
    const graph = parsed.value.body.graph
    const style = { 'b] &   n4ackground': '#bbb', border: '1px solid red' }
    if (directive.startsWith('classDef')) graph.classDefs.set('hot', style)
    else if (directive.startsWith('linkStyle')) graph.linkStyles.set('default', style)
    else graph.nodeStyles.set('T', style)
    expect(() => serializeMermaid(parsed.value)).toThrow('style property name')
  })

  test('unknown valid property names and CSS semicolon separators retain every field', () => {
    const source = 'flowchart TD\nstyle T background:#bbb; border:1px solid red;custom-field:hello'
    expect(parseMermaid(source).nodeStyles.get('T')).toEqual({ background: '#bbb', border: '1px solid red', 'custom-field': 'hello' })
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('fixture rejected')
    expect(serializeMermaid(parsed.value)).toContain('style T background:#bbb,border:1px solid red,custom-field:hello')
    expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_style_semicolon' }))
  })

  test.each(['style A', 'classDef c', 'linkStyle 0'])('%s retains property text admitted by the style lexer', directive => {
    const properties = { 'stroke\\-width': '2px', '\\66ill': 'red', 'font\\2d family': 'Arial', 'accTitle-color': 'blue', 'accDescr-width': '3px', 'custom.flag': 'value' }
    const declarations = Object.entries(properties).map(([name, value]) => `${name}:${value}`).join(',')
    const source = `flowchart TD\nA-->B\n${directive} ${declarations}`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error(JSON.stringify(parsed))
    const graph = parsed.value.body.graph
    const actual = directive.startsWith('classDef') ? graph.classDefs.get('c')
      : directive.startsWith('linkStyle') ? graph.linkStyles.get(0) : graph.nodeStyles.get('A')
    expect(actual).toEqual(properties)
    expect(serializeMermaid(parsed.value)).toContain(`${directive} ${declarations}`)
    expect(verifyMermaid(source).ok).toBe(true)
  })

  test.each(['set_node_style', 'define_class'] as const)('%s accepts literal style tokens without interpreting them as CSS identifiers', kind => {
    const parsed = parseRegisteredMermaid('flowchart TD\nA-->B')
    if (!parsed.ok) throw new Error('fixture rejected')
    const style = 'stroke\\-width:2px,accTitle-color:red'
    const edited = mutate(parsed.value, kind === 'set_node_style' ? { kind, id: 'A', style } : { kind, name: 'c', style })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    expect(serializeMermaid(edited.value)).toContain(style)
  })

  test.each(['é', '文', '--foo', 'a--b', 'default-color', 'class', '1class', 'v', 'foo class', '#end'])('refuses property name %s that Mermaid tokenizes as something else', name => {
    expect(() => nodeStyle(`style A ${name}:red`)).toThrow('style property name')
  })
  test('rgb() fill is preserved intact', () => {
    expect(nodeStyle('style A fill:rgb(10,10,10)')).toEqual({ fill: 'rgb(10,10,10)' })
  })

  test('rgba() fill with alpha is preserved', () => {
    expect(nodeStyle('style A fill:rgba(0,0,0,0.5)')).toEqual({ fill: 'rgba(0,0,0,0.5)' })
  })

  test('hsl() fill with percentages is preserved', () => {
    expect(nodeStyle('style A fill:hsl(120,50%,50%)')).toEqual({ fill: 'hsl(120,50%,50%)' })
  })

  test('rgb() fill + a second prop split correctly', () => {
    expect(nodeStyle('style A fill:rgba(0,0,0,0.5),stroke:#00f')).toEqual({ fill: 'rgba(0,0,0,0.5)', stroke: '#00f' })
  })

  test('plain hex multi-prop still splits (no regression)', () => {
    expect(nodeStyle('style A fill:#f00,stroke:#00f,stroke-width:2px')).toEqual({
      fill: '#f00', stroke: '#00f', 'stroke-width': '2px',
    })
  })

  test('classDef with rgb() also preserved', () => {
    const g = parseMermaid('flowchart TD\n  A\n  classDef hot fill:rgb(255,0,0),stroke:#000\n  class A hot')
    expect(g.classDefs.get('hot')).toEqual({ fill: 'rgb(255,0,0)', stroke: '#000' })
  })

  test('trailing semicolon still tolerated with rgb()', () => {
    expect(nodeStyle('style A fill:rgb(1,2,3);')).toEqual({ fill: 'rgb(1,2,3)' })
  })

  test('style statements without key/value properties are ignored', () => {
    const g = parseMermaid('flowchart TD\n  A --> B\n  style e red')
    expect(g.nodeStyles.has('e')).toBe(false)
  })
})

describe('Flowchart CSS validity and Mermaid inline-style spellability', () => {
  let upstream: ReturnType<typeof startUpstreamMermaid>
  beforeAll(() => { upstream = startUpstreamMermaid() })
  afterAll(() => upstream.close())

  test('class definitions construct escaped comma values through their own DB consumer', async () => {
    const source = 'flowchart TD\nA --> B\nclass A dash\nclassDef dash stroke-dasharray:9\\,5,font-family:Arial\\,sans-serif,fill:red\n'
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error('Expected editable class styles')
    const expected = { 'stroke-dasharray': '9,5', 'font-family': 'Arial,sans-serif', fill: 'red' }
    expect(parsed.value.body.graph.classDefs.get('dash')).toEqual(expected)
    expect(verifyMermaid(source).warnings).not.toContainEqual(expect.objectContaining({ syntax: 'flowchart_style_value' }))
    const base = parseRegisteredMermaid('flowchart TD\nA --> B\nclass A dash')
    if (!base.ok) throw new Error('Expected typed control')
    const built = mutate(base.value, { kind: 'define_class', name: 'dash', style: 'stroke-dasharray:9\\,5;font-family:Arial\\,sans-serif;fill:red' })
    if (!built.ok) throw new Error(JSON.stringify(built.error))
    for (const input of [parsed.value, built.value]) {
      const edited = mutate(input, { kind: 'set_label', target: 'B', label: 'Changed' })
      if (!edited.ok) throw new Error(JSON.stringify(edited.error))
      for (const diagram of [input, edited.value]) {
        const canonical = serializeMermaid(diagram)
        const reference = await upstream.project(canonical, pin => pin.db.getClasses().get('dash').styles)
        expect(reference).toEqual({ ok: true, value: ['stroke-dasharray:9,5', 'font-family:Arial,sans-serif', 'fill:red'] })
        const reload = parseRegisteredMermaid(canonical)
        if (!reload.ok || reload.value.body.kind !== 'flowchart') throw new Error('Expected editable reload')
        expect(reload.value.body.graph.classDefs.get('dash')).toEqual(expected)
        expect(renderMermaidSVG(canonical)).toBe(renderDiagramSVG(diagram))
      }
    }
  })

  test('class field separators remain independent of trailing payload backslashes', async () => {
    const slash = String.fromCharCode(92)
    const source = `flowchart TD\nA --> B\nclass A dash\nclassDef dash font-family:Foo${slash.repeat(2)},custom:Bar${slash.repeat(2)},fill:red\n`
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok || parsed.value.body.kind !== 'flowchart') throw new Error('Expected editable class fields')
    const expected = { 'font-family': `Foo${slash.repeat(2)}`, custom: `Bar${slash.repeat(2)}`, fill: 'red' }
    expect(parsed.value.body.graph.classDefs.get('dash')).toEqual(expected)
    const edited = mutate(parsed.value, { kind: 'set_label', target: 'B', label: 'Changed' })
    if (!edited.ok) throw new Error(JSON.stringify(edited.error))
    for (const input of [parsed.value, edited.value]) {
      const canonical = serializeMermaid(input)
      // Mermaid's styles2Map trims each field before handing it to CSS.
      const reference = await upstream.project(canonical, pin => pin.db.getClasses().get('dash').styles.map((field: string) => field.trim()))
      expect(reference).toEqual({ ok: true, value: [`font-family:Foo${slash.repeat(2)}`, `custom:Bar${slash.repeat(2)}`, 'fill:red'] })
      const reload = parseRegisteredMermaid(canonical)
      if (!reload.ok || reload.value.body.kind !== 'flowchart') throw new Error('Expected typed reload')
      expect(reload.value.body.graph.classDefs.get('dash')).toEqual(expected)
      expect(renderMermaidSVG(canonical)).toBe(renderDiagramSVG(input))
    }
  })

  test.each(['style A', 'classDef hot', 'linkStyle 0'])('%s preserves unspellable native functions and portable neighboring declarations', async directive => {
    const paint = directive.startsWith('linkStyle') ? 'stroke' : 'fill'
    const prefix = 'flowchart TD\nA --> B\n'
    for (const value of ['hsl(0 0% 0% / 0)', 'rgb(1,2,3)', 'var(--brand)']) {
      const source = `${prefix}${directive} ${paint}:${value},stroke-width:2px\n`
      expect(() => renderMermaidSVG(source)).not.toThrow()
      expect(await upstream.publicAccepts(source)).toBe(false)
      const escaped = value.replace(/[(),]/g, char => `#${char.codePointAt(0)};`)
      expect(await upstream.publicAccepts(`${prefix}${directive} ${paint}: ${escaped},stroke-width:2px`)).toBe(false)
      const control = `${prefix}${directive} ${paint}:#123456,stroke-width:2px`
      const reference = await upstream.project(control, diagram => {
        const name = diagram.db.getClasses().has('hot') ? 'classDef' : diagram.db.getVertices().get('A').styles.length ? 'style' : 'linkStyle'
        return { ids: [...diagram.db.getVertices().keys()], edges: diagram.db.getEdges().map((edge: any) => [edge.start, edge.end]), styles: name === 'classDef' ? diagram.db.getClasses().get('hot').styles : name === 'style' ? diagram.db.getVertices().get('A').styles : diagram.db.getEdges()[0].style }
      })
      expect(reference.ok).toBe(true)
      if (!reference.ok) throw new Error(reference.error)
      expect(reference.value).toEqual({ ids: ['A', 'B'], edges: [['A', 'B']], styles: [`${paint}:#123456`, 'stroke-width:2px', ...(directive.startsWith('linkStyle') ? ['fill:none'] : [])] })
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
      expect(renderMermaidSVG(serializeMermaid(parsed.value))).toBe(renderMermaidSVG(source))
      expect(verifyMermaid(source).warnings).toContainEqual(expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX', syntax: 'flowchart_style_value' }))
      const structured = parseRegisteredMermaid(`${prefix}style A fill:red`)
      if (!structured.ok) throw new Error('Expected typed control')
      const before = serializeMermaid(structured.value)
      for (const op of [
        { kind: 'set_node_style', id: 'A', style: `${paint}:${value},stroke-width:2px` },
        { kind: 'define_class', name: 'hot', style: `${paint}:${value},stroke-width:2px` },
      ] as const) {
        const edited = mutate(structured.value, op)
        expect(edited).toMatchObject({ ok: false, error: { code: 'INVALID_OP', message: expect.stringContaining('cannot be written losslessly') } })
        expect(serializeMermaid(structured.value)).toBe(before)
      }
    }
  })

  test('value tokens cannot introduce reserved grammar words while neighboring text stays portable', async () => {
    const base = parseRegisteredMermaid('flowchart TD\nA --> B\n')
    if (!base.ok) throw new Error('Expected typed control')
    const before = serializeMermaid(base.value)
    for (const value of ['class', 'default', '1class']) {
      const source = `flowchart TD\nA --> B\nstyle A custom:${value},stroke-width:2px\n`
      expect(await upstream.publicAccepts(source)).toBe(false)
      const control = 'flowchart TD\nA --> B\nstyle A custom:classy defaultx 1classx style,stroke-width:2px\n'
      const reference = await upstream.project(control, diagram => ({ ids: [...diagram.db.getVertices().keys()], styles: diagram.db.getVertices().get('A').styles }))
      expect(reference).toEqual({ ok: true, value: { ids: ['A', 'B'], styles: ['custom:classy defaultx 1classx style', 'stroke-width:2px'] } })
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      expect(parsed.value.body.kind).toBe('opaque')
      expect(serializeMermaid(parsed.value)).toBe(source)
      for (const op of [
        { kind: 'set_node_style', id: 'A', style: `custom:${value},stroke-width:2px` },
        { kind: 'define_class', name: 'hot', style: `custom:${value},stroke-width:2px` },
      ] as const) {
        expect(mutate(base.value, op)).toMatchObject({ ok: false, error: { code: 'INVALID_OP' } })
        expect(serializeMermaid(base.value)).toBe(before)
      }
    }
  })
})

// Mermaid joins the pairs a `;` separates into one declaration
// (`fill:#f9fstroke:#0a0`), which paints nothing; ours reads them as CSS does.
const SEMICOLON_SEPARATED: ReadonlyArray<readonly [string, string]> = [
  ['class style', 'classDiagram\n  class A\n  style A fill:#f9f;stroke:#0a0'],
  ['class classDef', 'classDiagram\n  class A:::hot\n  classDef hot fill:#f9f; stroke:#0a0'],
  ['state style', 'stateDiagram-v2\n  A --> B\n  style A fill:#f9f;stroke:#0a0'],
  ['state classDef', 'stateDiagram-v2\n  A --> B\n  classDef hot fill:#f9f;stroke:#0a0\n  class A hot'],
  ['ER style', 'erDiagram\n  A ||--|| B : x\n  style A fill:#f9f;stroke:#0a0'],
  ['ER classDef', 'erDiagram\n  A:::hot ||--|| B : x\n  classDef hot fill:#f9f;stroke:#0a0'],
]

describe('a `;` between style properties', () => {
  test.each(SEMICOLON_SEPARATED)('%s: separates them, and each is drawn', (_case, source) => {
    expect(verifyMermaid(source).warnings.filter(warning => warning.code === 'RENDER_FAILED')).toEqual([])
    expect(renderMermaidSVG(source)).toContain('fill="#f9f" stroke="#0a0"')
  })
})

describe('an authored paint the renderer cannot draw', () => {
  test('fails the render with the directive, the property, the value and a fix', () => {
    expect(() => renderMermaidSVG('flowchart TD\n  A --> B\n  style A fill:#12345')).toThrow(
      'style A: fill "#12345" is not a CSS color — expected a color name, #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(), rgba(), hsl(), hsla(), transparent, currentColor, none, or var(--name), e.g. style A fill:#f96',
    )
    for (const [source, named] of [
      ['flowchart TD\n  A:::hot --> B\n  classDef hot fill:#f96,stroke:url(#a)', 'classDef hot: stroke "url(#a)"'],
      ['flowchart TD\n  A --> B\n  linkStyle default color:#1234567', 'linkStyle default: color "#1234567"'],
      ['stateDiagram-v2\n  A --> B\n  classDef hot fill:#12345\n  class A hot', 'classDef hot: fill "#12345"'],
      ['classDiagram\n  class Account\n  style Account color:#12345', 'style Account: color "#12345"'],
      ['erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  style CUSTOMER fill:#12345', 'style CUSTOMER: fill "#12345"'],
    ] as const) {
      expect(() => renderMermaidSVG(source), source).toThrow(`${named} is not a CSS color — expected`)
    }
  })

  test('is refused even where the element never draws it', () => {
    // An edge draws only its stroke, but a bad fill or label color is still the author's mistake.
    for (const property of ['fill', 'color']) {
      expect(() => renderMermaidSVG(`flowchart TD\n  A --> B\n  linkStyle 0 ${property}:#12345`)).toThrow(
        `linkStyle 0: ${property} "#12345" is not a CSS color — expected`,
      )
    }
  })

  test('verify reports that message alone', () => {
    const verified = verifyMermaid('flowchart TD\n  A --> B\n  style A fill:#12345')
    expect(verified.ok).toBe(false)
    expect(verified.warnings).toEqual([{ code: 'RENDER_FAILED', reason: expect.stringContaining('style A: fill "#12345" is not a CSS color — expected'), origin: 'source' }])
  })
})
