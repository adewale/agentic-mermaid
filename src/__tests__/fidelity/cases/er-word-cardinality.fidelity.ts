import { mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid } from '../../../agent/index.ts'
import { parseErDiagram } from '../../../er/parser.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const source = 'erDiagram\n  CAR 1 to zero or more DRIVER : allows\n  DRIVER many(0) optionally to 0+ LICENSE : holds\n'

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  if (!evidence.semantics || typeof evidence.semantics !== 'object' || Array.isArray(evidence.semantics)) {
    throw new Error('ER word-alias evidence must be an object')
  }
  return evidence.semantics as Record<string, FidelityJson>
}

function matchesRows(value: FidelityJson, expected: readonly Record<string, string | boolean>[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((row, index) =>
    row !== null && typeof row === 'object' && !Array.isArray(row) &&
    Object.entries(expected[index]!).every(([key, entry]) => row[key] === entry))
}

function nativeRelations(input: string): FidelityJson {
  return parseErDiagram(input.split('\n').map(line => line.trim()).filter(Boolean)).relationships.map(relation => ({
    from: relation.entity1,
    to: relation.entity2,
    left: relation.cardinality1,
    right: relation.cardinality2,
    identifying: relation.identifying,
  }))
}

const expectedRelations = [
  { from: 'CAR', to: 'DRIVER', left: 'one', right: 'zero-many', identifying: true },
  { from: 'DRIVER', to: 'LICENSE', left: 'zero-many', right: 'zero-many', identifying: false },
]
const changedRelations = [
  { from: 'CAR', to: 'OPERATOR', left: 'one', right: 'zero-many', identifying: true },
  { from: 'OPERATOR', to: 'LICENSE', left: 'zero-many', right: 'zero-many', identifying: false },
]

const erWordCardinality: FidelityCaseDefinition = {
  id: 'er.relationships.word-cardinality-aliases',
  family: 'er',
  featureId: 'official-doc:er:section:relationship-syntax',
  source,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/entityRelationshipDiagram.html#relationship-syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return observed.kind === 'er' && matchesRows(observed.relations ?? null, [
          { from: 'CAR', to: 'DRIVER', left: 'one-only', right: 'zero-or-many', dashed: false },
          { from: 'DRIVER', to: 'LICENSE', left: 'zero-or-many', right: 'zero-or-many', dashed: true },
        ]) ? 'native' : 'absent'
      },
    },
    render: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return matchesRows(observed.relations ?? null, expectedRelations) && observed.visibleEdges === 2 ? 'native' : 'absent'
      },
    },
    serialize: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return matchesRows(observed.relations ?? null, expectedRelations) && observed.stable === true ? 'native' : 'absent'
      },
    },
    mutate: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const observed = facts(evidence)
        return observed.ok === true && matchesRows(observed.relations ?? null, changedRelations) ? 'native' : 'absent'
      },
    },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error(`ER word-alias agent parse failed: ${parsed.error.map(error => error.code).join(', ')}`)
    const body = parsed.value.body
    const svg = renderMermaidSVG(source)
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    const mutation = mutate(parsed.value, { kind: 'rename_entity', from: 'DRIVER', to: 'OPERATOR' })
    const changed = mutation.ok ? serializeMermaid(mutation.value) : ''
    return {
      agent: {
        status: 'observed', diagnosticCodes: [],
        semantics: {
          kind: body.kind,
          relations: body.kind === 'er' ? body.relations.map(relation => ({ from: relation.from, to: relation.to, left: relation.leftCard, right: relation.rightCard, dashed: relation.dashed })) : [],
        },
      },
      render: {
        status: 'observed', diagnosticCodes: [],
        semantics: { relations: nativeRelations(source), visibleEdges: [...svg.matchAll(/<polyline\b[^>]*class="er-relationship"/g)].length },
      },
      serialize: {
        status: 'observed', diagnosticCodes: [],
        semantics: { relations: nativeRelations(serialized), stable: reparsed.ok && serializeMermaid(reparsed.value) === serialized },
      },
      mutate: {
        status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { ok: mutation.ok, relations: mutation.ok ? nativeRelations(changed) : [] },
      },
    }
  },
}

export const fidelityCases = [erWordCardinality]
