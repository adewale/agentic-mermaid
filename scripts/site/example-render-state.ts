import type { RenderOptions } from '../../src/types.ts'
import type { EditorShareState } from './editor-state-url.ts'

/**
 * One complete request for an Examples-page proof and its Editor deep link.
 * Host-owned security/font/ID options are added by each surface separately;
 * every portable render option lives here and is transferred in the link.
 */
export interface ExampleRenderState {
  readonly source: string
  readonly renderOptions: RenderOptions
  readonly editorState: EditorShareState
}

/** The comparable review treatment used by the basic family cards. */
export const WEBSITE_EXAMPLE_THEME = Object.freeze({
  bg: '#FFFFFF',
  fg: '#27272A',
  accent: '#1A7351',
  line: '#8B9791',
  muted: '#5D6864',
  surface: '#F8FAF8',
  border: '#D3DDD7',
  font: 'Avenir Next',
}) satisfies Readonly<RenderOptions>

function editorConfig(options: RenderOptions): Record<string, unknown> {
  return { ...options } as Record<string, unknown>
}

function portableOptions(options: RenderOptions): RenderOptions {
  const {
    security: _security,
    embedFontImport: _embedFontImport,
    idPrefix: _idPrefix,
    ...portable
  } = options
  return portable
}

/**
 * Put arbitrary portable render options in config and explicitly select the
 * Editor's crisp/no-palette controls. This prevents recipient preferences from
 * changing a gallery proof while preserving custom style stacks verbatim.
 */
export function createExampleRenderState(
  source: string,
  options: RenderOptions = {},
): ExampleRenderState {
  const renderOptions: RenderOptions = { ...portableOptions(options), compact: true }
  return {
    source,
    renderOptions,
    editorState: {
      source,
      palette: '',
      style: 'crisp',
      seed: 0,
      config: editorConfig(renderOptions),
    },
  }
}

/**
 * Styled showcase cards also expose their named look/palette in the Editor UI.
 * The remaining options still travel as the complete portable config.
 */
export function createStyledExampleRenderState(
  source: string,
  appearance: { style: string; palette: string; seed: number },
  options: RenderOptions = {},
): ExampleRenderState {
  // Named appearance belongs to the visible Editor controls. Discard any
  // conflicting hidden style/seed values so a later control change cannot be
  // overridden by stale Advanced Options.
  const { style: _style, seed: _seed, ...remaining } = portableOptions(options)
  const config: RenderOptions = { ...remaining, compact: true }
  const renderOptions: RenderOptions = {
    ...config,
    style: [appearance.style, appearance.palette],
    seed: appearance.seed,
  }
  return {
    source,
    renderOptions,
    editorState: {
      source,
      palette: appearance.palette,
      style: appearance.style,
      seed: appearance.seed,
      config: editorConfig(config),
    },
  }
}
