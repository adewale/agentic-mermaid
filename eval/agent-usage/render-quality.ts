import { executeInSandbox } from '../../src/mcp/sandbox.ts'
import { BUILTIN_FAMILY_METADATA, parseMermaid, renderMermaidSVG, verifyMermaid, verifyNoExternalRefs, type DiagramKind } from '../../src/agent/index.ts'
import { DEFAULT_CASES, type AgentUsageEvalCase } from './run.ts'

export const AGENT_USAGE_SUPPORTED_FAMILIES: readonly DiagramKind[] = BUILTIN_FAMILY_METADATA.map(family => family.id)

export interface AgentUsageRenderQualityResult {
  id: string
  family: DiagramKind | 'unknown'
  ok: boolean
  sourceOk: boolean
  verifyOk: boolean
  renderOk: boolean
  safeSvgOk: boolean
  boundsOk: boolean
  semanticLabelsOk: boolean
  warnings: string[]
  metrics?: {
    width: number
    height: number
    nodes: number
    edges: number
    svgBytes: number
  }
  error?: string
}

export interface AgentUsageRenderQualitySummary {
  ok: boolean
  total: number
  passed: number
  families: DiagramKind[]
  results: AgentUsageRenderQualityResult[]
}

const EXPECTED_VISIBLE_LABELS: Record<string, string[]> = {
  cache_between_api_and_db: ['API', 'Cache', 'DB'],
  state_add_done_transition: ['Processing', 'done'],
  sequence_alt_add_message: ['hi', 'bye', 'yes'],
  timeline_add_event: ['Alpha', 'Beta'],
  class_add_duck: ['Duck', 'quack'],
  er_add_order: ['CUSTOMER', 'ORDER', 'string'],
  journey_add_review_task: ['Draft', 'Review', 'Agent'],
  architecture_add_cache: ['API', 'Cache', 'cache'],
  xychart_add_forecast: ['Q1', 'Q2'],
  pie_add_docs_slice: ['Build', 'Test', 'Docs'],
  quadrant_add_docs_point: ['API', 'Docs'],
  gantt_add_docs_task: ['Core', 'Docs'],
  mindmap_add_evidence_node: ['Product', 'Research', 'Evidence'],
  gitgraph_add_release_commit: ['ROOT', 'RC', 'rc.1'],
  radar_add_beta_curve: ['Speed', 'Alpha', 'Beta'],
  author_auth_flow_source: ['User', 'Login Page', 'Dashboard'],
  author_api_sequence_source: ['User', 'App', 'API', 'Render SVG', 'Download'],
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function numericBoundsFromSvg(svg: string): { width: number; height: number } | undefined {
  const viewBox = svg.match(/\bviewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/i)
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) }
  const width = svg.match(/\bwidth="([\d.]+)"/i)
  const height = svg.match(/\bheight="([\d.]+)"/i)
  if (!width || !height) return undefined
  return { width: Number(width[1]), height: Number(height[1]) }
}

function hasVisibleSvgContent(svg: string): boolean {
  return /<(?:text|tspan|path|rect|circle|ellipse|line|polyline|polygon)\b/i.test(svg)
}

function semanticLabelsOk(id: string, svg: string): boolean {
  const labels = EXPECTED_VISIBLE_LABELS[id] ?? []
  if (labels.length === 0) return true
  return labels.every(label => svg.includes(escapeXmlText(label)))
}

export async function scoreAgentUsageRenderedQuality(cases: AgentUsageEvalCase[] = DEFAULT_CASES): Promise<AgentUsageRenderQualitySummary> {
  const results: AgentUsageRenderQualityResult[] = []
  for (const c of cases) {
    try {
      const exec = await executeInSandbox(c.script, { trace: true })
      const source = exec.ok ? (exec.value as { source?: unknown } | undefined)?.source : undefined
      if (typeof source !== 'string') {
        results.push({ id: c.id, family: c.family ?? 'unknown', ok: false, sourceOk: false, verifyOk: false, renderOk: false, safeSvgOk: false, boundsOk: false, semanticLabelsOk: false, warnings: [], error: exec.ok ? 'script did not return { source }' : String(exec.error) })
        continue
      }
      const parsed = parseMermaid(source)
      if (!parsed.ok) {
        results.push({ id: c.id, family: c.family ?? 'unknown', ok: false, sourceOk: false, verifyOk: false, renderOk: false, safeSvgOk: false, boundsOk: false, semanticLabelsOk: false, warnings: [], error: 'source did not parse' })
        continue
      }
      const verify = verifyMermaid(parsed.value)
      const warnings = verify.warnings.map(w => w.code)
      let svg = ''
      let renderError: string | undefined
      try {
        svg = renderMermaidSVG(source, { security: 'strict', compact: true, idPrefix: `agent-usage-${c.id}-` })
      } catch (error) {
        renderError = error instanceof Error ? error.message : String(error)
      }
      const safeSvg = svg ? verifyNoExternalRefs(svg) : { ok: false, refs: [] as string[] }
      const svgBounds = svg ? numericBoundsFromSvg(svg) : undefined
      const width = svgBounds?.width ?? verify.layout.bounds.w
      const height = svgBounds?.height ?? verify.layout.bounds.h
      const boundsOk = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width <= 4000 && height <= 4000
      const renderOk = !renderError && svg.startsWith('<svg') && hasVisibleSvgContent(svg)
      const labelsOk = renderOk && semanticLabelsOk(c.id, svg)
      const result: AgentUsageRenderQualityResult = {
        id: c.id,
        family: c.family ?? parsed.value.kind,
        ok: verify.ok && renderOk && safeSvg.ok && boundsOk && labelsOk,
        sourceOk: true,
        verifyOk: verify.ok,
        renderOk,
        safeSvgOk: safeSvg.ok,
        boundsOk,
        semanticLabelsOk: labelsOk,
        warnings: safeSvg.ok ? warnings : [...warnings, ...safeSvg.refs.map(ref => `external:${ref}`)],
        metrics: { width, height, nodes: verify.layout.nodes.length, edges: verify.layout.edges.length, svgBytes: Buffer.byteLength(svg) },
        error: renderError,
      }
      results.push(result)
    } catch (error) {
      results.push({ id: c.id, family: c.family ?? 'unknown', ok: false, sourceOk: false, verifyOk: false, renderOk: false, safeSvgOk: false, boundsOk: false, semanticLabelsOk: false, warnings: [], error: error instanceof Error ? error.message : String(error) })
    }
  }
  const passed = results.filter(r => r.ok).length
  const families = [...new Set(results.map(r => r.family).filter((f): f is DiagramKind => f !== 'unknown'))]
  return { ok: passed === results.length, total: results.length, passed, families, results }
}
