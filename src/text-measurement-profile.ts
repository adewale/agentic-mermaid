import { parseSemVer } from './capability-negotiation.ts'

/** Trusted pixel metrics. Executable profiles never enter diagram/config data. */
export interface TextMeasurementProfileIdentity {
  readonly id: string
  readonly version: string
}

export interface ProfileTextMeasurementInput {
  readonly text: string
  readonly fontFamily: string
  readonly fontSize: number
  readonly fontWeight: number
  readonly fontStyle: 'normal' | 'italic'
  readonly monospace: boolean
}

/** A host must keep a profile's metrics stable for its id/version and fonts. */
export interface TextMeasurementProfile extends TextMeasurementProfileIdentity {
  readonly measure: (input: Readonly<ProfileTextMeasurementInput>) => number
}

export const DEFAULT_TEXT_MEASUREMENT_PROFILE: TextMeasurementProfileIdentity = Object.freeze({
  id: 'agentic-mermaid:inter-estimate',
  version: '4.0.0',
})

/** Capture caller-owned getters and function references once, like host backends. */
export function snapshotTextMeasurementProfile(profile: TextMeasurementProfile | undefined): TextMeasurementProfile | undefined {
  if (profile === undefined) return undefined
  if (typeof profile !== 'object' || profile === null) throw new TypeError('textMeasurement must be an object with id, version, and measure')
  const { id, version, measure } = profile
  if (typeof id !== 'string' || id.length > 160 || !/^[A-Za-z][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new TypeError('textMeasurement.id must be a stable name of at most 160 characters')
  }
  if (id === DEFAULT_TEXT_MEASUREMENT_PROFILE.id) throw new TypeError('textMeasurement.id is reserved for the deterministic default')
  if (typeof version !== 'string' || version.length > 80 || !parseSemVer(version)) {
    throw new TypeError('textMeasurement.version must be a semantic version')
  }
  if (typeof measure !== 'function') throw new TypeError('textMeasurement.measure must be a function')
  return Object.freeze({ id, version, measure })
}

/** Per-request cache shared by layout and drawing, held only in the private plan. */
export interface TextMeasurementExecution {
  readonly identity: TextMeasurementProfileIdentity
  readonly width: (input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }) => number
}

const MAX_WIDTH = 1_000_000
const MAX_CACHED_WIDTHS = 20_000

export function createTextMeasurementExecution(
  profile: TextMeasurementProfile | undefined,
  fontFamily: string,
): TextMeasurementExecution | undefined {
  const snapshot = snapshotTextMeasurementProfile(profile)
  if (!snapshot) return undefined
  const identity = Object.freeze({ id: snapshot.id, version: snapshot.version })
  const widths = new Map<string, number>()
  return Object.freeze({
    identity,
    width(input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }): number {
      const selectedFont = input.fontFamily ?? (input.monospace ? 'JetBrains Mono' : fontFamily)
      const key = JSON.stringify([input.text, selectedFont, input.fontSize, input.fontWeight, input.fontStyle, input.monospace])
      const cached = widths.get(key)
      if (cached !== undefined) return cached
      // A host callback may use the default estimator or render another diagram.
      // It must never recursively call itself or inherit its caller's profile.
      const width = withTextMeasurementExecution(undefined, () => snapshot.measure(Object.freeze({
        ...input,
        fontFamily: selectedFont,
      })))
      if (typeof width !== 'number' || !Number.isFinite(width) || width < 0 || width > MAX_WIDTH) {
        throw new RangeError(`Text measurement profile ${identity.id}@${identity.version} must return a finite width between 0 and ${MAX_WIDTH} pixels`)
      }
      if (widths.size < MAX_CACHED_WIDTHS) widths.set(key, width)
      return width
    },
  })
}

// Graphical execution is synchronous in every runtime. A stack-scoped value
// avoids threading executable callbacks through serializable family options.
// Every entry installs its own context (including undefined), and finally
// restores it, so nested/default renders and exceptions cannot leak metrics.
let activeExecution: TextMeasurementExecution | undefined

export function withTextMeasurementExecution<T>(execution: TextMeasurementExecution | undefined, run: () => T): T {
  const previous = activeExecution
  activeExecution = execution
  try {
    return run()
  } finally {
    activeExecution = previous
  }
}

export function customTextMeasurementActive(): boolean {
  return activeExecution !== undefined
}

export function profileTextWidth(input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }): number | undefined {
  return activeExecution?.width(input)
}
