import { parseWardley } from './parser.ts'
import { buildWardley } from './model.ts'
import type { WardleyBody } from './types.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'

export function parseWardleyBody(source: string): WardleyBody {
  const { type: _type, accTitle, accDescr, ...model } = buildWardley(parseWardley(source), undefined)
  assertDiagramWorkLimit('nodes', model.nodes.length + model.notes.length + model.annotations.length + model.accelerators.length + model.deaccelerators.length)
  assertDiagramWorkLimit('edges', model.links.length + model.trends.length)
  return { kind: 'wardley', ...model, accessibilityTitle: accTitle, accessibilityDescription: accDescr }
}
