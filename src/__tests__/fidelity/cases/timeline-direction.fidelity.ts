import { mutate, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { layoutTimelineDiagram } from '../../../timeline/layout.ts'
import { parseTimelineDiagram } from '../../../timeline/parser.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const upstreamRevision = 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc'
const featureId = 'official-doc:timeline:section:direction-v11-14-0'
const upstreamReference = 'https://mermaid.ai/open-source/syntax/timeline.html#direction-v11-14-0'
const verticalSource = 'timeline TD\n  2020 : Launch\n  2021 : Scale\n'
const unsupportedSource = 'timeline TB\n  2020 : Launch\n'

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  const value = evidence.semantics
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Timeline direction evidence must be an object')
  return value as Record<string, FidelityJson>
}

function parsedOrThrow(source: string) {
  const result = parseRegisteredMermaid(source)
  if (!result.ok) throw new Error(`Timeline direction parse failed: ${result.error.map(error => error.code).join(', ')}`)
  return result.value
}

const verticalDirection: FidelityCaseDefinition = {
  id: 'timeline.direction.td-vertical-geometry',
  family: 'timeline', featureId, source: verticalSource, upstreamReference, upstreamRevision,
  expected: {
    agent: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.kind === 'timeline' && value.direction === 'TD' && JSON.stringify(value.periods) === JSON.stringify(['2020', '2021']) ? 'native' : 'absent'
      },
    },
    render: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.direction === 'TD' && value.verticalRail === true && value.periodsAdvanceDown === true && value.visibleLabels === true ? 'native' : 'absent'
      },
    },
    serialize: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.direction === 'TD' && value.stable === true ? 'native' : 'absent'
      },
    },
    mutate: {
      applicability: 'applicable', disposition: 'native',
      evaluate: evidence => {
        const value = facts(evidence)
        return value.ok === true && value.direction === 'TD' && value.changedEvent === 'Scaled' ? 'native' : 'absent'
      },
    },
  },
  observe: () => {
    const parsed = parsedOrThrow(verticalSource)
    const native = parseTimelineDiagram(verticalSource.trim().split('\n').map(line => line.trim()))
    const positioned = layoutTimelineDiagram(native)
    const markers = positioned.sections.flatMap(section => section.periods.map(period => period.markerY))
    const svg = renderMermaidSVG(verticalSource)
    const serialized = serializeMermaid(parsed)
    const reparsed = parsedOrThrow(serialized)
    const mutation = mutate(parsed, { kind: 'set_event_text', sectionIndex: 0, periodIndex: 1, eventIndex: 0, text: 'Scaled' })
    const changed = mutation.ok ? parseTimelineDiagram(serializeMermaid(mutation.value).trim().split('\n').map(line => line.trim())) : null
    return {
      agent: {
        status: 'observed', diagnosticCodes: [],
        semantics: {
          kind: parsed.body.kind,
          direction: parsed.body.kind === 'timeline' ? parsed.body.direction ?? null : null,
          periods: parsed.body.kind === 'timeline' ? parsed.body.sections.flatMap(section => section.periods.map(period => period.label)) : [],
        },
      },
      render: {
        status: 'observed', diagnosticCodes: [],
        semantics: {
          direction: native.direction ?? null,
          verticalRail: positioned.rail.x1 === positioned.rail.x2 && positioned.rail.y2 > positioned.rail.y1,
          periodsAdvanceDown: markers.length === 2 && markers[1]! > markers[0]!,
          visibleLabels: svg.includes('Launch') && svg.includes('Scale'),
        },
      },
      serialize: {
        status: 'observed', diagnosticCodes: [],
        semantics: {
          direction: reparsed.body.kind === 'timeline' ? reparsed.body.direction ?? null : null,
          stable: serialized.startsWith('timeline TD\n') && serializeMermaid(reparsed) === serialized,
        },
      },
      mutate: {
        status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: {
          ok: mutation.ok,
          direction: changed?.direction ?? null,
          changedEvent: changed?.sections[0]?.periods[1]?.events[0]?.text ?? null,
        },
      },
    }
  },
}

const unsupportedDirection: FidelityCaseDefinition = {
  id: 'timeline.direction.unsupported-header-diagnosis',
  family: 'timeline', featureId, source: unsupportedSource, upstreamReference, upstreamRevision,
  expected: {
    agent: {
      applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['UNSUPPORTED_SYNTAX'],
      evaluate: evidence => {
        const value = facts(evidence)
        return value.kind === 'opaque' && value.specificHeaderWarning === true ? 'source-preserved' : 'absent'
      },
    },
    render: {
      applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['RENDER_FAILED'],
      evaluate: evidence => {
        const value = facts(evidence)
        return value.rejected === true && value.verifyRejected === true ? 'diagnosed' : 'absent'
      },
    },
    serialize: {
      applicability: 'applicable', disposition: 'source-preserved',
      evaluate: evidence => facts(evidence).exactSource === true ? 'source-preserved' : 'absent',
    },
    mutate: {
      applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['INVALID_OP'],
      evaluate: evidence => facts(evidence).rejectedOpaqueMutation === true ? 'diagnosed' : 'absent',
    },
  },
  observe: () => {
    const parsed = parsedOrThrow(unsupportedSource)
    const verified = verifyMermaid(parsed)
    const specificHeaderWarning = verified.warnings.some(warning => warning.code === 'UNSUPPORTED_SYNTAX' && warning.syntax === 'timeline_header_direction')
    const verifyRejected = !verified.ok && verified.warnings.some(warning => warning.code === 'RENDER_FAILED')
    let renderError = ''
    try { renderMermaidSVG(unsupportedSource) } catch (error) { renderError = error instanceof Error ? error.message : String(error) }
    const mutation = mutate(parsed, { kind: 'set_event_text', sectionIndex: 0, periodIndex: 0, eventIndex: 0, text: 'Changed' })
    return {
      agent: {
        status: 'observed', diagnosticCodes: specificHeaderWarning ? ['UNSUPPORTED_SYNTAX'] : [],
        semantics: { kind: parsed.body.kind, specificHeaderWarning },
      },
      render: {
        status: 'observed', diagnosticCodes: verifyRejected ? ['RENDER_FAILED'] : [],
        semantics: { rejected: renderError.includes('Unsupported timeline header suffix "TB"'), verifyRejected },
      },
      serialize: {
        status: 'observed', diagnosticCodes: [],
        semantics: { exactSource: serializeMermaid(parsed) === unsupportedSource },
      },
      mutate: {
        status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code],
        semantics: { rejectedOpaqueMutation: !mutation.ok && mutation.error.code === 'INVALID_OP' },
      },
    }
  },
}

export const fidelityCases = [verticalDirection, unsupportedDirection]
