import { decodeXML } from 'entities'
import type { FamilyDescriptor } from './agent/families.ts'
import type { RenderOptions } from './types.ts'
import { detectBrowserBuiltinFamilyFromFirstLine, type BrowserBuiltinFamilyId } from './browser-lazy/generated/catalog.ts'
import { mermaidFirstLine } from './mermaid-source-wrapper.ts'

type FamilyModule = { default: FamilyDescriptor }
type FamilyLoader = () => Promise<FamilyModule>

const FAMILY_LOADERS = Object.freeze({
  zenuml: () => import('./browser-lazy/families/zenuml.ts'),
  eventmodeling: () => import('./browser-lazy/families/eventmodeling.ts'),
  packet: () => import('./browser-lazy/families/packet.ts'),
  kanban: () => import('./browser-lazy/families/kanban.ts'),
  requirement: () => import('./browser-lazy/families/requirement.ts'),
  treemap: () => import('./browser-lazy/families/treemap.ts'),
  ishikawa: () => import('./browser-lazy/families/ishikawa.ts'),
  block: () => import('./browser-lazy/families/block.ts'),
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
  c4: () => import('./browser-lazy/families/c4.ts'),
} satisfies Record<BrowserBuiltinFamilyId, FamilyLoader>)

export class BrowserFamilyDetectionError extends Error {
  readonly code = 'UNSUPPORTED_FAMILY'

  constructor(firstLine: string) {
    super(`Unsupported Mermaid family in async browser renderer: ${JSON.stringify(firstLine)}.`)
    this.name = 'BrowserFamilyDetectionError'
  }
}

function detectFamily(source: string): BrowserBuiltinFamilyId {
  // Only the header line is needed here; the family's render normalizes the
  // whole source (frontmatter, directives) once its chunk has loaded.
  const firstLine = mermaidFirstLine(decodeXML(source))
  const familyId = detectBrowserBuiltinFamilyFromFirstLine(firstLine)
  if (!familyId) throw new BrowserFamilyDetectionError(firstLine)
  return familyId
}

/** Render SVG while downloading only the selected diagram family on demand.
 * The classic synchronous `agentic-mermaid/browser` entry remains available
 * for script-tag consumers that prefer one all-in-one file. */
export async function renderMermaidSVGAsync(source: string, options: RenderOptions = {}): Promise<string> {
  return (await renderMermaidSVGWithReceiptAsync(source, options)).svg
}

/** Receipt-bearing lazy rendering retains the complete canonical contract. */
export async function renderMermaidSVGWithReceiptAsync(source: string, options: RenderOptions = {}): Promise<import('./svg-api.ts').RenderedSvg> {
  const familyId = detectFamily(source)
  const [{ default: family }, { renderLoadedFamilySvgWithReceipt }] = await Promise.all([FAMILY_LOADERS[familyId](), import('./browser-lazy/render-core.ts')])
  return renderLoadedFamilySvgWithReceipt(source, options, family)
}

export type { RenderOptions }
