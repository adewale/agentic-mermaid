import { decodeXML } from 'entities'
import type { FamilyDescriptor } from './agent/families.ts'
import type { RenderOptions } from './types.ts'
import {
  detectBrowserBuiltinFamilyFromFirstLine,
  type BrowserBuiltinFamilyId,
} from './browser-lazy/generated/catalog.ts'
import { normalizeMermaidSource } from './mermaid-source.ts'

type FamilyModule = { default: FamilyDescriptor }
type FamilyLoader = () => Promise<FamilyModule>

const FAMILY_LOADERS = Object.freeze({
  flowchart: () => import('./browser-lazy/families/flowchart.ts'),
  state: () => import('./browser-lazy/families/state.ts'),
  sequence: () => import('./browser-lazy/families/sequence.ts'),
  timeline: () => import('./browser-lazy/families/timeline.ts'),
  class: () => import('./browser-lazy/families/class.ts'),
  er: () => import('./browser-lazy/families/er.ts'),
  journey: () => import('./browser-lazy/families/journey.ts'),
  architecture: () => import('./browser-lazy/families/architecture.ts'),
  xychart: () => import('./browser-lazy/families/xychart.ts'),
  pie: () => import('./browser-lazy/families/pie.ts'),
  quadrant: () => import('./browser-lazy/families/quadrant.ts'),
  gantt: () => import('./browser-lazy/families/gantt.ts'),
  mindmap: () => import('./browser-lazy/families/mindmap.ts'),
  gitgraph: () => import('./browser-lazy/families/gitgraph.ts'),
  radar: () => import('./browser-lazy/families/radar.ts'),
  sankey: () => import('./browser-lazy/families/sankey.ts'),
} satisfies Record<BrowserBuiltinFamilyId, FamilyLoader>)

export class BrowserFamilyDetectionError extends Error {
  readonly code = 'UNSUPPORTED_FAMILY'

  constructor(firstLine: string) {
    super(`Unsupported Mermaid family in async browser renderer: ${JSON.stringify(firstLine)}.`)
    this.name = 'BrowserFamilyDetectionError'
  }
}

function detectFamily(source: string): BrowserBuiltinFamilyId {
  const normalized = normalizeMermaidSource(decodeXML(source))
  const familyId = detectBrowserBuiltinFamilyFromFirstLine(normalized.firstLine)
  if (!familyId) throw new BrowserFamilyDetectionError(normalized.firstLine)
  return familyId
}

/** Render SVG while downloading only the selected diagram family on demand.
 * The classic synchronous `agentic-mermaid/browser` entry remains available
 * for script-tag consumers that prefer one all-in-one file. */
export async function renderMermaidSVGAsync(
  source: string,
  options: RenderOptions = {},
): Promise<string> {
  const familyId = detectFamily(source)
  const [{ default: family }, { renderLoadedFamilySvg }] = await Promise.all([
    FAMILY_LOADERS[familyId](),
    import('./browser-lazy/render-core.ts'),
  ])
  return renderLoadedFamilySvg(source, options, family)
}

export type { RenderOptions }
