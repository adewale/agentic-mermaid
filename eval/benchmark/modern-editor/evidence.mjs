import { isDeepStrictEqual } from 'node:util'

export const ENGINES = ['modern', 'agentic', 'reference']

/** Each attempt must belong to exactly one expected input, engine and round. */
export function validateEngineEvidence(report, inventory) {
  if (!isDeepStrictEqual(report.corpus, inventory)) throw new Error('Engine evidence does not match its input inventory; rerun the engines')
  const inputs = new Map(inventory.occurrences.map(input => [input.id, input]))
  if (inputs.size !== inventory.occurrences.length || !inputs.size) throw new Error('Invalid engine inventory')
  if (!Array.isArray(report.engines) || report.engines.length !== inputs.size * ENGINES.length * 3) throw new Error('Incomplete engine evidence')
  const seen = new Set()
  for (const row of report.engines) {
    const input = inputs.get(row.id)
    const key = JSON.stringify([row.engine, row.round, row.id])
    if (!ENGINES.includes(row.engine) || ![1, 2, 3].includes(row.round) || !input || input.family !== row.family
      || typeof row.ok !== 'boolean' || !Number.isFinite(row.ms) || row.ms < 0 || seen.has(key)) {
      throw new Error(`Invalid or duplicated engine attempt: ${key}`)
    }
    seen.add(key)
  }
}

/** Admit old engine results before any current-run artifacts overwrite them. */
export function resumeEngineEvidence(prior, priorInventory, current, inventory) {
  if (!isDeepStrictEqual(prior.revisions, current.revisions)
    || !isDeepStrictEqual(prior.fetchedArtifacts, current.fetchedArtifacts)
    || !isDeepStrictEqual(priorInventory, inventory)) {
    throw new Error('Different engine inputs or dependencies; run without RESUME_ENGINES')
  }
  validateEngineEvidence(prior, inventory)
  return { engines: prior.engines, engineMeasuredAt: prior.engineMeasuredAt ?? prior.date,
    engineEnvironment: prior.engineEnvironment ?? prior.environment }
}
