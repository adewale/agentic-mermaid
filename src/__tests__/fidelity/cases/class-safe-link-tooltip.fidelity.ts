import { asClass, mutate, parseRegisteredMermaid, renderMermaidWithActions, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { parseClassDiagram } from '../../../class/parser.ts'
import { renderMermaidSVG } from '../../../index.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const featureId = 'official-doc:class:section:interaction'
const upstreamReference = 'https://mermaid.ai/open-source/syntax/classDiagram.html#interaction'
const upstreamRevision = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'
const href = 'https://example.com/docs'
const tooltip = 'API reference'

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  const value = evidence.semantics
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Class link evidence must be an object')
  return value as Record<string, FidelityJson>
}

const nativeLink: FidelityCaseDefinition = {
  id: 'class.interaction.safe-link-tooltip-native', family: 'class', featureId,
  source: `classDiagram\nclass A\nlink A "${href}" "${tooltip}"\nclass B\n`, upstreamReference, upstreamRevision,
  expected: {
    agent: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).href === href && facts(evidence).tooltip === tooltip ? 'native' : 'absent' },
    render: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).href === href && facts(evidence).tooltip === tooltip
        && facts(evidence).svgTitle === true && facts(evidence).sidecarTooltip === tooltip ? 'native' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).stable === true && facts(evidence).href === href && facts(evidence).tooltip === tooltip ? 'native' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'native',
      evaluate: evidence => facts(evidence).ok === true && facts(evidence).tooltip === tooltip ? 'native' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(nativeLink.source)
    if (!parsed.ok) throw new Error('Safe Class link should parse')
    const agentNode = asClass(parsed.value)?.body.classes.find(cls => cls.id === 'A')
    const nativeNode = parseClassDiagram(nativeLink.source.split('\n')).classes.find(cls => cls.id === 'A')
    const rendered = renderMermaidWithActions(nativeLink.source, { format: 'svg' })
    if (rendered.format !== 'svg') throw new Error('Class link receipt requires an SVG artifact')
    const verified = verifyMermaid(parsed.value)
    const serialized = serializeMermaid(parsed.value)
    const reparsed = parseRegisteredMermaid(serialized)
    const mutation = mutate(parsed.value, { kind: 'rename_class', from: 'B', to: 'Branch' })
    return {
      agent: { status: 'observed', diagnosticCodes: [], semantics: { href: agentNode?.href ?? null, tooltip: agentNode?.tooltip ?? null } },
      render: { status: 'observed', diagnosticCodes: verified.warnings.map(warning => warning.code),
        semantics: { href: nativeNode?.href ?? null, tooltip: nativeNode?.tooltip ?? null,
          svgTitle: rendered.output.includes(`<title>${tooltip}</title>`),
          sidecarTooltip: rendered.actionSurface.actions.find(action => action.target === 'A')?.tooltip ?? null } },
      serialize: { status: 'observed', diagnosticCodes: [],
        semantics: { stable: reparsed.ok && serializeMermaid(reparsed.value) === serialized,
          href: parseClassDiagram(serialized.split('\n')).classes.find(cls => cls.id === 'A')?.href ?? null,
          tooltip: parseClassDiagram(serialized.split('\n')).classes.find(cls => cls.id === 'A')?.tooltip ?? null } },
      mutate: { status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { ok: mutation.ok, tooltip: mutation.ok ? asClass(mutation.value)?.body.classes.find(cls => cls.id === 'A')?.tooltip ?? null : null } },
    }
  },
}

// Pinned Mermaid also accepts a navigation target. Our inert action model does
// not preserve it, so the broader Interaction heading must stay diagnosed.
const navigationTargetGap: FidelityCaseDefinition = {
  id: 'class.interaction.navigation-target-diagnosed', family: 'class', featureId,
  source: `classDiagram\nclass A\nlink A "${href}" "${tooltip}" _self\n`, upstreamReference, upstreamRevision,
  expected: {
    agent: { applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['UNSUPPORTED_SYNTAX'],
      evaluate: evidence => facts(evidence).kind === 'opaque' ? 'source-preserved' : 'absent' },
    render: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['RENDER_FAILED'],
      evaluate: evidence => facts(evidence).rejected === true ? 'diagnosed' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'source-preserved',
      evaluate: evidence => facts(evidence).exactSource === true ? 'source-preserved' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['INVALID_OP'],
      evaluate: evidence => facts(evidence).rejected === true ? 'diagnosed' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(navigationTargetGap.source)
    if (!parsed.ok) throw new Error('Class link target should retain its source')
    const verified = verifyMermaid(parsed.value)
    let rejected = false
    try { renderMermaidSVG(navigationTargetGap.source) } catch { rejected = true }
    const mutation = mutate(parsed.value, { kind: 'rename_class', from: 'A', to: 'B' })
    return {
      agent: { status: 'observed', diagnosticCodes: verified.warnings.filter(warning => warning.code === 'UNSUPPORTED_SYNTAX').map(warning => warning.code),
        semantics: { kind: parsed.value.body.kind } },
      render: { status: 'observed', diagnosticCodes: verified.warnings.filter(warning => warning.code === 'RENDER_FAILED').map(warning => warning.code),
        semantics: { rejected } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { exactSource: serializeMermaid(parsed.value) === navigationTargetGap.source } },
      mutate: { status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code], semantics: { rejected: !mutation.ok } },
    }
  },
}

export const fidelityCases = [nativeLink, navigationTargetGap] as const satisfies readonly FidelityCaseDefinition[]
