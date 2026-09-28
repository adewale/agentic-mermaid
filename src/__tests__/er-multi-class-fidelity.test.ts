import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import mermaid from 'mermaid'
import { asEr, mutate, parseRegisteredMermaid, serializeMermaid } from '../agent/index.ts'
import { parseErDiagram } from '../er/parser.ts'
import { renderMermaidSVG } from '../index.ts'

const source = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  classDef vip fill:#ff8a65
  classDef hot stroke:#3b4cca,stroke-width:4px
  class CUSTOMER, ORDER vip, hot
`

describe('ER multiple-class shorthand (Mermaid 11.16.0)', () => {
  test('pinned Mermaid DB applies both classes to both existing entities', async () => {
    mermaid.initialize({ startOnLoad: false })
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(source)
    const entities = (upstream.db as unknown as { getEntities(): Map<string, { cssClasses: string }> }).getEntities()
    expect(entities.get('CUSTOMER')?.cssClasses).toBe('default vip hot')
    expect(entities.get('ORDER')?.cssClasses).toBe('default vip hot')
  })

  test('native and agent models preserve all class identities and merged paint', () => {
    const native = parseErDiagram(source.trim().split('\n').map(line => line.trim()))
    expect(native.entities.map(entity => [entity.id, entity.className])).toEqual([
      ['CUSTOMER', 'vip hot'], ['ORDER', 'vip hot'],
    ])

    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const er = asEr(parsed.value)
    expect(er?.body.entities.map(entity => [entity.id, entity.className])).toEqual([
      ['CUSTOMER', 'vip hot'], ['ORDER', 'vip hot'],
    ])
    const canonical = serializeMermaid(parsed.value)
    expect(canonical).toContain('class CUSTOMER vip,hot')
    expect(canonical).toContain('class ORDER vip,hot')
    expect(parseErDiagram(canonical.trim().split('\n').map(line => line.trim())).entities.map(entity => entity.className)).toEqual(['vip hot', 'vip hot'])

    const svg = renderMermaidSVG(source)
    expect(svg).toContain('class="entity vip hot" data-id="CUSTOMER"')
    expect(svg).toContain('class="entity vip hot" data-id="ORDER"')
    for (const id of ['CUSTOMER', 'ORDER']) {
      const rect = svg.match(new RegExp(`<rect\\b[^>]*data-id="entity-rect:${id}"[^>]*\\/>`))?.[0]
      expect(rect).toContain('fill="#ff8a65"')
      expect(rect).toContain('stroke="#3b4cca"')
    }
  })

  test('a typed rename preserves both classes and the unrelated entity', () => {
    const parsed = parseRegisteredMermaid(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const er = asEr(parsed.value)
    expect(er).not.toBeNull()
    if (!er) return
    const renamed = mutate(er, { kind: 'rename_entity', from: 'CUSTOMER', to: 'CLIENT' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    const native = parseErDiagram(serializeMermaid(renamed.value).trim().split('\n').map(line => line.trim()))
    expect(native.entities.map(entity => [entity.id, entity.className])).toEqual([
      ['CLIENT', 'vip hot'], ['ORDER', 'vip hot'],
    ])
  })

  test('repeated class statements accumulate in Mermaid order, with later paint winning', async () => {
    const repeated = `erDiagram
      A ||--o{ B : x
      classDef first fill:#ff0000
      classDef second fill:#0000ff
      class A first
      class A second
    `
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(repeated)
    const entities = (upstream.db as unknown as { getEntities(): Map<string, { cssClasses: string }> }).getEntities()
    expect(entities.get('A')?.cssClasses).toBe('default first second')
    expect(parseErDiagram(repeated.trim().split('\n').map(line => line.trim())).entities[0]?.className).toBe('first second')
    const svg = renderMermaidSVG(repeated)
    expect(svg).toContain('class="entity first second" data-id="A"')
    expect(svg).toContain('fill="#0000ff"')
  })

  test('later shorthand appends to statement and shorthand classes on an existing entity', async () => {
    const mixed = `erDiagram
      A ||--o{ B : x
      class A first,second
      A:::third
      A:::fourth,fifth
    `
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(mixed)
    const upstreamA = (upstream.db as unknown as { getEntities(): Map<string, { cssClasses: string }> }).getEntities().get('A')
    expect(upstreamA?.cssClasses).toBe('default first second third fourth fifth')
    const native = parseErDiagram(mixed.trim().split('\n').map(line => line.trim()))
    expect(native.entities[0]?.className).toBe('first second third fourth fifth')
    const parsed = parseRegisteredMermaid(mixed)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(asEr(parsed.value)?.body.entities[0]?.className).toBe('first second third fourth fifth')
    const serialized = serializeMermaid(parsed.value)
    expect(parseErDiagram(serialized.trim().split('\n').map(line => line.trim())).entities[0]?.className).toBe('first second third fourth fifth')
  })

  test('class directives before an entity exists do not mint or style it', async () => {
    const ordered = `erDiagram
      class GHOST vip
      class A vip
      A ||--o{ B : x
      class A hot
    `
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(ordered)
    const entities = (upstream.db as unknown as { getEntities(): Map<string, { cssClasses: string }> }).getEntities()
    expect([...entities.keys()]).toEqual(['A', 'B'])
    expect(entities.get('A')?.cssClasses).toBe('default hot')
    const native = parseErDiagram(ordered.trim().split('\n').map(line => line.trim()))
    expect(native.entities.map(entity => [entity.id, entity.className])).toEqual([['A', 'hot'], ['B', undefined]])
    const parsed = parseRegisteredMermaid(ordered)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(asEr(parsed.value)?.body.entities.map(entity => [entity.id, entity.className])).toEqual([['A', 'hot'], ['B', undefined]])
  })

  test('official ::: shorthand applies multiple classes on declarations and relationship endpoints', async () => {
    const shorthand = `erDiagram
      A:::vip,hot ||--o{ B : x
      C:::vip,hot
      classDef vip fill:#ff8a65
      classDef hot stroke:#3b4cca
    `
    const upstream = await mermaid.mermaidAPI.getDiagramFromText(shorthand)
    const entities = (upstream.db as unknown as { getEntities(): Map<string, { cssClasses: string }> }).getEntities()
    expect(entities.get('A')?.cssClasses).toBe('default vip hot')
    expect(entities.get('C')?.cssClasses).toBe('default vip hot')
    const native = parseErDiagram(shorthand.trim().split('\n').map(line => line.trim()))
    expect(native.entities.map(entity => [entity.id, entity.className])).toEqual([
      ['A', 'vip hot'], ['B', undefined], ['C', 'vip hot'],
    ])
    const agent = parseRegisteredMermaid(shorthand)
    expect(agent.ok).toBe(true)
    if (!agent.ok) return
    expect(asEr(agent.value)?.body.entities.map(entity => [entity.id, entity.className])).toEqual([
      ['A', 'vip hot'], ['B', undefined], ['C', 'vip hot'],
    ])
    const canonical = serializeMermaid(agent.value)
    expect(canonical).toContain('class A vip,hot')
    expect(canonical).toContain('class C vip,hot')
    expect(renderMermaidSVG(shorthand)).toContain('class="entity vip hot" data-id="A"')
  })

  test('malformed class lists do not silently style a subset of entities', () => {
    const malformed = `erDiagram
      A ||--o{ B : x
      class A, B first,
    `
    expect(() => parseErDiagram(malformed.trim().split('\n').map(line => line.trim()))).toThrow('Invalid ER class assignment')
    const parsed = parseRegisteredMermaid(malformed)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(asEr(parsed.value)).toBeNull()
  })

  test('large comma lists scan in bounded time', () => {
    const classes = `${'hot,'.repeat(20_000)}hot`
    const started = performance.now()
    const native = parseErDiagram(['erDiagram', 'A ||--o{ B : x', `class A ${classes}`])
    expect(native.entities[0]?.className?.split(' ')).toHaveLength(20_001)
    expect(performance.now() - started).toBeLessThan(250)
  })

  test('repeated valid class directives do not copy the entire prior assignment', () => {
    const lines = ['erDiagram', 'A ||--o{ B : x', ...Array(200_000).fill('class A hot')]
    const started = performance.now()
    const native = parseErDiagram(lines)
    expect(native.entities[0]?.className?.split(' ')).toHaveLength(200_000)
    expect(performance.now() - started).toBeLessThan(1_500)
  })

  test('a large second class list avoids the JavaScript argument-count ceiling', () => {
    const classes = `${'hot,'.repeat(200_000)}hot`
    const native = parseErDiagram(['erDiagram', 'A ||--o{ B : x', 'class A vip', `class A ${classes}`])
    expect(native.entities[0]?.className?.split(' ')).toHaveLength(200_002)
    const parsed = parseRegisteredMermaid(`erDiagram\nA ||--o{ B : x\nclass A vip\nclass A ${classes}`)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(asEr(parsed.value)?.body.entities[0]?.className?.split(' ')).toHaveLength(200_002)

    // Bun permits larger call-argument lists than Node; exercise the shared
    // parser in the supported Node runtime as well.
    const parserUrl = new URL('../er/parser.ts', import.meta.url).href
    const script = `import { parseErDiagram } from ${JSON.stringify(parserUrl)};
      const classes = 'hot,'.repeat(200000) + 'hot';
      const chart = parseErDiagram(['erDiagram', 'A ||--o{ B : x', 'class A vip', 'class A ' + classes]);
      if (chart.entities[0]?.className?.split(' ').length !== 200002) process.exit(1);`
    const node = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' })
    expect(node.status).toBe(0)
  })
})
