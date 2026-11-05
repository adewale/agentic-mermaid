import type { AsciiContext } from '../agent/families.ts'
import { checkAllGraphAuthoredStyles } from '../shared/style-props.ts'
import { parseSwimlaneRenderSource } from '../swimlane/parser.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { drawGraph } from './draw.ts'
import { flipCanvasVertically } from './canvas.ts'
import { terminalArtifact, type TerminalArtifact } from './terminal-artifact.ts'

/** The terminal graph compositor retains authored lane identities, nested
 * memberships, shape-specific cards and physical cross-lane connector ports.
 * Its cell geometry is independent of the SVG band's pixel geometry. */
export function renderSwimlaneTerminal(context: AsciiContext): TerminalArtifact {
  const parsed = parseSwimlaneRenderSource(context.source.authoredFamilyBody ?? context.source.familyBody, context.source.familyBody)
  checkAllGraphAuthoredStyles(parsed)
  const config = { ...context.config, graphDirection: parsed.direction === 'LR' || parsed.direction === 'RL' ? 'LR' as const : 'TD' as const,
    reverseDirection: parsed.direction === 'RL' }
  const graph = convertToAsciiGraph(parsed, config)
  createMapping(graph)
  drawGraph(graph)
  if (parsed.direction === 'BT') flipCanvasVertically(graph.canvas)
  return terminalArtifact(graph.canvas, { colorMode: context.colorMode, theme: context.theme })
}
