import { assertRailroadWork } from './parser.ts'
import type { Notation, RailroadBody, RailroadNode } from './types.ts'

/** Mermaid's grammar converter recognizes backslash, quotes and n/r/t;
 * JSON's b/f/u escapes would silently change literal values. */
function grammarString(value: string): string {
  const shieldDirective = value.includes('%%{')
  return '"' + value.replace(/[\\"\n\r\t%]/g, character => character === '\\' ? '\\\\' : character === '"' ? '\\"' : character === '\n' ? '\\n' : character === '\r' ? '\\r' : character === '\t' ? '\\t' : shieldDirective ? '\\%' : '%') + '"'
}

function expression(node: RailroadNode, notation: Notation): string {
  const child = (value: RailroadNode) => expression(value, notation)
  const quote = (value: string): string => {
    if (notation === 'abnf' && (/["\r\n]/.test(value) || value.includes('%%{'))) throw new Error('ABNF string literals cannot contain quotes, newlines or directive openers')
    return notation === 'abnf' ? `"${value}"` : grammarString(value)
  }
  const ir = notation === 'railroad'
  switch (node.type) {
    case 'terminal':
      if (node.literalKind === 'abnf-numeric') {
        if (notation !== 'abnf' || !/^%[xXdDbB][0-9A-Fa-f]+(?:-[0-9A-Fa-f]+|\.[0-9A-Fa-f]+)*$/.test(node.value)) throw new Error('A numeric terminal needs one ABNF numeric-value token')
        return node.value
      }
      return ir ? `terminal(${quote(node.value)})` : quote(node.value)
    case 'nonterminal':
      if (!ir && !/^[A-Za-z_][\w-]*$/.test(node.name)) throw new Error('A nonterminal name must be a portable grammar identifier')
      return ir ? `nonterminal(${quote(node.name)})` : node.name
    case 'special':
      if (ir) return `special(${quote(node.text)})`
      if (notation !== 'ebnf' || /[?\r\n]/.test(node.text)) throw new Error('This special expression requires the railroad constructor notation')
      return `? ${node.text} ?`
    case 'any':
      if (notation !== 'peg') throw new Error('The any-character expression requires PEG notation')
      return '.'
    case 'predicate':
      if (notation !== 'peg') throw new Error('Lookahead predicates require PEG notation')
      return `${node.operator}(${child(node.element)})`
    case 'exception':
      if (notation !== 'ebnf') throw new Error('Grammar exceptions require EBNF notation')
      return `(${child(node.base)}) - (${child(node.except)})`
    case 'sequence':
      if (!node.elements.length) throw new Error('An empty sequence has no portable railroad spelling')
      return ir ? `sequence(${node.elements.map(child).join(', ')})` : `(${node.elements.map(child).join(notation === 'ebnf' ? ', ' : ' ')})`
    case 'choice':
      if (!node.alternatives.length) throw new Error('A grammar choice needs an alternative')
      if (node.ordered && notation !== 'peg') throw new Error('Ordered alternatives require PEG notation')
      return ir ? `choice(${node.alternatives.map(child).join(', ')})` : `(${node.alternatives.map(child).join(notation === 'peg' || notation === 'abnf' ? ' / ' : ' | ')})`
    case 'optional': return ir ? `optional(${child(node.element)})` : notation === 'peg' ? `(${child(node.element)})?` : `[${child(node.element)}]`
    case 'repetition': {
      if (!Number.isSafeInteger(node.min) || node.min < 0 || (node.max !== null && (!Number.isSafeInteger(node.max) || node.max < node.min))) throw new Error('Repetition bounds must be nonnegative integers, with null for an unbounded maximum')
      if (notation === 'abnf') return `${node.max === node.min ? node.min : `${node.min || ''}*${node.max ?? ''}`}(${child(node.element)})`
      if (node.max !== null || (node.min !== 0 && node.min !== 1)) throw new Error('Bounded repetition requires ABNF notation')
      return ir ? `${node.min === 0 ? 'zeroOrMore' : 'oneOrMore'}(${child(node.element)})` : notation === 'ebnf' && node.min === 0 ? `{${child(node.element)}}` : `(${child(node.element)})${node.min === 0 ? '*' : '+'}`
    }
  }
}

export function renderRailroad(body: RailroadBody): string {
  assertRailroadWork(body.rules)
  const header = `railroad-${body.notation === 'railroad' ? '' : `${body.notation}-`}beta`
  const lines = [header]
  if (body.title !== undefined) {
    if (body.notation === 'abnf' && (/[\r\n]/.test(body.title) || body.title.includes('%%'))) throw new Error('ABNF titles cannot contain line breaks or comment openers')
    lines.push(`title ${body.notation === 'abnf' ? `"${body.title}"` : grammarString(body.title)}`)
  }
  for (const rule of body.rules) {
    if (!/^[A-Za-z_][\w-]*$/.test(rule.name)) throw new Error('A rule name must be a portable grammar identifier')
    lines.push(`${rule.name} ${body.notation === 'peg' ? '<-' : '='} ${expression(rule.definition, body.notation)};`)
  }
  return lines.join('\n') + '\n'
}
