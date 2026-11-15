import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagramTitle } from '../styles.ts'
import type { PositionedDiagram, RenderOptions } from '../types.ts'

export interface TreemapNode {
  id: string
  label: string
  parentId?: string
  value?: number
  className?: string
}
export interface TreemapBody {
  kind: 'treemap'
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  nodes: TreemapNode[]
  classDefs: Record<string, Record<string, string>>
}
export type TreemapMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_node'; label: string; value?: number; parentId?: string; className?: string }
  | { kind: 'remove_node'; id: string }
  | { kind: 'set_label'; id: string; label: string }
  | { kind: 'set_value'; id: string; value: number }
  | { kind: 'move_node'; id: string; parentId?: string; index?: number }
  | { kind: 'define_class'; name: string; style: string }
  | { kind: 'set_node_class'; id: string; className: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

export interface TreemapConfig {
  width: number
  height: number
  padding: number
  diagramPadding: number
  showValues: boolean
  labelFontSize: number
  valueFontSize: number
  borderWidth: number
  valueFormat: string
}
export interface TreemapCell {
  node: TreemapNode
  total: number
  x: number
  y: number
  width: number
  height: number
  depth: number
  category: number
  label?: PixelTextBlock
  valueLabel?: PixelTextBlock
  labelY?: number
  valueY?: number
  /** Measured section header extent, before its child partition begins. */
  headerHeight?: number
}
export interface PositionedTreemap extends PositionedDiagram {
  body: TreemapBody
  cells: TreemapCell[]
  title?: PositionedDiagramTitle
  config: TreemapConfig
  hiddenLabels: string[]
  options: Readonly<RenderOptions>
}
