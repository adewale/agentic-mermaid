import type { PositionedDiagram, RenderOptions } from '../types.ts'
import type { PositionedDiagramTitle } from '../styles.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { Circle } from './geometry.ts'

export interface VennSubset {
  sets: string[]
  size: number
  label?: string
}
export interface VennText {
  sets: string[]
  id: string
  label?: string
}
export interface VennStyle {
  targets: string[]
  styles: Record<string, string>
}
export interface VennBody {
  kind: 'venn'
  subsets: VennSubset[]
  textNodes: VennText[]
  styles: VennStyle[]
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type VennMutationOp =
  | { kind: 'set_subset'; sets: string[]; size: number; label?: string }
  | { kind: 'remove_subset'; sets: string[]; cascade?: boolean }
  | { kind: 'rename_set'; from: string; to: string }
  | { kind: 'set_text'; sets: string[]; id: string; label?: string }
  | { kind: 'remove_text'; id: string }
  | { kind: 'set_style'; targets: string[]; styles: Record<string, string> }
  | { kind: 'set_title'; title: string | null }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }

export interface PositionedVenn extends PositionedDiagram {
  body: VennBody
  circles: Circle[]
  regions: { id: string; sets: string[]; path: string; fill?: string }[]
  labels: { id: string; text: string; block: PixelTextBlock; x: number; y: number; sets: string[]; ownerId: string }[]
  title?: PositionedDiagramTitle
  options: Readonly<RenderOptions>
}
