import { HOSTED_FONT_RESOURCES } from './font-manifest.ts'
import { tryParseCssColor } from './shared/color-math.ts'
import {
  decodedSvgAttributeValue,
  replaceSvgRootStartTag,
  svgAttribute,
  svgRootStartTag,
  transformSvgAttributes,
  type SvgStartTagToken,
} from './svg-structure.ts'
/** Logical PNG projection policy shared by every first-party raster adapter. */
export const PNG_OUTPUT_POLICY_VERSION = 3 as const
export const PNG_DEFAULT_SCALE = 2 as const
export const PNG_DEFAULT_FONT_FAMILY = 'Inter' as const
/** ~16.7 megapixels / ~64 MiB of raw RGBA before encoder overhead. */
export const MAX_PNG_PIXELS = 16_777_216 as const
/** Defends pathological one-pixel-wide/tall rasters that fit the pixel cap. */
export const MAX_PNG_RASTER_DIMENSION = 16_384 as const
/** Hosted WASM stays below the shared native/browser allocation ceiling. */
export const MAX_HOSTED_PNG_PIXELS = 4_194_304 as const
/** Bounds the hosted response and its unavoidable base64 representation. */
export const MAX_HOSTED_PNG_BYTES = 8_388_608 as const
export const MAX_PNG_FONT_DIRECTORIES = 16 as const
export const MAX_PNG_FONT_DIRECTORY_LENGTH = 4_096 as const

export type PngFitTo =
  | { readonly width: number; readonly height?: never }
  | { readonly width?: never; readonly height: number }

export interface PortablePngOutputOptions {
  scale?: number
  background?: string
  fitTo?: PngFitTo
}

export interface PngOutputPolicyInput extends PortablePngOutputOptions {
  fontDirs?: readonly string[]
  loadSystemFonts?: boolean
}

export type PngOutputOptionScope = 'portable' | 'native-host-only'
export type PngOutputOptionInputKind = 'serializable' | 'callback'
export type PngOutputOptionPolicyState = 'included' | 'excluded'
export type PngOutputOptionReceiptState = 'included' | 'excluded'

export interface PngOutputOptionFieldDescriptor {
  readonly scope: PngOutputOptionScope
  readonly input: PngOutputOptionInputKind
  readonly policy: PngOutputOptionPolicyState
  readonly receipt: PngOutputOptionReceiptState
  readonly typeScript: string
  readonly description: string
  readonly schema?: Readonly<Record<string, unknown>>
  readonly runtimeValidator?: 'portablePngBackground'
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return Object.freeze(value)
}

const POSITIVE_NUMBER_SCHEMA = {
  type: 'number',
  exclusiveMinimum: 0,
} as const

const POSITIVE_INTEGER_SCHEMA = {
  type: 'integer',
  minimum: 1,
} as const

const PORTABLE_PNG_COLOR_KEYWORDS = Object.freeze({
  transparent: '#00000000',
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff',
  maroon: '#800000', red: '#ff0000', purple: '#800080', fuchsia: '#ff00ff', green: '#008000',
  lime: '#00ff00', olive: '#808000', yellow: '#ffff00', navy: '#000080', blue: '#0000ff',
  teal: '#008080', aqua: '#00ffff', orange: '#ffa500',
} as const)

function caseInsensitiveKeywordPattern(keyword: string): string {
  return [...keyword].map(character => `[${character.toLowerCase()}${character.toUpperCase()}]`).join('')
}

const PORTABLE_PNG_BACKGROUND_PATTERN = `^\\s*(?:#[0-9A-Fa-f]{3,4}|#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{8}|${Object.keys(PORTABLE_PNG_COLOR_KEYWORDS).map(caseInsensitiveKeywordPattern).join('|')})\\s*$`

const FIT_TO_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    width: { ...POSITIVE_INTEGER_SCHEMA, description: 'Exact output width in integer pixels.' },
    height: { ...POSITIVE_INTEGER_SCHEMA, description: 'Exact output height in integer pixels.' },
  },
  oneOf: [
    { required: ['width'] },
    { required: ['height'] },
  ],
  description: 'Exactly one positive output width or height.',
} as const

/**
 * The single authority for every PNG output-specific option. Serializable
 * policy fields participate in the PNG request receipt; the native warning
 * callback is deliberately admitted by the native adapter but excluded from
 * both policy and receipt identity.
 */
export const PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS = deepFreeze({
  scale: {
    scope: 'portable', input: 'serializable', policy: 'included', receipt: 'included',
    typeScript: 'number',
    description: 'Positive output scale used when no fitTo constraint is supplied.',
    schema: { ...POSITIVE_NUMBER_SCHEMA, default: PNG_DEFAULT_SCALE },
  },
  background: {
    scope: 'portable', input: 'serializable', policy: 'included', receipt: 'included',
    typeScript: 'string',
    description: 'Portable basic color or hex color painted behind the raster artifact.',
    schema: { type: 'string', minLength: 1, pattern: PORTABLE_PNG_BACKGROUND_PATTERN },
    runtimeValidator: 'portablePngBackground',
  },
  fitTo: {
    scope: 'portable', input: 'serializable', policy: 'included', receipt: 'included',
    typeScript: '{ width: number; height?: never } | { width?: never; height: number }',
    description: 'Exactly one output width or height constraint.',
    schema: FIT_TO_SCHEMA,
  },
  fontDirs: {
    scope: 'native-host-only', input: 'serializable', policy: 'included', receipt: 'included',
    typeScript: 'readonly string[]',
    description: 'Trusted native host directories searched for additional fonts.',
    schema: {
      type: 'array',
      maxItems: MAX_PNG_FONT_DIRECTORIES,
      items: { type: 'string', minLength: 1, maxLength: MAX_PNG_FONT_DIRECTORY_LENGTH, pattern: '\\S' },
    },
  },
  loadSystemFonts: {
    scope: 'native-host-only', input: 'serializable', policy: 'included', receipt: 'included',
    typeScript: 'boolean',
    description: 'Allow the native rasterizer to load machine-dependent system fonts.',
    schema: { type: 'boolean', default: false },
  },
  onWarning: {
    scope: 'native-host-only', input: 'callback', policy: 'excluded', receipt: 'excluded',
    typeScript: '(warning: PngFontWarning) => void',
    description: 'Native host callback for font-coverage warnings; never serialized or receipted.',
  },
} as const satisfies Readonly<Record<keyof PngOutputPolicyInput | 'onWarning', PngOutputOptionFieldDescriptor>>)

export type PngOutputOptionField = keyof typeof PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS
export type PortablePngOutputOptionField = keyof PortablePngOutputOptions
export type NativePngOutputPolicyField = keyof PngOutputPolicyInput
export type NativePngHostOnlyOptionField = Exclude<PngOutputOptionField, PortablePngOutputOptionField>

export const PNG_OUTPUT_OPTION_FIELDS: readonly PngOutputOptionField[] = Object.freeze(
  Object.keys(PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS) as PngOutputOptionField[],
)

export const PORTABLE_PNG_OUTPUT_OPTION_FIELDS: readonly PortablePngOutputOptionField[] = Object.freeze(
  PNG_OUTPUT_OPTION_FIELDS.filter(field => PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS[field].scope === 'portable') as PortablePngOutputOptionField[],
)

/** Serializable fields accepted by the native output-policy resolver. */
export const NATIVE_PNG_OUTPUT_POLICY_FIELDS: readonly NativePngOutputPolicyField[] = Object.freeze(
  PNG_OUTPUT_OPTION_FIELDS.filter(field => PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS[field].policy === 'included') as NativePngOutputPolicyField[],
)

/** Native-only font inputs plus the non-serializable warning callback. */
export const NATIVE_PNG_HOST_ONLY_OPTION_FIELDS: readonly NativePngHostOnlyOptionField[] = Object.freeze(
  PNG_OUTPUT_OPTION_FIELDS.filter(field => PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS[field].scope === 'native-host-only') as NativePngHostOnlyOptionField[],
)

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneJson) as T
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)])) as T
}

/** Closed JSON Schema projection for portable or native PNG policy inputs. */
export function pngOutputOptionsJsonSchema(substrate: 'portable' | 'native' = 'portable'): Record<string, unknown> {
  const fields = substrate === 'portable'
    ? PORTABLE_PNG_OUTPUT_OPTION_FIELDS
    : NATIVE_PNG_OUTPUT_POLICY_FIELDS
  const properties = Object.fromEntries(fields.map(field => {
    const descriptor = PNG_OUTPUT_OPTION_FIELD_DESCRIPTORS[field]
    if (!descriptor.schema) throw new Error(`PNG policy field ${field} has no serializable schema`)
    return [field, {
      ...cloneJson(descriptor.schema),
      description: descriptor.description,
      'x-agentic-mermaid-scope': descriptor.scope,
      'x-agentic-mermaid-receipt': descriptor.receipt,
      ...('runtimeValidator' in descriptor
        ? { 'x-agentic-mermaid-runtime-validator': descriptor.runtimeValidator }
        : {}),
    }]
  }))
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://agentic-mermaid.dev/schemas/png-output-options-v${PNG_OUTPUT_POLICY_VERSION}-${substrate}.schema.json`,
    type: 'object',
    additionalProperties: false,
    properties,
  }
}

export interface ResolvedPngOutputPolicy {
  readonly version: typeof PNG_OUTPUT_POLICY_VERSION
  readonly scale: number
  readonly background:
    | { readonly mode: 'artifact'; readonly fallback: '#ffffff' }
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

export interface PngRasterDimensions {
  readonly width: number
  readonly height: number
  readonly pixels: number
}

type PngRasterBudgetPolicy = number | Pick<ResolvedPngOutputPolicy, 'scale' | 'fitTo'>

function svgRootTag(svg: string): SvgStartTagToken {
  if (typeof svg !== 'string') throw new RangeError('SVG input must be a string for PNG rasterization')
  const root = svgRootStartTag(svg)
  if (!root) throw new RangeError('could not determine the SVG root for PNG rasterization')
  return root
}

function svgRootAttribute(root: SvgStartTagToken, name: string): string | undefined {
  return decodedSvgAttributeValue(root, name)
}

function positiveSvgPixels(raw: string | undefined, field: string): number {
  const token = raw?.trim()
  if (!token || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(token)) {
    throw new RangeError(`SVG root ${field} must be a positive finite absolute pixel length for PNG rasterization`)
  }
  const value = Number(token.replace(/px$/i, ''))
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`SVG root ${field} must be a positive finite absolute pixel length for PNG rasterization`)
  }
  return value
}

function svgViewBoxDimensions(root: SvgStartTagToken): { readonly width: number; readonly height: number } {
  const values = svgRootAttribute(root, 'viewBox')?.trim().split(/[\s,]+/).map(Number)
  const width = values?.[2]
  const height = values?.[3]
  if (values?.length !== 4
    || values.some(value => !Number.isFinite(value))
    || width === undefined || height === undefined
    || width <= 0 || height <= 0) {
    throw new RangeError('SVG root viewBox must contain four finite values with positive bounds for PNG rasterization')
  }
  return Object.freeze({ width, height })
}

/**
 * Read the dimensions a rasterizer will actually allocate from the SVG root.
 * The viewBox remains an integrity cross-check: mismatched aspect ratios are
 * rejected rather than letting a custom backend hide a large intrinsic canvas
 * behind a small viewBox.
 */
export function svgIntrinsicDimensions(svg: string): { readonly width: number; readonly height: number } {
  const root = svgRootTag(svg)
  const viewBox = svgViewBoxDimensions(root)
  const rawWidth = svgRootAttribute(root, 'width')?.trim()
  const rawHeight = svgRootAttribute(root, 'height')?.trim()
  // A responsive root has no standalone pixel intrinsic size. Our PNG
  // contract gives the paired, exact 100% form one deterministic meaning:
  // the finite viewBox dimensions that every raster adapter subsequently
  // pins to integers. Other relative or mixed units remain ambiguous and are
  // rejected before allocation.
  const responsive = rawWidth === '100%' && rawHeight === '100%'
  const width = responsive ? viewBox.width : positiveSvgPixels(rawWidth, 'width')
  const height = responsive ? viewBox.height : positiveSvgPixels(rawHeight, 'height')
  const intrinsicRatio = width / height
  const viewRatio = viewBox.width / viewBox.height
  const ratioDelta = Math.abs(intrinsicRatio - viewRatio)
  const ratioTolerance = Math.max(Math.abs(intrinsicRatio), Math.abs(viewRatio), 1) * 1e-9
  if (ratioDelta > ratioTolerance) {
    throw new RangeError(
      `SVG intrinsic dimensions ${width}×${height} are inconsistent with viewBox ${viewBox.width}×${viewBox.height}`,
    )
  }
  return Object.freeze({ width, height })
}

/** Compute conservative final integer dimensions before a rasterizer allocates. */
export function pngRasterDimensions(svg: string, output: PngRasterBudgetPolicy): PngRasterDimensions {
  const bounds = svgIntrinsicDimensions(svg)
  if (typeof output !== 'number' && !isPlainObject(output)) {
    throw new RangeError('PNG raster policy must be a positive scale or resolved policy object')
  }
  if (typeof output === 'number' && (!Number.isFinite(output) || output <= 0)) {
    throw new RangeError('PNG raster scale must be a positive finite number')
  }
  if (typeof output !== 'number') {
    if (typeof output.scale !== 'number' || !Number.isFinite(output.scale) || output.scale <= 0
      || !isPlainObject(output.fitTo)
      || !['zoom', 'width', 'height'].includes(String(output.fitTo.mode))
      || typeof output.fitTo.value !== 'number' || !Number.isFinite(output.fitTo.value) || output.fitTo.value <= 0) {
      throw new RangeError('PNG raster policy must contain a positive finite scale and fitTo mode/value')
    }
  }
  const fitTo = typeof output === 'number'
    ? { mode: 'zoom' as const, value: output }
    : output.fitTo
  const scale = typeof output === 'number' ? output : output.scale
  const rawWidth = fitTo.mode === 'width'
    ? fitTo.value
    : fitTo.mode === 'height'
      ? bounds.width * fitTo.value / bounds.height
      : bounds.width * scale
  const rawHeight = fitTo.mode === 'height'
    ? fitTo.value
    : fitTo.mode === 'width'
      ? bounds.height * fitTo.value / bounds.width
      : bounds.height * scale
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    throw new RangeError('PNG raster budget rejected non-finite or non-positive final dimensions')
  }
  // Every first-party adapter uses this exact ceil-and-floor-at-one rule.
  // In particular, a very narrow aspect ratio fitted to 1px never asks a
  // rasterizer to allocate a zero-pixel secondary dimension.
  const width = Math.max(1, Math.ceil(rawWidth))
  const height = Math.max(1, Math.ceil(rawHeight))
  return Object.freeze({ width, height, pixels: width * height })
}

/**
 * Pin the SVG intrinsic canvas to the already-budgeted integer dimensions.
 * Native and WASM resvg then render at zoom 1, while browser Canvas receives
 * the same dimensions in its callback context. This avoids backend-specific
 * rounding of fitTo ratios.
 */
export function prepareSvgForPngRasterization(svg: string, dimensions: PngRasterDimensions): string {
  if (!Number.isSafeInteger(dimensions.width) || dimensions.width <= 0
    || !Number.isSafeInteger(dimensions.height) || dimensions.height <= 0
    || !Number.isSafeInteger(dimensions.pixels)
    || dimensions.pixels !== dimensions.width * dimensions.height) {
    throw new RangeError('PNG raster dimensions must be positive safe integers')
  }
  const root = svgRootTag(svg)
  if (!svgAttribute(root, 'width') || !svgAttribute(root, 'height')) {
    throw new RangeError('SVG root must declare intrinsic width and height')
  }
  let resized = transformSvgAttributes(svg.slice(root.start, root.end), attribute => {
    if (attribute.name === 'width') return String(dimensions.width)
    if (attribute.name === 'height') return String(dimensions.height)
    return undefined
  })
  // Canvas drawImage maps the decoded SVG to the exact integer destination.
  // Pin resvg to the same mapping, including the 1px secondary-dimension edge
  // case where preserving the original ratio is mathematically impossible.
  const resizedRoot = svgRootTag(resized)
  resized = svgAttribute(resizedRoot, 'preserveAspectRatio')
    ? transformSvgAttributes(resized, attribute => attribute.name === 'preserveAspectRatio' ? 'none' : undefined)
    : `${resized.slice(0, -1)} preserveAspectRatio="none">`
  const pinnedStyle = `width:${dimensions.width}px!important;height:${dimensions.height}px!important`
  if (svgAttribute(svgRootTag(resized), 'style')) {
    resized = transformSvgAttributes(resized, attribute => attribute.name === 'style'
      ? `${attribute.value.replace(/;?\s*$/, ';')}${pinnedStyle}`
      : undefined)
  } else {
    resized = `${resized.slice(0, -1)} style="${pinnedStyle}">`
  }
  return replaceSvgRootStartTag(svg, root, resized)
}

/** Shared allocation gate for native, browser, WASM, CLI, and MCP PNG paths. */
export function assertPngRasterBudget(svg: string, output: PngRasterBudgetPolicy): PngRasterDimensions {
  const dimensions = pngRasterDimensions(svg, output)
  if (dimensions.width > MAX_PNG_RASTER_DIMENSION
    || dimensions.height > MAX_PNG_RASTER_DIMENSION
    || !Number.isSafeInteger(dimensions.pixels)
    || dimensions.pixels > MAX_PNG_PIXELS) {
    const megapixels = Number.isFinite(dimensions.pixels)
      ? `${Math.ceil(dimensions.pixels / 1_000_000)}MP`
      : 'a non-finite pixel count'
    throw new RangeError(
      `PNG raster budget exceeded: ${dimensions.width}×${dimensions.height} (${megapixels}); `
      + `maximum dimension is ${MAX_PNG_RASTER_DIMENSION}px and pixel cap is ${Math.ceil(MAX_PNG_PIXELS / 1_000_000)}MP`,
    )
  }
  return dimensions
}

/** Hosted pre-allocation gate layered over the substrate-neutral dimensions. */
export function assertHostedPngRasterBudget(dimensions: PngRasterDimensions): PngRasterDimensions {
  const admitted = isPlainObject(dimensions)
  const width = admitted ? dimensions.width : Number.NaN
  const height = admitted ? dimensions.height : Number.NaN
  const pixels = admitted ? dimensions.pixels : Number.NaN
  if (!admitted
    || !Number.isSafeInteger(width) || width <= 0
    || !Number.isSafeInteger(height) || height <= 0
    || !Number.isSafeInteger(pixels)
    || pixels <= 0
    || pixels !== width * height
    || width > MAX_PNG_RASTER_DIMENSION
    || height > MAX_PNG_RASTER_DIMENSION
    || pixels > MAX_HOSTED_PNG_PIXELS) {
    throw new RangeError(
      `hosted PNG raster budget exceeded: ${String(width)}×${String(height)}; `
      + `maximum dimension is ${MAX_PNG_RASTER_DIMENSION}px and hosted pixel cap is ${Math.ceil(MAX_HOSTED_PNG_PIXELS / 1_000_000)}MP`,
    )
  }
  return dimensions
}

const BUNDLED_FONT_RESOURCES = Object.freeze(
  HOSTED_FONT_RESOURCES.map(resource => `${resource.identity.id}@${resource.identity.version}#sha256:${resource.sha256}`),
)

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertClosedPlainObject(
  value: unknown,
  allowedFields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`)
  const allowed = new Set(allowedFields)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(`${label} contains unknown option ${typeof key === 'symbol' ? String(key) : `"${key}"`}`)
    }
  }
}

function positiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer number of pixels`)
  }
  return value
}

/** Canonicalize a concrete CSS color into the exact bytes every PNG substrate
 * receives. CSS variables and color functions outside the runtime-neutral
 * parser deliberately remain unresolved. */
export function canonicalizeConcreteCssColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const rgba = tryParseCssColor(value)
  if (!rgba) return undefined
  const bytes = rgba.map((channel, index) => {
    const scaled = index === 3 ? channel * 255 : channel
    return Math.round(Math.max(0, Math.min(255, scaled)))
  })
  const hex = bytes.map(channel => channel.toString(16).padStart(2, '0')).join('')
  return `#${bytes[3] === 255 ? hex.slice(0, 6) : hex}`
}

/** Canonical portable explicit-background intersection understood identically
 * by Canvas and resvg. Keep this narrower admission contract separate from the
 * artifact background, whose safe CSS paint has already passed render-option
 * validation and is resolved to concrete bytes below. */
export function normalizePortablePngBackground(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const color = value.trim().toLowerCase()
  if (!/^#[0-9a-f]{3,4}$/.test(color)
    && !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(color)
    && !(color in PORTABLE_PNG_COLOR_KEYWORDS)) return undefined
  return canonicalizeConcreteCssColor(color)
}

export const PNG_ARTIFACT_BACKGROUND_UNRESOLVED = 'PNG_ARTIFACT_BACKGROUND_UNRESOLVED' as const

export class PngArtifactBackgroundError extends TypeError {
  readonly code = PNG_ARTIFACT_BACKGROUND_UNRESOLVED
  readonly paint: string

  constructor(paint: string) {
    super(`${PNG_ARTIFACT_BACKGROUND_UNRESOLVED}: PNG artifact background must resolve to a concrete CSS color`)
    this.name = 'PngArtifactBackgroundError'
    this.paint = paint
  }
}

/** Resolve explicit/artifact/fallback precedence once before substrate
 * dispatch. An authored but non-concrete artifact paint is an error: silently
 * substituting white would make valid rgb()/hsl() inputs and unresolved var()
 * references indistinguishable. */
export function resolvePngRasterBackground(
  svg: string,
  outputPolicy: Pick<ResolvedPngOutputPolicy, 'background'>,
): string {
  if (outputPolicy.background.mode === 'explicit') return outputPolicy.background.value
  const rootStyle = svgRootAttribute(svgRootTag(svg), 'style')
  const artifactPaint = rootStyle?.match(/(?:^|;)\s*--bg\s*:\s*([^;]+)/i)?.[1]?.trim()
  if (artifactPaint === undefined) return outputPolicy.background.fallback
  const concrete = canonicalizeConcreteCssColor(artifactPaint)
  if (concrete === undefined) throw new PngArtifactBackgroundError(artifactPaint)
  return concrete
}

function descriptorProjection(
  input: Readonly<Record<string, unknown>>,
  fields: readonly PngOutputOptionField[],
): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap(field =>
    Object.prototype.hasOwnProperty.call(input, field) && input[field] !== undefined
      ? [[field, input[field]]]
      : []))
}

/** Pick only portable PNG fields from a combined render/transport options bag. */
export function projectPortablePngOutputOptions(input: Readonly<Record<string, unknown>>): PortablePngOutputOptions {
  return descriptorProjection(input, PORTABLE_PNG_OUTPUT_OPTION_FIELDS) as PortablePngOutputOptions
}

/** Pick serializable native PNG policy fields from a combined options bag. */
export function projectNativePngOutputPolicyInput(input: Readonly<Record<string, unknown>>): PngOutputPolicyInput {
  return descriptorProjection(input, NATIVE_PNG_OUTPUT_POLICY_FIELDS) as PngOutputPolicyInput
}

/** Remove every canonical PNG adapter field, including the host callback. */
export function omitPngOutputOptions<T extends Readonly<Record<string, unknown>>>(input: T): Omit<T, PngOutputOptionField> {
  const fields = new Set<string>(PNG_OUTPUT_OPTION_FIELDS)
  return Object.fromEntries(Object.entries(input).filter(([field]) => !fields.has(field))) as Omit<T, PngOutputOptionField>
}

function normalizePngOutputPolicy(
  input: unknown,
  substrate: 'portable' | 'native',
): ResolvedPngOutputPolicy {
  const allowedFields = substrate === 'portable'
    ? PORTABLE_PNG_OUTPUT_OPTION_FIELDS
    : NATIVE_PNG_OUTPUT_POLICY_FIELDS
  assertClosedPlainObject(input, allowedFields, `${substrate === 'portable' ? 'portable' : 'native'} PNG output options`)

  const requestedScale = input.scale === undefined
    ? PNG_DEFAULT_SCALE
    : positiveFiniteNumber(input.scale, 'PNG scale')

  let width: number | undefined
  let height: number | undefined
  if (input.fitTo !== undefined) {
    assertClosedPlainObject(input.fitTo, ['width', 'height'], 'PNG fitTo')
    const fitKeys = Object.keys(input.fitTo)
    if (fitKeys.length !== 1 || (fitKeys[0] !== 'width' && fitKeys[0] !== 'height')) {
      throw new TypeError('PNG fitTo accepts exactly one of width or height')
    }
    if (Object.prototype.hasOwnProperty.call(input.fitTo, 'width')) {
      width = positiveInteger(input.fitTo.width, 'PNG fitTo.width')
    } else {
      height = positiveInteger(input.fitTo.height, 'PNG fitTo.height')
    }
  }

  if (input.background !== undefined && typeof input.background !== 'string') {
    throw new TypeError('PNG background must be a safe CSS color')
  }
  const explicitBackground = input.background === undefined ? undefined : normalizePortablePngBackground(input.background)
  if (input.background !== undefined && !explicitBackground) {
    throw new TypeError(
      'PNG background must be a safe CSS color in the portable basic-keyword or 3, 4, 6, or 8 digit hex intersection',
    )
  }

  let callerDirectories: readonly string[] = []
  let loadSystemFonts = false
  if (substrate === 'native') {
    if (input.fontDirs !== undefined) {
      const directories = input.fontDirs
      if (!Array.isArray(directories)
        || Object.getPrototypeOf(directories) !== Array.prototype
        || directories.length > MAX_PNG_FONT_DIRECTORIES
        || Reflect.ownKeys(directories).some(key => key !== 'length'
          && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= directories.length))) {
        throw new TypeError(`PNG fontDirs must be a dense array of at most ${MAX_PNG_FONT_DIRECTORIES} paths`)
      }
      for (let index = 0; index < directories.length; index++) {
        const directory = directories[index]
        if (!Object.prototype.hasOwnProperty.call(directories, index)
          || typeof directory !== 'string'
          || directory.trim() === ''
          || directory.length > MAX_PNG_FONT_DIRECTORY_LENGTH) {
          throw new TypeError(
            `PNG fontDirs must be a dense array of non-empty paths no longer than ${MAX_PNG_FONT_DIRECTORY_LENGTH} characters`,
          )
        }
      }
      callerDirectories = directories
    }
    if (input.loadSystemFonts !== undefined && typeof input.loadSystemFonts !== 'boolean') {
      throw new TypeError('PNG loadSystemFonts must be a boolean')
    }
    loadSystemFonts = input.loadSystemFonts ?? false
  }

  const fitTo = width !== undefined
    ? { mode: 'width' as const, value: width }
    : height !== undefined
      ? { mode: 'height' as const, value: height }
      : { mode: 'zoom' as const, value: requestedScale }
  // fitTo supersedes scale. Canonicalize the ignored field so receipts and
  // hosted cache keys do not distinguish requests that rasterize identically.
  const scale = fitTo.mode === 'zoom' ? requestedScale : PNG_DEFAULT_SCALE
  const background = explicitBackground === undefined
    ? { mode: 'artifact' as const, fallback: '#ffffff' as const }
    : { mode: 'explicit' as const, value: explicitBackground }
  return Object.freeze({
    version: PNG_OUTPUT_POLICY_VERSION,
    scale,
    background: Object.freeze(background),
    fitTo: Object.freeze(fitTo),
    fonts: Object.freeze({
      defaultFamily: PNG_DEFAULT_FONT_FAMILY,
      bundledResources: BUNDLED_FONT_RESOURCES,
      callerDirectories: Object.freeze([...callerDirectories]),
      loadSystemFonts,
    }),
  })
}

/** Normalize portable controls used by browser/WASM/hosted raster adapters. */
export function resolvePortablePngOutputPolicy(input: PortablePngOutputOptions = {}): ResolvedPngOutputPolicy {
  return normalizePngOutputPolicy(input, 'portable')
}

/** Normalize native controls and defaults before they participate in a receipt. */
export function resolvePngOutputPolicy(input: PngOutputPolicyInput = {}): ResolvedPngOutputPolicy {
  return normalizePngOutputPolicy(input, 'native')
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
