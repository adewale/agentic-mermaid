// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
import { parserObservationActive, observeParserStatement, observeParserMutation } from '../shared/parser-observation.ts';
import {
  ACC_DESCR,
  ACC_TITLE,
  DIRECTIVE,
  NEWLINE,
  Reader,
  SINGLE_LINE_COMMENT,
  STRING,
  TITLE,
  WHITESPACE,
  YAML,
  accDescrValue,
  accTitleValue,
  keyword,
  stringValue,
  titleValue,
  tokenize,
  type TokenType,
} from '../shared/grammar-reader.ts';

const enum T {
  keywordColon,
  keyword,
  arrow,
  colon,
  domain,
  accDescr,
  accTitle,
  title,
  string,
  newline,
}

export const CYNEFIN_TOKENS: readonly TokenType[] = [
  { name: 'cynefin-beta:', pattern: 'cynefin-beta:' },
  keyword('cynefin-beta'),
  { name: '-->', pattern: '-->' },
  { name: ':', pattern: ':' },
  { name: 'DOMAIN_NAME', pattern: /complex|complicated|clear|chaotic|confusion/y },
  ACC_DESCR,
  ACC_TITLE,
  TITLE,
  STRING,
  NEWLINE,
  WHITESPACE,
  YAML,
  DIRECTIVE,
  SINGLE_LINE_COMMENT,
];

export type DomainName = 'complex' | 'complicated' | 'clear' | 'chaotic' | 'confusion';

export interface DomainBlockAst {
  $type: 'DomainBlock';
  domain: DomainName;
  items: { $type: 'DomainItem'; label: string }[];
}

export interface TransitionAst {
  $type: 'Transition';
  from: DomainName;
  to: DomainName;
  label?: string;
}

export interface CynefinAst {
  $type: 'Cynefin';
  title?: string;
  accTitle?: string;
  accDescr?: string;
  domains: DomainBlockAst[];
  transitions: TransitionAst[];
}

export function parseCynefin(src: string): CynefinAst {
  const r = new Reader(tokenize(src, CYNEFIN_TOKENS, 'cynefin'), CYNEFIN_TOKENS, 'cynefin');
  const ast: CynefinAst = { $type: 'Cynefin', domains: [], transitions: [] };

  const skipLines = (): void => {
    while (r.kinds[r.i] === T.newline) r.i++;
  };
  const endOfLine = (): void => {
    if (r.kind === -1) return;
    if (r.kind !== T.newline) r.fail('a line break or the end of input');
    skipLines();
  };

  skipLines();
  if (r.kind !== T.keyword && r.kind !== T.keywordColon) r.fail("'cynefin-beta'");
  r.i++;
  const observed = parserObservationActive('cynefin');
  while (r.kind !== -1) {
    const kind = r.kind, start = r.tokens.starts[r.i]!;
    switch (r.kind) {
      case T.newline:
        r.i++;
        break;
      case T.accDescr:
        ast.accDescr = accDescrValue(r.take());
        if (observed) observeParserMutation('cynefin', 'set-accessibility-description', ast.accDescr, { offset: start, endOffset: r.tokens.ends[r.i - 1] ?? start, unit: 'physical' });
        endOfLine();
        break;
      case T.accTitle:
        ast.accTitle = accTitleValue(r.take());
        if (observed) observeParserMutation('cynefin', 'set-accessibility-title', ast.accTitle, { offset: start, endOffset: r.tokens.ends[r.i - 1] ?? start, unit: 'physical' });
        endOfLine();
        break;
      case T.title:
        ast.title = titleValue(r.take());
        if (observed) observeParserMutation('cynefin', 'set-title', ast.title, { offset: start, endOffset: r.tokens.ends[r.i - 1] ?? start, unit: 'physical' });
        endOfLine();
        break;
      case T.domain: {
        const name = r.take() as DomainName;
        if (r.accept(T.arrow)) {
          const transition: TransitionAst = { $type: 'Transition', from: name, to: r.expect(T.domain) as DomainName };
          if (r.accept(T.colon)) transition.label = stringValue(r.expect(T.string));
          const endOffset = r.tokens.ends[r.i - 1]!;
          endOfLine();
          ast.transitions.push(transition);
          if (observed) observeParserMutation('cynefin', 'add-transition', transition, { offset: start, endOffset, unit: 'physical' });
          break;
        }
        const block: DomainBlockAst = { $type: 'DomainBlock', domain: name, items: [] };
        skipLines();
        while (r.kinds[r.i] === T.string) {
          const offset = r.tokens.starts[r.i]!;
          const item = { $type: 'DomainItem' as const, label: stringValue(r.take()) };
          block.items.push(item);
          if (observed) observeParserMutation('cynefin', 'add-item', { domain: name, index: block.items.length - 1, item }, { offset, endOffset: r.tokens.ends[r.i - 1]!, unit: 'physical' });
          skipLines();
        }
        let last = r.i - 1;
        while (r.kinds[last] === T.newline) last--;
        ast.domains.push(block);
        if (observed) observeParserMutation('cynefin', 'add-domain', block, { offset: start, endOffset: r.tokens.ends[last]!, unit: 'physical' });
        break;
      }
      default:
        r.fail('a domain, a transition, a title, or a line break');
    }
    if (observed && kind !== T.newline) {
      const endOffset = r.tokens.starts[r.i] ?? src.length;
      observeParserStatement('cynefin', CYNEFIN_TOKENS[kind]!.name, src.slice(start, endOffset), { offset: start, endOffset, unit: 'physical' });
    }
  }
  return ast;
}
