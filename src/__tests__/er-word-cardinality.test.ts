import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mermaid from 'mermaid'
import { parseRegisteredMermaid, asEr, mutate, serializeMermaid } from '../agent/index.ts'
import { renderMermaidPNG } from '../agent/png.ts'
import { parseErDiagram } from '../er/parser.ts'
import { renderMermaidSVG } from '../index.ts'

const parseNative = (statement: string) => parseErDiagram(['erDiagram', statement])
const asset = (name: string): string => join(import.meta.dir, '..', '..', 'docs', 'pr-assets', name)

const aliases = [
  ['one or zero', 'zero-one', 'zero-or-one'],
  ['zero or one', 'zero-one', 'zero-or-one'],
  ['one or more', 'many', 'one-or-many'],
  ['one or many', 'many', 'one-or-many'],
  ['many(1)', 'many', 'one-or-many'],
  ['1+', 'many', 'one-or-many'],
  ['zero or more', 'zero-many', 'zero-or-many'],
  ['zero or many', 'zero-many', 'zero-or-many'],
  ['many(0)', 'zero-many', 'zero-or-many'],
  ['0+', 'zero-many', 'zero-or-many'],
  ['only one', 'one', 'one-only'],
  ['1', 'one', 'one-only'],
  ['one', 'one', 'one-only'],
  ['many', 'zero-many', 'zero-or-many'],
] as const

describe('ER word-form relationship aliases (Mermaid 11.16.0)', () => {
  test('both projections recognize every pinned cardinality alias on either side', () => {
    for (const [alias, nativeCard, agentCard] of aliases) {
      for (const side of ['left', 'right'] as const) {
        const statement = side === 'left'
          ? `CAR ${alias} to 1 DRIVER : allows`
          : `CAR 1 to ${alias} DRIVER : allows`
        const native = parseNative(statement)
        expect({ alias, side, count: native.relationships.length }).toEqual({ alias, side, count: 1 })
        expect(side === 'left' ? native.relationships[0]!.cardinality1 : native.relationships[0]!.cardinality2).toBe(nativeCard)
        expect(native.entities.map(entity => entity.id)).toEqual(['CAR', 'DRIVER'])

        const parsed = parseRegisteredMermaid(`erDiagram\n  ${statement}`)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) continue
        const body = asEr(parsed.value)?.body
        expect(body?.relations).toHaveLength(1)
        expect(side === 'left' ? body?.relations[0]?.leftCard : body?.relations[0]?.rightCard).toBe(agentCard)
        expect(body?.entities.map(entity => entity.id)).toEqual(['CAR', 'DRIVER'])
      }
    }
  })

  test('identifying and non-identifying words and glyphs retain meaning and endpoint identity', () => {
    const cases = [
      ['CAR 1 to zero or more NAMED-DRIVER : allows', true, 'one', 'zero-many'],
      ['PERSON many(0) optionally to 0+ NAMED-DRIVER : is', false, 'zero-many', 'zero-many'],
      ['CUSTOMER 1--one or more DELIVERY-ADDRESS : has', true, 'one', 'many'],
      ['A one or many optionally to zero or one B : has', false, 'many', 'zero-one'],
    ] as const
    for (const [statement, identifying, left, right] of cases) {
      const native = parseNative(statement)
      expect(native.relationships).toHaveLength(1)
      expect(native.relationships[0]).toMatchObject({ identifying, cardinality1: left, cardinality2: right })
      const parsed = parseRegisteredMermaid(`erDiagram\n  ${statement}`)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const body = asEr(parsed.value)?.body
      expect(body?.relations).toHaveLength(1)
      expect(body?.relations[0]?.dashed).toBe(!identifying)
      const canonical = serializeMermaid(parsed.value)
      expect(parseErDiagram(canonical.split('\n').map(line => line.trim()).filter(Boolean)).relationships).toHaveLength(1)
      expect(renderMermaidSVG(`erDiagram\n  ${statement}`)).toMatch(/class="er-relationship"/)
    }
  })

  test('the pinned Mermaid DB agrees about word-form cardinality and identification', async () => {
    mermaid.initialize({ startOnLoad: false })
    const upstreamCard = {
      one: 'ONLY_ONE', 'zero-one': 'ZERO_OR_ONE', many: 'ONE_OR_MORE', 'zero-many': 'ZERO_OR_MORE',
    } as const
    for (const [alias, nativeCard] of aliases) {
      for (const side of ['left', 'right'] as const) {
        const statement = side === 'left'
          ? `CAR ${alias} to 1 DRIVER : allows`
          : `CAR 1 to ${alias} DRIVER : allows`
        const upstream = await mermaid.mermaidAPI.getDiagramFromText(`erDiagram\n${statement}\n`)
        const db = upstream.db as unknown as { getRelationships(): Array<{ relSpec: { cardA: string; cardB: string } }> }
        expect(db.getRelationships()).toHaveLength(1)
        expect(side === 'left' ? db.getRelationships()[0]!.relSpec.cardB : db.getRelationships()[0]!.relSpec.cardA).toBe(upstreamCard[nativeCard])
      }
    }
    for (const [statement, cardA, cardB, relType] of [
      ['CAR 1 to zero or more DRIVER : allows', 'ZERO_OR_MORE', 'ONLY_ONE', 'IDENTIFYING'],
      ['PERSON many(0) optionally to 0+ DRIVER : is', 'ZERO_OR_MORE', 'ZERO_OR_MORE', 'NON_IDENTIFYING'],
    ] as const) {
      const upstream = await mermaid.mermaidAPI.getDiagramFromText(`erDiagram\n${statement}\n`)
      const db = upstream.db as unknown as { getRelationships(): Array<{ relSpec: { cardA: string; cardB: string; relType: string } }> }
      expect(db.getRelationships().map(relation => relation.relSpec)).toEqual([{ cardA, cardB, relType }])
    }
  })

  test('a typed mutation keeps surrounding relationships and canonical cardinalities', () => {
    const parsed = parseRegisteredMermaid('erDiagram\n  CAR 1 to zero or more DRIVER : allows\n  DRIVER many(0) optionally to 0+ LICENSE : holds')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const er = asEr(parsed.value)
    expect(er).not.toBeNull()
    if (!er) return
    const changed = mutate(er, { kind: 'rename_entity', from: 'DRIVER', to: 'OPERATOR' })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    const source = serializeMermaid(changed.value)
    const native = parseErDiagram(source.split('\n').map(line => line.trim()).filter(Boolean))
    expect(native.relationships.map(relation => ({ from: relation.entity1, to: relation.entity2, left: relation.cardinality1, right: relation.cardinality2, identifying: relation.identifying }))).toEqual([
      { from: 'CAR', to: 'OPERATOR', left: 'one', right: 'zero-many', identifying: true },
      { from: 'OPERATOR', to: 'LICENSE', left: 'zero-many', right: 'zero-many', identifying: false },
    ])
  })

  test('reviewer-facing before/after SVG and PNG are real renderer artifacts', () => {
    const source = 'erDiagram\nCAR 1 to zero or more DRIVER : allows\n'
    const before = readFileSync(asset('issue-248-er-word-before.svg'), 'utf8')
    expect(before).toContain('width="0" height="0"')
    expect(before).not.toContain('er-relationship')
    expect(renderMermaidSVG(source, { embedFontImport: false })).toBe(readFileSync(asset('issue-248-er-word-after.svg'), 'utf8'))
    expect(Buffer.from(renderMermaidPNG(source, { scale: 1 }))).toEqual(readFileSync(asset('issue-248-er-word-after.png')))
  })
})
