// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import type { Reader, TokenType } from '../shared/grammar-reader.ts';
import {
  ACC_DESCR,
  ACC_TITLE,
  choice,
  hiddenTokens,
  identifier,
  literal,
  nonterminal,
  opening,
  optional,
  parseGrammar,
  quoted,
  repetition,
  sequence,
  special,
  terminal,
  title,
  toRules,
  unescape,
  type Grammar,
} from './common.ts';
import type { RailroadNode, RailroadRule } from './types.ts';

// `railroad-peg-beta`: parsing expression grammars.

const enum T {
  keyword,
  arrow,
  semicolon,
  slash,
  and,
  not,
  question,
  star,
  plus,
  group,
  groupEnd,
  dot,
  title,
  accTitle,
  accDescr,
  id,
  string,
}

const ID = identifier('PEG_ID');

export const PEG_TOKENS: readonly TokenType[] = [
  opening('railroad-peg-beta', ID),
  literal('<-'),
  literal(';'),
  literal('/'),
  literal('&'),
  literal('!'),
  literal('?'),
  literal('*'),
  literal('+'),
  literal('('),
  literal(')'),
  literal('.'),
  title(String.raw`[\w-]`),
  ACC_TITLE,
  ACC_DESCR,
  ID,
  quoted('PEG_STRING'),
  ...hiddenTokens('PEG'),
  { name: 'PEG_LINE_COMMENT', pattern: /#[^\n\r]*/y, hidden: true, first: '#' },
];

export type PegPrimary =
  | { $type: 'PegLiteral'; value: string }
  | { $type: 'PegIdentifier'; name: string }
  | { $type: 'PegAny'; dot: string }
  | { $type: 'PegGroup'; element: PegChoice };

export interface PegSuffix {
  $type: 'PegSuffix';
  primary: PegPrimary;
  operator?: string;
}

export interface PegPrefix {
  $type: 'PegPrefix';
  operator?: string;
  suffix: PegSuffix;
}

export interface PegSequence {
  $type: 'PegSequence';
  elements: PegPrefix[];
}

export interface PegChoice {
  $type: 'PegOrderedChoice';
  alternatives: PegSequence[];
}

export interface PegRule {
  $type: 'PegRule';
  name: string;
  definition: PegChoice;
}

export type PegAst = Grammar<'RailroadPeg', PegRule>;

// One open group, or the rule itself at the bottom of the stack.
interface Frame {
  choice: PegChoice;
  sequence: PegSequence;
  // The group's node and the predicate written before it.
  node: PegPrimary | undefined;
  operator: string | undefined;
}

function frame(node: PegPrimary | undefined, choice: PegChoice, operator: string | undefined): Frame {
  const sequence: PegSequence = { $type: 'PegSequence', elements: [] };
  choice.alternatives.push(sequence);
  return { choice, sequence, node, operator };
}

function definition(r: Reader): PegChoice {
  const stack: Frame[] = [];
  let top = frame(undefined, { $type: 'PegOrderedChoice', alternatives: [] }, undefined);
  for (;;) {
    let operator = r.kind === T.and || r.kind === T.not ? r.take() : undefined;
    let primary: PegPrimary;
    const kind = r.kind;
    switch (kind) {
      case T.string:
        primary = { $type: 'PegLiteral', value: unescape(r.take()) };
        break;
      case T.id:
        primary = { $type: 'PegIdentifier', name: r.take() };
        break;
      case T.dot:
        primary = { $type: 'PegAny', dot: r.take() };
        break;
      case T.group: {
        r.i++;
        const element: PegChoice = { $type: 'PegOrderedChoice', alternatives: [] };
        stack.push(top);
        top = frame({ $type: 'PegGroup', element }, element, operator);
        continue;
      }
      default:
        r.fail('a literal, a name, a dot, or an opening parenthesis');
    }
    for (;;) {
      const suffix: PegSuffix = { $type: 'PegSuffix', primary };
      if (r.kind === T.question || r.kind === T.star || r.kind === T.plus) suffix.operator = r.take();
      top.sequence.elements.push(operator === undefined ? { $type: 'PegPrefix', suffix } : { $type: 'PegPrefix', operator, suffix });
      const k = r.kind;
      if (k === T.groupEnd && stack.length > 0) {
        r.i++;
        primary = top.node!;
        operator = top.operator;
        top = stack.pop()!;
        continue;
      }
      if (k === T.slash) {
        r.i++;
        top.sequence = { $type: 'PegSequence', elements: [] };
        top.choice.alternatives.push(top.sequence);
      } else if (k !== T.and && k !== T.not && k !== T.string && k !== T.id && k !== T.dot && k !== T.group) {
        if (stack.length === 0) return top.choice;
        r.fail("token of type ')'");
      }
      break;
    }
  }
}

export function parsePeg(src: string): PegAst {
  return parseGrammar(src, PEG_TOKENS, 'RailroadPeg', T.title, unescape, (r) => {
    const name = r.expect(T.id);
    r.expect(T.arrow);
    const rule: PegRule = { $type: 'PegRule', name, definition: definition(r) };
    r.expect(T.semicolon);
    return rule;
  });
}

type Part = PegChoice | PegSequence | PegPrefix | PegSuffix | PegPrimary;

// What a predicate shows of the expression it looks ahead for.
function label(node: RailroadNode): string {
  switch (node.type) {
    case 'terminal':
      return `"${node.value}"`;
    case 'nonterminal':
      return node.name;
    case 'special':
      return node.text;
    default:
      return '(...)';
  }
}

function node(part: Part, kids: RailroadNode[]): RailroadNode {
  const kid = kids[0]!;
  switch (part.$type) {
    case 'PegOrderedChoice':
      return kids.length === 1 ? kids[0]! : { type: 'choice', alternatives: kids, ordered: true };
    case 'PegSequence':
      return sequence(kids);
    case 'PegPrefix':
      return part.operator ? { type: 'predicate', operator: part.operator as '!' | '&', element: kid! } : kid!;
    case 'PegSuffix':
      if (!part.operator) return kid;
      return part.operator === '?' ? optional(kid) : repetition(kid, part.operator === '+' ? 1 : 0);
    case 'PegLiteral':
      return terminal(part.value);
    case 'PegIdentifier':
      return nonterminal(part.name);
    case 'PegAny':
      return { type: 'any' };
    case 'PegGroup':
      return kid;
  }
}

export const pegRules = (ast: PegAst): RailroadRule[] => toRules<Part>(ast, node);
