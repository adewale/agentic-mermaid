/** Admission of a fully consumed public receipt, independent of renderer internals. */
export function assertInvocationReceipt(receipt: unknown, output: string): void {
  if (!receipt || typeof receipt !== 'object') throw new Error('Receipt-bearing invocation returned no receipt')
  const value = receipt as Record<string, unknown>
  if (!Number.isInteger(value.version) || (value.version as number) < 1) throw new Error('Receipt has no supported integer version')
  if (value.output !== output) throw new Error(`Receipt output ${String(value.output)} does not match ${output}`)
  if (typeof value.requestDigest !== 'string' || !value.requestDigest) throw new Error('Receipt has no requestDigest')
  if ((value.version as number) >= 2) {
    for (const name of ['sharedRequestDigest', 'appearanceDigest']) if (typeof value[name] !== 'string' || !value[name]) throw new Error(`Receipt has no ${name}`)
    const decision = value.capabilityDecision as Record<string, unknown> | undefined
    if (!decision || typeof decision.accepted !== 'boolean' || !Array.isArray(decision.resolutions)) throw new Error('Receipt has no materialized capability decision')
  }
}
