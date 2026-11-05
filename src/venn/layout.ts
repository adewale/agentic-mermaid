import { layoutCircles, findSpot, regionPath } from './geometry.ts'
import { validateVenn, vennRegionId, vennRegionIdentities } from './parser.ts'
import type { VennBody, PositionedVenn } from './types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import type { RenderOptions } from '../types.ts'
import { preparePixelText } from '../shared/prepared-text.ts'
import { diagramTitleBand, positionDiagramTitle, resolveRenderStyle, FLOWCHART_STYLE_DEFAULTS } from '../styles.ts'

export function layoutVennDiagram(body: VennBody, options: RenderOptions = {}, face?: InternalStyleFace, title?: string): PositionedVenn {
  validateVenn(body)
  const style = resolveRenderStyle(options, FLOWCHART_STYLE_DEFAULTS, face)
  const measure = (text: string) => preparePixelText(text, { fontSize: style.nodeLabelFontSize, fontWeight: style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, fontFamily: options.font, maxWidth: 220, display: 'literal' })
  const band = diagramTitleBand(body.title ?? title, style),
    padding = 32
  const circles = layoutCircles(body.subsets)
  const widest = circles.reduce((max, circle) => Math.max(max, circle.r), 0)
  const scale = widest > 0 ? 140 / widest : 1
  for (const circle of circles) {
    circle.x *= scale
    circle.y *= scale
    circle.r *= scale
  }
  let minX = Math.min(0, ...circles.map(circle => circle.x - circle.r)),
    minY = Math.min(0, ...circles.map(circle => circle.y - circle.r))
  let maxX = Math.max(100, ...circles.map(circle => circle.x + circle.r)),
    maxY = Math.max(80, ...circles.map(circle => circle.y + circle.r))
  const labels: PositionedVenn['labels'] = [],
    regions: PositionedVenn['regions'] = []
  const regionIds = vennRegionIdentities(body)
  const used = new Set([...circles.map(circle => circle.id), ...body.textNodes.map(node => node.id), ...regionIds.values()])
  const allocate = (prefix: string): string => {
    let n = 0
    while (used.has(`${prefix}${n}`)) n++
    const id = `${prefix}${n}`
    used.add(id)
    return id
  }
  const regionLabels = new Map<string, { id: string; text: string; sets: string[] }[]>()
  for (const subset of body.subsets) regionLabels.set(vennRegionId(subset.sets), [{ id: allocate('venn-label-'), text: subset.label ?? subset.sets.join(' ∩ '), sets: subset.sets }])
  for (const node of body.textNodes) {
    const key = vennRegionId(node.sets),
      values = regionLabels.get(key) ?? []
    values.push({ id: node.id, text: node.label ?? node.id, sets: node.sets })
    regionLabels.set(key, values)
  }
  for (const [key, values] of regionLabels) {
    const sets = values[0]!.sets
    const regionId = regionIds.get(key)!
    const inside = circles.flatMap((circle, index) => (sets.includes(circle.id) ? [index] : []))
    const outside = circles.flatMap((circle, index) => (sets.includes(circle.id) ? [] : [index]))
    // Bound total circle checks as the number of authored regions grows.
    const probeBudget = Math.max(1, Math.min(640, Math.floor(3e6 / Math.max(1, circles.length * regionLabels.size))))
    const spot = findSpot(circles, inside, outside, probeBudget)
    const measured = values.map(value => ({ ...value, block: measure(value.text) }))
    const height = measured.reduce((sum, value) => sum + value.block.height + 4, -4)
    let y = spot.margin > 0 ? spot.y - height / 2 : maxY + 20
    const x = spot.margin > 0 ? spot.x : (minX + maxX) / 2
    for (const value of measured) {
      const cy = y + value.block.height / 2
      labels.push({ ...value, id: body.textNodes.some(node => node.id === value.id) ? allocate('venn-label-') : value.id, x, y: cy, ownerId: body.textNodes.some(node => node.id === value.id) ? value.id : regionId })
      minX = Math.min(minX, x - value.block.width / 2)
      maxX = Math.max(maxX, x + value.block.width / 2)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y + value.block.height)
      y += value.block.height + 4
    }
    if (sets.length > 1)
      regions.push({
        id: regionId,
        sets: [...sets],
        path: regionPath(
          inside.map(index => circles[index]!),
          n => String(Math.round(n * 1e6) / 1e6),
        ),
      })
  }
  const offsetX = padding - minX,
    offsetY = padding + (band?.height ?? 0) - minY
  circles.forEach(circle => {
    circle.x += offsetX
    circle.y += offsetY
  })
  labels.forEach(label => {
    label.x += offsetX
    label.y += offsetY
  })
  // Paths are rebuilt from the translated circles so drawing and inspection share coordinates.
  regions.forEach(region => {
    region.path = regionPath(
      circles.filter(circle => region.sets.includes(circle.id)),
      n => String(Math.round(n * 1e6) / 1e6),
    )
  })
  const width = Math.ceil(Math.max(maxX - minX + padding * 2, (band?.width ?? 0) + padding * 2)),
    height = Math.ceil(maxY - minY + padding * 2 + (band?.height ?? 0))
  return { width, height, body, circles, regions, labels, options, ...(band ? { title: positionDiagramTitle(band, width, padding) } : {}) }
}
