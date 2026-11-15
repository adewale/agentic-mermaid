import type { AsciiContext } from '../agent/families.ts'
import { parseIshikawaDiagram } from '../ishikawa/parser.ts'
import { TerminalDocument } from './terminal-document.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { wrapText } from './wrap.ts'

export function renderIshikawaTerminal(ctx: AsciiContext) {
  const body = parseIshikawaDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
  const document = new TerminalDocument()
  document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'ishikawa.fishbone', message: 'The fishbone is projected as a cause/effect hierarchy; parent identities and complete labels are retained.' })
  if (ctx.config.title) for (const line of wrapText(ctx.config.title, ctx.options.targetWidth)) document.line([{ text: line, role: 'text', owner: { id: 'title', kind: 'label' } }])
  const depths = new Map<string, number>()
  for (const node of body.nodes) {
    const depth = node.parentId ? (depths.get(node.parentId) ?? 0) + 1 : 0
    depths.set(node.id, depth)
    const prefix = node.parentId ? `${'  '.repeat(depth - 1)}${ctx.config.useAscii ? '+-> ' : '└─→ '}` : 'Effect: '
    const lines = wrapText(node.label, ctx.options.targetWidth ? Math.max(1, ctx.options.targetWidth - prefix.length) : undefined)
    for (const [index, line] of lines.entries())
      document.line([
        { text: index === 0 ? prefix : ' '.repeat(prefix.length), kind: 'surface', owner: { id: node.id, kind: 'node' } },
        { text: line, role: 'text', owner: { id: node.id, kind: 'node' } },
      ])
  }
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
