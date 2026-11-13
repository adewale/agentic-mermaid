import type { Accessibility } from '../agent/types.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagramTitle } from '../styles.ts'
import type { PositionedDiagram } from '../types.ts'

export interface PacketField {
  id: string
  start: number
  end: number
  label: string
}
export interface PacketBody {
  kind: 'packet'
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  fields: PacketField[]
}
export type PacketMutationOp =
  | { kind: 'set_title'; title?: string }
  | { kind: 'set_accessibility_title'; title?: string }
  | { kind: 'set_accessibility_description'; description?: string }
  | { kind: 'add_field'; label: string; bits: number; index?: number }
  | { kind: 'remove_field'; index: number }
  | { kind: 'set_field_label'; index: number; label: string }
  | { kind: 'set_field_bits'; index: number; bits: number }
  | { kind: 'move_field'; from: number; to: number }

export interface PacketVisualConfig {
  bitsPerRow: number
  bitOrder: 'ascending' | 'descending'
  showBits: boolean
  rowHeight: number
  bitWidth: number
  paddingX: number
  paddingY: number
}
export interface PositionedPacketField extends PacketField {
  fieldId: string
  row: number
  x: number
  y: number
  width: number
  /** Exact value-encoding allocation before the authored inter-field gap. */
  slotWidth: number
  height: number
  labelBlock: PixelTextBlock
  bitLabels: Array<{ text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; block: PixelTextBlock }>
}
export interface PositionedPacketDiagram extends PositionedDiagram {
  fields: PositionedPacketField[]
  rows: number
  visual: PacketVisualConfig
  title?: PositionedDiagramTitle
  accessibility?: Accessibility
}
