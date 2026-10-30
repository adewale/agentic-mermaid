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

/** Actual shaped ink, before fitting or tracking, relative to its baseline origin.
 * A host supplies the same resolved fonts and shaping to the output consumer. */
export interface ProfileTextInkMeasurement {
  readonly advance: number
  readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null
}

/** A host must keep a profile's metrics stable for its id/version and fonts. */
export interface TextMeasurementProfile extends TextMeasurementProfileIdentity {
  readonly measure: (input: Readonly<ProfileTextMeasurementInput>) => number
  /** Undefined leaves ink unmeasured; null bounds mean the run paints no ink. */
  readonly measureInk?: (input: Readonly<ProfileTextMeasurementInput>) => ProfileTextInkMeasurement | undefined
}

export const DEFAULT_TEXT_MEASUREMENT_PROFILE: TextMeasurementProfileIdentity = Object.freeze({
  id: 'agentic-mermaid:inter-estimate',
  version: '4.0.0',
})

/** Capture caller-owned getters and function references once, like host backends. */
export function snapshotTextMeasurementProfile(profile: TextMeasurementProfile | undefined): TextMeasurementProfile | undefined {
  if (profile === undefined) return undefined
  if (typeof profile !== 'object' || profile === null) throw new TypeError('textMeasurement must be an object with id, version, and measure')
  const { id, version, measure, measureInk } = profile
  if (typeof id !== 'string' || id.length > 160 || !/^[A-Za-z][A-Za-z0-9._:/-]*$/.test(id)) {
    throw new TypeError('textMeasurement.id must be a stable name of at most 160 characters')
  }
  if (id === DEFAULT_TEXT_MEASUREMENT_PROFILE.id) throw new TypeError('textMeasurement.id is reserved for the deterministic default')
  if (typeof version !== 'string' || version.length > 80 || !parseSemVer(version)) {
    throw new TypeError('textMeasurement.version must be a semantic version')
  }
  if (typeof measure !== 'function') throw new TypeError('textMeasurement.measure must be a function')
  if (measureInk !== undefined && typeof measureInk !== 'function') throw new TypeError('textMeasurement.measureInk must be a function')
  return Object.freeze({ id, version, measure, measureInk })
}

/** Per-request cache shared by layout and drawing, held only in the private plan. */
export interface TextMeasurementExecution {
  readonly identity: TextMeasurementProfileIdentity
  readonly fontFamily: string
  readonly hasInk: boolean
  readonly width: (input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }) => number
  readonly ink: (input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }) => ProfileTextInkMeasurement | undefined
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
  const inks = new Map<string, ProfileTextInkMeasurement | undefined>()
  return Object.freeze({
    identity,
    fontFamily,
    hasInk: snapshot.measureInk !== undefined,
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
    ink(input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }): ProfileTextInkMeasurement | undefined {
      if (!snapshot.measureInk) return undefined
      const selectedFont = input.fontFamily ?? (input.monospace ? 'JetBrains Mono' : fontFamily)
      const key = JSON.stringify([input.text, selectedFont, input.fontSize, input.fontWeight, input.fontStyle, input.monospace])
      if (inks.has(key)) return inks.get(key)
      const measured = withTextMeasurementExecution(undefined, () => {
        const result = snapshot.measureInk!(Object.freeze({ ...input, fontFamily: selectedFont }))
        if (result === undefined) return undefined
        const invalid = (): never => { throw new RangeError(`Text measurement profile ${identity.id}@${identity.version} must return finite ordered ink bounds and an advance between 0 and ${MAX_WIDTH} pixels`) }
        if (result === null || typeof result !== 'object') return invalid()
        // Read each caller-owned slot once, then retain only our frozen copy.
        const { advance, bounds } = result
        if (typeof advance !== 'number' || !Number.isFinite(advance) || advance < 0 || advance > MAX_WIDTH) return invalid()
        if (bounds === null) return Object.freeze({ advance, bounds: null })
        if (typeof bounds !== 'object' || !bounds || advance === 0) return invalid()
        const { x0, y0, x1, y1 } = bounds
        if (![x0, y0, x1, y1].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_WIDTH)
          || x0 > x1 || y0 > y1) return invalid()
        return Object.freeze({ advance, bounds: Object.freeze({ x0, y0, x1, y1 }) })
      })
      if (inks.size < MAX_CACHED_WIDTHS) inks.set(key, measured)
      return measured
    },
  })
}

// Graphical execution is synchronous in every runtime. A stack-scoped value
// avoids threading executable callbacks through serializable family options.
// Every entry installs its own context (including undefined), and finally
// restores it, so nested/default renders and exceptions cannot leak metrics.
let activeExecution: TextMeasurementExecution | undefined
let activeFontFamily: string | undefined

export function withTextMeasurementExecution<T>(execution: TextMeasurementExecution | undefined, run: () => T, fontFamily?: string): T {
  const previous = activeExecution
  const previousFont = activeFontFamily
  activeExecution = execution
  activeFontFamily = execution?.fontFamily ?? fontFamily
  try {
    return run()
  } finally {
    activeExecution = previous
    activeFontFamily = previousFont
  }
}

export function customTextMeasurementActive(): boolean {
  return activeExecution !== undefined
}

export function profileTextWidth(input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }): number | undefined {
  return activeExecution?.width(input)
}

export function profileTextInk(input: Omit<ProfileTextMeasurementInput, 'fontFamily'> & { fontFamily?: string }): ProfileTextInkMeasurement | undefined {
  return activeExecution?.ink(input)
}

export function customTextInkActive(): boolean {
  return activeExecution?.hasInk === true
}

export function profileTextFontFamily(): string | undefined {
  return activeFontFamily
}
