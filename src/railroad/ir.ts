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

// `railroad-beta`: Mermaid's own notation, one constructor call per node.

const enum T {
  keyword,
  nonterminal,
  zeroOrMore,
  oneOrMore,
  sequence,
  optional,
  terminal,
  special,
  choice,
  equals,
  semicolon,
  open,
  comma,
  close,
  title,
  accTitle,
  accDescr,
  id,
  string,
}

const ID = identifier('RR_ID');
const word = (name: string): TokenType => literal(name, [ID]);

export const IR_TOKENS: readonly TokenType[] = [
  opening('railroad-beta', ID),
  word('nonterminal'),
  word('zeroOrMore'),
  word('oneOrMore'),
  word('sequence'),
  word('optional'),
  word('terminal'),
  word('special'),
  word('choice'),
  literal('='),
  literal(';'),
  literal('('),
  literal(','),
  literal(')'),
  title(String.raw`[\w-]`),
  ACC_TITLE,
  ACC_DESCR,
  ID,
  quoted('RR_STRING'),
  ...hiddenTokens('RR'),
  { name: 'RR_BLOCK_COMMENT', pattern: /\/\*[\s\S]*?\*\//y, hidden: true, first: '/', opener: /\/\*/y },
];

export type IrExpression =
  | { $type: 'RailroadSequenceExpr'; elements: IrExpression[] }
  | { $type: 'RailroadChoiceExpr'; alternatives: IrExpression[] }
  | { $type: 'RailroadOptionalExpr' | 'RailroadOneOrMoreExpr' | 'RailroadZeroOrMoreExpr'; element: IrExpression }
  | { $type: 'RailroadTerminalExpr'; value: string }
  | { $type: 'RailroadNonTerminalExpr'; name: string }
  | { $type: 'RailroadSpecialExpr'; text: string };

export interface IrRule {
  $type: 'RailroadRule';
  name: string;
  definition: IrExpression;
}

export type IrAst = Grammar<'Railroad', IrRule>;

function argument(r: Reader): string {
  r.i++;
  r.expect(T.open);
  const value = unescape(r.expect(T.string));
  r.expect(T.close);
  return value;
}

function wrapper($type: 'RailroadOptionalExpr' | 'RailroadOneOrMoreExpr' | 'RailroadZeroOrMoreExpr'): IrExpression {
  return { $type, element: undefined as unknown as IrExpression };
}

function expression(r: Reader): IrExpression {
  const open: IrExpression[] = [];
  for (;;) {
    let value: IrExpression;
    switch (r.kind) {
      case T.terminal:
        value = { $type: 'RailroadTerminalExpr', value: argument(r) };
        break;
      case T.nonterminal:
        value = { $type: 'RailroadNonTerminalExpr', name: argument(r) };
        break;
      case T.special:
        value = { $type: 'RailroadSpecialExpr', text: argument(r) };
        break;
      case T.sequence:
        value = { $type: 'RailroadSequenceExpr', elements: [] };
        break;
      case T.choice:
        value = { $type: 'RailroadChoiceExpr', alternatives: [] };
        break;
      case T.optional:
        value = wrapper('RailroadOptionalExpr');
        break;
      case T.oneOrMore:
        value = wrapper('RailroadOneOrMoreExpr');
        break;
      case T.zeroOrMore:
        value = wrapper('RailroadZeroOrMoreExpr');
        break;
      default:
        r.fail('an expression');
    }
    if ('elements' in value || 'alternatives' in value || 'element' in value) {
      r.i++;
      r.expect(T.open);
      open.push(value);
      continue;
    }
    for (;;) {
      const parent = open[open.length - 1];
      if (parent === undefined) return value;
      if ('element' in parent) {
        parent.element = value;
      } else {
        ('elements' in parent ? parent.elements : (parent as { alternatives: IrExpression[] }).alternatives).push(value);
        if (r.accept(T.comma)) break;
      }
      r.expect(T.close);
      open.pop();
      value = parent;
    }
  }
}

export function parseIr(src: string): IrAst {
  return parseGrammar(src, IR_TOKENS, 'Railroad', T.title, unescape, (r) => {
    const name = r.expect(T.id);
    r.expect(T.equals);
    const definition = expression(r);
    r.expect(T.semicolon);
    return { $type: 'RailroadRule', name, definition };
  });
}

function node(e: IrExpression, kids: RailroadNode[]): RailroadNode {
  switch (e.$type) {
    case 'RailroadTerminalExpr':
      return terminal(e.value);
    case 'RailroadNonTerminalExpr':
      return nonterminal(e.name);
    case 'RailroadSpecialExpr':
      return special(e.text);
    case 'RailroadSequenceExpr':
      return sequence(kids);
    case 'RailroadChoiceExpr':
      return choice(kids);
    case 'RailroadOptionalExpr':
      return optional(kids[0]!);
    default:
      return repetition(kids[0]!, e.$type === 'RailroadOneOrMoreExpr' ? 1 : 0);
  }
}

export const irRules = (ast: IrAst): RailroadRule[] => toRules(ast, node);
