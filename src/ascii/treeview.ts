import type { AsciiContext } from '../agent/families.ts'
import { treeviewIconLabel, treeviewRows } from '../treeview/hierarchy.ts'
import { parseTreeviewDiagram } from '../treeview/parser.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { TerminalDocument } from './terminal-document.ts'
import { visualWidth } from './width.ts'
import { wrapText } from './wrap.ts'

export function renderTreeviewTerminal(ctx: AsciiContext) {
  const body = parseTreeviewDiagram(ctx.source.authoredFamilyBody ?? ctx.source.familyBody)
  const document = new TerminalDocument(),
    config = ctx.source.config.treeView as Record<string, unknown> | undefined
  const title = body.title ?? ctx.config.title
  if (title) for (const line of wrapText(title, ctx.options.targetWidth)) document.line([{ text: line, role: 'text', owner: { id: 'title', kind: 'label' } }])
  for (const { node, depth, ancestorsContinue, last } of treeviewRows(body.nodes)) {
    const prefix = depth ? ancestorsContinue.map(more => (more ? (ctx.config.useAscii ? '|   ' : '│   ') : '    ')).join('') + (ctx.config.useAscii ? (last ? '`-- ' : '|-- ') : last ? '└── ' : '├── ') : ''
    const continuation = depth ? ancestorsContinue.map(more => (more ? (ctx.config.useAscii ? '|   ' : '│   ') : '    ')).join('') + (last ? '    ' : ctx.config.useAscii ? '|   ' : '│   ') : ''
    const icon = treeviewIconLabel(node.icon, node.nodeType, config?.showIcons === true)
    const label = `${icon ? `${ctx.config.useAscii && icon === '▱' ? '[dir]' : ctx.config.useAscii && icon === '▤' ? '[file]' : icon} ` : ''}${node.label}${node.nodeType === 'directory' ? '/' : ''}${node.description !== undefined ? `  ${ctx.config.useAscii ? '--' : '—'} ${node.description}` : ''}`
    const owner = { id: node.id, kind: 'node' as const, ...(node.parentId ? { parent: { id: node.parentId, kind: 'node' as const } } : {}) }
    const lines = wrapText(label, ctx.options.targetWidth ? Math.max(1, ctx.options.targetWidth - visualWidth(prefix)) : undefined)
    for (const [index, line] of lines.entries())
      document.line([
        { text: index ? continuation : prefix, kind: 'surface', owner },
        { text: line, role: 'text', owner },
      ])
  }
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
