import { mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { parseClassDiagram } from '../../../class/parser.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const featureId = 'official-doc:class:section:defining-relationship'
const upstreamReference = 'https://mermaid.ai/open-source/syntax/classDiagram.html#defining-relationship'
const upstreamRevision = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  const value = evidence.semantics
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Class link evidence must be an object')
  return value as Record<string, FidelityJson>
}

function sameRelation(value: FidelityJson | undefined, expected: { from: string; to: string; kind: string; markerAt: string }): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const relation = value as Record<string, FidelityJson>
  return relation.from === expected.from && relation.to === expected.to && relation.kind === expected.kind && relation.markerAt === expected.markerAt
}

function nativeFacts(source: string) {
  const diagram = parseClassDiagram(source.trim().split('\n').map(line => line.trim()))
  return {
    classIds: diagram.classes.map(node => node.id),
    relations: diagram.relationships.map(relation => ({ from: relation.from, to: relation.to, kind: relation.type, markerAt: relation.markerAt })),
  }
}

function markerlessCase(kind: 'link-dashed' | 'link-solid', operator: '..' | '--'): FidelityCaseDefinition {
  const source = `classDiagram\nA ${operator} B\n`
  const expectedRelation = { from: 'A', to: 'B', kind, markerAt: 'none' }
  return {
    id: `class.relationship.${kind}-native`, family: 'class', featureId, source, upstreamReference, upstreamRevision,
    expected: {
      agent: {
        applicability: 'applicable', disposition: 'native',
        evaluate: evidence => {
          const value = facts(evidence)
          return value.kind === 'class' && sameRelation(value.relation, expectedRelation) ? 'native' : 'absent'
        },
      },
      render: {
        applicability: 'applicable', disposition: 'native',
        evaluate: evidence => {
          const value = facts(evidence)
          return Array.isArray(value.classIds) && value.classIds.length === 2 && value.classIds[0] === 'A' && value.classIds[1] === 'B'
            && sameRelation(value.relation, expectedRelation)
            && value.visible === true && value.edgeCount === 1 && value.markerless === true && value.dashed === (kind === 'link-dashed')
            ? 'native' : 'absent'
        },
      },
      serialize: {
        applicability: 'applicable', disposition: 'native',
        evaluate: evidence => {
          const value = facts(evidence)
          return value.stable === true && sameRelation(value.relation, expectedRelation) ? 'native' : 'absent'
        },
      },
      mutate: {
        applicability: 'applicable', disposition: 'native',
        evaluate: evidence => {
          const value = facts(evidence)
          return value.ok === true && sameRelation(value.relation, { ...expectedRelation, to: 'Target' }) ? 'native' : 'absent'
        },
      },
    },
    observe: () => {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) throw new Error(`Class link agent parse failed: ${parsed.error.map(error => error.code).join(', ')}`)
      const body = parsed.value.body
      const agentRelation = body.kind === 'class' ? body.relations[0] : undefined
      const native = nativeFacts(source)
      const svg = renderMermaidSVG(source)
      const element = svg.match(/<(?:path|polyline) class="class-relationship"[^>]+>/)?.[0] ?? ''
      const verified = verifyMermaid(parsed.value)
      const serialized = serializeMermaid(parsed.value)
      const reparsed = parseRegisteredMermaid(serialized)
      const mutation = mutate(parsed.value, { kind: 'rename_class', from: 'B', to: 'Target' })
      return {
        agent: {
          status: 'observed', diagnosticCodes: [],
          semantics: { kind: body.kind, relation: agentRelation ? { from: agentRelation.from, to: agentRelation.to, kind: agentRelation.kind, markerAt: agentRelation.markerAt ?? null } : null },
        },
        render: {
          status: 'observed', diagnosticCodes: verified.warnings.map(warning => warning.code),
          semantics: {
            classIds: native.classIds,
            relation: native.relations[0] ?? null,
            visible: element.includes('data-from="A" data-to="B"'),
            edgeCount: verified.layout?.edges.length ?? 0,
            markerless: !element.includes('marker-start=') && !element.includes('marker-end='),
            dashed: element.includes('stroke-dasharray="6 4"'),
          },
        },
        serialize: {
          status: 'observed', diagnosticCodes: [],
          semantics: { stable: reparsed.ok && serializeMermaid(reparsed.value) === serialized, relation: nativeFacts(serialized).relations[0] ?? null },
        },
        mutate: {
          status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
          semantics: { ok: mutation.ok, relation: mutation.ok ? nativeFacts(serializeMermaid(mutation.value)).relations[0] ?? null : null },
        },
      }
    },
  }
}

// The same official relationship section also permits escaped IDs on marked
// arrows. That separate #260 gap is deliberately recorded as absent, so the
// two passing bare-link cases cannot promote the whole section to native.
const escapedDirectedGap: FidelityCaseDefinition = {
  id: 'class.relationship.escaped-directed-absent',
  family: 'class', featureId,
  source: 'classDiagram\n`class A` --> B\n', upstreamReference, upstreamRevision,
  expected: {
    agent: {
      applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['UNSUPPORTED_SYNTAX'],
      evaluate: evidence => facts(evidence).kind === 'opaque' ? 'source-preserved' : 'absent',
    },
    render: {
      applicability: 'applicable', disposition: 'absent',
      evaluate: evidence => facts(evidence).visible === false && facts(evidence).edgeCount === 0 ? 'absent' : 'native',
    },
    serialize: {
      applicability: 'applicable', disposition: 'source-preserved',
      evaluate: evidence => facts(evidence).exactSource === true ? 'source-preserved' : 'absent',
    },
    mutate: {
      applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['INVALID_OP'],
      evaluate: evidence => facts(evidence).rejected === true ? 'diagnosed' : 'absent',
    },
  },
  observe: () => {
    const source = escapedDirectedGap.source
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('Escaped Class relationship source should remain preserved')
    const verified = verifyMermaid(parsed.value)
    const svg = renderMermaidSVG(source)
    const mutation = mutate(parsed.value, { kind: 'rename_class', from: 'class A', to: 'Target' })
    return {
      agent: {
        status: 'observed', diagnosticCodes: verified.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX') ? ['UNSUPPORTED_SYNTAX'] : [],
        semantics: { kind: parsed.value.body.kind },
      },
      render: {
        status: 'observed', diagnosticCodes: [],
        semantics: { visible: svg.includes('class="class-relationship"'), edgeCount: verified.layout?.edges.length ?? 0 },
      },
      serialize: {
        status: 'observed', diagnosticCodes: [],
        semantics: { exactSource: serializeMermaid(parsed.value) === source },
      },
      mutate: {
        status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { rejected: !mutation.ok },
      },
    }
  },
}

export const fidelityCases = [
  markerlessCase('link-dashed', '..'),
  markerlessCase('link-solid', '--'),
  escapedDirectedGap,
]
