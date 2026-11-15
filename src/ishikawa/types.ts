import type { PositionedDiagram, RenderOptions, Point } from '../types.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagramTitle } from '../styles.ts'

export interface IshikawaNode {
  id: string
  label: string
  parentId?: string
}
export interface IshikawaBody {
  kind: 'ishikawa'
  nodes: IshikawaNode[]
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type IshikawaMutationOp =
  | { kind: 'set_effect'; label: string }
  | { kind: 'add_cause'; label: string; parentId?: string }
  | { kind: 'remove_cause'; id: string }
  | { kind: 'set_label'; id: string; label: string }
  | { kind: 'move_cause'; id: string; parentId: string; index?: number }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
export interface PositionedIshikawaNode {
  node: IshikawaNode
  x: number
  y: number
  width: number
  height: number
  block: PixelTextBlock
  depth: number
}
export interface IshikawaBranch {
  id: string
  from: string
  to: string
  points: Point[]
}
export interface PositionedIshikawa extends PositionedDiagram {
  body: IshikawaBody
  nodes: PositionedIshikawaNode[]
  branches: IshikawaBranch[]
  spine: Point[]
  title?: PositionedDiagramTitle
  options: Readonly<RenderOptions>
}
