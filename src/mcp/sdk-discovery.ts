import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeOps, opSignatures, type OpFamily } from '../agent/op-schema.ts'
import { CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS } from './sdk-decl.ts'
import { PURE_COMPUTE_ANNOTATIONS, type McpToolDefinition } from './tool-surface.ts'

export const SDK_FAMILIES = BUILTIN_FAMILY_METADATA.map(family => family.id)
const SDK_FAMILY_SET = new Set<string>(SDK_FAMILIES)
const DIAGRAM_KIND = SDK_FAMILIES.map(family => `'${family}'`).join(' | ')
const NARROWERS = BUILTIN_FAMILY_METADATA
  .map(family => `  ${family.narrower}(diagram: ValidDiagram): ValidDiagram | null`)
  .join('\n')

/**
 * The declaration sent with tools/list. Family IR and mutation unions stay out
 * of initial model context; describe_sdk returns the one family schema needed
 * by the task. SDK_DECLARATION remains the full reference used by docs/evals.
 */
export const SDK_CORE_DECLARATION = `// Core Agentic Mermaid SDK available as global mermaid. Calls are synchronous and pure.
type DiagramKind = ${DIAGRAM_KIND}
type MutationOp = { kind: string; [field: string]: unknown }
type Result<T, E = { code: string; message: string }> = { ok: true; value: T } | { ok: false; error: E }
interface ValidDiagram { readonly kind: DiagramKind }
type ExternalFamilyId = \`family:\${string}\`
interface ExtensionCompatibility {
  readonly [contract: string]: string | undefined
  readonly core?: string
  readonly scene?: string
}
interface ExtensionProvenance { readonly owner: string; readonly source: string; readonly reference?: string }
interface ExtensionIdentity<Kind extends string = string> {
  readonly id: \`\${Kind}:\${string}\`
  readonly kind: Kind
  readonly version: string
  readonly compatibility: ExtensionCompatibility
  readonly provenance: ExtensionProvenance
}
interface SourceSpanPoint { readonly offset: number; readonly line: number; readonly col: number }
interface SourceSpan { readonly start: SourceSpanPoint; readonly end: SourceSpanPoint }
interface PreservedSourceSpans {
  readonly source: SourceSpan
  readonly wrapper?: SourceSpan
  readonly header: SourceSpan
  readonly body: SourceSpan
}
interface SourcePreservationReceipt {
  readonly version: 1
  readonly classification: 'unsupported' | 'inventory-only' | 'unknown'
  readonly source: string
  readonly header: string
  readonly upstreamFamilyId?: string
  readonly mermaidVersion: string
  readonly spans?: PreservedSourceSpans
}
interface ParseError {
  readonly code: string
  readonly message: string
  readonly line?: number
  readonly col?: number
  readonly preservation?: SourcePreservationReceipt
  readonly help?: string
}
interface ExtensionValidDiagram {
  readonly kind: ExternalFamilyId
  readonly descriptorIdentity: ExtensionIdentity<'family'>
}
interface PreservedValidDiagram {
  readonly kind: ExternalFamilyId
  readonly body: {
    readonly kind: 'preserved'
    readonly representation: 'opaque' | 'unknown'
    readonly source: string
    readonly preservation: SourcePreservationReceipt
    readonly spans: PreservedSourceSpans
    readonly diagnostic: {
      readonly code: 'UNSUPPORTED_FAMILY' | 'UNKNOWN_HEADER' | 'FAMILY_DESCRIPTOR_MISMATCH'
      readonly message: string
      readonly help: string
    }
  }
}
type ParsedDiagram = ValidDiagram | ExtensionValidDiagram | PreservedValidDiagram
interface VerifyResult { ok: boolean; warnings: unknown[]; layout: { bounds: unknown; nodes: unknown[]; edges: unknown[] } }
type CheckMermaidSpec = string[] | { include?: string[]; exclude?: string[]; exact?: boolean }
interface CheckMermaidResult { ok: boolean; missing: string[]; unexpected: string[]; facts: string[] }
type MermaidConfigScalar = string | number | boolean | null
type MermaidConfigValue = MermaidConfigScalar | MermaidConfigValue[] | { [key: string]: MermaidConfigValue | undefined }
type MermaidRuntimeConfig = { [key: string]: MermaidConfigValue | undefined }

${CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS}

declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, ParseError[]>
  // Open parser for installed families; built-in authoring ops remain ValidDiagram-only.
  parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]>
  createMermaid(kind: DiagramKind, opts?: { direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }): ValidDiagram
  buildMermaid(kind: DiagramKind, ops: MutationOp[], opts?: { direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }): Result<ValidDiagram, { code: string; message: string; opIndex: number }>
${NARROWERS}
  mutate(diagram: ValidDiagram, op: MutationOp): Result<ValidDiagram>
  verifyMermaid(input: ParsedDiagram | string, opts?: { suppress?: string[]; labelCharCap?: number; renderOptions?: SharedRenderOptions }): VerifyResult
  analyzeMermaid(diagram: ValidDiagram): Record<string, unknown>
  analyzeMermaidSource(source: string): Result<Record<string, unknown>>
  describeMermaidFacts(diagram: ValidDiagram): string[]
  describeMermaidFactsSource(source: string): Result<string[]>
  checkMermaid(diagram: ValidDiagram, spec: CheckMermaidSpec): CheckMermaidResult
  checkMermaidSource(source: string, spec: CheckMermaidSpec): Result<CheckMermaidResult>
  serializeMermaid(diagram: ParsedDiagram): string
  renderMermaidSVG(input: ParsedDiagram | string, opts?: SvgRenderOptions): string
  renderMermaidSVGWithReceipt(input: ParsedDiagram | string, opts?: SvgRenderOptions): RenderedSvg
  renderMermaidASCII(input: ParsedDiagram | string, opts?: AsciiRenderOptions): string
  renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, opts?: AsciiRenderOptions): RenderedAscii
  layoutMermaidWithReceipt(input: ParsedDiagram | string, opts?: LayoutRenderOptions): RenderedLayoutArtifact
  describeOps(family: DiagramKind): Record<string, { name: string; required: boolean; type: string; note?: string }[]>
  opSignatures(family: DiagramKind): string[]
}`

export type DescribeSdkDetail = 'signatures' | 'fields'

export function createDescribeSdkTool(): McpToolDefinition {
  return {
    name: 'describe_sdk',
    description: `Return version-matched mutation operations for one diagram family.
Use detail=signatures for the compact op menu or detail=fields (default) for exact
field types, required flags, enum values, defaults, and constraints. Call this
before build, mutate, or execute when the family schema is not already known.`,
    inputSchema: {
      type: 'object',
      properties: {
        family: { type: 'string', enum: [...SDK_FAMILIES], description: 'Diagram family whose mutation operations are needed.' },
        detail: { type: 'string', enum: ['signatures', 'fields'], description: 'signatures for a compact menu; fields for the complete schema (default).' },
      },
      required: ['family'],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  }
}

export function describeSdkPayload(args: Record<string, unknown>): Record<string, unknown> {
  const family = args.family
  if (typeof family !== 'string' || !SDK_FAMILY_SET.has(family)) {
    throw new Error(`describe_sdk family must be one of: ${SDK_FAMILIES.join(', ')}`)
  }
  const detail = args.detail ?? 'fields'
  if (detail !== 'signatures' && detail !== 'fields') {
    throw new Error('describe_sdk detail must be one of: signatures, fields')
  }
  if (detail === 'signatures') {
    return { ok: true, family, detail, signatures: opSignatures(family as OpFamily) }
  }
  return { ok: true, family, detail, ops: describeOps(family as OpFamily) }
}
