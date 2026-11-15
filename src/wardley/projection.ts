import type { FamilyPositionedProjectionContext, FamilyPositionedView } from '../agent/families.ts'
import { f, retainedLabelBounds, retainedLabelGeometry, canvasOf, labelRect } from '../positioned-views/geometry.ts'
import type { PositionedWardley } from './types.ts'
export function projectWardleyPositioned({ positioned: chart }: FamilyPositionedProjectionContext<PositionedWardley>): FamilyPositionedView {
  const parents = new Map(chart.pipelines.flatMap(pipeline => pipeline.members.map(id => [id, pipeline.id] as const)))
  return { version: 1, bounds: { w: f(chart.width), h: f(chart.height) },
    nodes: chart.nodes.map(item => ({ id: item.id, ...(parents.has(item.id) ? { parentId: parents.get(item.id) } : {}), x: f(item.x - 7), y: f(item.y - 7), w: f(14), h: f(14), shape: item.node.isPipelineParent ? 'rectangle' : 'circle', role: 'labelled-mark', label: item.text, ...retainedLabelGeometry(item.block, item.label!.x, item.label!.y, canvasOf(chart)) })),
    edges: chart.edges.map(edge => ({ id: edge.id, from: edge.from, to: edge.to, path: edge.points.map(point => [f(point.x), f(point.y)]), ...(edge.label ? { label: { x: f(edge.label.x), y: f(edge.label.y), text: edge.label.text, bounds: retainedLabelBounds(edge.label.block, edge.label.x, edge.label.y) } } : {}) })),
    groups: chart.pipelines.map(pipeline => ({ id: pipeline.id, x: f(pipeline.x), y: f(pipeline.y), w: f(pipeline.width), h: f(pipeline.height), label: '', members: pipeline.members })),
    labels: [...chart.labels, ...chart.edges.flatMap(edge => edge.label ? [edge.label] : [])].map(label => ({ id: label.id, text: label.text, bounds: retainedLabelBounds(label.block, label.x, label.y), container: labelRect(canvasOf(chart)) })).concat([
      ...chart.nodes.map(item => ({ id: `node:${item.id}`, text: item.text, bounds: retainedLabelBounds(item.block, item.label!.x, item.label!.y), container: labelRect(canvasOf(chart)) })),
      ...(chart.title ? [{ id: 'title', text: chart.title.text, bounds: retainedLabelBounds(chart.title.block, chart.title.x, chart.title.y), container: labelRect(canvasOf(chart)) }] : []),
    ]),
  }
}
