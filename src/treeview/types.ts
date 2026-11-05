import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagramTitle } from '../styles.ts'
import type { Point, PositionedDiagram, RenderOptions } from '../types.ts'

export interface TreeviewNode {
  /** Positional reader address; structural edits may renumber it. */
  id: string
  label: string
  parentId?: string
  nodeType: 'file' | 'directory'
  className?: string
  icon?: string
  description?: string
}
export interface TreeviewBody {
  kind: 'treeview'
  nodes: TreeviewNode[]
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type TreeviewMutationOp =
  | { kind: 'add_node'; label: string; parentId?: string; nodeType?: 'file' | 'directory'; icon?: string; description?: string; className?: string }
  | { kind: 'remove_node'; id: string }
  | { kind: 'set_label'; id: string; label: string }
  | { kind: 'set_description'; id: string; description: string | null }
  | { kind: 'set_icon'; id: string; icon: string | null }
  | { kind: 'set_class'; id: string; className: string | null }
  | { kind: 'set_node_type'; id: string; nodeType: 'file' | 'directory' }
  | { kind: 'move_node'; id: string; parentId?: string; index?: number }
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
export interface TreeviewRow {
  node: TreeviewNode
  depth: number
  x: number
  y: number
  width: number
  height: number
  label: PixelTextBlock
  description?: PixelTextBlock
  descriptionX?: number
  icon?: PixelTextBlock
  iconGraphic?: { path?: string; size: number; filled: boolean; kind: 'file' | 'folder' | 'bundled' | 'fallback' }
  labelX: number
}
export interface PositionedTreeview extends PositionedDiagram {
  body: TreeviewBody
  rows: TreeviewRow[]
  guides: { id: string; from: string; to: string; points: Point[] }[]
  title?: PositionedDiagramTitle
  options: Readonly<RenderOptions>
}
