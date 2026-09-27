import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { decodeXML } from 'entities'
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

const xmlControlSource = 'pie\n  "A\\0B" : 1\n'
const xmlControlDiagnosed: FidelityCaseDefinition = {
  id: 'pie.syntax.xml-disallowed-control-diagnosed', family: 'pie',
  featureId: 'official-doc:pie:section:syntax', source: xmlControlSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/pie.html#syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: { applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['UNSUPPORTED_SYNTAX'],
      evaluate: evidence => facts(evidence).kind === 'opaque' && facts(evidence).sourceExact === true ? 'source-preserved' : 'absent' },
    render: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['RENDER_FAILED'],
      evaluate: evidence => facts(evidence).rejected === true && facts(evidence).pieDiagnostic === true ? 'diagnosed' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'source-preserved',
      evaluate: evidence => facts(evidence).sourceExact === true ? 'source-preserved' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['INVALID_OP'],
      evaluate: evidence => facts(evidence).rejected === true ? 'diagnosed' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(xmlControlSource)
    if (!parsed.ok) throw new Error('Unsafe Pie label source should be preserved')
    const verified = verifyMermaid(parsed.value)
    let errorMessage = ''
    try { renderMermaidSVG(xmlControlSource) } catch (error) { errorMessage = String(error) }
    const serialized = serializeMermaid(parsed.value)
    const mutation = mutate(parsed.value, { kind: 'set_slice_value', label: 'A\0B', value: 7 })
    return {
      agent: { status: 'observed', diagnosticCodes: verified.warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX').map(warning => warning.code),
        semantics: { kind: parsed.value.body.kind, sourceExact: parsed.value.body.kind === 'opaque' && parsed.value.body.source === xmlControlSource } },
      render: { status: 'observed', diagnosticCodes: verified.warnings.filter(warning => warning.code === 'RENDER_FAILED').map(warning => warning.code),
        semantics: { rejected: errorMessage.length > 0, pieDiagnostic: errorMessage.includes('Pie slice label contains an XML-disallowed control character') } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { sourceExact: serialized === xmlControlSource } },
      mutate: { status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code], semantics: { rejected: !mutation.ok } },
    }
  },
}

const entitySource = 'pie showData\n  "A&amp;B" : 1\n  "A&B" : 2\n'
const entityLabels = [['A&amp;B', 1], ['A&B', 2]]
const entitySpellingDistinct: FidelityCaseDefinition = {
  id: 'pie.syntax.entity-spelling-distinct', family: 'pie',
  featureId: 'official-doc:pie:section:syntax', source: entitySource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/pie.html#syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).kind === 'pie' && JSON.stringify(facts(evidence).slices) === JSON.stringify(entityLabels) ? 'native' : 'absent' },
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => JSON.stringify(facts(evidence).slices) === JSON.stringify(entityLabels) ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => JSON.stringify(facts(evidence).slices) === JSON.stringify(entityLabels) ? 'native' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => JSON.stringify(facts(evidence).slices) === JSON.stringify([['A&amp;B', 1], ['A&B', 3]]) ? 'native' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(entitySource)
    if (!parsed.ok) throw new Error('Distinct Pie entities should parse')
    const slices = parsed.value.body.kind === 'pie'
      ? parsed.value.body.slices.map(slice => [slice.label, slice.value]) : []
    const svgSlices = (svg: string) => [...svg.matchAll(/data-label="([^"]+)" data-value="([^"]+)"/g)]
      .map(match => [decodeXML(match[1]!), Number(match[2])])
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parsePieChart(serialized.trim().split('\n'))
    const mutation = mutate(parsed.value, { kind: 'set_slice_value', label: 'A&B', value: 3 })
    return {
      agent: { status: 'observed', diagnosticCodes: [], semantics: { kind: parsed.value.body.kind, slices } },
      render: { status: 'observed', diagnosticCodes: [], semantics: { slices: svgSlices(renderMermaidSVG(entitySource)) } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { slices: reparsed.entries.map(entry => [entry.label, entry.value]) } },
      mutate: { status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { slices: mutation.ok ? svgSlices(renderMermaidSVG(serializeMermaid(mutation.value))) : [] } },
    }
  },
}

export const fidelityCases = [duplicateFirstWins, entitySpellingDistinct, xmlControlDiagnosed] as const satisfies readonly FidelityCaseDefinition[]
