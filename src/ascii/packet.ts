import type { AsciiContext } from '../agent/families.ts'
import { withFrontmatterTitle } from '../mermaid-source.ts'
import { resolvePacketConfig } from '../packet/config.ts'
import { parsePacketDiagram } from '../packet/parser.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { prepareCellText } from './prepared-text.ts'
import { serializeTerminalArtifact, type TerminalArtifact, terminalArtifact } from './terminal-artifact.ts'
import { TerminalDocument } from './terminal-document.ts'
import { paintTerminalFrame } from './terminal-geometry.ts'
import { AsciiWidthError } from './width-error.ts'

export function renderPacketTerminal(context: AsciiContext): TerminalArtifact {
  const body = withFrontmatterTitle(parsePacketDiagram(context.source.familyBody), context.source.frontmatter)
  const visual = (context.familyConfig as { visual?: ReturnType<typeof resolvePacketConfig> } | undefined)?.visual ?? resolvePacketConfig(context.source.frontmatter)
  const rows = body.fields.length ? Math.floor(body.fields.at(-1)!.end / visual.bitsPerRow) + 1 : 0
  assertDiagramWorkLimit('nodes', rows + body.fields.length)
  const maxWidth = context.options.targetWidth ?? context.options.maxWidth ?? context.config.maxWidth
  const minimumBitWidth = Math.max(3, String(body.fields.at(-1)?.end ?? 0).length + 2)
  const minimum = visual.bitsPerRow * minimumBitWidth + 1
  if (maxWidth && maxWidth < minimum) throw new AsciiWidthError(maxWidth, minimum, 'packet', 'MINIMUM_GEOMETRY')
  const bitWidth = Math.max(minimumBitWidth, maxWidth ? Math.floor((maxWidth - 1) / visual.bitsPerRow) : Math.ceil(visual.bitWidth / 8))
  const document = new TerminalDocument()
  if (body.title) {
    for (const line of prepareCellText(body.title, { display: 'formatted', maxWidth }).lines) document.line([{ text: line, role: 'text', owner: { id: 'title', kind: 'label' } }])
    document.line()
  }
  let y = document.height
  let firstField = 0
  for (let row = 0; row < rows; row++) {
    const start = row * visual.bitsPerRow,
      end = start + visual.bitsPerRow - 1
    while (firstField < body.fields.length && body.fields[firstField]!.end < start) firstField++
    const fields = []
    for (let index = firstField; index < body.fields.length && body.fields[index]!.start <= end; index++) {
      const field = body.fields[index]!
      const low = Math.max(start, field.start),
        high = Math.min(end, field.end)
      const left = visual.bitOrder === 'descending' ? visual.bitsPerRow - (high - start + 1) : low - start
      const width = (high - low + 1) * bitWidth + 1
      fields.push({ field, low, high, x: left * bitWidth, width, block: prepareCellText(field.label, { display: 'formatted', maxWidth: width - 2 }) })
    }
    const height = Math.max(3, ...fields.map(field => field.block.height + 2))
    if (visual.showBits) y++
    for (const segment of fields) {
      const id = `${segment.field.id}:row-${row}`,
        owner = { id, kind: 'node' as const }
      paintTerminalFrame(document, { x: segment.x, y, width: segment.width, height }, owner, context.config.useAscii)
      document.textBlock(segment.x + 1, y + 1, segment.block.lines, { role: 'text', owner })
      if (visual.showBits) {
        const low = visual.bitOrder === 'descending' ? segment.high : segment.low
        const high = visual.bitOrder === 'descending' ? segment.low : segment.high
        if (low === high) document.text(segment.x + Math.floor(segment.width / 2), y - 1, String(low), { role: 'border', owner: { id: `${id}:bits`, kind: 'label', parent: owner } })
        else {
          document.text(segment.x + 1, y - 1, String(low), { role: 'border', owner: { id: `${id}:start`, kind: 'label', parent: owner } })
          document.text(segment.x + segment.width - 1 - String(high).length, y - 1, String(high), { role: 'border', owner: { id: `${id}:end`, kind: 'label', parent: owner } })
        }
      }
    }
    y += height + 1
  }
  return terminalArtifact(document, { colorMode: context.colorMode, theme: context.theme, trimEnd: true })
}
export function renderPacketAscii(context: AsciiContext): string {
  return serializeTerminalArtifact(renderPacketTerminal(context))
}
