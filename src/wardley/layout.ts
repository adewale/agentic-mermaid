import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle } from '../styles.ts'
import type { RenderOptions } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { WardleyBody, PositionedWardley, WardleyPlacedText } from './types.ts'

/** Wardley positions encode visibility and evolution; measuring labels never
 * changes their coordinate domain or their dependency endpoints. */
export function layoutWardley(body: WardleyBody, options: Readonly<RenderOptions> = {}, styleFace?: InternalStyleFace): PositionedWardley {
  const style = resolveRenderStyle(options, undefined, styleFace), pad = options.padding ?? 32
  const titleBand = diagramTitleBand(body.title, style)
  const plot = { x: pad + 64, y: pad + (titleBand?.height ?? 0) + 24, width: Math.max(240, (body.size?.width ?? 800) - 2 * pad - 64), height: Math.max(180, (body.size?.height ?? 500) - 2 * pad - 72) }
  const measure = (text: string, role: 'node' | 'group' | 'edge' = 'node') => preparePixelText(text, { display: 'literal', fontSize: role === 'group' ? style.groupHeaderFontSize : role === 'edge' ? style.edgeLabelFontSize : style.nodeLabelFontSize, fontWeight: role === 'group' ? style.groupHeaderFontWeight : role === 'edge' ? style.edgeLabelFontWeight : style.nodeLabelFontWeight, letterSpacing: role === 'group' ? style.groupLetterSpacing : role === 'edge' ? style.edgeLetterSpacing : style.nodeLetterSpacing, transform: role === 'group' ? style.groupTextTransform : role === 'edge' ? style.edgeTextTransform : style.nodeTextTransform, maxWidth: 220, fontFamily: role === 'group' ? style.groupFont ?? options.font : options.font })
  const x = (value: number) => plot.x + value / 100 * plot.width, y = (value: number) => plot.y + (1 - value / 100) * plot.height
  const label = (id: string, text: string, px: number, py: number, role: 'node' | 'group' | 'edge' = 'node'): WardleyPlacedText => ({ id, text, x: px, y: py, block: measure(text, role), textRole: role })
  const nodes: PositionedWardley['nodes'] = body.nodes.map(node => ({ ...label(node.id, node.label, x(node.x!), y(node.y!)), node }))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const labels: WardleyPlacedText[] = [label('axis:visibility', body.axes.yLabel ?? 'Visibility', pad, plot.y - 12, 'group'), label('axis:evolution', body.axes.xLabel ?? 'Evolution', plot.x + plot.width / 2, plot.y + plot.height + 48, 'group')]
  const stages = body.axes.stages ?? ['Genesis', 'Custom built', 'Product', 'Commodity']
  stages.forEach((stage, index) => {
    const left = index === 0 ? 0 : body.axes.stageBoundaries?.[index - 1] ?? index / stages.length
    const right = body.axes.stageBoundaries?.[index] ?? (index + 1) / stages.length
    labels.push(label(`stage:${index}`, stage, x((left + right) * 50), plot.y + plot.height + 20, 'group'))
  })
  const stageHeight = Math.max(0, ...labels.filter(label => label.id.startsWith('stage:')).map(label => label.block.height))
  for (const item of labels) if (item.id.startsWith('stage:')) item.y = plot.y + plot.height + 12 + stageHeight / 2
  labels[1]!.y = plot.y + plot.height + stageHeight + 36
  body.notes.forEach((note, index) => labels.push(label(`note:${index}`, note.text, x(note.x), y(note.y))))
  body.annotations.forEach((annotation, index) => annotation.coordinates.forEach((at, coordinate) => labels.push(label(`annotation:${index}:${coordinate}`, `[${annotation.number}]`, x(at.x), y(at.y)))))
  let legendY = body.annotationsBox ? y(body.annotationsBox.y) : labels[1]!.y + labels[1]!.block.height + 24
  for (const [index, annotation] of body.annotations.entries()) if (annotation.text) {
    const legend = label(`annotation-text:${index}`, `${annotation.number}. ${annotation.text}`, body.annotationsBox ? x(body.annotationsBox.x) : plot.x + 110, legendY)
    labels.push(legend); legendY += legend.block.height + 12
  }
  for (const node of nodes) if (node.node.sourceStrategy) labels.push(label(`strategy:${node.id}`, `[${node.node.sourceStrategy}]`, node.x, node.y + 24, 'edge'))
  body.accelerators.forEach((force, index) => labels.push(label(`accelerator:${index}`, `${force.name} >>`, x(force.x), y(force.y))))
  body.deaccelerators.forEach((force, index) => labels.push(label(`deaccelerator:${index}`, `${force.name} <<`, x(force.x), y(force.y))))
  const edges: PositionedWardley['edges'] = body.links.map((link, index) => {
    const from = byId.get(link.source), to = byId.get(link.target)
    if (!from || !to) throw new Error('Wardley dependency has no positioned endpoint')
    return { id: `dependency:${index}`, from: link.source, to: link.target, points: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }], flow: link.flow, dashed: link.dashed,
      ...(link.label !== undefined ? { label: label(`dependency-label:${index}`, link.label, (from.x + to.x) / 2, (from.y + to.y) / 2, 'edge') } : {}) }
  })
  for (const [index, trend] of body.trends.entries()) {
    const from = byId.get(trend.nodeId)
    if (!from) throw new Error('Wardley evolution has no positioned component')
    edges.push({ id: `evolve:${index}`, from: trend.nodeId, to: trend.nodeId, points: [{ x: from.x, y: from.y }, { x: x(trend.targetX), y: y(trend.targetY) }], dashed: true, flow: 'forward', trend: true })
  }
  const pipelines = body.pipelines.map(pipeline => {
    const members = pipeline.componentIds.map(id => byId.get(id)!)
    const left = Math.min(...members.map(member => member.x)), right = Math.max(...members.map(member => member.x))
    return { id: `pipeline:${pipeline.nodeId}`, members: [...pipeline.componentIds], x: left - 12, y: byId.get(pipeline.nodeId)!.y - 12, width: Math.max(24, right - left + 24), height: 24 }
  })
  // Only automatically placed captions move. Component coordinates and
  // explicitly authored offsets remain exact; short leaders retain ownership.
  type Box = { x: number; y: number; width: number; height: number }
  const cells = new Map<string, Box[]>(), cellSize = 64
  const box = (item: WardleyPlacedText): Box => ({ x: item.x - item.block.width / 2 - 4, y: item.y - item.block.height / 2 - 4, width: item.block.width + 8, height: item.block.height + 8 })
  const keys = (rect: Box): string[] => { const result: string[] = []; for (let x = Math.floor(rect.x / cellSize); x <= Math.floor((rect.x + rect.width) / cellSize); x++) for (let y = Math.floor(rect.y / cellSize); y <= Math.floor((rect.y + rect.height) / cellSize); y++) result.push(`${x}:${y}`); return result }
  const add = (rect: Box): void => { for (const key of keys(rect)) { const values = cells.get(key) ?? []; values.push(rect); cells.set(key, values) } }
  const intersects = (rect: Box): boolean => keys(rect).some(key => cells.get(key)?.some(other => rect.x < other.x + other.width && rect.x + rect.width > other.x && rect.y < other.y + other.height && rect.y + rect.height > other.y))
  for (const item of [...labels, ...edges.flatMap(edge => edge.label ? [edge.label] : [])]) add(box(item))
  for (const node of nodes) add({ x: node.x - 10, y: node.y - 10, width: 20, height: 20 })
  for (const node of nodes) if (node.node.labelOffsetX !== undefined || node.node.labelOffsetY !== undefined) {
    node.label = { ...node, x: node.x + (node.node.labelOffsetX ?? 14), y: node.y + (node.node.labelOffsetY ?? -14) }
    add(box(node.label))
  }
  let overflowY = plot.y + plot.height + 96
  for (const node of nodes) if (!node.label) {
    const preferred = { ...node, x: node.x + 14, y: node.y - 14 }, step = node.block.height + 12
    let placed: WardleyPlacedText | undefined
    for (let ring = 0; ring < 12 && !placed; ring++) {
      const candidates = ring === 0 ? [[0, 0]] : [[0, -ring * step], [0, ring * step], [-ring * 24, -ring * step], [ring * 24, -ring * step]]
      for (const [dx, dy] of candidates) { const candidate = { ...preferred, x: preferred.x + dx!, y: preferred.y + dy! }; if (!intersects(box(candidate))) { placed = candidate; break } }
    }
    if (!placed) { placed = { ...preferred, x: plot.x + node.block.width / 2, y: overflowY + node.block.height / 2 }; overflowY += node.block.height + 12 }
    node.label = placed; add(box(placed))
    if (Math.hypot(placed.x - preferred.x, placed.y - preferred.y) > 1) {
      const dx = node.x - placed.x, dy = node.y - placed.y, t = Math.min(dx ? placed.block.width / (2 * Math.abs(dx)) : Infinity, dy ? placed.block.height / (2 * Math.abs(dy)) : Infinity)
      node.leader = [{ x: node.x, y: node.y }, { x: placed.x + dx * t, y: placed.y + dy * t }]
    }
  }
  // Label retention may grow the canvas beyond an authored plot size; it
  // never compresses the authored coordinate domain or clips content.
  let width = plot.x + plot.width + pad, height = plot.y + plot.height + 64 + pad, minX = pad, minY = pad + (titleBand?.height ?? 0)
  for (const item of [...labels, ...edges.flatMap(edge => edge.label ? [edge.label] : []), ...nodes.map(node => node.label!)]) {
    width = Math.max(width, item.x + item.block.width / 2 + pad)
    height = Math.max(height, item.y + item.block.height / 2 + pad)
    minX = Math.min(minX, item.x - item.block.width / 2)
    minY = Math.min(minY, item.y - item.block.height / 2)
  }
  const dx = Math.max(0, pad - minX), dy = Math.max(0, pad + (titleBand?.height ?? 0) - minY)
  if (dx || dy) {
    plot.x += dx; plot.y += dy
    for (const item of [...nodes, ...nodes.map(node => node.label!), ...labels, ...edges.flatMap(edge => edge.label ? [edge.label] : [])]) { item.x += dx; item.y += dy }
    for (const edge of edges) for (const point of edge.points) { point.x += dx; point.y += dy }
    for (const pipeline of pipelines) { pipeline.x += dx; pipeline.y += dy }
    for (const node of nodes) for (const point of node.leader ?? []) { point.x += dx; point.y += dy }
    width += dx; height += dy
  }
  width = Math.max(width, (titleBand?.width ?? 0) + 2 * pad)
  return { width, height, plot, body, nodes, labels, edges, pipelines, options, ...(titleBand ? { title: positionDiagramTitle(titleBand, width, pad) } : {}) }
}
