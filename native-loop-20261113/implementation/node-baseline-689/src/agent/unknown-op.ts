/** Shared prescriptive formatting, independent of family modules to avoid
 * initialization cycles in family-owned schema/mutator pairs. */
export function formatUnknownOpMessage(family: string, op: unknown, menu: string): string {
  // Passing an op ARRAY where one op is expected is the single most common shape
  // slip — it recurs on nearly every case across every model tier in the
  // agent-usage eval (mutate() applies ONE op, but "apply these ops" reads as a
  // list). Hand back the rule and the batch alternatives so the next action is
  // in the message, not left to infer from a dumped array.
  if (Array.isArray(op)) {
    return `Expected a single ${family} op, got an array of ${op.length}. ` + `Ops apply one at a time: call mutate() once per op, or pass the whole list to a batch ` + `entrypoint — applyOps({ source, family, ops }) to edit source, or buildMermaid(kind, ops) ` + `to author — valid ${family} ops: ${menu}`
  }
  const kind = (op as { kind?: unknown } | null | undefined)?.kind
  const got = typeof kind === 'string' ? `"${kind}"` : JSON.stringify(op)
  return `Unknown ${family} op ${got} — valid ops: ${menu}`
}
