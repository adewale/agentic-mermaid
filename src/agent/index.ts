// ============================================================================
// agentic-mermaid — public agent surface (v4)
// Re-exports the runtime-neutral core plus the Node-native PNG renderer.
// Browser/workerd consumers should import `agentic-mermaid/agent/core` so
// their bundle never resolves the native PNG dependency tree.
// ============================================================================

export * from './core.ts'
export { createMermaidPNGRenderer, renderMermaidPNG, renderMermaidPNGWithReceipt } from './png.ts'
export type {
  MermaidPNGRenderer, MermaidPNGRendererHostOptions, PngOptions, RenderedPng,
} from './png.ts'

import { renderMermaidPNG } from './png.ts'
import { layoutMermaid, renderMermaidSVG } from './core.ts'
import { renderMermaidASCIIWithMeta, type AsciiRegion, type AsciiWarning } from '../ascii/meta.ts'
import { parseRegisteredMermaid as parseMermaid } from './parse.ts'
import { collectActionRecords } from './analyze.ts'
import { prepareRenderInput } from './render-input.ts'
import { SHARED_RENDER_OPTION_FIELDS } from '../render-contract.ts'
import { toFinite } from './types.ts'
import { inspectPngDimensions } from '../output-color-profile.ts'
import { decodedSvgAttributeValue, scanSvgStartTags } from '../svg-structure.ts'
import type { AsciiRenderOptions } from '../ascii/index.ts'
import type { PngOptions } from './png.ts'
import type {
  DiagramActionRecord,
  ParsedDiagram,
  RenderedRegion,
  RenderedRegionKind,
} from './types.ts'
import type { RenderOptions } from '../types.ts'

export type RendererActionFormat = 'svg' | 'png' | 'ascii' | 'unicode'
export type RendererActionDisposition = 'embedded-inert' | 'sidecar-only'

export interface RendererAction extends DiagramActionRecord {
  surface: RendererActionFormat
  disposition: RendererActionDisposition
  /** Surface-coordinate hit region, absent when the target was not rendered. */
  region?: RenderedRegion
}

export interface RendererActionSurface {
  version: 1
  format: RendererActionFormat
  coordinateSpace: 'pixel' | 'cell'
  /** Only regions referenced by at least one action. */
  regions: RenderedRegion[]
  /** Callbacks remain metadata-only and `executable` is always false. */
  actions: RendererAction[]
}

export type RenderMermaidActionRequest =
  | { format: 'svg'; options?: RenderOptions }
  | { format: 'png'; options?: PngOptions }
  | { format: 'ascii' | 'unicode'; options?: AsciiRenderOptions }

export type RenderedActionArtifact =
  | { format: 'svg'; output: string; actionSurface: RendererActionSurface }
  | { format: 'png'; output: Uint8Array; actionSurface: RendererActionSurface }
  | { format: 'ascii' | 'unicode'; output: string; actionSurface: RendererActionSurface; warnings: AsciiWarning[] }

function sharedRenderOptions(options: Readonly<Record<string, unknown>>): RenderOptions {
  const result: Record<string, unknown> = {}
  for (const field of SHARED_RENDER_OPTION_FIELDS) {
    if (options[field] !== undefined) result[field] = options[field]
  }
  return result as RenderOptions
}

function terminalRegionId(region: AsciiRegion): string {
  if (region.kind === 'node') return `node:${region.id}`
  if (region.kind === 'edge') return `edge:${region.id}`
  if (region.kind === 'label') return `label:${region.id}`
  return `group:${region.id}`
}

function terminalRegionKind(kind: AsciiRegion['kind']): RenderedRegionKind {
  return kind === 'subgraph' ? 'cluster' : kind
}

function terminalRegion(region: AsciiRegion): RenderedRegion {
  return {
    id: terminalRegionId(region),
    kind: terminalRegionKind(region.kind),
    elementId: region.id,
    bounds: {
      x: toFinite(region.canvasColStart),
      y: toFinite(region.canvasRow),
      w: toFinite(Math.max(1, region.canvasColEnd - region.canvasColStart)),
      h: toFinite(Math.max(1, region.rowSpan ?? 1)),
    },
    ...(region.sourceLine !== undefined ? { sourceLine: region.sourceLine } : {}),
  }
}

function actionSurface(
  format: RendererActionFormat,
  coordinateSpace: RendererActionSurface['coordinateSpace'],
  actions: DiagramActionRecord[],
  regions: RenderedRegion[],
  embeddedSvgActions: ReadonlySet<string> = new Set(),
): RendererActionSurface {
  const byId = new Map(regions.map(region => [region.id, region]))
  const rendererActions: RendererAction[] = actions.map(action => {
    const region = action.regionId ? byId.get(action.regionId) : undefined
    return {
      ...action,
      surface: format,
      disposition: format === 'svg' && region && action.href !== undefined
        && embeddedSvgActions.has(`${action.target}\u0000${action.href}`)
        ? 'embedded-inert'
        : 'sidecar-only',
      ...(region ? { region } : {}),
    }
  })
  const referencedIds = new Set(rendererActions.flatMap(action => action.region ? [action.region.id] : []))
  return {
    version: 1,
    format,
    coordinateSpace,
    regions: regions.filter(region => referencedIds.has(region.id)),
    actions: rendererActions,
  }
}

function embeddedSvgActionKeys(svg: string): ReadonlySet<string> {
  const result = new Set<string>()
  for (const tag of scanSvgStartTags(svg)) {
    const href = decodedSvgAttributeValue(tag, 'data-href')
    const targets = [decodedSvgAttributeValue(tag, 'data-task'), decodedSvgAttributeValue(tag, 'data-id')]
    if (href !== undefined) {
      for (const target of targets) if (target !== undefined) result.add(`${target}\u0000${href}`)
    }
    const links = decodedSvgAttributeValue(tag, 'data-links')
    const target = targets.find(candidate => candidate !== undefined)
    if (links === undefined || target === undefined) continue
    try {
      const menu = JSON.parse(links) as unknown
      if (!menu || typeof menu !== 'object' || Array.isArray(menu)) continue
      for (const value of Object.values(menu)) {
        if (typeof value === 'string') result.add(`${target}\u0000${value}`)
      }
    } catch {
      // Renderer-owned metadata should always be JSON. Ignore malformed tags
      // instead of upgrading an action to embedded without exact evidence.
    }
  }
  return result
}

function scalePixelRegions(regions: RenderedRegion[], scaleX: number, scaleY: number): RenderedRegion[] {
  return regions.map(region => ({
    ...region,
    bounds: {
      x: toFinite(region.bounds.x * scaleX),
      y: toFinite(region.bounds.y * scaleY),
      w: toFinite(region.bounds.w * scaleX),
      h: toFinite(region.bounds.h * scaleY),
    },
  }))
}

/**
 * Render SVG, PNG, ASCII, or Unicode and return one renderer-neutral inert
 * action/hit-region sidecar. The ordinary byte/string render APIs are unchanged.
 */
export function renderMermaidWithActions(
  input: ParsedDiagram | string,
  request: RenderMermaidActionRequest,
): RenderedActionArtifact {
  const source = prepareRenderInput(input).source
  if (request.format === 'ascii' || request.format === 'unicode') {
    const meta = renderMermaidASCIIWithMeta(input, {
      ...(request.options ?? {}),
      useAscii: request.format === 'ascii',
    })
    const failure = meta.warnings.find(warning => warning.code === 'ASCII_RENDER_FAILED')
    if (failure) throw new Error(failure.message)
    const regions = meta.regions.map(terminalRegion)
    return {
      format: request.format,
      output: meta.ascii,
      actionSurface: actionSurface(request.format, 'cell', meta.actions, regions),
      warnings: meta.warnings,
    }
  }

  const options = request.options ?? {}
  const shared = sharedRenderOptions(options as Readonly<Record<string, unknown>>)
  const parsed = parseMermaid(source)
  if (!parsed.ok) throw new Error(parsed.error.map(error => error.message).join('; '))
  const diagram = typeof input === 'string' ? parsed.value : input
  const layout = layoutMermaid(diagram, { ...shared, regions: true })
  const actions = collectActionRecords(parsed.value)
  if (request.format === 'svg') {
    const output = renderMermaidSVG(input, options)
    return {
      format: 'svg',
      output,
      actionSurface: actionSurface('svg', 'pixel', actions, layout.regions ?? [], embeddedSvgActionKeys(output)),
    }
  }
  const output = renderMermaidPNG(input, options)
  const dimensions = inspectPngDimensions(output)
  const regions = scalePixelRegions(
    layout.regions ?? [],
    layout.bounds.w > 0 ? dimensions.width / layout.bounds.w : 1,
    layout.bounds.h > 0 ? dimensions.height / layout.bounds.h : 1,
  )
  return { format: 'png', output, actionSurface: actionSurface('png', 'pixel', actions, regions) }
}
