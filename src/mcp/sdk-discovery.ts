import { RESOLVED_SCENE_CAPABILITY } from '../scene/resolved-types.ts'
import { DEFAULT_EXECUTE_OUTPUT_LIMITS } from './execute-limits.ts'
import { SDK_COMMON_CORE_DECLARATIONS, SDK_RESOLVED_SCENE_DECLARATIONS } from './generated/sdk-types.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeOps, opSignatures, type OpFamily } from '../agent/op-schema.ts'
import { CODE_MODE_RESOLVED_SCENE_SUMMARY_DECLARATION, CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS, CODE_MODE_LAYOUT_SUMMARY_DECLARATION, compactSdkDeclaration } from './sdk-decl.ts'
import { PURE_COMPUTE_ANNOTATIONS, type McpToolDefinition } from './tool-surface.ts'
import { sharedRenderOptionsJsonSchema } from '../render-contract.ts'
import { isPlainRecord } from '../shared/plain-data.ts'

export const SDK_FAMILIES = BUILTIN_FAMILY_METADATA.map(family => family.id)
const SDK_FAMILY_SET = new Set<string>(SDK_FAMILIES)
const DIAGRAM_KIND = SDK_FAMILIES.map(family => `'${family}'`).join(' | ')
const NARROWERS = BUILTIN_FAMILY_METADATA.map(family => `'${family.narrower}'`).join('|')

/**
 * The declaration sent with tools/list. Family IR and mutation unions stay out
 * of initial model context; describe_sdk returns the one family schema needed
 * by the task. SDK_DECLARATION remains the full reference used by docs/evals.
 */
export const SDK_CORE_DECLARATION = 'type Fields=Record<string,unknown>\n' + compactSdkDeclaration(`type DiagramKind = ${DIAGRAM_KIND.replaceAll(' | ', '|')}
type MutationOp = { kind: string; [field: string]: unknown }
interface OpFieldDoc { name: string; required: boolean; type: string; note?: string; fields?: OpFieldDoc[] }
type Result<T, E = { code: string; message: string }> = { ok: true; value: T } | { ok: false; error: E }
${SDK_COMMON_CORE_DECLARATIONS}
interface ValidDiagram { readonly kind: DiagramKind; readonly source: SourceMap }
interface ExtensionValidDiagram {
  readonly kind: ExternalFamilyId
  readonly descriptorIdentity: ExtensionIdentity<'family'>
  readonly source: SourceMap
}
interface PreservedValidDiagram {
  readonly kind: ExternalFamilyId
  readonly source: SourceMap
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
type Narrow = (d: ParsedDiagram) => ValidDiagram | null
${CODE_MODE_LAYOUT_SUMMARY_DECLARATION}
${CODE_MODE_RESOLVED_SCENE_SUMMARY_DECLARATION}
interface VerifyResult{ok:boolean;warnings:unknown[];layout:RenderedLayout;checks?:{renderability:'passed'|'failed'|'not-checked';sourceLoss:'detected'|'not-detected';taskCorrectness:'not-checked'}}
type MermaidConfigScalar=string|number|boolean|null
type MermaidConfigValue=MermaidConfigScalar|MermaidConfigValue[]|{[key:string]:MermaidConfigValue|undefined}
type MermaidRuntimeConfig = { [key: string]: MermaidConfigValue | undefined }

${CODE_MODE_CORE_RENDER_OPTION_DECLARATIONS}

declare const mermaid: Record<${NARROWERS}, Narrow> & {
  parseRegisteredMermaid(source: string): Result<ParsedDiagram, ParseError[]>
  createMermaid(kind: DiagramKind, opts?: CreateMermaidOptions): ValidDiagram
  buildMermaid(kind: DiagramKind, ops: MutationOp[], opts?: CreateMermaidOptions): Result<ValidDiagram, { code: string; message: string; opIndex: number }>
  mutate(diagram: ValidDiagram, op: MutationOp): Result<ValidDiagram>
  mutatePreservingSource(d: ParsedDiagram, op: MutationOp): Result<{source:string;diagram:ParsedDiagram;preservation?:{method:'local'|'canonical';reason?:string}}>
  verifyMermaid(input: ParsedDiagram | string, opts?: { suppress?: string[]; labelCharCap?: number; renderOptions?: SharedRenderOptions }): VerifyResult
  analyzeMermaid(diagram: ValidDiagram): Record<string, unknown>
  analyzeMermaidSource(source: string): Result<Record<string, unknown>>
  describeMermaidFacts(diagram: ValidDiagram): string[]
  describeMermaidFactsSource(source: string): Result<string[]>
  checkMermaid(diagram: ValidDiagram, spec: CheckMermaidSpec): CheckMermaidResult
  checkMermaidSource(source: string, spec: CheckMermaidSpec): Result<CheckMermaidResult>
  serializeMermaid(diagram: ParsedDiagram): string
  renderResolvedScene(input: ParsedDiagram | string, opts?: SvgRenderOptions): ResolvedScene
  renderMermaidSVG(input: ParsedDiagram | string, opts?: SvgRenderOptions): string
  renderMermaidSVGWithReceipt(input: ParsedDiagram | string, opts?: SvgRenderOptions): RenderedSvg
  renderMermaidASCII(input: ParsedDiagram | string, opts?: AsciiRenderOptions): string
  renderMermaidASCIIWithReceipt(input: ParsedDiagram | string, opts?: AsciiRenderOptions): RenderedAscii
  layoutMermaidWithReceipt(input: ParsedDiagram | string, opts?: LayoutRenderOptions): RenderedLayoutArtifact
  describeOps(family: DiagramKind): Record<string, OpFieldDoc[]>
  opSignatures(family: DiagramKind): string[]
}`.replace(/^[ \t]+/gm, '').replace(/; +/g, ';').replace(/: +/g, ':')).replaceAll('Record<string,unknown>', 'Fields')

export type DescribeSdkDetail = 'signatures' | 'fields'

/** Read-only capabilities describe_sdk discloses instead of a family. */
export const DESCRIBE_SDK_CAPABILITIES = Object.freeze(['resolved-scene', 'render-options', 'code-mode'] as const)
const DESCRIBE_SDK_CAPABILITY_SET = new Set<string>(DESCRIBE_SDK_CAPABILITIES)

const APPLICABLE_FAMILIES = 'x-agentic-mermaid-applicable-builtin-families'
const TERMINAL = 'x-agentic-mermaid-terminal'
const TERMINAL_NOTE = 'x-agentic-mermaid-terminal-note'

/** `#/$defs/<name>` references reachable from a schema, through the definitions they name. */
function referencedDefinitions(schema: unknown, definitions: Record<string, unknown>, found = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const item of schema) referencedDefinitions(item, definitions, found)
  else if (isPlainRecord(schema)) {
    for (const [keyword, value] of Object.entries(schema)) {
      if (keyword === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
        const name = value.slice('#/$defs/'.length)
        if (!found.has(name) && Object.hasOwn(definitions, name)) {
          found.add(name)
          referencedDefinitions(definitions[name], definitions, found)
        }
      } else referencedDefinitions(value, definitions, found)
    }
  }
  return found
}

/**
 * The annotated render options the compact tools/list schema omits. Without a
 * field: one row per RenderOptions field with its description, the built-in
 * families it applies to and its terminal treatment. With a field: that
 * field's complete annotated schema and the definitions it references.
 */
function renderOptionsPayload(field: unknown): Record<string, unknown> {
  const { $id, properties, $defs } = sharedRenderOptionsJsonSchema() as { $id: string; properties: Record<string, Record<string, unknown>>; $defs: Record<string, unknown> }
  if (field === undefined) {
    return {
      ok: true,
      capability: 'render-options',
      schema: $id,
      hint: 'Pass field for one option\'s full annotated schema.',
      fields: Object.entries(properties).map(([name, schema]) => ({
        name,
        ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
        ...(Array.isArray(schema[APPLICABLE_FAMILIES]) ? { families: schema[APPLICABLE_FAMILIES] } : {}),
        ...(schema[TERMINAL] === undefined ? {} : { terminal: schema[TERMINAL] }),
        ...(schema[TERMINAL_NOTE] === undefined ? {} : { terminalNote: schema[TERMINAL_NOTE] }),
      })),
    }
  }
  if (typeof field !== 'string' || !Object.hasOwn(properties, field)) {
    throw new Error(`describe_sdk field must be one of: ${Object.keys(properties).join(', ')}`)
  }
  const schema = properties[field]!
  const names = [...referencedDefinitions(schema, $defs)]
  return {
    ok: true,
    capability: 'render-options',
    field,
    schema,
    ...(names.length > 0 ? { $defs: Object.fromEntries(names.map(name => [name, $defs[name]])) } : {}),
  }
}

export function createDescribeSdkTool(): McpToolDefinition {
  return {
    name: 'describe_sdk',
    title: 'Describe Mermaid SDK operations',
    description: `Return version-matched mutation operations for one diagram family, or use capability=resolved-scene for painted geometry, runtime limits and typed errors.
Use detail=signatures for the compact op menu or detail=fields (default) for exact
field types, required flags, enum values, defaults, and constraints. Call this
before build, mutate, or execute when the family schema is not already known.
capability=render-options lists each render option's families and terminal notes (field= for one option's full schema);
capability=code-mode returns the execute SDK declaration.`,
    inputSchema: {
      type: 'object',
      properties: {
        capability: { type: 'string', enum: [...DESCRIBE_SDK_CAPABILITIES], description: 'Read-only capability; use instead of family.' },
        family: { type: 'string', enum: [...SDK_FAMILIES], description: 'Diagram family whose mutation operations are needed.' },
        detail: { type: 'string', enum: ['signatures', 'fields'], description: 'signatures for a compact menu; fields for the complete schema (default).' },
        field: { type: 'string', description: 'With capability=render-options: one RenderOptions field name.' },
      },
      oneOf: [{ required: ['family'] }, { required: ['capability'] }],
    },
    annotations: PURE_COMPUTE_ANNOTATIONS,
  }
}

export function describeSdkPayload(args: Record<string, unknown>): Record<string, unknown> {
  if (args.field !== undefined && args.capability !== 'render-options') throw new Error('describe_sdk field applies only to capability=render-options')
  if (args.capability !== undefined) {
    if (typeof args.capability !== 'string' || !DESCRIBE_SDK_CAPABILITY_SET.has(args.capability) || args.family !== undefined) {
      throw new Error(`describe_sdk accepts capability=${DESCRIBE_SDK_CAPABILITIES.join('|')} instead of family`)
    }
    if (args.capability !== 'resolved-scene' && args.detail !== undefined) throw new Error(`describe_sdk detail does not apply to capability=${args.capability}`)
    if (args.capability === 'render-options') return renderOptionsPayload(args.field)
    if (args.capability === 'code-mode') {
      return {
        ok: true,
        capability: 'code-mode',
        hint: 'execute runs synchronous JavaScript with this global mermaid; family IR and op unions come from describe_sdk family=<id>.',
        declaration: SDK_CORE_DECLARATION,
      }
    }
    const detail = args.detail ?? 'fields'
    if (detail !== 'fields' && detail !== 'signatures') throw new Error('describe_sdk detail must be one of: signatures, fields')
    if (detail === 'signatures') return { ok: true, capability: 'resolved-scene', signatures: ['renderResolvedScene(input: ParsedDiagram | string, options?: SvgRenderOptions): ResolvedScene'] }
    return {
      ok: true, capability: 'resolved-scene', ...RESOLVED_SCENE_CAPABILITY,
      codeMode: { defaultMaxResultBytes: DEFAULT_EXECUTE_OUTPUT_LIMITS.maxResultBytes, hint: 'Return only needed parts; hosts may impose a lower result limit.' },
      errors: { code: ['RESOLVED_SCENE_UNSUPPORTED_ARTWORK', 'RESOLVED_SCENE_UNAVAILABLE'], fields: ['code', 'partId', 'feature', 'message'], partId: 'Scene part ID, not source node ID; frame denotes unowned artwork.' },
      declaration: SDK_RESOLVED_SCENE_DECLARATIONS,
    }
  }
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
