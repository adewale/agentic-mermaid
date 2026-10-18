// Phase C: structured ER diagram support.

import { describe, test, expect } from 'bun:test'
import { parseRegisteredMermaid as parseMermaid, asEr, mutate, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { decodeXML } from 'entities'
import { parseErDiagram } from '../er/parser.ts'
import { erAttributeBlocks } from '../er/layout.ts'
import { normalizeMermaidSource } from '../mermaid-source.ts'
import { renderMermaidSVG } from '../index.ts'
import { escapeXml } from '../multiline-utils.ts'

const parse = (s: string) => {
  const r = parseMermaid(s)
  if (!r.ok) throw new Error('parse: ' + JSON.stringify(r.error))
  return r.value
}

describe('ER — parse', () => {
  test('header-only source remains a structured blank canvas for typed authoring', () => {
    const d = parse('erDiagram\n')
    expect(asEr(d)).not.toBeNull()
    expect(d.body.kind === 'er' ? { entities: d.body.entities.length, statements: d.body.statements?.length } : null)
      .toEqual({ entities: 0, statements: 0 })
  })

  test('basic relation', () => {
    const d = parse('erDiagram\n  CUSTOMER ||--o{ ORDER : places')
    expect(d.body.kind).toBe('er')
    if (d.body.kind !== 'er') return
    expect(d.body.entities.map(e => e.id).sort()).toEqual(['CUSTOMER', 'ORDER'])
    expect(d.body.relations[0]).toEqual({
      from: 'CUSTOMER', to: 'ORDER',
      leftCard: 'one-only', rightCard: 'zero-or-many',
      dashed: false, label: 'places',
    })
  })

  test('entity with attribute block', () => {
    const d = parse(`erDiagram
  CUSTOMER {
    string name
    string email PK
  }`)
    if (d.body.kind !== 'er') throw new Error()
    expect(d.body.entities[0]!.attributes.map(a => a.text)).toEqual(['string name', 'string email PK'])
  })

  test('entity aliases are structured with stable identity and round-trip through the renderer grammar', () => {
    const d = parse('erDiagram\n  CUSTOMER["Customer Account"] ||--o{ ORDER : places')
    expect(d.body.kind).toBe('er')
    if (d.body.kind !== 'er') return
    expect(d.body.entities.find(entity => entity.id === 'CUSTOMER')?.label).toBe('Customer Account')
    const canonical = serializeMermaid(d)
    expect(canonical).toContain('CUSTOMER["Customer Account"]')
    const reparsed = parse(canonical)
    expect(reparsed.body.kind === 'er' && reparsed.body.entities.find(entity => entity.id === 'CUSTOMER')?.label)
      .toBe('Customer Account')
  })

  test('quoted entity names with line breaks remain structured and canonical', () => {
    const d = parse('erDiagram\n  "Entity<br>Name" {\n    string id\n  }')
    expect(d.body.kind).toBe('er')
    if (d.body.kind !== 'er') return
    expect(d.body.entities[0]!.id).toBe('Entity<br>Name')
    // A quoted name is the entity's identity, not an alias (upstream's alias
    // is empty); its `<br>` is display, which the renderer draws.
    expect(d.body.entities[0]!.label).toBeUndefined()
    const canonical = serializeMermaid(d)
    expect(canonical).toContain('"Entity<br>Name" {')
    expect(parse(canonical).body.kind).toBe('er')
  })

  test('quoted label', () => {
    const d = parse('erDiagram\n  A ||--|{ B : "places orders"')
    if (d.body.kind !== 'er') throw new Error()
    expect(d.body.relations[0]!.label).toBe('places orders')
  })

  test('dashed relation', () => {
    const d = parse('erDiagram\n  A ||..o{ B : "may have"')
    if (d.body.kind !== 'er') throw new Error()
    expect(d.body.relations[0]!.dashed).toBe(true)
  })
})

describe('ER — mutate', () => {
  test('add_entity', () => {
    const d = parse('erDiagram\n  CUSTOMER ||--o{ ORDER : places')
    const r = mutate(asEr(d)!, { kind: 'add_entity', id: 'PRODUCT' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.body.entities.map(e => e.id).sort()).toEqual(['CUSTOMER', 'ORDER', 'PRODUCT'])
  })

  test('set_entity_label adds and removes a display alias without changing identity', () => {
    const d = asEr(parse('erDiagram\n  CUSTOMER'))!
    const labeled = mutate(d, { kind: 'set_entity_label', entity: 'CUSTOMER', label: 'Customer Account' })
    expect(labeled.ok).toBe(true)
    if (!labeled.ok) return
    expect(labeled.value.body.entities[0]).toEqual({ id: 'CUSTOMER', label: 'Customer Account', attributes: [] })
    expect(serializeMermaid(labeled.value)).toContain('CUSTOMER["Customer Account"]')

    const cleared = mutate(labeled.value, { kind: 'set_entity_label', entity: 'CUSTOMER', label: null })
    expect(cleared.ok && cleared.value.body.entities[0]!.label).toBeUndefined()
  })

  test('remove_entity cascades to relations', () => {
    const d = parse('erDiagram\n  A ||--o{ B : x\n  B ||--o{ C : y')
    const r = mutate(asEr(d)!, { kind: 'remove_entity', id: 'B' })
    if (!r.ok) throw new Error()
    expect(r.value.body.relations).toEqual([])
  })

  test('rename_entity updates relations', () => {
    const d = parse('erDiagram\n  A ||--o{ B : x')
    const r = mutate(asEr(d)!, { kind: 'rename_entity', from: 'A', to: 'Z' })
    if (!r.ok) throw new Error()
    expect(r.value.body.relations[0]!.from).toBe('Z')
  })

  test('add/remove_attribute', () => {
    const d = parse('erDiagram\n  CUSTOMER {\n    string name\n  }')
    const e = asEr(d)!
    const r1 = mutate(e, { kind: 'add_attribute', entity: 'CUSTOMER', text: 'string email' })
    if (!r1.ok) throw new Error()
    expect(r1.value.body.entities[0]!.attributes.map(a => a.text)).toEqual(['string name', 'string email'])
    const r2 = mutate(r1.value, { kind: 'remove_attribute', entity: 'CUSTOMER', index: 0 })
    if (!r2.ok) throw new Error()
    expect(r2.value.body.entities[0]!.attributes.map(a => a.text)).toEqual(['string email'])
  })

  test('add_relation with cardinalities', () => {
    const d = parse('erDiagram\n  A\n  B')
    const r = mutate(asEr(d)!, {
      kind: 'add_relation', from: 'A', to: 'B',
      leftCard: 'one-only', rightCard: 'zero-or-many', label: 'has',
    })
    if (!r.ok) throw new Error()
    expect(r.value.body.relations[0]!.label).toBe('has')
  })

  test('errors', () => {
    const d = parse('erDiagram\n  A')
    const e = asEr(d)!
    const dup = mutate(e, { kind: 'add_entity', id: 'A' })
    if (dup.ok) throw new Error()
    expect(dup.error.code).toBe('DUPLICATE_ENTITY')
    const miss = mutate(e, { kind: 'remove_entity', id: 'Missing' })
    if (miss.ok) throw new Error()
    expect(miss.error.code).toBe('ENTITY_NOT_FOUND')
  })
})

describe('ER — round-trip', () => {
  test('serialize → parse → serialize is stable', () => {
    const src = `erDiagram
  CUSTOMER {
    string name
    string email
  }
  ORDER
  CUSTOMER ||--o{ ORDER : places`
    const d = parse(src)
    const out1 = serializeMermaid(d)
    const out2 = serializeMermaid(parse(out1))
    expect(out2).toBe(out1)
  })
})

describe('ER — verify', () => {
  test.each([
    ['entity codes and grammar padding', 'string value PK, FK, UK "_word_ #lt;b#gt;literal#lt;/b#gt;"', ['string', 'value', 'PK,FK,UK', '_word_ <b>literal</b>'], 21],
    ['comment whitespace and breaks', 't n "  a<br/>  b   c  "', ['t', 'n', '', 'a b c'], 5],
    ['long type', `${'T'.repeat(37)} n`, ['T'.repeat(37), 'n', '', ''], 37],
    ['long name', `t ${'N'.repeat(38)}`, ['t', 'N'.repeat(38), '', ''], 38],
    ['long literal comment', `t n "_${'x'.repeat(37)}_"`, ['t', 'n', '', `_${'x'.repeat(37)}_`], 39],
    ['keys', 't n PK, FK, UK', ['t', 'n', 'PK,FK,UK', ''], 8],
    ['XML-encoded literal comment', 't n "&#95;word&#95; &lt;i&gt;tag&lt;/i&gt;"', ['t', 'n', '', '_word_ <i>tag</i>'], 17],
    ['entity-produced backslash n', 't n "#92;n"', ['t', 'n', '', String.raw`\n`], 2],
  ] as const)('%s measures the widest drawn column through source, edit and reload', (_name, attribute, columns, charCount) => {
    const source = `erDiagram\n  A {\n    ${attribute}\n  }`
    const parsed = parse(source)
    const edited = mutate(asEr(parse('erDiagram\n  A'))!, { kind: 'add_attribute', entity: 'A', text: attribute })
    if (!edited.ok) throw new Error('attribute edit refused')
    const written = serializeMermaid(edited.value)
    const reloaded = parse(written)
    expect(serializeMermaid(reloaded)).toBe(written)
    for (const input of [source, parsed, edited.value, written, reloaded]) {
      const warningsAt = (labelCharCap: number) => verifyMermaid(input, { labelCharCap }).warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')
      expect(warningsAt(36)).toEqual(charCount > 36 ? [{ code: 'LABEL_OVERFLOW', target: 'A#a0', charCount, limit: 36 }] : [])
      expect(warningsAt(charCount)).toEqual([])
      expect(warningsAt(charCount - 1)).toEqual([{ code: 'LABEL_OVERFLOW', target: 'A#a0', charCount, limit: charCount - 1 }])
    }
    for (const candidate of [source, written]) {
      const attr = parseErDiagram(normalizeMermaidSource(decodeXML(candidate)).familyLines).entities[0]!.attributes[0]!
      const blocks = erAttributeBlocks(attr)
      expect([blocks.type.text, blocks.name.text, blocks.keys.text, blocks.comment?.text ?? '']).toEqual([...columns])
      const svg = renderMermaidSVG(candidate)
      for (const column of columns.filter(Boolean)) expect(svg).toContain(`>${escapeXml(column)}</text>`)
    }
  })
})
