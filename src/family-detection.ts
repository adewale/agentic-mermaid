import {
  detectRegisteredFamilyFromFirstLine,
} from './agent/families.ts'
import type { FamilyId, SourcePreservationReceipt } from './agent/types.ts'
import {
  findUpstreamFamilyByHeader,
  UPSTREAM_MERMAID_FAMILY_INDEX,
  type UpstreamHeaderMatch,
} from './upstream-family-index.ts'

export type MermaidFamilyClassification =
  | { kind: 'registered'; familyId: FamilyId }
  | { kind: 'upstream'; match: UpstreamHeaderMatch }
  | { kind: 'unknown'; header: string }

export interface FamilyDetectionDiagnostic {
  code: 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER' | 'FAMILY_DESCRIPTOR_MISMATCH'
  message: string
  line: 1
  preservation: SourcePreservationReceipt
  help: string
}

export function classifyMermaidFamilyFromFirstLine(
  firstLine: string,
  mode: 'strict' | 'loose' = 'strict',
): MermaidFamilyClassification {
  const registered = detectRegisteredFamilyFromFirstLine(firstLine, mode)
  if (registered) return { kind: 'registered', familyId: registered }
  const upstream = findUpstreamFamilyByHeader(firstLine)
  if (upstream) return { kind: 'upstream', match: upstream }
  return { kind: 'unknown', header: firstLine }
}

export function familyDetectionDiagnostic(
  classification: Exclude<MermaidFamilyClassification, { kind: 'registered' }>,
  source: string,
): FamilyDetectionDiagnostic {
  const mermaidVersion = UPSTREAM_MERMAID_FAMILY_INDEX.provenance.version
  if (classification.kind === 'unknown') {
    return {
      code: 'UNKNOWN_HEADER',
      message: `Unrecognized Mermaid header: "${classification.header}"`,
      line: 1,
      preservation: {
        version: 1,
        classification: 'unknown',
        source,
        header: classification.header,
        mermaidVersion,
      },
      help: 'Check for a Mermaid upgrade or register a namespaced family descriptor; the source was preserved unchanged.',
    }
  }

  const { family, header } = classification.match
  const preservationClass = header.agenticStatus === 'inventory-only' ? 'inventory-only' : 'unsupported'
  const nativeMismatch = header.agenticStatus === 'native'
  return {
    code: nativeMismatch ? 'FAMILY_DESCRIPTOR_MISMATCH' : 'UNSUPPORTED_FAMILY',
    message: nativeMismatch
      ? `Mermaid ${mermaidVersion} header "${header.value}" is marked native but no installed family descriptor claimed it`
      : `Mermaid ${mermaidVersion} family "${family.id}" is ${preservationClass} in Agentic Mermaid`,
    line: 1,
    preservation: {
      version: 1,
      classification: preservationClass,
      source,
      header: header.value,
      upstreamFamilyId: family.id,
      mermaidVersion,
    },
    help: nativeMismatch
      ? 'Report a descriptor/manifest mismatch; the source was preserved unchanged.'
      : `Install a family descriptor for "${header.value}" or use a currently native family; the source was preserved unchanged.`,
  }
}

export class MermaidFamilyDetectionError extends Error {
  readonly name = 'MermaidFamilyDetectionError'
  readonly code: FamilyDetectionDiagnostic['code']
  readonly line: 1
  readonly preservation: SourcePreservationReceipt
  readonly help: string

  constructor(diagnostic: FamilyDetectionDiagnostic) {
    super(diagnostic.message)
    this.code = diagnostic.code
    this.line = diagnostic.line
    this.preservation = diagnostic.preservation
    this.help = diagnostic.help
  }

  toJSON(): FamilyDetectionDiagnostic {
    return {
      code: this.code,
      message: this.message,
      line: this.line,
      preservation: this.preservation,
      help: this.help,
    }
  }
}

export function requireRegisteredMermaidFamily(
  firstLine: string,
  source: string,
  mode: 'strict' | 'loose' = 'strict',
): FamilyId {
  const classification = classifyMermaidFamilyFromFirstLine(firstLine, mode)
  if (classification.kind === 'registered') return classification.familyId
  throw new MermaidFamilyDetectionError(familyDetectionDiagnostic(classification, source))
}
