// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import type { Reader, TokenType } from '../shared/grammar-reader.ts';
import {
  ACC_DESCR,
  ACC_TITLE,
  LETTERS,
  choice,
  hiddenTokens,
  literal,
  nonterminal,
  opening,
  optional,
  parseGrammar,
  repetition,
  sequence,
  terminal,
  title,
  toRules,
  type Grammar,
} from './common.ts';
import type { RailroadNode, RailroadRule } from './types.ts';

// `railroad-abnf-beta`: ABNF as in RFC 5234, with each rule closed by a semicolon.

const enum T {
  keyword,
  equals,
  semicolon,
  slash,
  group,
  groupEnd,
  option,
  optionEnd,
  title,
  accTitle,
  accDescr,
  name,
  string,
  number,
  repeat,
  exact,
}

const DIGITS = '0123456789';
const NAME: TokenType = { name: 'ABNF_RULENAME', pattern: /[A-Za-z][A-Za-z0-9-]*/y, first: LETTERS };
const COMMENT: TokenType = { name: 'ABNF_COMMENT', pattern: /;[^\n\r]*/y, hidden: true, first: ';' };

export const ABNF_TOKENS: readonly TokenType[] = [
  opening('railroad-abnf-beta', NAME),
  literal('='),
  // A semicolon closes a rule only at the end of its line; with anything after it, it starts a comment.
  literal(';', [COMMENT]),
  literal('/'),
  literal('('),
  literal(')'),
  literal('['),
  literal(']'),
  title(String.raw`[A-Za-z0-9-]`),
  ACC_TITLE,
  ACC_DESCR,
  NAME,
  { name: 'ABNF_STRING', pattern: /"[^"]*"/y, first: '"' },
  { name: 'ABNF_NUMVAL', pattern: /%[xXdDbB][0-9A-Fa-f]+(?:-[0-9A-Fa-f]+|\.[0-9A-Fa-f]+)*/y, first: '%' },
  { name: 'ABNF_REPEAT', pattern: /[0-9]*\*[0-9]*/y, first: DIGITS + '*' },
  { name: 'ABNF_EXACT_REPEAT', pattern: /[0-9]+/y, first: DIGITS },
  ...hiddenTokens('ABNF'),
  COMMENT,
];

export type AbnfPrimary =
  | { $type: 'AbnfStringLiteral' | 'AbnfNumVal'; value: string }
  | { $type: 'AbnfRuleName'; name: string }
  | { $type: 'AbnfGroup' | 'AbnfOptionalGroup'; element: AbnfAlternation };

export interface AbnfElement {
  $type: 'AbnfElement';
  repeat?: string;
  primary: AbnfPrimary;
}

export interface AbnfConcatenation {
  $type: 'AbnfConcatenation';
  elements: AbnfElement[];
}

export interface AbnfAlternation {
  $type: 'AbnfAlternation';
  alternatives: AbnfConcatenation[];
}

export interface AbnfRule {
  $type: 'AbnfRule';
  name: string;
  definition: AbnfAlternation;
}

export type AbnfAst = Grammar<'RailroadAbnf', AbnfRule>;

// One open bracket, or the rule itself at the bottom of the stack.
interface Frame {
  alternation: AbnfAlternation;
  concatenation: AbnfConcatenation;
  // The bracket's node, its closing token, and the repeat written before it.
  node: AbnfPrimary | undefined;
  close: number;
  repeat: string | undefined;
}

function frame(node: AbnfPrimary | undefined, alternation: AbnfAlternation, close: number, repeat: string | undefined): Frame {
  const concatenation: AbnfConcatenation = { $type: 'AbnfConcatenation', elements: [] };
  alternation.alternatives.push(concatenation);
  return { alternation, concatenation, node, close, repeat };
}

function alternation(r: Reader): AbnfAlternation {
  const stack: Frame[] = [];
  let top = frame(undefined, { $type: 'AbnfAlternation', alternatives: [] }, -2, undefined);
  for (;;) {
    let repeat = r.kind === T.repeat || r.kind === T.exact ? r.take() : undefined;
    let primary: AbnfPrimary;
    const kind = r.kind;
    switch (kind) {
      case T.string:
        primary = { $type: 'AbnfStringLiteral', value: r.take().slice(1, -1) };
        break;
      case T.number:
        primary = { $type: 'AbnfNumVal', value: r.take() };
        break;
      case T.name:
        primary = { $type: 'AbnfRuleName', name: r.take() };
        break;
      case T.group:
      case T.option: {
        r.i++;
        const element: AbnfAlternation = { $type: 'AbnfAlternation', alternatives: [] };
        stack.push(top);
        top = frame({ $type: kind === T.group ? 'AbnfGroup' : 'AbnfOptionalGroup', element }, element, kind + 1, repeat);
        continue;
      }
      default:
        r.fail('a string, a number, a name, or an opening bracket');
    }
    for (;;) {
      top.concatenation.elements.push(repeat === undefined ? { $type: 'AbnfElement', primary } : { $type: 'AbnfElement', repeat, primary });
      const k = r.kind;
      if (k === top.close) {
        r.i++;
        primary = top.node!;
        repeat = top.repeat;
        top = stack.pop()!;
        continue;
      }
      if (k === T.slash) {
        r.i++;
        top.concatenation = { $type: 'AbnfConcatenation', elements: [] };
        top.alternation.alternatives.push(top.concatenation);
      } else if (k !== T.string && k !== T.number && k !== T.name && k !== T.group && k !== T.option && k !== T.repeat && k !== T.exact) {
        if (stack.length === 0) return top.alternation;
        r.fail(`token of type '${ABNF_TOKENS[top.close]!.name}'`);
      }
      break;
    }
  }
}

export function parseAbnf(src: string): AbnfAst {
  return parseGrammar(
    src,
    ABNF_TOKENS,
    'RailroadAbnf',
    T.title,
    (text) => text.slice(1, -1),
    (r) => {
      const name = r.expect(T.name);
      r.expect(T.equals);
      const definition = alternation(r);
      r.expect(T.semicolon);
      return { $type: 'AbnfRule', name, definition };
    }
  );
}

type Part = AbnfAlternation | AbnfConcatenation | AbnfElement | AbnfPrimary;

function node(part: Part, kids: RailroadNode[]): RailroadNode {
  switch (part.$type) {
    case 'AbnfAlternation':
      return choice(kids);
    case 'AbnfConcatenation':
      return sequence(kids);
    case 'AbnfElement': {
      const repeat = part.repeat;
      if (!repeat) return kids[0]!;
      const star = repeat.indexOf('*');
      const exact = star === -1;
      const min = star > 0 || exact ? parseInt(repeat, 10) : 0;
      const max = exact ? min : star < repeat.length - 1 ? parseInt(repeat.slice(star + 1), 10) : Infinity;
      return min === 0 && max === 1 ? optional(kids[0]!) : repetition(kids[0]!, min, max);
    }
    case 'AbnfStringLiteral':
      return terminal(part.value);
    case 'AbnfNumVal':
      return { type: 'terminal', value: part.value, literalKind: 'abnf-numeric' };
    case 'AbnfRuleName':
      return nonterminal(part.name);
    case 'AbnfGroup':
      return kids[0]!;
    case 'AbnfOptionalGroup':
      return optional(kids[0]!);
  }
}

export const abnfRules = (ast: AbnfAst): RailroadRule[] => toRules<Part>(ast, node);
