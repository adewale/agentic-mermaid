export function median(values: readonly number[]): number {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw Error('Finite nonempty samples required')
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
export function quantile(values: readonly number[], probability: number): number {
  if (probability < 0 || probability > 1 || !values.length || values.some(value => !Number.isFinite(value))) throw Error('Invalid quantile inputs')
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(probability * sorted.length) - 1))]!
}
export function summarize(values: readonly number[]) {
  if (!values.length) return { samples: 0, medianMs: null, p95Ms: null, minMs: null, maxMs: null }
  return { samples: values.length, medianMs: median(values), p95Ms: quantile(values, 0.95), minMs: Math.min(...values), maxMs: Math.max(...values) }
}
export interface CalibrationRound {
  round: number
  A0: number[]
  A1: number[]
  B: number[]
}
/** Replica B uses the same admitted artifact in the calibration case study. */
export function calibrate(rounds: CalibrationRound[], minimumSamples: number, maximumControlSpread = 0.25) {
  const gaps: string[] = []
  if (rounds.length < 5) gaps.push('At least five independent rounds are required')
  if (new Set(rounds.map(round => round.round)).size !== rounds.length) gaps.push('Round identities must be unique')
  if (rounds.some(round => [round.A0, round.A1, round.B].some(samples => samples.length < minimumSamples || samples.some(value => !Number.isFinite(value) || value <= 0)))) gaps.push('Every replica/round needs the declared finite positive sample count')
  if (gaps.length) return { status: 'uncalibrated' as const, gaps, controlRatios: [], candidateRatios: [], controlBand: null, candidateRatio: null }
  const controlRatios = rounds.map(round => median(round.A1) / median(round.A0))
  const candidateRatios = rounds.map(round => median(round.B) / Math.sqrt(median(round.A0) * median(round.A1)))
  const controlBand = { lower: Math.min(...controlRatios, ...controlRatios.map(value => 1 / value)), upper: Math.max(...controlRatios, ...controlRatios.map(value => 1 / value)) }
  if (controlBand.upper - 1 > maximumControlSpread) gaps.push('Observed A/A control spread exceeds the declared noise ceiling')
  const candidateRatio = median(candidateRatios)
  return {
    status: gaps.length ? ('uncalibrated' as const) : ('calibrated' as const),
    gaps,
    controlRatios,
    candidateRatios,
    controlBand,
    candidateRatio,
    interpretation: candidateRatio < controlBand.lower ? 'below observed control band; advisory' : candidateRatio > controlBand.upper ? 'above observed control band; advisory' : 'within observed control band',
  }
}
