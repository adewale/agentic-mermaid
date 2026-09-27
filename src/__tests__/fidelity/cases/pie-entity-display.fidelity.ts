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
        && facts(evidence).terminalLabel === 'A&#B' && facts(evidence).authoredLabel === 'A&#35;B'
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
        svgLegend: svgLegend(source) ?? null, terminalLabel, authoredLabel,
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

const namedSource = 'pie\n  "A#reg;B" : 1\n'

const namedEntityDisplay: FidelityCaseDefinition = {
  id: 'pie.syntax.named-entity-display', family: 'pie',
  featureId: 'official-doc:pie:section:syntax', source: namedSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/pie.html#syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).kind === 'pie' && facts(evidence).authoredLabel === 'A#reg;B'
        ? 'native' : 'absent' },
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).svgLegend === 'A®B (100.0%)'
        && facts(evidence).terminalLabel === 'A®B' && facts(evidence).authoredLabel === 'A#reg;B'
        ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).sourceExact === true ? 'native' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).authoredLabel === 'A#reg;B'
        && facts(evidence).svgLegend === 'A®B (100.0%)' && facts(evidence).updatedValue === 2
        ? 'native' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(namedSource)
    if (!parsed.ok || parsed.value.body.kind !== 'pie') throw new Error('Named Pie entity should remain typed')
    const authoredLabel = parsed.value.body.slices[0]!.label
    const svgLegend = (text: string) => renderMermaidSVG(text).match(/class="pie-legend-text"[^>]*>([^<]*)<\/text>/)?.[1]
    const terminalLabel = renderMermaidASCII(namedSource, { colorMode: 'none' }).split('  ')[0] ?? null
    const serialized = serializeMermaid(parsed.value)
    const changed = mutate(parsed.value, { kind: 'set_slice_value', label: 'A#reg;B', value: 2 })
    const changedSource = changed.ok ? serializeMermaid(changed.value) : ''
    const changedSlice = changed.ok && changed.value.body.kind === 'pie' ? changed.value.body.slices[0] : undefined
    return {
      agent: { status: 'observed', diagnosticCodes: [], semantics: { kind: parsed.value.body.kind, authoredLabel } },
      render: { status: 'observed', diagnosticCodes: [], semantics: {
        svgLegend: svgLegend(namedSource) ?? null, terminalLabel, authoredLabel,
      } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { sourceExact: serialized === namedSource } },
      mutate: { status: 'observed', diagnosticCodes: changed.ok ? [] : [changed.error.code], semantics: {
        authoredLabel: changedSlice?.label ?? null,
        svgLegend: changed.ok ? svgLegend(changedSource) ?? null : null,
        updatedValue: changedSlice?.value ?? null,
      } },
    }
  },
}

const titleSource = 'pie\n  title A#65;B\n  "X" : 1\n'

const titleEntityDisplay: FidelityCaseDefinition = {
  id: 'pie.syntax.title-entity-display', family: 'pie',
  featureId: 'official-doc:pie:section:syntax', source: titleSource,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/pie.html#syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).kind === 'pie' && facts(evidence).authoredTitle === 'A#65;B'
        ? 'native' : 'absent' },
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).svgTitle === 'AAB'
        && facts(evidence).terminalTitle === 'AAB' && facts(evidence).authoredTitle === 'A#65;B'
        ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).sourceExact === true ? 'native' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).authoredTitle === 'A#65;B'
        && facts(evidence).svgTitle === 'AAB' && facts(evidence).updatedValue === 2
        ? 'native' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(titleSource)
    if (!parsed.ok || parsed.value.body.kind !== 'pie') throw new Error('Pie title entity should remain typed')
    const authoredTitle = parsed.value.body.title ?? null
    const svgTitle = (text: string) => renderMermaidSVG(text).match(/class="pie-title"[^>]*>([^<]*)<\/text>/)?.[1] ?? null
    const terminalTitle = renderMermaidASCII(titleSource, { colorMode: 'none' }).split('\n')[0] ?? null
    const serialized = serializeMermaid(parsed.value)
    const changed = mutate(parsed.value, { kind: 'set_slice_value', label: 'X', value: 2 })
    const changedSource = changed.ok ? serializeMermaid(changed.value) : ''
    const changedBody = changed.ok && changed.value.body.kind === 'pie' ? changed.value.body : undefined
    return {
      agent: { status: 'observed', diagnosticCodes: [], semantics: { kind: parsed.value.body.kind, authoredTitle } },
      render: { status: 'observed', diagnosticCodes: [], semantics: {
        svgTitle: svgTitle(titleSource), terminalTitle, authoredTitle,
      } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { sourceExact: serialized === titleSource } },
      mutate: { status: 'observed', diagnosticCodes: changed.ok ? [] : [changed.error.code], semantics: {
        authoredTitle: changedBody?.title ?? null,
        svgTitle: changed.ok ? svgTitle(changedSource) : null,
        updatedValue: changedBody?.slices[0]?.value ?? null,
      } },
    }
  },
}

export const fidelityCases = [numericEntityDisplay, namedEntityDisplay, titleEntityDisplay] as const satisfies readonly FidelityCaseDefinition[]
