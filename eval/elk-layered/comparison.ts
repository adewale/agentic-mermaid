/** Exclude only output-added GWT identity hashes; authored fields remain observable. */
export function withoutGeneratedIdentity(output: unknown, input: unknown): unknown {
  if (output === null || typeof output !== 'object') return output
  if (!Array.isArray(output) && Object.prototype.toString.call(output) !== '[object Object]') {
    return structuredClone(output)
  }
  const authored = input !== null && typeof input === 'object' ? input as Record<string, unknown> : undefined
  const values = output as Record<string, unknown>
  const result = Array.isArray(output) ? new Array<unknown>(output.length) : Object.create(Object.getPrototypeOf(output))
  for (const key of Object.keys(output)) {
    if (key === '$H' && typeof values[key] === 'number' && !Object.hasOwn(authored ?? {}, key)) continue
    Object.defineProperty(result, key, {
      value: withoutGeneratedIdentity(values[key], authored?.[key]),
      enumerable: true, configurable: true, writable: true,
    })
  }
  return result
}
