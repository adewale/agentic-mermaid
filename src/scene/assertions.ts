// Our own Scene lowering derives some facts twice, such as a connector's
// terminal projection from its semantics (mark SVG is not among them: the
// writer draws it from the fields). Re-deriving and comparing them on every
// render costs a measurable share of a render, and only a lowering bug can
// make them disagree, so these cross-checks run where such bugs are caught or
// where a caller asked for the strongest evidence: in the unit tests (their
// preload sets AGENTIC_MERMAID_SCENE_ASSERTIONS=1), for the requests verify
// lowers, for `layoutSafety: 'strict'`, for the connector Scene ASCII draws
// from, and on request with that variable. Scenes from `family:` extensions
// are always checked in full, and the final output-security gate always
// inspects the bytes a render emits. Marks live on the request rather than in
// a scope, so a verify cut short (a sandbox timeout skips `finally`) cannot
// leave them on.

import type { ResolvedRenderRequest } from '../render-contract.ts'

const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const enabledByEnvironment = environment?.AGENTIC_MERMAID_SCENE_ASSERTIONS === '1'
const assertedRequests = new WeakSet<ResolvedRenderRequest>()

/** Cross-check every built-in Scene lowered for `request`, as verify does. */
export function assertScenesOf(request: ResolvedRenderRequest): void {
  assertedRequests.add(request)
}

/** Whether a built-in Scene lowered for `request` is cross-checked at admission. */
export function sceneAssertionsEnabled(request?: ResolvedRenderRequest): boolean {
  return enabledByEnvironment || (request !== undefined && (assertedRequests.has(request) || request.renderOptions.layoutSafety === 'strict'))
}
