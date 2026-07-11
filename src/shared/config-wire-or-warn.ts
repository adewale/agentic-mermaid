/** Return the sorted documented-but-unwired fields present in config maps. */
export function ineffectiveFieldsPresent(configs: unknown[], fields: readonly string[]): string[] {
  const present = new Set<string>()
  for (const config of configs) {
    if (!config || typeof config !== 'object') continue
    for (const field of fields) {
      if (field in (config as Record<string, unknown>)) present.add(field)
    }
  }
  return [...present].sort()
}
