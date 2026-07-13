import { HOSTED_FONT_RESOURCES } from './font-manifest.ts'
import { safeCssColor } from './shared/css-color.ts'

/** Logical PNG projection policy shared by every first-party raster adapter. */
export const PNG_OUTPUT_POLICY_VERSION = 1 as const
export const PNG_DEFAULT_SCALE = 2 as const
export const PNG_DEFAULT_FONT_FAMILY = 'Inter' as const

export interface PngFitTo {
  width?: number
  height?: number
}

export interface PngOutputPolicyInput {
  scale?: number
  background?: string
  fitTo?: PngFitTo
  fontDirs?: readonly string[]
  loadSystemFonts?: boolean
}

export interface ResolvedPngOutputPolicy {
  readonly version: typeof PNG_OUTPUT_POLICY_VERSION
  readonly scale: number
  readonly background:
    | { readonly mode: 'artifact'; readonly fallback: 'white' }
    | { readonly mode: 'explicit'; readonly value: string }
  readonly fitTo:
    | { readonly mode: 'zoom'; readonly value: number }
    | { readonly mode: 'width' | 'height'; readonly value: number }
  readonly fonts: {
    readonly defaultFamily: typeof PNG_DEFAULT_FONT_FAMILY
    readonly bundledResources: readonly string[]
    readonly callerDirectories: readonly string[]
    readonly loadSystemFonts: boolean
  }
}

const BUNDLED_FONT_RESOURCES = Object.freeze(
  HOSTED_FONT_RESOURCES.map(resource => `${resource.identity.id}@${resource.identity.version}#sha256:${resource.sha256}`),
)

/** Normalize user controls and defaults before they participate in a receipt. */
export function resolvePngOutputPolicy(input: PngOutputPolicyInput = {}): ResolvedPngOutputPolicy {
  const scale = input.scale ?? PNG_DEFAULT_SCALE
  if (!Number.isFinite(scale) || scale <= 0) throw new TypeError('PNG scale must be a positive finite number')
  if (input.fitTo?.width !== undefined && input.fitTo.height !== undefined) {
    throw new TypeError('PNG fitTo accepts width or height, not both')
  }
  if (input.fitTo?.width !== undefined && (!Number.isFinite(input.fitTo.width) || input.fitTo.width <= 0)) {
    throw new TypeError('PNG fitTo.width must be a positive finite number')
  }
  if (input.fitTo?.height !== undefined && (!Number.isFinite(input.fitTo.height) || input.fitTo.height <= 0)) {
    throw new TypeError('PNG fitTo.height must be a positive finite number')
  }
  const explicitBackground = input.background === undefined ? undefined : safeCssColor(input.background)
  if (input.background !== undefined && !explicitBackground) throw new TypeError('PNG background must be a safe CSS color')
  if (input.fontDirs?.some(directory => typeof directory !== 'string' || directory.trim() === '')) {
    throw new TypeError('PNG fontDirs must contain non-empty paths')
  }
  const fitTo = input.fitTo?.width
    ? { mode: 'width' as const, value: input.fitTo.width }
    : input.fitTo?.height
      ? { mode: 'height' as const, value: input.fitTo.height }
      : { mode: 'zoom' as const, value: scale }
  const background = explicitBackground === undefined
    ? { mode: 'artifact' as const, fallback: 'white' as const }
    : { mode: 'explicit' as const, value: explicitBackground }
  return Object.freeze({
    version: PNG_OUTPUT_POLICY_VERSION,
    scale,
    background: Object.freeze(background),
    fitTo: Object.freeze(fitTo),
    fonts: Object.freeze({
      defaultFamily: PNG_DEFAULT_FONT_FAMILY,
      bundledResources: BUNDLED_FONT_RESOURCES,
      callerDirectories: Object.freeze([...(input.fontDirs ?? [])]),
      loadSystemFonts: input.loadSystemFonts ?? false,
    }),
  })
}

export const PNG_FONT_SOURCES = Object.freeze([
  'verified-files',
  'verified-buffers',
  'caller-directories',
  'system-fonts',
  'embedded-data-uri',
  'unavailable',
] as const)

export type PngFontSource = typeof PNG_FONT_SOURCES[number]

/** Runtime provenance is artifact metadata, never part of the logical request digest. */
export interface PngRuntimeProvenance {
  readonly engine: 'resvg'
  readonly engineVersion: '2.6.2'
  readonly binding: 'napi' | 'wasm'
  /** Every class of font input that could affect the produced bytes. */
  readonly fontSources: readonly PngFontSource[]
  /** Whether every byte-affecting resource is identified by content in the runtime contract. */
  readonly reproducibility: 'content-addressed' | 'host-dependent'
}

export const PNG_NAPI_RUNTIME: PngRuntimeProvenance = Object.freeze({
  engine: 'resvg',
  engineVersion: '2.6.2',
  binding: 'napi',
  fontSources: Object.freeze<PngFontSource[]>(['verified-files']),
  reproducibility: 'content-addressed',
})

export const PNG_WASM_RUNTIME: PngRuntimeProvenance = Object.freeze({
  engine: 'resvg',
  engineVersion: '2.6.2',
  binding: 'wasm',
  fontSources: Object.freeze<PngFontSource[]>(['verified-buffers']),
  reproducibility: 'content-addressed',
})

/** Add host-controlled font inputs to the N-API artifact provenance. */
export function pngNapiRuntimeProvenance(input: {
  readonly callerDirectories?: readonly string[]
  readonly loadSystemFonts?: boolean
} = {}): PngRuntimeProvenance {
  const sources: PngFontSource[] = ['verified-files']
  if ((input.callerDirectories?.length ?? 0) > 0) sources.push('caller-directories')
  if (input.loadSystemFonts) sources.push('system-fonts')
  if (sources.length === 1) return PNG_NAPI_RUNTIME
  return Object.freeze({
    engine: 'resvg',
    engineVersion: '2.6.2',
    binding: 'napi',
    fontSources: Object.freeze(sources),
    reproducibility: 'host-dependent',
  })
}
