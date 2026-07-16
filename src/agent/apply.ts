// ============================================================================
// apply: the declarative, plain-JSON edit surface — the shape a hosted MCP
// `mutate`/`build` tool and the CLI expose, and the counterpart to the Code
// Mode `execute` path. Where `execute` hands an LLM the raw typed SDK behind a
// sandbox, this hands it a validated op list and one canonical result DTO.
//
// Three jobs, one shared core (mutateChecked):
//   - buildChecked(): author from blank — createMermaid then fold mutateChecked
//     over the ops. Validates shape; same Result shape as buildMermaid.
//   - applyOps(): the batch entrypoint — parse `source` (edit) or `family`
//     (build), fold the ops, and return ONE canonical OpEnvelope: always
//     `{ok, …}`, always plain JSON (no Result-vs-plain split, no provenance
//     proxy, no Map), so a caller reads success and failure the same way.
//
// Both entrypoints, the Code Mode facade, and the CLI funnel op application
// through mutateChecked — there is no second validator to drift from.
// ============================================================================

import { parseRegisteredMermaid } from './parse.ts'
import { serializeMermaid } from './serialize.ts'
import { createMermaid, type CreateMermaidOptions } from './create.ts'
import { mutateChecked } from './mutate.ts'
import { verifyMermaid } from './verify.ts'
import { hasOpSchema, type OpFamily, type OpValidationError } from './op-schema.ts'
import type { MutableValidDiagram, VerifyResult, DiagramKind, MutationError, Result } from './types.ts'
import { ok, err } from './types.ts'

// ---- Canonical result envelope --------------------------------------------

/** A verify summary reduced to plain JSON (no RenderedLayout proxy graph). */
export interface VerifySummary {
  ok: boolean
  warnings: VerifyResult['warnings']
}

/** A mutation failure annotated with which op in the list failed. */
export type CheckedBuildError = MutationError & { opIndex: number }

/**
 * THE single output DTO for the declarative surface. Success and failure share
 * one shape: `ok` discriminates. Every field is plain JSON — safe to return
 * straight out as an MCP tool result and safe to JSON round-trip: no
 * `{ok,value}`-vs-plain split, no provenance proxy, no Map.
 */
export type OpEnvelope =
  | {
      ok: true
      family: DiagramKind
      /** canonical Mermaid source of the mutated diagram */
      source: string
      verify: VerifySummary
    }
  | {
      ok: false
      family: OpFamily | DiagramKind | null
      /** index of the failing op within the batch, when the failure is op-scoped */
      opIndex?: number
      error: OpValidationError | { code: string; message: string; details?: unknown }
    }

/** Drop the layout proxy graph; keep the model-actionable verdict. The JSON
 *  round-trip guarantees no residual Map / prototype leaks through. */
export function verifySummary(v: VerifyResult): VerifySummary {
  return JSON.parse(JSON.stringify({ ok: v.ok, warnings: v.warnings }))
}

// ---- Blank-slate build through the checked core ---------------------------

function snapshotOpArray(value: unknown): { ok: true; value: unknown[] } | { ok: false } {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return { ok: false }
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>
    const length = descriptors.length?.value
    if (!Number.isSafeInteger(length) || length < 0) return { ok: false }
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key === 'symbol'
      || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))) return { ok: false }
    const snapshot: unknown[] = []
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[String(index)]
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return { ok: false }
      snapshot.push(descriptor.value)
    }
    return { ok: true, value: snapshot }
  } catch {
    return { ok: false }
  }
}

/**
 * buildMermaid's contract (createMermaid → fold ops) with the shape check in
 * front of every op. Same Result shape as buildMermaid, so it is a drop-in for
 * the untyped build path (Code Mode facade `buildMermaid`, declarative `build`).
 */
export function buildChecked(kind: DiagramKind, ops: unknown[], opts?: CreateMermaidOptions): Result<MutableValidDiagram, CheckedBuildError> {
  const admitted = snapshotOpArray(ops)
  if (!admitted.ok) {
    return err({ code: 'INVALID_OP', message: '`ops` must be an array of op objects', opIndex: -1 })
  }
  const checkedOps = admitted.value
  let d: MutableValidDiagram
  try {
    d = createMermaid(kind, opts)
  } catch (e) {
    return err({ code: 'INVALID_OP', message: e instanceof Error ? e.message : String(e), opIndex: -1 })
  }
  for (let i = 0; i < checkedOps.length; i++) {
    const r = mutateChecked(d, checkedOps[i])
    if (!r.ok) {
      let kindLabel: unknown
      try { kindLabel = (checkedOps[i] as { kind?: unknown } | null)?.kind } catch {}
      return err({ ...r.error, opIndex: i, message: `op[${i}]${typeof kindLabel === 'string' ? ` (${kindLabel})` : ''}: ${r.error.message}` })
    }
    d = r.value
  }
  return ok(d)
}

// ---- Declarative batch entrypoint -----------------------------------------

export interface ApplyOpsInput {
  /** Existing Mermaid `source` to edit, OR `family` to author from blank. */
  source?: string
  family?: string
  ops: unknown
}

/**
 * Plain-JSON-in / plain-JSON-out batch edit. Fail-fast, all-or-nothing: ops
 * apply in order over a working copy; the first invalid or semantically-rejected
 * op stops the batch and reports its index — nothing is committed (the input
 * `source` is untouched, mirroring buildMermaid). Returns the canonical envelope.
 */
export function applyOps(input: ApplyOpsInput): OpEnvelope {
  let source: unknown
  let family: unknown
  let ops: unknown
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, family: null, error: { code: 'INVALID_OP', message: 'applyOps input must be a plain object' } }
    }
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, family: null, error: { code: 'INVALID_OP', message: 'applyOps input must be a plain object' } }
    }
    ;({ source, family, ops } = input)
  } catch {
    return { ok: false, family: null, error: { code: 'INVALID_OP', message: 'applyOps input must be a readable plain object' } }
  }

  const admittedOps = snapshotOpArray(ops)
  if (!admittedOps.ok) {
    return { ok: false, family: (typeof family === 'string' && hasOpSchema(family)) ? family : null, error: { code: 'INVALID_OP', message: '`ops` must be an array of op objects' } }
  }
  const checkedOps = admittedOps.value
  if (source !== undefined && typeof source !== 'string') {
    return { ok: false, family: null, error: { code: 'INVALID_OP', message: '`source` must be a string when provided' } }
  }
  if (family !== undefined && typeof family !== 'string') {
    return { ok: false, family: null, error: { code: 'INVALID_OP', message: '`family` must be a string when provided' } }
  }
  if (typeof source === 'string' && typeof family === 'string') {
    return { ok: false, family: hasOpSchema(family) ? family : null, error: { code: 'INVALID_OP', message: 'applyOps accepts either `source` or `family`, not both' } }
  }

  let d: MutableValidDiagram

  if (typeof source === 'string' && source.trim().length > 0) {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) {
      const primary = parsed.error[0]
      return {
        ok: false,
        family: null,
        error: {
          code: primary?.code ?? 'PARSE_ERROR',
          message: parsed.error.map(e => e.message).join('; ') || 'could not parse source',
        },
      }
    }
    d = parsed.value as MutableValidDiagram
    if (!hasOpSchema(d.kind)) {
      return { ok: false, family: d.kind, error: { code: 'INVALID_OP', message: `family "${d.kind}" has no structured ops; edit it as source text` } }
    }
    if (checkedOps.length === 0) {
      return { ok: false, family: d.kind, error: { code: 'INVALID_OP', message: '`ops` must contain at least one op object' } }
    }
  } else if (typeof family === 'string') {
    if (!hasOpSchema(family)) {
      return { ok: false, family: null, error: { code: 'INVALID_OP', message: `unknown family "${family}"` } }
    }
    if (checkedOps.length === 0) {
      return { ok: false, family, error: { code: 'INVALID_OP', message: '`ops` must contain at least one op object' } }
    }
    const built = buildChecked(family, checkedOps)
    if (!built.ok) {
      const { opIndex, ...error } = built.error
      return { ok: false, family, opIndex: opIndex >= 0 ? opIndex : undefined, error }
    }
    return verifiedEnvelope(built.value)
  } else {
    return { ok: false, family: null, error: { code: 'INVALID_OP', message: 'applyOps requires either `source` (to edit) or `family` (to build)' } }
  }

  // Edit path: fold ops over the parsed diagram.
  for (let i = 0; i < checkedOps.length; i++) {
    const r = mutateChecked(d, checkedOps[i])
    if (!r.ok) return { ok: false, family: d.kind, opIndex: i, error: r.error }
    d = r.value
  }
  return verifiedEnvelope(d)
}

/** Verification is the declarative surface's commit point. Never publish
 * source that the canonical verifier has rejected. */
function verifiedEnvelope(diagram: MutableValidDiagram): OpEnvelope {
  const verification = verifyMermaid(diagram)
  const summary = verifySummary(verification)
  if (!verification.ok) {
    return {
      ok: false,
      family: diagram.kind,
      error: {
        code: 'VERIFY_FAILED',
        message: 'mutated diagram failed verify; source was not emitted',
        details: summary.warnings,
      },
    }
  }
  return {
    ok: true,
    family: diagram.kind,
    source: serializeMermaid(diagram),
    verify: summary,
  }
}
