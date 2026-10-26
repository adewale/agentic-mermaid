import { existsSync, readFileSync } from 'node:fs'

export interface WorkerEvidenceRow {
  id: string
  status: string
  [key: string]: unknown
}
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map(key => [key, item[key]]),
        )
      : item,
  )
const isRow = (value: unknown): value is WorkerEvidenceRow => !!value && typeof value === 'object' && typeof (value as WorkerEvidenceRow).id === 'string' && typeof (value as WorkerEvidenceRow).status === 'string'

/** Only newline-committed rows survive a crash. A truncated tail never discards its prefix. */
export function committedWorkerRows(text: string): { rows: WorkerEvidenceRow[]; errors: string[]; ignoredTail: boolean } {
  const last = text.lastIndexOf('\n'),
    rows: WorkerEvidenceRow[] = [],
    errors: string[] = []
  if (last < 0) return { rows, errors, ignoredTail: !!text.trim() }
  for (const [index, line] of text.slice(0, last).split('\n').entries()) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (!isRow(value)) throw Error('Expected workload id/status')
      rows.push(value)
    } catch (error) {
      errors.push(`Committed JSONL line${index + 1}: ${String(error)}`)
    }
  }
  return { rows, errors, ignoredTail: !!text.slice(last + 1).trim() }
}

/** Completed and incremental ledgers must agree; last-writer-wins would hide regressions. */
export function mergeWorkerRows(committed: readonly WorkerEvidenceRow[], completed: readonly unknown[] = []): { rows: WorkerEvidenceRow[]; errors: string[] } {
  const rows = new Map<string, WorkerEvidenceRow>(),
    errors: string[] = [],
    contradictions = new Set<string>()
  for (const value of [...committed, ...completed]) {
    if (!isRow(value)) {
      errors.push('Invalid completed worker row')
      continue
    }
    const previous = rows.get(value.id)
    if (previous && canonical(previous) !== canonical(value)) contradictions.add(value.id)
    else if (!previous) rows.set(value.id, value)
  }
  for (const id of contradictions) {
    const previous = rows.get(id)!
    const { samplesMs: _samples, ...rest } = previous
    rows.set(id, { ...rest, status: 'failed', detail: 'Contradictory duplicate workload results across worker ledgers; timing withheld' })
    errors.push('Contradictory duplicate workload: ' + id)
  }
  return { rows: [...rows.values()], errors }
}

export function readWorkerRows(progressFile: string, completed: readonly unknown[] = []) {
  const progress = committedWorkerRows(existsSync(progressFile) ? readFileSync(progressFile, 'utf8') : ''),
    merged = mergeWorkerRows(progress.rows, completed)
  return { rows: merged.rows, errors: [...progress.errors, ...merged.errors], ignoredTail: progress.ignoredTail }
}
