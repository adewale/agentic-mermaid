// Pure color grammars repeatedly see the same palette on every Scene mark.
// Bound both key count and key length: source-controlled tokens must never
// grow a persistent renderer's memory without limit.
export function memoizeColorToken<T>(parse: (token: string) => T): (token: string) => T {
  const values = new Map<string, T>()
  return token => {
    if (typeof token !== 'string' || token.length > 256) return parse(token)
    const prior = values.get(token)
    if (prior !== undefined || values.has(token)) return prior as T
    const result = parse(token)
    if (values.size >= 256) values.delete(values.keys().next().value!)
    values.set(token, result)
    return result
  }
}
