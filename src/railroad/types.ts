// Adapted from Pele (MIT, copyright 2026 kepano), revision 3a2f075.
// See LICENSES/pele-MIT.txt.
export type RailroadNode =
  | { type: 'terminal'; value: string; literalKind?: 'abnf-numeric' }
  | { type: 'nonterminal'; name: string }
  | { type: 'special'; text: string }
  | { type: 'sequence'; elements: RailroadNode[] }
  | { type: 'choice'; alternatives: RailroadNode[]; ordered?: true }
  | { type: 'optional'; element: RailroadNode }
  | { type: 'repetition'; element: RailroadNode; min: number; max: number | null }
  | { type: 'predicate'; operator: '!' | '&'; element: RailroadNode }
  | { type: 'any' }
  | { type: 'exception'; base: RailroadNode; except: RailroadNode };

export interface RailroadRule {
  name: string;
  definition: RailroadNode;
}

// Which of Mermaid's four grammars the text was written in.
export type Notation = 'railroad' | 'ebnf' | 'abnf' | 'peg';

export interface RailroadModel {
  type: 'railroad';
  notation: Notation;
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;
  // Every rule in source order. A name defined twice appears twice.
  rules: RailroadRule[];
}

export interface RailroadBody {
  kind: 'railroad'
  notation: Notation
  title?: string
  accessibilityTitle?: string
  accessibilityDescription?: string
  rules: RailroadRule[]
}

export type RailroadMutationOp =
  | { kind: 'add_rule'; name: string; definition: RailroadNode; index?: number }
  | { kind: 'replace_rule'; index: number; name?: string; definition: RailroadNode }
  | { kind: 'remove_rule'; index: number }
  | { kind: 'set_title'; title: string | null }
