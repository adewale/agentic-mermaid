/** Mermaid 12 sequenceDb.LINETYPE + parser/sequenceDiagram.jison and
 * sequenceRenderer.ts marker dispatch. OPEN(5/6) means a shaft without a head;
 * POINT(24/25) is the -) open head. Reverse half-arrows use upstream's flipped
 * top/bottom naming at marker-start. Shared by result and actual-call adapters.
 * This is reference protocol knowledge, independent of Agentic's arrow table.
 */
export const REFERENCE_SEQUENCE_SIGNALS: Readonly<Record<number, readonly [line: string, start: string, end: string]>> = {
  0: ['solid', 'none', 'filled'],
  1: ['dashed', 'none', 'filled'],
  3: ['solid', 'none', 'cross'],
  4: ['dashed', 'none', 'cross'],
  5: ['solid', 'none', 'none'],
  6: ['dashed', 'none', 'none'],
  24: ['solid', 'none', 'open'],
  25: ['dashed', 'none', 'open'],
  33: ['solid', 'filled', 'filled'],
  34: ['dashed', 'filled', 'filled'],
  41: ['solid', 'none', 'half-top'],
  42: ['solid', 'none', 'half-bottom'],
  43: ['solid', 'none', 'stick-top'],
  44: ['solid', 'none', 'stick-bottom'],
  45: ['solid', 'half-bottom', 'none'],
  46: ['solid', 'half-top', 'none'],
  47: ['solid', 'stick-bottom', 'none'],
  48: ['solid', 'stick-top', 'none'],
  51: ['dashed', 'none', 'half-top'],
  52: ['dashed', 'none', 'half-bottom'],
  53: ['dashed', 'none', 'stick-top'],
  54: ['dashed', 'none', 'stick-bottom'],
  55: ['dashed', 'half-bottom', 'none'],
  56: ['dashed', 'half-top', 'none'],
  57: ['dashed', 'stick-bottom', 'none'],
  58: ['dashed', 'stick-top', 'none'],
}
