/** Split CSS-like Mermaid style pairs without splitting functional color commas. */
function splitTopLevelCommas(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  let escaped = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) { out.push(value.slice(start, index)); start = index + 1 }
  }
  out.push(value.slice(start))
  return out.map(part => part.replace(/\\,/g, ','))
}

/** Parse Mermaid's `key:value,key:value` paint grammar. */
export function parseStyleProps(source: string): Record<string, string> {
  const cleaned = source.replace(/;\s*$/, '')
  const props: Record<string, string> = {}
  for (const pair of splitTopLevelCommas(cleaned)) {
    const colon = pair.indexOf(':')
    if (colon <= 0) continue
    const key = pair.slice(0, colon).trim()
    const value = pair.slice(colon + 1).trim()
    if (key && value) props[key] = value
  }
  return props
}

export type MutableStyleParseResult =
  | { ok: true; value: Record<string, string> }
  | { ok: false; reason: 'NOT_STRING' | 'MULTILINE' | 'EMPTY' }

/**
 * Validate a typed-mutation style before it reaches line-oriented Mermaid
 * serialization. Source parsers still consume one already-delimited line via
 * `parseStyleProps`; mutation callers must additionally reject CR/LF so style
 * values cannot inject a new node/entity/class statement.
 */
export function parseMutableStyleProps(source: unknown): MutableStyleParseResult {
  if (typeof source !== 'string') return { ok: false, reason: 'NOT_STRING' }
  if (/[\r\n]/.test(source)) return { ok: false, reason: 'MULTILINE' }
  const value = parseStyleProps(source)
  return Object.keys(value).length > 0 ? { ok: true, value } : { ok: false, reason: 'EMPTY' }
}

export function serializeStyleProps(style: Record<string, string>): string {
  return Object.entries(style).map(([key, value]) => `${key}:${value}`).join(',')
}
