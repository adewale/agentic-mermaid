/** Optional synchronous observation at native parser consumption/build boundaries.
 * Events describe each parser's own language; their kinds are not Mermaid's
 * lexer token numbers or its yy method protocol.
 */
export interface ParserObservationSource {
  line?: number
  column?: number
  offset?: number
  endOffset?: number
  /** Coordinates refer to supplied physical text or a parser's normalized view. */
  unit?: 'physical' | 'normalized'
}

export type ParserObservationValue = null | boolean | number | string | ParserObservationValue[] | { [key: string]: ParserObservationValue }

export interface ParserObservation {
  family: string
  unit: 'token' | 'statement' | 'mutation'
  kind: string
  text?: string
  value?: ParserObservationValue
  source?: ParserObservationSource
}

export type ParserObserver = (event: Readonly<ParserObservation>) => void

interface Scope {
  family: string
  observer: ParserObserver
  mutations?: ReadonlySet<string>
}
let active: Scope | undefined

/** True only within the selected synchronous scope. Guard event construction
 * with this function so ordinary parsing does no snapshot or allocation work.
 */
export function parserObservationActive(family: string): boolean {
  return active?.family === family
}

/** Nested scopes replace, then restore, their caller's observer. Async work is
 * deliberately outside this contract: no parser context survives a promise.
 */
export function withParserObservation<T>(family: string, observer: ParserObserver, parse: () => T, options?: { mutations?: readonly string[] }): T {
  const previous = active
  active = { family, observer, mutations: options?.mutations ? new Set(options.mutations) : undefined }
  try {
    const result = parse()
    if (result !== null && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
      // The callback has already started its async work. Consume a future
      // rejection while refusing to keep this synchronous scope alive.
      void Promise.resolve(result).catch(() => {})
      throw new TypeError('Parser observation scopes must be synchronous')
    }
    return result
  } finally {
    active = previous
  }
}

function snapshot(value: unknown, seen = new Map<object, string>(), path = '$'): ParserObservationValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $number: String(value) }
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value !== 'object') return String(value)
  const prior = seen.get(value)
  if (prior !== undefined) return { $ref: prior }
  seen.set(value, path)
  let result: ParserObservationValue
  if (value instanceof Date) result = value.toISOString()
  else if (value instanceof Map) result = [...value].map(([key, item], index) => [snapshot(key, seen, `${path}.${index}.0`), snapshot(item, seen, `${path}.${index}.1`)])
  else if (value instanceof Set) result = [...value].map((item, index) => snapshot(item, seen, `${path}.${index}`))
  else if (Array.isArray(value)) result = value.map((item, index) => snapshot(item, seen, `${path}.${index}`))
  else {
    const out: { [key: string]: ParserObservationValue } = Object.create(null) as { [key: string]: ParserObservationValue }
    for (const [key, item] of Object.entries(value)) {
      if (typeof item !== 'function' && item !== undefined) out[key] = snapshot(item, seen, `${path}.${key}`)
    }
    result = out
  }
  seen.delete(value)
  return result
}

/** A result-control snapshot uses the same lossless parent-preserving copy as
 * event values. This is a model snapshot, never a reconstructed operation trace.
 */
export function snapshotParserObservationValue(value: unknown): ParserObservationValue {
  return snapshot(value)
}

function deliver(family: string, event: ParserObservation): void {
  const scope = active
  if (!scope || scope.family !== family) return
  // A callback may itself call a parser. It must opt into a nested scope rather
  // than accidentally recording those calls in the parse being observed.
  active = undefined
  try {
    scope.observer(event)
  } finally {
    active = scope
  }
}

export function observeParserStatement(family: string, kind: string, text: string, source?: ParserObservationSource): void {
  if (!parserObservationActive(family)) return
  deliver(family, { family, unit: 'statement', kind, text, ...(source ? { source: { ...source } } : {}) })
}

export function observeParserToken(family: string, kind: string, text: string, source?: ParserObservationSource): void {
  if (!parserObservationActive(family)) return
  deliver(family, { family, unit: 'token', kind, text, ...(source ? { source: { ...source } } : {}) })
}

/** Copies values before invoking user code; later model mutations cannot
 * rewrite an earlier event. Semantic parent/membership fields are retained.
 */
export function observeParserMutation(family: string, kind: string, value: unknown, source?: ParserObservationSource): void {
  if (!parserObservationActive(family)) return
  // Select before copying: source-map consumers need only generated identities,
  // not snapshots of every still-unprocessed nested subtree.
  if (active?.mutations && !active.mutations.has(kind)) return
  deliver(family, { family, unit: 'mutation', kind, value: snapshot(value), ...(source ? { source: { ...source } } : {}) })
}
