import type { RenderRequestReceipt } from '../../render-contract.ts'
import type { RenderOptions } from '../../types.ts'

/**
 * One JSON-safe request used by every public-surface Section A sentinel.
 * Keep this fixture representable by the editor as well as programmatic hosts:
 * its security/font policy is editor-owned, while the remaining fields pass
 * through the editor's canonical RenderOptions projection.
 */
export const SECTION_A_TRANSPORT_FIXTURE = Object.freeze({
  source: 'flowchart LR\n  A[Start] -->|ships| B[Finish]',
  options: Object.freeze({
    style: ['hand-drawn', 'paper'],
    seed: 17,
    padding: 24,
    embedFontImport: false,
    security: 'strict',
  } satisfies RenderOptions),
})

/**
 * The exact receipt fields that must survive transport. Keeping this projection
 * beside the request prevents individual surface tests from quietly comparing
 * only whichever digest they happen to expose.
 */
export function sectionATransportReceiptProjection(receipt: RenderRequestReceipt) {
  return {
    output: receipt.output,
    sharedRequestDigest: receipt.sharedRequestDigest,
    requestDigest: receipt.requestDigest,
    appearanceDigest: receipt.appearanceDigest,
    diagnostics: receipt.diagnostics ?? [],
    capabilityDecision: receipt.capabilityDecision,
    executionDecision: receipt.executionDecision ?? null,
    graphicalProjectionDigest: receipt.graphicalProjectionDigest ?? null,
  }
}
