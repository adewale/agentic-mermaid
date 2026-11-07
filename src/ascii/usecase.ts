import type { AsciiContext } from '../agent/families.ts'
import { projectUsecaseGraph } from '../usecase/graph.ts'
import { parseUsecaseDiagram } from '../usecase/parser.ts'
import { flipCanvasVertically } from './canvas.ts'
import { convertToAsciiGraph } from './converter.ts'
import { drawGraph } from './draw.ts'
import { createMapping } from './grid.ts'
import { terminalArtifact } from './terminal-artifact.ts'

export function renderUsecaseTerminal(ctx: AsciiContext) {
  const body = parseUsecaseDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody),
    model = projectUsecaseGraph(body, true)
  const graph = convertToAsciiGraph(model, { ...ctx.config, title: body.title ?? ctx.config.title,
    graphDirection: body.direction === 'LR' || body.direction === 'RL' ? 'LR' : 'TD', reverseDirection: body.direction === 'RL',
  }, 'cluster')
  createMapping(graph)
  drawGraph(graph)
  if (body.direction === 'BT') flipCanvasVertically(graph.canvas)
  graph.canvas.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'usecase.actor', message: 'Actors use labelled terminal boxes; actor roles, system boundaries, relationship endpoints and include/extend labels remain explicit.' })
  return terminalArtifact(graph.canvas, { colorMode: ctx.colorMode, theme: ctx.theme })
}
