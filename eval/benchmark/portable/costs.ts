export interface UsageEvidence {
  provider: string
  model: string
  transcript: string
  measuredAt: string
  inputTokens: number
  outputTokens: number
  price: { observedAt: string; source: string; inputPerMillionUsd: number; outputPerMillionUsd: number }
}
export function modelCost(evidence?: UsageEvidence) {
  if (!evidence) return { status: 'unavailable' as const, dollars: null, detail: 'No actual provider/model transcript and dated token-price evidence supplied' }
  const finite = (value: number) => Number.isFinite(value) && value >= 0
  if (
    ![evidence.provider, evidence.model, evidence.transcript, evidence.price?.source].every(value => typeof value === 'string' && value.trim()) ||
    !Number.isFinite(Date.parse(evidence.measuredAt)) ||
    !Number.isFinite(Date.parse(evidence.price.observedAt)) ||
    ![evidence.inputTokens, evidence.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0) ||
    ![evidence.price.inputPerMillionUsd, evidence.price.outputPerMillionUsd].every(finite)
  )
    throw Error('Actual usage evidence and finite dated prices are required')
  const observed = {
    provider: evidence.provider,
    model: evidence.model,
    transcript: evidence.transcript,
    measuredAt: evidence.measuredAt,
    inputTokens: evidence.inputTokens,
    outputTokens: evidence.outputTokens,
    price: { observedAt: evidence.price.observedAt, source: evidence.price.source, inputPerMillionUsd: evidence.price.inputPerMillionUsd, outputPerMillionUsd: evidence.price.outputPerMillionUsd },
  }
  return { status: 'estimated-from-supplied-usage' as const, dollars: (evidence.inputTokens * evidence.price.inputPerMillionUsd + evidence.outputTokens * evidence.price.outputPerMillionUsd) / 1_000_000, evidence: observed }
}
export function processCpuCost(userSeconds: number, systemSeconds: number, ratePerCpuHourUsd?: number) {
  if (![userSeconds, systemSeconds].every(value => Number.isFinite(value) && value >= 0) || (ratePerCpuHourUsd !== undefined && (!Number.isFinite(ratePerCpuHourUsd) || ratePerCpuHourUsd < 0))) throw Error('Finite nonnegative CPU samples and rates required')
  const seconds = userSeconds + systemSeconds,
    lowerSeconds = Math.max(0, seconds - 0.02),
    upperSeconds = seconds + 0.02
  return {
    status: ratePerCpuHourUsd === undefined ? 'rate-unavailable' : seconds === 0 ? 'below-counter-resolution' : 'estimated-at-supplied-rate',
    seconds,
    lowerSeconds,
    upperSeconds,
    dollars: ratePerCpuHourUsd === undefined || seconds === 0 ? null : (seconds * ratePerCpuHourUsd) / 3600,
    lowerDollars: ratePerCpuHourUsd === undefined ? null : (lowerSeconds * ratePerCpuHourUsd) / 3600,
    upperDollars: ratePerCpuHourUsd === undefined ? null : (upperSeconds * ratePerCpuHourUsd) / 3600,
    scope: 'Whole fresh worker CPU, including runtime/import/qualification; 10ms reporting grain per counter. Not an API-only CPU allocation or a provider invoice.',
  }
}
