import type { DomainName } from './parser.ts'
import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagram, RenderOptions, Point } from '../types.ts'
import type { PositionedDiagramTitle } from '../styles.ts'
export type { DomainName } from './parser.ts'
export const CYNEFIN_DOMAINS: readonly DomainName[] = ['complex', 'complicated', 'clear', 'chaotic', 'confusion']
export interface CynefinDomain { name: DomainName; items: { label: string }[] }
export interface CynefinTransition { from: DomainName; to: DomainName; label?: string }
export interface CynefinBody {
  kind: 'cynefin'
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  domains: CynefinDomain[]
  transitions: CynefinTransition[]
}
export type CynefinMutationOp =
  | { kind: 'set_title'; title: string | null }
  | { kind: 'add_item'; domain: DomainName; label: string }
  | { kind: 'set_item'; domain: DomainName; index: number; label: string }
  | { kind: 'remove_item'; domain: DomainName; index: number }
  | { kind: 'add_transition'; from: DomainName; to: DomainName; label?: string }
  | { kind: 'remove_transition'; index: number }
  | { kind: 'set_accessibility_title'; title: string | null }
  | { kind: 'set_accessibility_description'; description: string | null }
export interface CynefinPlacedLabel { id: string; text: string; block: PixelTextBlock; x: number; y: number }
export interface PositionedCynefin extends PositionedDiagram {
  body: CynefinBody
  domains: { name: DomainName; x: number; y: number; width: number; height: number; heading: CynefinPlacedLabel; items: CynefinPlacedLabel[] }[]
  transitions: { id: string; from: DomainName; to: DomainName; points: Point[]; label?: CynefinPlacedLabel }[]
  title?: PositionedDiagramTitle
  options: Readonly<RenderOptions>
}
