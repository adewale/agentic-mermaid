import type { AsciiContext } from '../agent/families.ts'
import { parseCynefinBody } from '../agent/cynefin-body.ts'
import { CYNEFIN_DOMAINS } from '../cynefin/types.ts'
import { TerminalDocument } from './terminal-document.ts'
import { terminalArtifact } from './terminal-artifact.ts'
import { wrapText } from './wrap.ts'
export function renderCynefinTerminal(ctx: AsciiContext) {
  const body = parseCynefinBody(ctx.source.authoredFamilyBody ?? ctx.source.familyBody), document = new TerminalDocument()
  document.report({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'cynefin.domains', message: 'The five domains are projected as named sections with complete items and directed transitions.' })
  const line = (text: string, id: string, kind: 'node' | 'edge' | 'label' = 'label') => { for (const part of wrapText(text, ctx.options.targetWidth)) document.line([{ text: part, role: 'text', owner: { id, kind } }]) }
  if (body.title ?? ctx.config.title) line(body.title ?? ctx.config.title!, 'title')
  const domains = new Map(body.domains.map(domain => [domain.name, domain]))
  for (const name of CYNEFIN_DOMAINS) { line(name.toUpperCase(), name); domains.get(name)?.items.forEach((item, index) => line(`  ${item.label}`, `${name}:${index}`, 'node')) }
  body.transitions.forEach((transition, index) => line(`${transition.from} -> ${transition.to}${transition.label === undefined ? '' : `: ${transition.label}`}`, `transition:${index}`, 'edge'))
  return terminalArtifact(document, { colorMode: ctx.colorMode, theme: ctx.theme })
}
