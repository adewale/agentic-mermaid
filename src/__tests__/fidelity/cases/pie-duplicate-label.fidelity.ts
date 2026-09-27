import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidSVG } from '../../../index.ts'
import { parsePieChart } from '../../../pie/parser.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const source = 'pie showData\n  "Alpha" : 10\n  "Beta" : 20\n  "Alpha" : 30\n'
const expectedSlices = [['Alpha', 10], ['Beta', 20]]

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  if (!evidence.semantics || typeof evidence.semantics !== 'object' || Array.isArray(evidence.semantics)) {
    throw new Error('Pie duplicate-label evidence must be an object')
  }
  return evidence.semantics as Record<string, FidelityJson>
}

const duplicateFirstWins: FidelityCaseDefinition = {
  id: 'pie.syntax.duplicate-label-first-wins', family: 'pie',
  featureId: 'official-doc:pie:section:syntax', source,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/pie.html#syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: { applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['UNSUPPORTED_SYNTAX'],
      evaluate: evidence => facts(evidence).kind === 'opaque' && facts(evidence).sourceExact === true ? 'source-preserved' : 'absent' },
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => JSON.stringify(facts(evidence).slices) === JSON.stringify(expectedSlices)
        && facts(evidence).duplicateSeen === true ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'source-preserved',
      evaluate: evidence => facts(evidence).sourceExact === true ? 'source-preserved' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['INVALID_OP'],
      evaluate: evidence => facts(evidence).rejected === true ? 'diagnosed' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('Duplicate Pie source should be preserved')
    const verified = verifyMermaid(parsed.value)
    const native = parsePieChart(source.trim().split('\n'))
    const svg = renderMermaidSVG(source)
    const drawn = [...svg.matchAll(/data-label="([^"]+)" data-value="([^"]+)"/g)]
      .map(match => [match[1]!, Number(match[2])])
    const serialized = serializeMermaid(parsed.value)
    const mutation = mutate(parsed.value, { kind: 'set_slice_value', label: 'Alpha', value: 7 })
    return {
      agent: { status: 'observed', diagnosticCodes: verified.warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX').map(warning => warning.code),
        semantics: { kind: parsed.value.body.kind, sourceExact: parsed.value.body.kind === 'opaque' && parsed.value.body.source === source } },
      render: { status: 'observed', diagnosticCodes: [],
        semantics: { slices: drawn, duplicateSeen: native.hasDuplicateSourceLabels === true } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { sourceExact: serialized === source } },
      mutate: { status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code], semantics: { rejected: !mutation.ok } },
    }
  },
}

export const fidelityCases = [duplicateFirstWins] as const satisfies readonly FidelityCaseDefinition[]
