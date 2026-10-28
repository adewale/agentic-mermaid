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
// The default path shares structured mutation with Code Mode and the CLI.
// Explicit source-preserving edits use the same op admission at their owner.
// ============================================================================

import { parseRegisteredMermaid } from './parse.ts'
import { serializeMermaid } from './serialize.ts'
import { createMermaid, type CreateMermaidOptions } from './create.ts'
import { applyMutationBatch, mutatePreservingSource } from './mutate.ts'
import { renderFailureWarning, verifyMermaid } from './verify.ts'
import { hasOpSchema, type OpFamily, type OpValidationError } from './op-schema.ts'
import type { MutableValidDiagram, ValidDiagram, VerifyResult, DiagramKind, LayoutWarning, MutationError, Result } from './types.ts'
import { getFamily } from './families.ts'
import { renderMermaidSVG } from '../index.ts'
import type { ParsedDiagram } from './types.ts'
import { WARNING_SEVERITY, ok, err } from './types.ts'
import { isPlainRecord } from '../shared/plain-data.ts'

// ---- Canonical result envelope --------------------------------------------

/** A verify summary reduced to plain JSON (no RenderedLayout proxy graph). */
export interface VerifySummary {
  ok: boolean
  warnings: VerifyResult['warnings']
  checks?: VerifyResult['checks']
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
      /** Canonical source by default; exact edited bytes in source-preserving mode. */
      source: string
      mode?: 'source-preserving'
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
  return JSON.parse(JSON.stringify({ ok: v.ok, warnings: v.warnings, checks: v.checks }))
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
  return applyMutationBatch(d, checkedOps) as Result<MutableValidDiagram, CheckedBuildError>
}

// ---- Declarative batch entrypoint -----------------------------------------

export interface ApplyOpsInput {
  /** Existing Mermaid `source` to edit, OR `family` to author from blank. */
  source?: string
  family?: string
  ops: unknown
  /** Explicitly retain unsupported syntax while applying a bounded family edit. */
  mode?: 'structured' | 'source-preserving'
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
  let mode: unknown
  try {
    if (!isPlainRecord(input)) {
      return { ok: false, family: null, error: { code: 'INVALID_OP', message: 'applyOps input must be a plain object' } }
    }
    ;({ source, family, ops, mode } = input)
  } catch {
    return { ok: false, family: null, error: { code: 'INVALID_OP', message: 'applyOps input must be a readable plain object' } }
  }

  const admittedOps = snapshotOpArray(ops)
  if (!admittedOps.ok) {
    return { ok: false, family: (typeof family === 'string' && hasOpSchema(family)) ? family : null, error: { code: 'INVALID_OP', message: '`ops` must be an array of op objects' } }
  }
  const checkedOps = admittedOps.value
  if (mode !== undefined && mode !== 'structured' && mode !== 'source-preserving') return { ok: false, family: null, error: { code: 'INVALID_OP', message: '`mode` must be structured or source-preserving' } }
  if (mode === 'source-preserving' && typeof source !== 'string') return { ok: false, family: null, error: { code: 'INVALID_OP', message: 'Source-preserving mode requires existing source, not a blank-slate build' } }
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
  let before: ParsedDiagram

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
    before = d
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

  if (mode === 'source-preserving') {
    let current: ParsedDiagram = before, exactSource = source as string
    for (let index = 0; index < checkedOps.length; index++) {
      const edited = mutatePreservingSource(current, checkedOps[index])
      if (!edited.ok) return { ok: false, family: d.kind, opIndex: index, error: edited.error }
      current = edited.value.diagram
      exactSource = edited.value.source
    }
    return verifiedEnvelope(current as ValidDiagram, before, exactSource)
  }
  const edited = applyMutationBatch(d, checkedOps)
  if (!edited.ok) {
    const { opIndex, ...error } = edited.error
    return { ok: false, family: d.kind, opIndex, error }
  }
  d = edited.value as MutableValidDiagram
  return verifiedEnvelope(d, before)
}

/** Shared post-edit gate, internal to the public adapters. Empty is still an
 * error for standalone verification, but a deliberate structured result can
 * be published when emptiness is its only blocking diagnostic and its emitted
 * source actually renders. Empty scaffolds below a grammar floor still fail.
 * An edit is not blamed for an engine defect it did not introduce: when every
 * blocking finding is an INTERNAL_ERROR the pre-edit diagram (`before`)
 * already had, with the same reason and the same ordinary-render outcome, the
 * edit is accepted and its verification keeps reporting the defect. */
export function verifyMutationResult(diagram: ParsedDiagram, before?: ParsedDiagram): { accepted: boolean; verification: VerifyResult } {
  const verification = verifyMermaid(diagram)
  if (verification.checks?.sourceLoss === 'detected') return { accepted: false, verification }
  if (verification.ok) return { accepted: true, verification }
  const blocking = verification.warnings.filter(warning => WARNING_SEVERITY[warning.code] === 'error')
  if (before && blocking.length > 0 && blocking.every(warning => warning.code === 'INTERNAL_ERROR')) {
    const defect = (warning: LayoutWarning) => warning.code === 'INTERNAL_ERROR' ? `${warning.defaultRender}\u0000${warning.reason}` : undefined
    const prior = new Set(verifyMermaid(before).warnings.map(defect).filter(key => key !== undefined))
    if (blocking.every(warning => prior.has(defect(warning)!))) return { accepted: true, verification }
  }
  if (diagram.body.kind === 'opaque' || diagram.body.kind === 'preserved' || diagram.body.kind === 'extension'
    || !getFamily(diagram.kind)?.mutate
    || blocking.length === 0 || blocking.some(warning => warning.code !== 'EMPTY_DIAGRAM')) {
    return { accepted: false, verification }
  }
  try {
    renderMermaidSVG(serializeMermaid(diagram))
    return { accepted: true, verification }
  } catch (error) {
    // This is the ordinary render, so an engine defect here fails it.
    return { accepted: false, verification: { ...verification, warnings: [...verification.warnings, renderFailureWarning(error, () => 'fails')] } }
  }
}

function verifiedEnvelope(diagram: ValidDiagram, before?: ParsedDiagram, preservedSource?: string): OpEnvelope {
  const { accepted, verification } = verifyMutationResult(diagram, before)
  const summary = verifySummary(verification)
  if (!accepted) {
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
    source: preservedSource ?? serializeMermaid(diagram),
    ...(preservedSource !== undefined ? { mode: 'source-preserving' as const } : {}),
    verify: summary,
  }
}
