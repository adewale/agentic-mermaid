import { mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { parseClassDiagram } from '../../../class/parser.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const featureId = 'official-doc:class:section:annotations-on-classes'
const upstreamReference = 'https://mermaid.ai/open-source/syntax/classDiagram.html#annotations-on-classes'
const upstreamRevision = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'
const source = 'classDiagram\n  class Shape <<interface>>\n  class Other\n  Shape --> Other\n'
const separateSource = 'classDiagram\n  class Shape\n  <<interface>> Shape\n  class Other\n  Shape --> Other\n'
const repeatedSource = 'classDiagram\n  class Shape <<interface>>\n  <<abstract>> Shape\n'

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  const value = evidence.semantics
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Class annotation evidence must be an object')
  return value as Record<string, FidelityJson>
}

function nativeFacts(input: string) {
  const diagram = parseClassDiagram(input.trim().split('\n').map(line => line.trim()))
  return {
    annotation: diagram.classes.find(node => node.id === 'Shape' || node.id === 'Form')?.annotation ?? null,
    classIds: diagram.classes.map(node => node.id),
    relations: diagram.relationships.map(relation => [relation.from, relation.to]),
  }
}

function parsedOrThrow(input: string) {
  const parsed = parseRegisteredMermaid(input)
  if (!parsed.ok) throw new Error(`Class annotation agent parse failed: ${parsed.error.map(error => error.code).join(', ')}`)
  return parsed.value
}

function officialPlacementCase(id: string, placementSource: string): FidelityCaseDefinition {
  return {
  id,
  family: 'class', featureId, source: placementSource, upstreamReference, upstreamRevision,
  expected: {
    agent: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.kind === 'class' && value.annotation === 'interface' && value.relation === 'Shape->Other' ? 'native' : 'absent'
      },
    },
    render: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.annotation === 'interface' && value.visibleAnnotation === true && value.relation === 'Shape->Other' ? 'native' : 'absent'
      },
    },
    serialize: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.annotation === 'interface' && value.stable === true ? 'native' : 'absent'
      },
    },
    mutate: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.ok === true && value.annotation === 'interface' && value.relation === 'Form->Other' ? 'native' : 'absent'
      },
    },
  },
  observe: () => {
    const parsed = parsedOrThrow(placementSource)
    const body = parsed.body
    const native = nativeFacts(placementSource)
    const svg = renderMermaidSVG(placementSource)
    const serialized = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serialized)
    const mutation = mutate(parsed, { kind: 'rename_class', from: 'Shape', to: 'Form' })
    const changed = mutation.ok ? nativeFacts(serializeMermaid(mutation.value)) : null
    return {
      agent: {
        status: 'observed', diagnosticCodes: [],
        semantics: {
          kind: body.kind,
          annotation: body.kind === 'class' && body.classes.find(node => node.id === 'Shape')?.members.includes('<<interface>>') ? 'interface' : null,
          relation: body.kind === 'class' ? body.relations.map(relation => `${relation.from}->${relation.to}`).join(',') : null,
        },
      },
      render: {
        status: 'observed', diagnosticCodes: [],
        semantics: {
          annotation: native.annotation,
          visibleAnnotation: svg.includes('data-annotation="interface"') && svg.includes('&lt;&lt;interface&gt;&gt;'),
          relation: native.relations.map(([from, to]) => `${from}->${to}`).join(','),
        },
      },
      serialize: {
        status: 'observed', diagnosticCodes: [],
        semantics: { annotation: nativeFacts(serialized).annotation, stable: serializeMermaid(reparsed) === serialized },
      },
      mutate: {
        status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          ok: mutation.ok,
          annotation: changed?.annotation ?? null,
          relation: changed?.relations.map(([from, to]) => `${from}->${to}`).join(',') ?? null,
        },
      },
    }
  },
  }
}

const repeatedAnnotation: FidelityCaseDefinition = {
  id: 'class.annotations.repeated-diagnosed',
  family: 'class', featureId, source: repeatedSource, upstreamReference, upstreamRevision,
  expected: {
    agent: {
      applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['UNSUPPORTED_SYNTAX'],
      evaluate: evidence => facts(evidence).kind === 'opaque' ? 'source-preserved' : 'absent',
    },
    render: {
      applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['RENDER_FAILED'],
      evaluate: evidence => facts(evidence).rejected === true && facts(evidence).verifyRejected === true ? 'diagnosed' : 'absent',
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
    const parsed = parsedOrThrow(repeatedSource)
    const verified = verifyMermaid(parsed)
    let renderError = ''
    try { renderMermaidSVG(repeatedSource) } catch (error) { renderError = error instanceof Error ? error.message : String(error) }
    const mutation = mutate(parsed, { kind: 'rename_class', from: 'Shape', to: 'Form' })
    return {
      agent: {
        status: 'observed', diagnosticCodes: verified.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX') ? ['UNSUPPORTED_SYNTAX'] : [],
        semantics: { kind: parsed.body.kind },
      },
      render: {
        status: 'observed', diagnosticCodes: verified.warnings.some(warning => warning.code === 'RENDER_FAILED') ? ['RENDER_FAILED'] : [],
        semantics: { rejected: renderError.includes('Multiple annotations'), verifyRejected: !verified.ok },
      },
      serialize: {
        status: 'observed', diagnosticCodes: [],
        semantics: { exactSource: serializeMermaid(parsed) === repeatedSource },
      },
      mutate: {
        status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { rejected: !mutation.ok },
      },
    }
  },
}

export const fidelityCases = [
  officialPlacementCase('class.annotations.inline-native', source),
  officialPlacementCase('class.annotations.separate-native', separateSource),
  repeatedAnnotation,
]
