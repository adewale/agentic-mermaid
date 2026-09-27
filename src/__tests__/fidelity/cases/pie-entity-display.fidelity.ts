import { mutate, parseRegisteredMermaid, serializeMermaid } from '../../../agent/index.ts'
import { renderMermaidASCII, renderMermaidSVG } from '../../../index.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const source = 'pie\n  "A&#35;B" : 1\n'

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  if (!evidence.semantics || typeof evidence.semantics !== 'object' || Array.isArray(evidence.semantics)) {
    throw new Error('Pie entity-display evidence must be an object')
  }
  return evidence.semantics as Record<string, FidelityJson>
}

const numericEntityDisplay: FidelityCaseDefinition = {
  id: 'pie.syntax.numeric-entity-display', family: 'pie',
  featureId: 'official-doc:pie:section:syntax', source,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/pie.html#syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).kind === 'pie' && facts(evidence).authoredLabel === 'A&#35;B'
        ? 'native' : 'absent' },
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).svgLegend === 'A&amp;#B (100.0%)'
        && facts(evidence).terminalLabel === 'A&#B' && facts(evidence).sourceKey === 'A&#35;B'
        ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).sourceExact === true ? 'native' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).authoredLabel === 'A&#35;B'
        && facts(evidence).svgLegend === 'A&amp;#B (100.0%)'
        && facts(evidence).updatedValue === 2 ? 'native' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('Numeric Pie entity should parse')
    if (parsed.value.body.kind !== 'pie') throw new Error('Numeric Pie entity should remain typed')
    const authoredLabel = parsed.value.body.slices[0]!.label
    const svgLegend = (text: string) => renderMermaidSVG(text).match(/class="pie-legend-text"[^>]*>([^<]*)<\/text>/)?.[1]
    const terminalLabel = renderMermaidASCII(source, { colorMode: 'none' }).split('  ')[0] ?? null
    const serialized = serializeMermaid(parsed.value)
    const changed = mutate(parsed.value, { kind: 'set_slice_value', label: 'A&#35;B', value: 2 })
    const changedSource = changed.ok ? serializeMermaid(changed.value) : ''
    const changedSlice = changed.ok && changed.value.body.kind === 'pie' ? changed.value.body.slices[0] : undefined
    return {
      agent: { status: 'observed', diagnosticCodes: [], semantics: { kind: parsed.value.body.kind, authoredLabel } },
      render: { status: 'observed', diagnosticCodes: [], semantics: {
        svgLegend: svgLegend(source) ?? null, terminalLabel, sourceKey: authoredLabel,
      } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { sourceExact: serialized === source } },
      mutate: { status: 'observed', diagnosticCodes: changed.ok ? [] : [changed.error.code], semantics: {
        authoredLabel: changedSlice?.label ?? null,
        svgLegend: changed.ok ? svgLegend(changedSource) ?? null : null,
        updatedValue: changedSlice?.value ?? null,
      } },
    }
  },
}

export const fidelityCases = [numericEntityDisplay] as const satisfies readonly FidelityCaseDefinition[]
