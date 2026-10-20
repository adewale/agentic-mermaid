import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap } from '../mermaid-source.ts'
import { isSafeActionHref } from '../output-security.ts'
import type { KanbanVisualConfig } from './types.ts'

export const KANBAN_CONFIG_KEYS = ['padding', 'sectionWidth', 'ticketBaseUrl', 'useMaxWidth'] as const
export function resolveKanbanConfig(frontmatter: MermaidFrontmatterMap = {}): KanbanVisualConfig {
  const raw = getFrontmatterMap(frontmatter, ['kanban']) ?? {}
  return {
    padding: typeof raw.padding === 'number' && Number.isFinite(raw.padding) && raw.padding >= 0 ? raw.padding : 8,
    sectionWidth: typeof raw.sectionWidth === 'number' && Number.isFinite(raw.sectionWidth) && raw.sectionWidth > 0 ? raw.sectionWidth : 240,
    ticketBaseUrl: typeof raw.ticketBaseUrl === 'string' ? raw.ticketBaseUrl : '',
  }
}
export function kanbanTicketUrl(base: string, ticket: string): string | undefined {
  if (!base || !ticket) return undefined
  const result = base.replaceAll('#TICKET#', encodeURIComponent(ticket))
  return /^(?:https?:|mailto:|\/|#)/i.test(result) && isSafeActionHref(result) && !/[\u0000-\u0020\u007f-\u009f]/.test(result) ? result : undefined
}
