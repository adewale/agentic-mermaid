// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import type { Reader, TokenType } from '../shared/grammar-reader.ts';
import {
  ACC_DESCR,
  ACC_TITLE,
  choice,
  hiddenTokens,
  identifier,
  isSpace,
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

// `railroad-ebnf-beta`: EBNF in the W3C and ISO 14977 styles.

const enum T {
  keyword,
  defines,
  equals,
  semicolon,
  bar,
  comma,
  group,
  groupEnd,
  option,
  optionEnd,
  repeat,
  repeatEnd,
  question,
  star,
  plus,
  minus,
  title,
  accTitle,
  accDescr,
  id,
  string,
  special,
}

// A question mark, text with something other than blanks in it and no `?` or `;`, and a question mark.
// Mermaid's pattern looks ahead with two nested runs, which rescans; this reads the text once.
function specialSequence(src: string, at: number): number {
  if (src.charCodeAt(at) !== 63) return -1;
  let solid = false;
  for (let i = at + 1; i < src.length; i++) {
    const c = src.charCodeAt(i);
    if (c === 63) return solid ? i + 1 : -1;
    if (c === 59) return -1;
    solid ||= !isSpace(c);
  }
  return -1;
}

const ID = identifier('EBNF_ID');
const SPECIAL: TokenType = {
  name: 'EBNF_SPECIAL_SEQUENCE',
  pattern: /\?(?=[^?;]*[^?\s;][^?;]*\?)[^?;]*\?/y,
  first: '?',
  scanner: () => specialSequence,
};
const HIDDEN = hiddenTokens('EBNF');
const ISO_COMMENT: TokenType = { name: 'EBNF_ISO_COMMENT', pattern: /\(\*[\s\S]*?\*\)/y, hidden: true, first: '(', opener: /\(\*/y };

export const EBNF_TOKENS: readonly TokenType[] = [
  opening('railroad-ebnf-beta', ID),
  literal('::='),
  literal('='),
  literal(';'),
  literal('|'),
  literal(','),
  literal('(', [ISO_COMMENT]),
  literal(')'),
  literal('['),
  literal(']'),
  literal('{'),
  literal('}'),
  literal('?', [SPECIAL]),
  literal('*'),
  literal('+'),
  literal('-', [HIDDEN[1]!]),
  title(String.raw`[\w-]`),
  ACC_TITLE,
  ACC_DESCR,
  ID,
  quoted('EBNF_STRING'),
  SPECIAL,
  ...HIDDEN,
  { name: 'EBNF_BLOCK_COMMENT', pattern: /\/\*[\s\S]*?\*\//y, hidden: true, first: '/', opener: /\/\*/y },
  ISO_COMMENT,
];

export type EbnfPrimary =
  | { $type: 'EbnfTerminal'; value: string }
  | { $type: 'EbnfNonTerminal'; name: string }
  | { $type: 'EbnfSpecial'; text: string }
  | { $type: 'EbnfGroup' | 'EbnfOptional' | 'EbnfRepetition'; element: EbnfChoice };

export type EbnfPostfix =
  | { $type: 'EbnfOptionalPostfix' | 'EbnfZeroOrMorePostfix' | 'EbnfOneOrMorePostfix'; operator: string }
  | { $type: 'EbnfExceptionPostfix'; except: EbnfPrimary };

export interface EbnfTerm {
  $type: 'EbnfTerm';
  base: EbnfPrimary;
  postfixes: EbnfPostfix[];
}

export interface EbnfSequence {
  $type: 'EbnfSequence';
  elements: EbnfTerm[];
}

export interface EbnfChoice {
  $type: 'EbnfChoice';
  alternatives: EbnfSequence[];
}

export interface EbnfRule {
  $type: 'EbnfRule';
  name: string;
  definition: EbnfChoice;
}

export type EbnfAst = Grammar<'RailroadEbnf', EbnfRule>;

// One open bracket, or the rule itself at the bottom of the stack.
interface Frame {
  choice: EbnfChoice;
  sequence: EbnfSequence;
  term: EbnfTerm | undefined;
  // The bracket's node, its closing token, and whether it is the right side of an exception.
  node: EbnfPrimary | undefined;
  close: number;
  except: boolean;
}

function frame(node: EbnfPrimary | undefined, choice: EbnfChoice, close: number, except: boolean): Frame {
  const sequence: EbnfSequence = { $type: 'EbnfSequence', elements: [] };
  choice.alternatives.push(sequence);
  return { choice, sequence, term: undefined, node, close, except };
}

const BRACKETS = ['EbnfGroup', 'EbnfOptional', 'EbnfRepetition'] as const;

function definition(r: Reader): EbnfChoice {
  const stack: Frame[] = [];
  let top = frame(undefined, { $type: 'EbnfChoice', alternatives: [] }, -2, false);
  let except = false;
  for (;;) {
    let primary: EbnfPrimary;
    const kind = r.kind;
    switch (kind) {
      case T.string:
        primary = { $type: 'EbnfTerminal', value: unescape(r.take()) };
        break;
      case T.id:
        primary = { $type: 'EbnfNonTerminal', name: r.take() };
        break;
      case T.special:
        primary = { $type: 'EbnfSpecial', text: r.take().slice(1, -1).trim() };
        break;
      case T.group:
      case T.option:
      case T.repeat: {
        r.i++;
        const element: EbnfChoice = { $type: 'EbnfChoice', alternatives: [] };
        stack.push(top);
        top = frame({ $type: BRACKETS[(kind - T.group) >> 1]!, element }, element, kind + 1, except);
        except = false;
        continue;
      }
      default:
        r.fail('a terminal, a name, or an opening bracket');
    }
    for (;;) {
      if (except) {
        top.term!.postfixes.push({ $type: 'EbnfExceptionPostfix', except: primary });
        except = false;
      } else {
        top.term = { $type: 'EbnfTerm', base: primary, postfixes: [] };
        top.sequence.elements.push(top.term);
      }
      const postfixes = top.term!.postfixes;
      for (;;) {
        const k = r.kind;
        if (k === T.question) postfixes.push({ $type: 'EbnfOptionalPostfix', operator: r.take() });
        else if (k === T.star) postfixes.push({ $type: 'EbnfZeroOrMorePostfix', operator: r.take() });
        else if (k === T.plus) postfixes.push({ $type: 'EbnfOneOrMorePostfix', operator: r.take() });
        else break;
      }
      const k = r.kind;
      if (k === top.close) {
        r.i++;
        primary = top.node!;
        except = top.except;
        top = stack.pop()!;
        continue;
      }
      if (k === T.minus) {
        r.i++;
        except = true;
      } else if (k === T.comma) {
        r.i++;
      } else if (k === T.bar) {
        r.i++;
        top.sequence = { $type: 'EbnfSequence', elements: [] };
        top.choice.alternatives.push(top.sequence);
      } else if (k !== T.string && k !== T.id && k !== T.special && k !== T.group && k !== T.option && k !== T.repeat) {
        if (stack.length === 0) return top.choice;
        r.fail(`token of type '${EBNF_TOKENS[top.close]!.name}'`);
      }
      break;
    }
  }
}

export function parseEbnf(src: string): EbnfAst {
  return parseGrammar(src, EBNF_TOKENS, 'RailroadEbnf', T.title, unescape, (r) => {
    const name = r.expect(T.id);
    if (!r.accept(T.equals)) r.expect(T.defines);
    const rule: EbnfRule = { $type: 'EbnfRule', name, definition: definition(r) };
    r.expect(T.semicolon);
    return rule;
  });
}

type Part = EbnfChoice | EbnfSequence | EbnfTerm | EbnfPrimary;

function node(part: Part, kids: RailroadNode[]): RailroadNode {
  switch (part.$type) {
    case 'EbnfChoice':
      return choice(kids);
    case 'EbnfSequence':
      return sequence(kids);
    case 'EbnfTerm': {
      // Each postfix operator applies to everything before it in the term.
      let result = kids[0]!;
      let next = 1;
      for (const postfix of part.postfixes) {
        if (postfix.$type === 'EbnfOptionalPostfix') result = optional(result);
        else if (postfix.$type === 'EbnfExceptionPostfix') result = { type: 'exception', base: result!, except: kids[next++]! };
        else result = repetition(result, postfix.$type === 'EbnfOneOrMorePostfix' ? 1 : 0);
      }
      return result;
    }
    case 'EbnfTerminal':
      return terminal(part.value);
    case 'EbnfNonTerminal':
      return nonterminal(part.name);
    case 'EbnfSpecial':
      return special(part.text);
    case 'EbnfGroup':
      return kids[0]!;
    case 'EbnfOptional':
      return optional(kids[0]!);
    case 'EbnfRepetition':
      return repetition(kids[0]!, 0);
  }
}

export const ebnfRules = (ast: EbnfAst): RailroadRule[] => toRules<Part>(ast, node);
