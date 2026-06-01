// ============================================================================
// runBatchedOperations — shared scaffold for "run a handler over each item
// in a list, never abort the batch on a single failure".
//
// Loop 9 M8. Both `cmdBatch` (CLI JSONL runner) and `runWithJudge`
// (LLM-judge fan-out) had near-identical loops: iterate items, try the
// handler, surface the error as a structured entry, keep going.
//
// Signature is sync-or-async — the handler returns O or Promise<O>; the
// result list is awaited as a whole.
// ============================================================================

export interface BatchSuccess<O> { ok: true; value: O }
export interface BatchFailure { ok: false; error: { code: string; message: string } }
export type BatchEntry<O> = BatchSuccess<O> | BatchFailure

export interface RunBatchedOptions {
  /** Override the code field on caught errors (default 'HANDLER_ERROR'). */
  errorCode?: string
}

export async function runBatchedOperations<I, O>(
  items: I[],
  handler: (item: I, index: number) => O | Promise<O>,
  opts: RunBatchedOptions = {},
): Promise<BatchEntry<O>[]> {
  const errorCode = opts.errorCode ?? 'HANDLER_ERROR'
  const out: BatchEntry<O>[] = []
  for (let i = 0; i < items.length; i++) {
    try {
      const value = await handler(items[i]!, i)
      out.push({ ok: true, value })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      out.push({ ok: false, error: { code: errorCode, message } })
    }
  }
  return out
}

/**
 * Synchronous variant for callers whose handler is guaranteed sync.
 * Identical semantics to runBatchedOperations sans the await — used by
 * cmdBatch in the CLI where the dispatcher returns a number, not a promise.
 */
export function collectBatched<I, O>(
  items: I[],
  handler: (item: I, index: number) => O,
  errorCode = 'HANDLER_ERROR',
): BatchEntry<O>[] {
  const out: BatchEntry<O>[] = []
  for (let i = 0; i < items.length; i++) {
    try {
      out.push({ ok: true, value: handler(items[i]!, i) })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      out.push({ ok: false, error: { code: errorCode, message } })
    }
  }
  return out
}
