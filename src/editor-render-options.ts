import type { RenderOptions } from './types.ts'

export interface EditorRenderStateInput {
  readonly palette?: unknown
  readonly style?: unknown
  readonly seed?: unknown
  readonly config?: unknown
}

export interface EditorRenderOptionDependencies {
  readonly allowedFields: readonly string[]
  readonly validate: (options: unknown) => readonly string[]
  readonly resolvePaletteInput: (palette: unknown) => string
}

/**
 * Resolve the exact render request consumed by the live Editor.
 *
 * Share hashes, restored drafts, and tests all cross this one boundary so the
 * allowlist, validation, style precedence, seed handling, and host-owned
 * security policy cannot drift between producers and the browser consumer.
 */
export function resolveEditorRenderOptions(
  state: EditorRenderStateInput | null | undefined,
  dependencies: EditorRenderOptionDependencies,
): RenderOptions {
  const input = state ?? {}
  const rawConfig = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
    ? input.config as Record<string, unknown>
    : {}
  const config: Record<string, unknown> = Object.create(null)
  for (const field of dependencies.allowedFields) {
    if (Object.prototype.hasOwnProperty.call(rawConfig, field) && rawConfig[field] !== undefined) {
      config[field] = rawConfig[field]
    }
  }

  const problems = dependencies.validate(config)
  if (problems.length > 0) throw new Error(`Invalid render options: ${problems.join('; ')}`)

  const configStyle = config.style
  delete config.style
  const options: Record<string, unknown> = {
    embedFontImport: false,
    security: 'strict',
    ...config,
  }
  // The Editor owns these sink policies even when a restored payload contains
  // valid but weaker values.
  options.embedFontImport = false
  options.security = 'strict'

  const styleStack: unknown[] = []
  if (input.style && input.style !== 'crisp') styleStack.push(input.style)
  if (Array.isArray(configStyle)) styleStack.push(...configStyle)
  else if (configStyle) styleStack.push(configStyle)
  const paletteInput = dependencies.resolvePaletteInput(input.palette)
  if (paletteInput) styleStack.push(paletteInput)
  if (styleStack.length === 1) options.style = styleStack[0]
  else if (styleStack.length > 1) options.style = styleStack

  if (input.style && input.style !== 'crisp' && options.seed === undefined) {
    options.seed = typeof input.seed === 'number' && Number.isFinite(input.seed) ? input.seed : 0
  }
  options.security = 'strict'
  return options as RenderOptions
}
