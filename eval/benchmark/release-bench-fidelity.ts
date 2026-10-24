import { decodeXML } from 'entities'
import type { BenchInput, LayoutCache, LayoutMode } from './release-bench-types.ts'

/** Keep text measurement symmetric, and exclude the automatic forest policy
 * from explicit solver comparisons, including older default-only packages. */
export function layoutCacheEnvironment(cache: LayoutCache): Record<string, string> {
  return {
    AGENTIC_MERMAID_ELK_CACHE: cache === 'normal' ? '1' : '0',
    AGENTIC_MERMAID_EXPERIMENTS: cache === 'normal' ? 'text-spans,position-cache' : 'text-spans',
  }
}
import type { RenderOptions } from '../../src/types.ts'

/** Omission is the legacy benchmark; explicit arms share diagnostic policy. */
export function layoutRenderOptions(mode?: LayoutMode): RenderOptions | undefined {
  if (!mode) return undefined
  return {
    graphLayout: mode === 'elk' ? { backend: 'elk' }
      : { backend: 'agentic', fallback: mode === 'agentic-with-elk' ? 'elk' : 'none' },
    onConfigDiagnostic: () => {},
  }
}

/** Check actual text emitted by the renderer, outside the timed call. */
export function missingSvgLabels(svg: string, expected: readonly string[] = []): string[] {
  const labels = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
  return expected.filter(label => !labels.includes(label))
}

export const agentEditCase: BenchInput = {
  id: 'agent:edit-flowchart', family: 'flowchart', workflow: 'edit-flowchart',
  source: 'flowchart LR\n  API["API"] --> DB["Database"]',
  expectedSvgLabels: ['API', 'Database', 'Cache', 'lookup'],
}

type AgentApi = typeof import('../../src/agent/index.ts')

/** Include the complete editing loop, then independently read back the edit
 * and preserved facts after serialization. No renderer or mutation internals. */
export function renderAgentEdit(api: AgentApi, source: string, renderOptions?: RenderOptions, renderFinal?: (source: string) => string): string {
  const parsed = api.parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error('agent workflow: parse failed')
  const flow = api.asFlowchart(parsed.value)
  if (!flow) throw new Error('agent workflow: not a structured flowchart')
  const node = api.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
  if (!node.ok) throw new Error('agent workflow: add_node failed')
  const edge = api.mutate(node.value, { kind: 'add_edge', from: 'API', to: 'Cache', label: 'lookup' })
  if (!edge.ok || !api.verifyMermaid(edge.value, renderOptions ? { renderOptions } : undefined).ok) throw new Error('agent workflow: edit verification failed')
  const serialized = api.serializeMermaid(edge.value)
  const reparsed = api.parseRegisteredMermaid(serialized)
  if (!reparsed.ok || !api.checkMermaid(reparsed.value, [
    'node API : API', 'node DB : Database', 'edge API -> DB',
    'node Cache : Cache', 'edge API -> Cache : lookup',
  ]).ok) throw new Error('agent workflow: requested or preserved facts were lost')
  return renderFinal ? renderFinal(serialized) : api.renderMermaidSVG(serialized, renderOptions)
}
