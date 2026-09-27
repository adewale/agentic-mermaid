import { mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid } from '../../../agent/index.ts'
import { layoutErDiagram } from '../../../er/layout.ts'
import { parseErDiagram } from '../../../er/parser.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const source = `erDiagram
  A:::vip,hot ||--o{ B : places
  C
  classDef vip fill:#ff8a65
  classDef hot stroke:#3b4cca,stroke-width:4px
  class B,C vip,hot
`

const expected = [
  { id: 'A', className: 'vip hot' },
  { id: 'B', className: 'vip hot' },
  { id: 'C', className: 'vip hot' },
]
const renamed = [
  { id: 'X', className: 'vip hot' },
  { id: 'B', className: 'vip hot' },
  { id: 'C', className: 'vip hot' },
]

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  const value = evidence.semantics
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ER multi-class evidence must be an object')
  return value as Record<string, FidelityJson>
}

function matchesEntities(value: FidelityJson, rows: readonly { id: string; className: string }[]): boolean {
  return Array.isArray(value) && value.length === rows.length && value.every((row, index) =>
    row !== null && typeof row === 'object' && !Array.isArray(row) &&
    row.id === rows[index]!.id && row.className === rows[index]!.className)
}

function matchesPaint(value: FidelityJson): boolean {
  return Array.isArray(value) && value.length === 3 && value.every((row, index) =>
    row !== null && typeof row === 'object' && !Array.isArray(row) &&
    row.id === expected[index]!.id && row.fill === '#ff8a65' && row.stroke === '#3b4cca')
}

function nativeFacts(input: string) {
  const chart = parseErDiagram(input.trim().split('\n').map(line => line.trim()))
  const layout = layoutErDiagram(chart)
  return {
    entities: chart.entities.map(entity => ({ id: entity.id, className: entity.className ?? null })),
    paint: layout.entities.map(entity => ({ id: entity.id, fill: entity.inlineStyle?.fill ?? null, stroke: entity.inlineStyle?.stroke ?? null })),
  }
}

function parsedOrThrow(input: string) {
  const parsed = parseRegisteredMermaid(input)
  if (!parsed.ok) throw new Error(`ER multi-class agent parse failed: ${parsed.error.map(error => error.code).join(', ')}`)
  return parsed.value
}

const erMultiClass: FidelityCaseDefinition = {
  id: 'er.classes.multiple-assignments-and-shorthand',
  family: 'er',
  featureId: 'official-doc:er:section:classes',
  source,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/entityRelationshipDiagram.html#classes',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return observed.kind === 'er' && matchesEntities(observed.entities ?? null, expected) ? 'native' : 'absent'
      },
    },
    render: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return matchesEntities(observed.entities ?? null, expected) &&
          matchesPaint(observed.paint ?? null) && observed.visibleStyledEntities === 3 ? 'native' : 'absent'
      },
    },
    serialize: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return matchesEntities(observed.entities ?? null, expected) && observed.stable === true ? 'native' : 'absent'
      },
    },
    mutate: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return observed.ok === true && matchesEntities(observed.entities ?? null, renamed) ? 'native' : 'absent'
      },
    },
  },
  observe: () => {
    const parsed = parsedOrThrow(source)
    const body = parsed.body
    const svg = renderMermaidSVG(source)
    const serialized = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serialized)
    const mutation = mutate(parsed, { kind: 'rename_entity', from: 'A', to: 'X' })
    return {
      agent: {
        status: 'observed', diagnosticCodes: [],
        semantics: {
          kind: body.kind,
          entities: body.kind === 'er' ? body.entities.map(entity => ({ id: entity.id, className: entity.className ?? null })) : [],
        },
      },
      render: {
        status: 'observed', diagnosticCodes: [],
        semantics: { ...nativeFacts(source), visibleStyledEntities: [...svg.matchAll(/class="entity vip hot"/g)].length },
      },
      serialize: {
        status: 'observed', diagnosticCodes: [],
        semantics: { entities: nativeFacts(serialized).entities, stable: serializeMermaid(reparsed) === serialized },
      },
      mutate: {
        status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { ok: mutation.ok, entities: mutation.ok ? nativeFacts(serializeMermaid(mutation.value)).entities : [] },
      },
    }
  },
}

export const fidelityCases = [erMultiClass]
