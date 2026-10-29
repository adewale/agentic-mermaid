import { sceneLowering, type DrawingFactory, type DrawingDocument } from '../scene/drawing.ts'
import { createFillInkResolver } from '../color-resolver.ts'
import { escapeAttr } from '../multiline-utils.ts'
import type { SceneNode } from '../scene/ir.ts'
import { resolveRoleStyle, sceneRoleTraits } from '../scene/roles.ts'
import { categoricalPalette } from '../shared/categorical-palette.ts'
import { contrastRatio, toHex, tryParseCssColor, WCAG_AA_TEXT_CONTRAST } from '../shared/color-math.ts'
import { hierarchyChildren } from '../shared/hierarchy-model.ts'
import { drawingDocument } from '../shared/scene-document.ts'
import { diagramTitleFields, FLOWCHART_STYLE_DEFAULTS, resolveRenderStyle } from '../styles.ts'
import type { RenderContext } from '../types.ts'
import { resolvedColorValue } from '../theme.ts'
import type { PositionedTreemap } from './types.ts'

export function lowerTreemapDrawing<T>(marks: DrawingFactory<T>, { positioned: chart, colors, resolved }: RenderContext<PositionedTreemap>): DrawingDocument<T> {
  const style = resolveRenderStyle(resolved.renderOptions, { ...FLOWCHART_STYLE_DEFAULTS, nodeLabelFontSize: chart.config.labelFontSize }, resolved.styleFace)
  const categoryCount = chart.body.nodes.filter(node => !node.parentId).length,
    paletteInputs = { accent: colors.accent, bg: colors.bg },
    palette = categoricalPalette(categoryCount, paletteInputs)
  const parts: T[] = []
  const contents = new Map<string, T[]>()
  const inkForFill = createFillInkResolver(colors)
  // At most the two Style role inks add a palette. Source-class inks never
  // multiply palette work and retain their authored-paint limitations.
  const inkPalettes = new Map<string, string[]>(),
    pageHalo = (resolved.paintBackendId === 'backend:rough' || resolved.paintBackendId === 'backend:hybrid') && sceneRoleTraits('label').textHalo,
    page = pageHalo ? tryParseCssColor(resolvedColorValue('var(--bg)', colors) ?? colors.bg) : undefined
  const paletteForInk = (ink: string | undefined): string[] => {
    if (ink === undefined) return palette
    const retained = inkPalettes.get(ink)
    if (retained) return retained
    const parsed = tryParseCssColor(resolvedColorValue(ink, colors) ?? ink)
    // The selected sketch backend puts label glyphs on its page-colored halo.
    // A page-readable ink therefore does not constrain the rectangle beneath.
    const concreteInk = parsed?.[3] === 1 ? toHex(parsed[0], parsed[1], parsed[2]) : undefined,
      readsOnHalo = concreteInk !== undefined && page?.[3] === 1 && contrastRatio(concreteInk, toHex(page[0], page[1], page[2]))! >= WCAG_AA_TEXT_CONTRAST,
      derived = concreteInk !== undefined && !readsOnHalo ? categoricalPalette(categoryCount, { ...paletteInputs, labelInk: concreteInk }) : palette
    inkPalettes.set(ink, derived)
    return derived
  }
  const childrenByParent = hierarchyChildren(chart.body.nodes)
  const total = chart.cells.filter(cell => !cell.node.parentId).reduce((sum, cell) => sum + cell.total, 0)
  if (chart.title) parts.push(marks.text(diagramTitleFields(chart.title, style)))
  for (const cell of chart.cells) {
    if (cell.width <= 0 || cell.height <= 0) {
      contents.set(cell.node.id, [])
      continue
    }
    const section = cell.node.value === undefined,
      channels = { value: total > 0 ? cell.total / total : 0, category: String(cell.category) },
      roleStyle = resolveRoleStyle(resolved.styleFace, 'bar', channels, { includeFallback: false })
    const authored = cell.node.className ? chart.body.classDefs[cell.node.className] : undefined
    const roleFill = section ? style.groupFillColor : style.nodeFillColor,
      roleInk = section ? style.groupTextColor : style.nodeTextColor,
      explicitInk = authored?.color ?? roleInk,
      headerFill = section && cell.headerHeight ? (authored?.fill ?? style.groupHeaderFillColor) : undefined,
      declaredFill = authored?.fill ?? roleStyle?.fillColor ?? roleFill,
      derivedPalette = declaredFill === undefined && headerFill === undefined && authored?.color === undefined ? paletteForInk(roleInk) : palette,
      fill = declaredFill ?? derivedPalette[cell.category] ?? 'var(--_node-fill)',
      stroke = authored?.stroke ?? roleStyle?.strokeColor ?? roleStyle?.borderColor ?? (section ? style.groupBorderColor : style.nodeBorderColor) ?? 'var(--bg)',
      strokeWidth = authored?.['stroke-width'] ?? String(roleStyle?.lineWidth ?? (section ? resolved.styleFace?.group?.lineWidth : resolved.styleFace?.node?.lineWidth) ?? chart.config.borderWidth),
      radius = Math.min((section ? style.groupCornerRadius : style.cornerRadius) ?? 0, cell.width / 2, cell.height / 2, headerFill ? cell.headerHeight! / 2 : Infinity)
    // Authored class and Style ink are authoritative on categorical surfaces
    // too. Only the family's derived text tone is contrast-adapted.
    const textFill = headerFill ?? fill
    const ink = explicitInk ?? inkForFill('var(--_text)', textFill, Boolean(authored?.fill || roleStyle?.fillColor || headerFill || !roleFill))
    const owner = { id: cell.node.id, role: section ? ('group' as const) : ('node' as const) }
    const children: T[] = []
    if (cell.width > 0 && cell.height > 0)
      children.push(
        marks.shape({
          id: `cell:${cell.node.id}`,
          role: 'bar',
          owner,
          geometry: { kind: 'rect', x: cell.x, y: cell.y, width: cell.width, height: cell.height, ...(radius > 0 ? { rx: radius, ry: radius } : {}) },
          paint: { fill, stroke, strokeWidth },
          channels,
        }),
      )
    if (headerFill && cell.width > 0 && cell.height > 0) {
      // Keep the header surface inside the border; its paint never changes the
      // quantitative rectangle or the partition allocated to its descendants.
      const inset = Math.min((Number.parseFloat(strokeWidth) || 0) / 2, cell.width / 2, cell.headerHeight! / 2),
        x = cell.x + inset,
        y = cell.y + inset,
        width = cell.width - inset * 2,
        height = cell.headerHeight! - inset,
        r = Math.max(0, radius - inset)
      if (width > 0 && height > 0)
        children.push(
          marks.shape({
            id: `header:${cell.node.id}`,
            role: 'chrome',
            owner,
            geometry: r > 0 ? { kind: 'path', d: `M${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${y + height}H${x}V${y + r}Q${x} ${y} ${x + r} ${y}Z` } : { kind: 'rect', x, y, width, height },
            paint: { fill: headerFill, stroke: 'none' },
          }),
        )
    }
    if (cell.label) children.push(marks.text({ id: `label:${cell.node.id}`, role: 'label', owner, text: cell.label.text, block: cell.label, x: cell.x + cell.width / 2, y: cell.labelY!, fontSize: cell.label.fontSize, fontWeight: cell.label.fontWeight, anchor: 'middle', paint: { fill: ink } }))
    if (cell.valueLabel) children.push(marks.text({ id: `value:${cell.node.id}`, role: 'label', owner, text: cell.valueLabel.text, block: cell.valueLabel, x: cell.x + cell.width / 2, y: cell.valueY!, fontSize: cell.valueLabel.fontSize, fontWeight: cell.valueLabel.fontWeight, anchor: 'middle', paint: { fill: ink } }))
    contents.set(cell.node.id, children)
  }
  // Actual Scene containment follows the authored hierarchy. Quantitative
  // rectangles and their measured text remain owned by that section or leaf.
  const groups = new Map<string, T>()
  for (const cell of [...chart.cells].reverse()) {
    const children = contents.get(cell.node.id)!
    for (const child of childrenByParent.get(cell.node.id) ?? []) {
      const group = groups.get(child.id)
      if (group) children.push(group)
    }
    // A label too small to paint still names its quantitative cell. Keep the
    // exact value independent of the author's cosmetic number formatting.
    // The native SVG title supplies both the accessible name and tooltip.
    const section = cell.node.value === undefined,
      accessible = !cell.label ? escapeAttr(`${cell.node.label}: ${cell.total}`) : undefined
    groups.set(
      cell.node.id,
      marks.group({
        id: cell.node.id,
        role: section ? 'group' : 'node',
        open: `<g${cell.node.parentId ? ` data-parent="${escapeAttr(cell.node.parentId)}"` : ''}${accessible === undefined ? '' : ` role="${section ? 'group' : 'graphics-symbol'}" aria-roledescription="treemap ${section ? 'section' : 'cell'}"`}>${accessible === undefined ? '' : `<title>${accessible}</title>`}`,
        close: '</g>',
        children: children.map(node => ({ node, indent: 2 })),
      }),
    )
  }
  for (const cell of chart.cells) if (!cell.node.parentId) parts.push(groups.get(cell.node.id)!)
  return drawingDocument(marks, 'treemap', chart, colors, resolved.renderOptions.transparent ?? false, parts)
}

export const lowerTreemapScene = sceneLowering<PositionedTreemap>(lowerTreemapDrawing)
