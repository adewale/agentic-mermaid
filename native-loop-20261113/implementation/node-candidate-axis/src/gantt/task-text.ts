import { encodeMermaidEntities } from '../shared/mermaid-entities.ts'
import { decodeMermaidEntities } from '../shared/mermaid-entity-display.ts'

/** These INITIAL-state rules precede taskTxt. The bare colon-adjacent words
 * are kept separate: they become directives only when whitespace follows. */
const INITIAL_TOKEN = /^(?:(?:gantt|inclusiveEndDates|topAxis|dateFormat|axisFormat|tickInterval|includes|excludes|todayMarker|weekday|weekend|click|accTitle|accDescr)\b|\d{4}-\d{2}-\d{2}\b|(?:title|section|call|accDescription)\s|href\s+")/i

export const GANTT_ADJACENT_TASK_COLON = /^(?:call|title|section|accDescription)$/i

export function ganttTaskLabelNeedsShield(source: string): boolean {
  return INITIAL_TOKEN.test(source) || source.includes('%%{')
}

export function readGanttTaskLabel(source: string): string {
  return decodeMermaidEntities(source, { subject: 'Gantt task text entity', example: 'Task #35;1 : 1d' })
}

/** A task's text is literal, independently of its ID and scheduling data. */
export function writeGanttTaskLabel(value: string): string {
  let text = encodeMermaidEntities(value, '#&:%')
  if (INITIAL_TOKEN.test(text)) text = `#${text.codePointAt(0)!};${text.slice(1)}`
  return text
}
