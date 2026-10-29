// Fishbone row allocation adapted from Pele (MIT, copyright 2026 kepano).
// See LICENSES/pele-MIT.txt. Scene ownership and retained text are Agentic's.
import type { IshikawaBody, IshikawaNode, PositionedIshikawa, PositionedIshikawaNode, IshikawaBranch } from './types.ts'
import type { RenderOptions } from '../types.ts'
import type { InternalStyleFace } from '../scene/style-registry.ts'
import { FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle, diagramTitleBand, positionDiagramTitle } from '../styles.ts'
import { preparePixelText, type PixelTextBlock } from '../shared/prepared-text.ts'
import { hierarchyChildren, validateHierarchy } from '../shared/hierarchy-model.ts'

interface Bone {
  node: IshikawaNode
  block: PixelTextBlock
  depth: number
  parent: number
  slot: number
  kids: number
  rise: number
  at: number
  textEnd: number
}
interface Category {
  node: IshikawaNode
  block: PixelTextBlock
  width: number
  height: number
  bones: Bone[]
  rise: number
  reach: number
}

export function layoutIshikawaDiagram(body: IshikawaBody, options: RenderOptions = {}, styleFace?: InternalStyleFace, title?: string, diagramPadding = 24): PositionedIshikawa {
  validateHierarchy(body.nodes)
  const style = resolveRenderStyle(options, FLOWCHART_STYLE_DEFAULTS, styleFace)
  const categoryPadX = styleFace?.node?.paddingX ?? 12, categoryPadY = styleFace?.node?.paddingY ?? 8,
    effectPadX = styleFace?.node?.paddingX ?? 16, effectPadY = styleFace?.node?.paddingY ?? 12
  const children = hierarchyChildren(body.nodes)
  const measure = (label: string, bold = false) => preparePixelText(label, { fontSize: style.nodeLabelFontSize, fontWeight: bold && styleFace?.node?.fontWeight === undefined && styleFace?.text?.fontWeight === undefined ? Math.max(600, style.nodeLabelFontWeight) : style.nodeLabelFontWeight, letterSpacing: style.nodeLetterSpacing, transform: style.nodeTextTransform, maxWidth: 220 })
  const band = diagramTitleBand(title, style)
  const root = body.nodes[0]
  if (!root) return { width: Math.max(100, (band?.width ?? 0) + diagramPadding * 2), height: 80 + (band?.height ?? 0), body, nodes: [], branches: [], spine: [], options, ...(band ? { title: positionDiagramTitle(band, Math.max(100, band.width + diagramPadding * 2), diagramPadding) } : {}) }
  const arrange = (node: IshikawaNode, up: boolean): Category => {
    const block = measure(node.label, true)
    const bones: Bone[] = []
    const rows: number[] = []
    const pending: { node: IshikawaNode; depth: number; parent: number; slot: number; bone: number }[] = []
    const push = (items: IshikawaNode[], depth: number, parent: number) => {
      for (let slot = items.length - 1; slot >= 0; slot--) pending.push({ node: items[up ? items.length - 1 - slot : slot]!, depth, parent, slot, bone: -1 })
    }
    push(children.get(node.id) ?? [], 2, -1)
    while (pending.length) {
      const frame = pending.pop()!
      if (frame.bone !== -1) {
        rows.push(frame.bone)
        continue
      }
      const index = bones.length
      const kids = children.get(frame.node.id) ?? []
      bones.push({ node: frame.node, block: measure(frame.node.label), depth: frame.depth, parent: frame.parent, slot: frame.slot, kids: kids.length, rise: 0, at: 0, textEnd: 0 })
      if (frame.depth % 2 === 0) rows.push(index)
      else pending.push({ ...frame, bone: index })
      push(kids, frame.depth + 1, index)
    }
    let rise = 16
    for (const index of rows) {
      const height = bones[index]!.block.height + 14
      bones[index]!.rise = rise + height / 2
      rise += height
    }
    let reach = (block.width + categoryPadX * 2) / 2
    for (const bone of bones) {
      const parent = bone.parent < 0 ? undefined : bones[bone.parent]
      if (bone.depth % 2 === 0) {
        bone.at = parent?.at ?? 0
        bone.textEnd = bone.at - (bone.kids ? (bone.kids + 1) * 24 : 20) - 6
      } else {
        bone.at = parent!.at - (parent!.kids - bone.slot) * 24
        bone.textEnd = bone.at - 6
      }
      reach = Math.max(reach, bone.block.width - bone.textEnd)
    }
    return { node, block, width: block.width + categoryPadX * 2, height: block.height + categoryPadY * 2, bones, rise: Math.max(64, rise + 12), reach }
  }
  const categories = (children.get(root.id) ?? []).map((node, index) => arrange(node, index % 2 === 0))
  const head = measure(root.label, true)
  const headWidth = head.width + effectPadX * 2
  const headHeight = Math.max(52, head.height + effectPadY * 2)
  const nodes: PositionedIshikawaNode[] = [{ node: root, block: head, x: 0, y: -headHeight / 2, width: headWidth, height: headHeight, depth: 0 }]
  const branches: IshikawaBranch[] = []
  let minX = -40
  let maxX = headWidth
  let minY = -headHeight / 2
  let maxY = headHeight / 2
  let axisX = -40
  const anchors: number[] = []
  for (let index = 0; index < categories.length; index += 2) {
    if (index > 0) {
      let gap = 0
      for (let side = 0; side < 2; side++) {
        const previous = categories[index - 2 + side]
        const next = categories[index + side]
        if (previous) gap = Math.max(gap, previous.reach + (next?.width ?? 0) / 2 + Math.abs((next?.rise ?? 0) - previous.rise) / 2)
      }
      axisX -= gap + 32
    }
    anchors.push(axisX, axisX)
  }
  const addNode = (node: IshikawaNode, block: PixelTextBlock, x: number, y: number, width: number, height: number, depth: number) => {
    nodes.push({ node, block, x, y, width, height, depth })
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x + width)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y + height)
  }
  categories.forEach((category, index) => {
    const sign = index % 2 === 0 ? -1 : 1
    const anchor = anchors[index]!
    const px = (at: number, rise: number) => anchor + at - rise / 2
    const endX = px(0, category.rise)
    const endY = sign * category.rise
    addNode(category.node, category.block, endX - category.width / 2, endY + (sign < 0 ? -category.height : 0), category.width, category.height, 1)
    branches.push({
      id: `branch:${category.node.id}`,
      from: category.node.id,
      to: root.id,
      points: [
        { x: endX, y: endY },
        { x: anchor, y: 0 },
      ],
    })
    for (const bone of category.bones) {
      const y = sign * bone.rise
      const right = px(bone.textEnd, bone.rise)
      addNode(bone.node, bone.block, right - bone.block.width, y - bone.block.height / 2, bone.block.width, bone.block.height, bone.depth)
      const points =
        bone.depth % 2 === 0
          ? [
              { x: right + 6, y },
              { x: px(bone.at, bone.rise), y },
            ]
          : [
              { x: px(bone.at, bone.rise), y },
              { x: px(bone.at, category.bones[bone.parent]!.rise), y: sign * category.bones[bone.parent]!.rise },
            ]
      branches.push({ id: `branch:${bone.node.id}`, from: bone.node.id, to: bone.node.parentId!, points })
    }
  })
  const tail = Math.min(minX - 28, axisX - 28)
  minX = Math.min(minX, tail)
  const innerWidth = Math.max(maxX - minX, band?.width ?? 0)
  const width = Math.ceil(innerWidth + 2 * diagramPadding)
  const height = Math.ceil(maxY - minY + (band?.height ?? 0) + diagramPadding * 2)
  const dx = diagramPadding - minX + (innerWidth - (maxX - minX)) / 2
  const dy = diagramPadding - minY + (band?.height ?? 0)
  for (const node of nodes) {
    node.x += dx
    node.y += dy
  }
  for (const branch of branches)
    for (const point of branch.points) {
      point.x += dx
      point.y += dy
    }
  return {
    width,
    height,
    body,
    nodes,
    branches,
    spine: [
      { x: tail + dx, y: dy },
      { x: dx, y: dy },
    ],
    options,
    ...(band ? { title: positionDiagramTitle(band, width, diagramPadding) } : {}),
  }
}
