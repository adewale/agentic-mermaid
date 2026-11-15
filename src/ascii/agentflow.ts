import type { AsciiContext } from '../agent/families.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'
import { parseAgentflow } from '../agentflow/parser.ts'
import { projectAgentflowGraph } from '../agentflow/projection.ts'
import { ownedAgentflowRenderGraph } from '../agent/owned-render-model.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { drawGraph } from './draw.ts'
import { flipCanvasVertically } from './canvas.ts'
import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'

export function renderAgentflowTerminal(context: AsciiContext): TerminalArtifact {
  const parsed = ownedAgentflowRenderGraph(context.source) ?? projectAgentflowGraph(parseAgentflow(context.source.authoredFamilyBody ?? context.source.familyBody, false))
  checkAllGraphAuthoredStyles(parsed)
  const config = { ...context.config, graphDirection: parsed.direction === 'LR' || parsed.direction === 'RL' ? 'LR' as const : 'TD' as const,
    reverseDirection: parsed.direction === 'RL' }
  const graph = convertToAsciiGraph(parsed, config)
  createMapping(graph)
  drawGraph(graph)
  if (parsed.direction === 'BT') flipCanvasVertically(graph.canvas)
  return terminalArtifact(graph.canvas, { colorMode: context.colorMode, theme: context.theme })
}
