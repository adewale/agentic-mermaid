import { mutate, parseRegisteredMermaid, serializeMermaid, verifyMermaid } from '../../../agent/index.ts'
import { renderMermaidASCIIWithReceipt } from '../../../ascii/index.ts'
import { parsePieChart } from '../../../pie/parser.ts'
import type { FidelityCaseDefinition, FidelityJson, ObservedFidelitySurfaceEvidence } from '../contract.ts'

const source = 'pie\n  "A\\rB" : 1\n'

function facts(evidence: ObservedFidelitySurfaceEvidence): Record<string, FidelityJson> {
  if (!evidence.semantics || typeof evidence.semantics !== 'object' || Array.isArray(evidence.semantics)) {
    throw new Error('Pie terminal-control evidence must be an object')
  }
  return evidence.semantics as Record<string, FidelityJson>
}

const escapedTerminalControl: FidelityCaseDefinition = {
  id: 'pie.syntax.escaped-terminal-control-sanitized', family: 'pie',
  featureId: 'official-doc:pie:section:syntax', source,
  upstreamReference: 'https://mermaid.ai/open-source/syntax/pie.html#syntax',
  upstreamRevision: 'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',
  acceptedDivergence: {
    policy: 'security',
    rationale: 'Terminal output replaces a Pie grammar-produced carriage return with a visible cell rather than moving the terminal cursor.',
    surfaces: ['render'],
  },
  expected: {
    agent: { applicability: 'applicable', disposition: 'source-preserved', diagnosticCodes: ['UNSUPPORTED_SYNTAX'],
      evaluate: evidence => facts(evidence).kind === 'opaque' && facts(evidence).sourceExact === true ? 'source-preserved' : 'absent' },
    render: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['TERMINAL_CONTROL_CHARACTERS_REPLACED'],
      evaluate: evidence => facts(evidence).decodedCr === true && facts(evidence).safeText === true
        && facts(evidence).terminalText === 'A?B  ' ? 'diagnosed' : 'absent' },
    serialize: { applicability: 'applicable', disposition: 'source-preserved',
      evaluate: evidence => facts(evidence).sourceExact === true ? 'source-preserved' : 'absent' },
    mutate: { applicability: 'applicable', disposition: 'diagnosed', diagnosticCodes: ['INVALID_OP'],
      evaluate: evidence => facts(evidence).rejected === true ? 'diagnosed' : 'absent' },
  },
  observe: () => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('Pie escaped-control source should be preserved')
    const serialized = serializeMermaid(parsed.value)
    const verified = verifyMermaid(parsed.value)
    const terminal = renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
    const decodedCr = parsePieChart(source.trim().split('\n')).entries[0]!.label === 'A\rB'
    const mutation = mutate(parsed.value, { kind: 'set_slice_value', label: 'A\rB', value: 2 })
    return {
      agent: { status: 'observed', diagnosticCodes: verified.warnings.map(warning => warning.code),
        semantics: { kind: parsed.value.body.kind, sourceExact: parsed.value.body.kind === 'opaque' && parsed.value.body.source === source } },
      render: { status: 'observed', diagnosticCodes: terminal.terminalStyle.diagnostics.map(item => item.code),
        semantics: {
          decodedCr,
          safeText: !/[\u0000-\u001f\u007f-\u009f]/.test(terminal.text),
          terminalText: terminal.text.slice(0, 5),
        } },
      serialize: { status: 'observed', diagnosticCodes: [], semantics: { sourceExact: serialized === source } },
      mutate: { status: 'observed', diagnosticCodes: mutation.ok ? [] : [mutation.error.code], semantics: { rejected: !mutation.ok } },
    }
  },
}

export const fidelityCases = [escapedTerminalControl] as const satisfies readonly FidelityCaseDefinition[]
