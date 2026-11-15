import { parseAbnf, abnfRules } from './abnf.ts'
import { parseEbnf, ebnfRules } from './ebnf.ts'
import { parseIr, irRules } from './ir.ts'
import { parsePeg, pegRules } from './peg.ts'
import { assertDiagramWorkLimit } from '../shared/diagram-limits.ts'
import { readAuthoredGrammarAccessibility } from '../shared/grammar-text.ts'
import type { RailroadBody, RailroadNode } from './types.ts'

export function assertRailroadWork(rules: RailroadBody['rules']): void {
  let count = 0
  const pending: Array<{ node: RailroadNode; depth: number }> = rules.map(rule => ({ node: rule.definition, depth: 1 }))
  const seen = new Set<object>()
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (!node || typeof node !== 'object' || seen.has(node)) throw new TypeError('Railroad expressions must form a tree')
    seen.add(node)
    assertDiagramWorkLimit('nodes', ++count)
    assertDiagramWorkLimit('nesting', depth)
    if (node.type === 'repetition' && (!Number.isSafeInteger(node.min) || node.min < 0 || (node.max !== null && (!Number.isSafeInteger(node.max) || node.max < node.min)))) throw new Error('Repetition bounds must be ordered nonnegative safe integers, with null for an unbounded maximum')
    if (node.type === 'sequence' || node.type === 'choice') for (const child of node.type === 'sequence' ? node.elements : node.alternatives) pending.push({ node: child, depth: depth + 1 })
    else if (node.type === 'optional' || node.type === 'repetition' || node.type === 'predicate') pending.push({ node: node.element, depth: depth + 1 })
    else if (node.type === 'exception') { pending.push({ node: node.base, depth: depth + 1 }); pending.push({ node: node.except, depth: depth + 1 }) }
  }
}

export function parseRailroad(source: string): RailroadBody {
  const header = source.match(/^[\t ]*railroad-(ebnf-|abnf-|peg-)?beta\b/im)
  if (!header) throw new Error('Expected a railroad-beta, railroad-ebnf-beta, railroad-abnf-beta or railroad-peg-beta header')
  const notation = header[1] === 'ebnf-' ? 'ebnf' : header[1] === 'abnf-' ? 'abnf' : header[1] === 'peg-' ? 'peg' : 'railroad'
  let parsed: { title?: string; accTitle?: string; accDescr?: string }, rules: RailroadBody['rules']
  if (notation === 'ebnf') { const ast = parseEbnf(source); parsed = ast; rules = ebnfRules(ast) }
  else if (notation === 'abnf') { const ast = parseAbnf(source); parsed = ast; rules = abnfRules(ast) }
  else if (notation === 'peg') { const ast = parsePeg(source); parsed = ast; rules = pegRules(ast) }
  else { const ast = parseIr(source); parsed = ast; rules = irRules(ast) }
  assertRailroadWork(rules)
  const accessibility = parsed.accTitle !== undefined || parsed.accDescr !== undefined ? readAuthoredGrammarAccessibility({ title: parsed.accTitle, descr: parsed.accDescr }) : undefined
  return { kind: 'railroad', notation, rules, ...(parsed.title ? { title: parsed.title } : {}), ...(accessibility?.title !== undefined ? { accessibilityTitle: accessibility.title } : {}), ...(accessibility?.descr !== undefined ? { accessibilityDescription: accessibility.descr } : {}) }
}
