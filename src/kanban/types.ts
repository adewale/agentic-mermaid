import type { PixelTextBlock } from '../shared/prepared-text.ts'
import type { PositionedDiagramTitle } from '../styles.ts'
import type { PositionedDiagram } from '../types.ts'

export interface KanbanItem {
  /** Collision-free public identity; sourceId retains repeated authored IDs. */
  id: string
  sourceId: string
  implicitId?: boolean
  label: string
  /** The declaration wrote the label as a Mermaid markdown string ("`…`"). */
  markdown?: true
  metadata: Record<string, unknown>
  icon?: string
  className?: string
}
export interface KanbanColumn extends KanbanItem {
  tasks: KanbanItem[]
}
export interface KanbanBody {
  kind: 'kanban'
  columns: KanbanColumn[]
  /** Display-only title supplied by the universal frontmatter envelope. */
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
}
export type KanbanMutationOp =
  | { kind: 'add_column'; id: string; label: string; index?: number }
  | { kind: 'remove_column'; id: string; removeTasks?: boolean }
  | { kind: 'set_column_label'; id: string; label: string }
  | { kind: 'move_column'; id: string; index: number }
  | { kind: 'add_task'; column: string; id: string; label: string; metadata?: Record<string, unknown>; index?: number }
  | { kind: 'remove_task'; id: string }
  | { kind: 'set_task_label'; id: string; label: string }
  | { kind: 'set_task_metadata'; id: string; metadata: Record<string, unknown> | null }
  | { kind: 'move_task'; id: string; column: string; index?: number }
  | { kind: 'set_icon'; id: string; icon?: string }
  | { kind: 'set_class'; id: string; className?: string }
  | { kind: 'set_accessibility_title'; title?: string }
  | { kind: 'set_accessibility_description'; description?: string }

export interface KanbanVisualConfig {
  padding: number
  sectionWidth: number
  ticketBaseUrl: string
}
export interface KanbanText {
  text: string
  block: PixelTextBlock
  x: number
  y: number
  kind: 'label' | 'ticket' | 'assigned' | 'priority' | 'icon'
}
export interface PositionedKanbanTask extends KanbanItem {
  parentId: string
  x: number
  y: number
  width: number
  height: number
  texts: KanbanText[]
  ticketUrl?: string
}
export interface PositionedKanbanColumn extends KanbanItem {
  x: number
  y: number
  width: number
  height: number
  headerHeight: number
  texts: KanbanText[]
  tasks: PositionedKanbanTask[]
}
export interface PositionedKanbanDiagram extends PositionedDiagram {
  columns: PositionedKanbanColumn[]
  visual: KanbanVisualConfig
  title?: PositionedDiagramTitle
}
