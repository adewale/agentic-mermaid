import { parseCynefin } from './parser.ts'
import type { CynefinBody, DomainName } from './types.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'

export function parseCynefinBody(source: string): CynefinBody {
  const ast = parseCynefin(source), domains = new Map<DomainName, CynefinBody['domains'][number]>()
  if (new Set(ast.domains.map(block => block.domain)).size !== ast.domains.length) throw new Error('Cynefin repeated domain declarations would discard earlier items in pinned Mermaid; the authored source is preserved, but rendering is refused')
  for (const block of ast.domains) domains.set(block.domain, { name: block.domain, items: block.items.map(item => ({ label: item.label })) })
  const body: CynefinBody = { kind: 'cynefin', title: ast.title || undefined, accessibilityTitle: ast.accTitle?.trimStart(), accessibilityDescription: ast.accDescr?.replace(/\n\s+/g, '\n'),
    domains: [...domains.values()], transitions: ast.transitions.map(transition => ({ from: transition.from, to: transition.to, label: transition.label || undefined })) }
  assertDiagramWorkLimit('nodes', body.domains.reduce((sum, domain) => sum + domain.items.length, 5))
  assertDiagramWorkLimit('edges', body.transitions.length)
  return body
}
