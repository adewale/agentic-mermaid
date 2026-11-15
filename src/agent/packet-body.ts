import { unknownOpMessage } from './mutation-ops.ts'
import { parsePacketDiagram } from '../packet/parser.ts'
import type { PacketBody, PacketMutationOp } from '../packet/types.ts'
import { appendAccessibilityLines } from './accessibility-envelope.ts'
import { labelOverflowCollector } from './body-utils.ts'
import type { LayoutWarning, MutationError, Result, VerifyOptions } from './types.ts'
import { err, ok } from './types.ts'

export function parsePacketBody(lines: readonly string[] | string): PacketBody | null {
  try {
    return parsePacketDiagram(lines)
  } catch {
    return null
  }
}
export function renderPacket(body: PacketBody): string {
  const lines = ['packet']
  appendAccessibilityLines(lines, body)
  if (body.title !== undefined) lines.push(`title ${body.title.replace(/\r?\n/g, '<br/>')}`)
  for (const field of body.fields) lines.push(`${field.start}${field.end === field.start ? '' : `-${field.end}`}: ${packetString(field.label)}`)
  return lines.join('\n') + '\n'
}

const PACKET_STRING_ESCAPES: Readonly<Record<string, string>> = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r' }

/** A STRING the packet reader takes back as `label`: it knows only the
 * backslash escapes `\n \r \t \b \f \v` and `\<char>`, so every other
 * character (controls and lone surrogates included) is written as itself. An
 * escaped percent keeps a directive opener literal without changing the
 * value; entities would change the authored label instead. */
function packetString(label: string): string {
  return `"${label.replace(/["\\\n\r]/g, character => PACKET_STRING_ESCAPES[character]!).replace(/%%(?=\{)/g, '%\\%')}"`
}
export function mutatePacket(body: PacketBody, op: PacketMutationOp): Result<PacketBody, MutationError> {
  const next: PacketBody = { ...body, fields: body.fields.map(field => ({ ...field })) }
  const invalid = (message: string): Result<PacketBody, MutationError> => err({ code: 'INVALID_OP', message })
  const text = (value: unknown): value is string => typeof value === 'string' && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  const bits = (value: number): boolean => Number.isSafeInteger(value) && value > 0
  const index = (value: number): boolean => Number.isInteger(value) && value >= 0 && value < next.fields.length
  switch (op.kind) {
    case 'set_title':
      if (op.title !== undefined && (!text(op.title) || /\r?\n/.test(op.title))) return invalid('Packet title must be single-line text')
      next.title = op.title
      break
    case 'set_accessibility_title':
      if (op.title !== undefined && !text(op.title)) return invalid('Packet accessibility title must be text')
      next.accessibilityTitle = op.title
      break
    case 'set_accessibility_description':
      if (op.description !== undefined && (!text(op.description) || !op.description.trim())) return invalid('Packet accessibility description must be non-empty text')
      next.accessibilityDescription = op.description
      break
    case 'add_field': {
      const at = op.index ?? next.fields.length
      if (!Number.isInteger(at) || at < 0 || at > next.fields.length || !text(op.label) || !bits(op.bits)) return invalid('add_field requires a label, positive integer bits, and an insertion index in range')
      const ids = new Set(next.fields.map(field => field.id))
      let suffix = 0
      while (ids.has(`field-${suffix}`)) suffix++
      next.fields.splice(at, 0, { id: `field-${suffix}`, start: 0, end: op.bits - 1, label: op.label })
      break
    }
    case 'remove_field':
      if (!index(op.index)) return invalid('Packet field index is out of range')
      next.fields.splice(op.index, 1)
      break
    case 'set_field_label':
      if (!index(op.index) || !text(op.label)) return invalid('set_field_label requires a field index and text label')
      next.fields[op.index]!.label = op.label
      break
    case 'set_field_bits':
      if (!index(op.index) || !bits(op.bits)) return invalid('set_field_bits requires a field index and positive integer bits')
      next.fields[op.index]!.end = next.fields[op.index]!.start + op.bits - 1
      break
    case 'move_field':
      if (!index(op.from) || !index(op.to)) return invalid('move_field indices are out of range')
      next.fields.splice(op.to, 0, next.fields.splice(op.from, 1)[0]!)
      break
    default:
      return invalid(unknownOpMessage('packet', op))
  }
  let cursor = 0
  for (const field of next.fields) {
    const length = field.end - field.start + 1
    field.start = cursor
    cursor += length
    field.end = cursor - 1
  }
  if (!Number.isSafeInteger(cursor)) return invalid('Packet size exceeds the safe integer range')
  return ok(next)
}
export function verifyPacket(body: PacketBody, options: VerifyOptions): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const overflow = labelOverflowCollector(warnings, options)
  if (!body.fields.length) warnings.push({ code: 'EMPTY_DIAGRAM' })
  if (body.title !== undefined) overflow('title', body.title)
  for (const field of body.fields) overflow(field.id, field.label)
  return warnings
}
