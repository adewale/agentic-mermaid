import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { describeOps, opSignatures, type OpFamily } from '../agent/op-schema.ts'
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
interface VerifyResult { ok: boolean; warnings: unknown[]; layout: { bounds: unknown; nodes: unknown[]; edges: unknown[] } }
type CheckMermaidSpec = string[] | { include?: string[]; exclude?: string[]; exact?: boolean }
interface CheckMermaidResult { ok: boolean; missing: string[]; unexpected: string[]; facts: string[] }
interface RenderRequestReceipt {
  version: 1
  output: 'svg' | 'png' | 'ascii' | 'unicode' | 'html' | 'layout'
  sharedRequestDigest: string
  requestDigest: string
  appearanceDigest: string
  diagnostics?: readonly { code: string; message?: string; reference?: string; feature?: string }[]
}
interface RenderedSvg { svg: string; receipt: RenderRequestReceipt }
interface RenderedAscii {
  text: string
  receipt: RenderRequestReceipt
  terminalStyle: Record<string, unknown>
  outputPolicy: Record<string, unknown>
}
interface RenderedLayoutArtifact { layout: Record<string, unknown>; receipt: RenderRequestReceipt }

declare const mermaid: {
  parseMermaid(source: string): Result<ValidDiagram, { code: string; message: string }[]>
  createMermaid(kind: DiagramKind, opts?: { direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }): ValidDiagram
  buildMermaid(kind: DiagramKind, ops: MutationOp[], opts?: { direction?: 'TD' | 'TB' | 'LR' | 'BT' | 'RL' }): Result<ValidDiagram, { code: string; message: string; opIndex: number }>
${NARROWERS}
  mutate(diagram: ValidDiagram, op: MutationOp): Result<ValidDiagram>
  verifyMermaid(input: ValidDiagram | string, opts?: { suppress?: string[]; labelCharCap?: number }): VerifyResult
  analyzeMermaid(diagram: ValidDiagram): Record<string, unknown>
  analyzeMermaidSource(source: string): Result<Record<string, unknown>>
  describeMermaidFacts(diagram: ValidDiagram): string[]
  describeMermaidFactsSource(source: string): Result<string[]>
  checkMermaid(diagram: ValidDiagram, spec: CheckMermaidSpec): CheckMermaidResult
  checkMermaidSource(source: string, spec: CheckMermaidSpec): Result<CheckMermaidResult>
  serializeMermaid(diagram: ValidDiagram): string
  renderMermaidSVG(input: ValidDiagram | string, opts?: Record<string, unknown>): string
  renderMermaidSVGWithReceipt(input: ValidDiagram | string, opts?: Record<string, unknown>): RenderedSvg
  renderMermaidASCII(input: ValidDiagram | string, opts?: { useAscii?: boolean; maxWidth?: number; targetWidth?: number; ganttToday?: string; mermaidConfig?: Record<string, unknown> }): string
  renderMermaidASCIIWithReceipt(input: ValidDiagram | string, opts?: { useAscii?: boolean; maxWidth?: number; targetWidth?: number; ganttToday?: string; mermaidConfig?: Record<string, unknown> }): RenderedAscii
  layoutMermaidWithReceipt(input: ValidDiagram | string, opts?: Record<string, unknown>): RenderedLayoutArtifact
  describeOps(family: DiagramKind): Record<string, { name: string; required: boolean; type: string; note?: string }[]>
  opSignatures(family: DiagramKind): string[]
}

// For unfamiliar MutationOp objects, call the direct MCP describe_sdk tool before execute/build/mutate.
// Inside execute, mermaid.describeOps and mermaid.opSignatures expose the same version-matched data.
// Existing diagrams: parse, narrow, mutate, verify, serialize. New diagrams: buildMermaid, or author source for syntax the typed ops do not model, then parse and verify.`

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
