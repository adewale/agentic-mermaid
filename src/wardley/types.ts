import type { WardleyBuildResult, WardleyNode, Flow } from './builder.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagram, RenderOptions, Point } from '../types.ts'
import type { PositionedDiagramTitle } from '../styles.ts'

export interface WardleyBody extends WardleyBuildResult {
  kind: 'wardley'
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type WardleyMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_component'; id: string; x: number; y: number; anchor?: boolean }
  | { kind: 'set_component_position'; id: string; x: number; y: number }
  | { kind: 'remove_component'; id: string }
  | { kind: 'add_dependency'; source: string; target: string; label?: string; dashed?: boolean; flow?: Flow }
  | { kind: 'remove_dependency'; index: number }
  | { kind: 'set_evolution'; id: string; x: number }
  | { kind: 'add_note'; text: string; x: number; y: number }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
export interface WardleyPlacedText { id: string; text: string; x: number; y: number; block: PixelTextBlock }
export interface WardleyPlacedNode extends WardleyPlacedText { node: WardleyNode }
export interface PositionedWardley extends PositionedDiagram {
  body: WardleyBody
  plot: { x: number; y: number; width: number; height: number }
  nodes: WardleyPlacedNode[]
  labels: WardleyPlacedText[]
  edges: { id: string; from: string; to: string; points: Point[]; label?: WardleyPlacedText; dashed?: boolean; flow?: Flow; trend?: boolean }[]
  pipelines: { id: string; members: string[]; x: number; y: number; width: number; height: number }[]
  title?: PositionedDiagramTitle
  options: Readonly<RenderOptions>
}
