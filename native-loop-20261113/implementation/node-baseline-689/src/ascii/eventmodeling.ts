import { prepareDisplayText } from '../shared/display-text.ts'
import { TerminalDocument } from './terminal-document.ts'
import { parseEventModeling, eventLane, eventRelations } from '../eventmodeling/parser.ts'
import { eventFrameText } from '../eventmodeling/layout.ts'
import { convertToAsciiGraph } from './converter.ts'
import { createMapping } from './grid.ts'
import { drawGraph } from './draw.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import type { AsciiConfig, ColorMode, AsciiTheme } from './types.ts'
import type { MermaidGraph } from '../types.ts'
export function renderEventModelingTerminal(source: string, config: AsciiConfig, colorMode?: ColorMode, theme?: AsciiTheme) {
  const body = parseEventModeling(source)
  const graph: MermaidGraph = {
    direction: 'LR',
    nodes: new Map(
      body.frames.map(frame => [frame.id, { id: frame.id, label: `${eventLane(frame)}\n${eventFrameText(body, frame)}`, labelContent: { value: `${eventLane(frame)}\n${eventFrameText(body, frame)}`, prepared: prepareDisplayText(`${eventLane(frame)}\n${eventFrameText(body, frame)}`, 'literal') }, shape: 'rectangle' }]),
    ),
    edges: eventRelations(body).map(edge => ({ id: edge.id, source: edge.from, target: edge.to, style: 'solid', hasArrowStart: false, hasArrowEnd: true })),
    subgraphs: [],
    classDefs: new Map(),
    classAssignments: new Map(),
    nodeStyles: new Map(),
    linkStyles: new Map(),
  }
  const positioned = convertToAsciiGraph(graph, { ...config, graphDirection: 'LR' })
  createMapping(positioned)
  drawGraph(positioned)
  const document = new TerminalDocument()
  const top = body.title ? (document.textBlock(0, 0, [body.title], { role: 'text', owner: { id: 'title', kind: 'label' } })?.height ?? 0) + 1 : 0
  document.overlay(positioned.canvas, 0, top)
  return terminalArtifact(document, { colorMode, theme })
}
