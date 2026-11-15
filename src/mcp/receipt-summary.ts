// Opt-in compact projection of a render receipt for MCP tool results. The full
// receipt stays the default; `receipt: "summary"` keeps what an agent branches
// on (the request identity, acceptance, any capability that was not selected,
// the layout certification verdict) and collapses diagnostics that differ only
// in the element they name into one entry with a count.
import type { RenderArtifactDiagnostic, RenderRequestReceipt } from '../render-contract.ts'
import type { CapabilityResolution } from '../capability-negotiation.ts'
import type { GraphLayoutDecision } from '../layout/backend.ts'

export const MCP_RENDER_RECEIPT_MODES = Object.freeze(['full', 'summary'] as const)
export type McpRenderReceiptMode = typeof MCP_RENDER_RECEIPT_MODES[number]

/** The advertised `receipt` argument shared by every MCP render tool. */
export function mcpRenderReceiptProperty(): Record<string, unknown> {
  return {
    type: 'string',
    enum: [...MCP_RENDER_RECEIPT_MODES],
    description: 'full (default) or summary: digest, acceptance, unselected capabilities, certification verdict, diagnostics grouped by code.',
  }
}

export interface RenderReceiptSummary {
  readonly view: 'summary'
  readonly version: RenderRequestReceipt['version']
  readonly output: RenderRequestReceipt['output']
  readonly requestDigest: string
  readonly accepted: boolean
  /** Only resolutions whose status is not `selected`; absent when all were. */
  readonly capabilityResolutions?: readonly CapabilityResolution[]
  /** Only graph layout decisions that did not select the requested backend. */
  readonly layoutDecisions?: readonly GraphLayoutDecision[]
  readonly layoutCertification?: { readonly status: string; readonly issues: readonly unknown[]; readonly geometry?: unknown }
  /** Diagnostics that are identical apart from `feature`/`cell`, once each, with how many there were. */
  readonly diagnostics?: readonly (Omit<RenderArtifactDiagnostic, 'feature'> & { readonly count: number })[]
}

/** Diagnostics identical except for the element they locate become one entry. */
function groupedDiagnostics(diagnostics: readonly RenderArtifactDiagnostic[]): (Omit<RenderArtifactDiagnostic, 'feature'> & { count: number })[] {
  const groups = new Map<string, Omit<RenderArtifactDiagnostic, 'feature'> & { count: number }>()
  for (const diagnostic of diagnostics) {
    const { feature: _feature, cell: _cell, ...shared } = diagnostic as RenderArtifactDiagnostic & { cell?: unknown }
    const key = JSON.stringify(shared)
    const group = groups.get(key)
    if (group) group.count++
    else groups.set(key, { ...shared, count: 1 })
  }
  return [...groups.values()]
}

export function summarizeRenderReceipt(receipt: RenderRequestReceipt): RenderReceiptSummary {
  const unselected = receipt.capabilityDecision.resolutions.filter(resolution => resolution.status !== 'selected')
  const fallbacks = (receipt.layoutDecisions ?? []).filter(decision => decision.selected !== decision.requested)
  const certification = receipt.layoutCertification as { status: string; issues: readonly unknown[]; geometry?: unknown } | undefined
  const diagnostics = receipt.diagnostics ?? []
  return {
    view: 'summary',
    version: receipt.version,
    output: receipt.output,
    requestDigest: receipt.requestDigest,
    accepted: receipt.capabilityDecision.accepted,
    ...(unselected.length > 0 ? { capabilityResolutions: unselected } : {}),
    ...(fallbacks.length > 0 ? { layoutDecisions: fallbacks } : {}),
    ...(certification ? {
      layoutCertification: {
        status: certification.status,
        issues: certification.issues,
        ...(certification.geometry === undefined ? {} : { geometry: certification.geometry }),
      },
    } : {}),
    ...(diagnostics.length > 0 ? { diagnostics: groupedDiagnostics(diagnostics) } : {}),
  }
}

/** The receipt a render tool returns for its validated `receipt` argument. */
export function mcpRenderReceipt(receipt: RenderRequestReceipt, args: Readonly<Record<string, unknown>>): RenderRequestReceipt | RenderReceiptSummary {
  return args.receipt === 'summary' ? summarizeRenderReceipt(receipt) : receipt
}
