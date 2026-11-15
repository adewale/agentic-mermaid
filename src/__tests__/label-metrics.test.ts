import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { labelDisplayLength, labelOverflowWarning } from '../agent/label-metrics.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

// LABEL_OVERFLOW measures what the renderer draws: entities decode, <br>
// splits lines, formatting tags strip. See src/agent/label-metrics.ts.
describe('labelDisplayLength', () => {
  test('plain text is its own length', () => {
    expect(labelDisplayLength('hello world')).toBe(11)
    expect(labelDisplayLength('')).toBe(0)
  })
  test('<br> variants split lines; longest line wins', () => {
    expect(labelDisplayLength('aaaa<br/>bb')).toBe(4)
    expect(labelDisplayLength('aa<br>bbbbb')).toBe(5)
    expect(labelDisplayLength('aa<BR />bbb')).toBe(3)
  })
  test('literal \\n splits lines like the renderer', () => {
    expect(labelDisplayLength('aaaa\\nbb')).toBe(4)
    expect(labelDisplayLength('aaaa\nbb')).toBe(4)
  })
  test('numeric entities count as one character', () => {
    expect(labelDisplayLength('a&#160;b')).toBe(3)
    expect(labelDisplayLength('Map&#x3C;K, V&#x3E;')).toBe('Map<K, V>'.length)
  })
  test('XML named entities decode; HTML-only names stay literal like the renderer', () => {
    expect(labelDisplayLength('a&amp;b')).toBe(3)
    // decodeXML (the render pipeline's decoder) does not decode &nbsp;
    expect(labelDisplayLength('a&nbsp;b')).toBe('a&nbsp;b'.length)
  })
  test('formatting tags are stripped from the count', () => {
    expect(labelDisplayLength('<b>bold</b> and <i>italic</i>')).toBe('bold and italic'.length)
    expect(labelDisplayLength('**bold**')).toBe(4)
  })
})

// The count is of drawn characters: grapheme clusters per displayed line,
// never UTF-16 code units or code points.
describe('labelDisplayLength counts grapheme clusters', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const clusters = (line: string) => [...segmenter.segment(line)].length
  // Each token is one drawn character of a different UTF-16 / code-point shape.
  const glyph = fc.constantFrom('a', 'Z', '7', ' ', 'é', 'e\u0301', '中', '🎉', '👍🏽', '👨‍👩‍👧', '🇯🇵', 'ক্ষ')
  const line = fc.array(glyph, { minLength: 1, maxLength: 12 }).map(chars => chars.join(''))

  test('the longest <br>-separated line, in clusters', () => {
    fc.assert(fc.property(fc.array(line, { minLength: 1, maxLength: 3 }), lines => {
      expect(labelDisplayLength(lines.join('<br/>'))).toBe(Math.max(...lines.map(clusters)))
    }), fcParameters({ numRuns: 200, examples: [[['🎉'.repeat(25)]], [['👨‍👩‍👧'.repeat(15)]]] }))
  })
})

describe('labelOverflowWarning', () => {
  test('reports the rendered length, not source chars', () => {
    const w = labelOverflowWarning('A', `${'x'.repeat(45)}<br/>short`, 40)
    expect(w).toEqual({ code: 'LABEL_OVERFLOW', target: 'A', charCount: 45, limit: 40 })
  })
  test('null at or under the cap', () => {
    expect(labelOverflowWarning('A', 'x'.repeat(40), 40)).toBeNull()
  })
})

describe('flowchart LABEL_OVERFLOW', () => {
  test('counts the asterisks a plain label draws literally', () => {
    // 38 x between ** markers renders as 42 characters, over the default 40.
    const label = `**${'x'.repeat(38)}**`
    const verify = verifyMermaid(`flowchart LR\n  A["${label}"] --> B`)
    expect(verify.warnings).toContainEqual({ code: 'LABEL_OVERFLOW', target: 'A', charCount: 42, limit: 40 })
    // A markdown string draws the same text bold, without the markers.
    const markdown = verifyMermaid(`flowchart LR\n  A["\`${label}\`"] --> B`)
    expect(markdown.warnings.filter(warning => warning.code === 'LABEL_OVERFLOW')).toEqual([])
  })
})

// charCount is the drawn text: emoji are one character each, and a markdown
// string's backticks and emphasis markers are not drawn.
describe('LABEL_OVERFLOW counts the characters the renderer draws', () => {
  test.each([
    ['25 emoji in a flowchart node', `flowchart LR\n  A[${'🎉'.repeat(25)}]`, []],
    ['41 ZWJ family emoji', `flowchart LR\n  A[${'👨‍👩‍👧'.repeat(41)}]`, [41]],
    ['39-character markdown string', `flowchart LR\n  A["\`**${'x'.repeat(39)}**\`"]`, []],
    ['41-character markdown string', `flowchart LR\n  A["\`**${'x'.repeat(41)}**\`"]`, [41]],
    ['25 emoji in a Sequence message', `sequenceDiagram\n  A->>B: ${'🎉'.repeat(25)}`, []],
  ] as const)('%s', (context, source, charCounts) => {
    const overflow = verifyMermaid(source).warnings.flatMap(warning =>
      warning.code === 'LABEL_OVERFLOW' && 'charCount' in warning ? [warning.charCount] : [])
    expect({ context, overflow }).toEqual({ context, overflow: [...charCounts] })
  })
})

// The warning catalog's contract, in every family: a drawn label longer than
// the cap raises exactly one LABEL_OVERFLOW, whose charCount is the drawn
// grapheme count, under the id an agent can act on — an edge by its indexed
// id (`A->B#k`), so a parallel edge is never named like its sibling. Each row
// places one generated label among drawn text far under the cap; `extra` is
// what the family draws beside it (a class member's visibility, a ZenUML
// call's parentheses). Identifier slots take identifier characters.
describe('LABEL_OVERFLOW fires once per overflowing drawn label in every family', () => {
  type Row = readonly [family: string, source: (label: string) => string, target: string | ((label: string) => string), extra?: number, identifier?: boolean]
  const rows: readonly Row[] = [
    ['flowchart node', l => `flowchart LR\n  A["${l}"] --> B`, 'A'],
    ['flowchart parallel edge', l => `flowchart LR\n  A --> B\n  A -->|${l}| B`, 'A->B#1'],
    ['sequence message', l => `sequenceDiagram\n  A->>B: ${l}`, 'msg#0:A->B'],
    ['sequence participant', l => `sequenceDiagram\n  participant A as ${l}\n  A->>B: hi`, 'A'],
    ['class label', l => `classDiagram\n  class A["${l}"]`, 'A'],
    ['class member', l => `classDiagram\n  class A {\n    +${l}\n  }`, 'A#m0', 1],
    ['class relationship', l => `classDiagram\n  A --> B : ${l}`, 'rel#0'],
    ['state description', l => `stateDiagram-v2\n  S1 : ${l}`, 'S1'],
    ['state parallel transition', l => `stateDiagram-v2\n  S1 --> S2 : go\n  S1 --> S2 : ${l}`, 'S1->S2#1'],
    ['state note', l => `stateDiagram-v2\n  S1\n  note right of S1 : ${l}`, 'note#0'],
    ['ER relationship', l => `erDiagram\n  A ||--o{ B : "${l}"`, 'rel#0'],
    ['journey task', l => `journey\n  section S\n    ${l}: 5: Me`, 'task-0'],
    ['gantt task', l => `gantt\n  dateFormat YYYY-MM-DD\n  section s\n    ${l} :a1, 2024-01-01, 1d`, 'task-0'],
    ['pie slice', l => `pie\n  "${l}" : 1`, 'slice-0'],
    ['quadrant point', l => `quadrantChart\n  ${l}: [0.3, 0.6]`, l => l],
    ['mindmap node', l => `mindmap\n  root\n    ${l}`, l => l],
    ['timeline event', l => `timeline\n  2024 : ${l}`, 'event-0'],
    ['gitGraph commit', l => `gitGraph\n  commit id: "${l}"`, l => l],
    ['XYChart title', l => `xychart-beta\n  title "${l}"\n  x-axis [a, b]\n  bar [1, 2]`, 'title'],
    ['sankey node', l => `sankey-beta\n"${l}",B,10`, l => l],
    ['radar axis', l => `radar-beta\n  axis a["${l}"], b, c\n  curve c1{1,2,3}`, 'a'],
    ['C4 person', l => `C4Context\n  Person(p, "${l}")`, 'p'],
    ['packet field', l => `packet\n  0-15: "${l}"`, 'field-0'],
    ['kanban card', l => `kanban\n  todo\n    t1[${l}]`, 't1'],
    ['requirement text', l => `requirementDiagram\n  requirement r {\n    id: 1\n    text: "${l}"\n  }`, 'r'],
    ['block', l => `block-beta\n  a["${l}"]`, 'a'],
    ['treemap leaf', l => `treemap-beta\n  "${l}": 1`, 'treemap-0'],
    ['architecture service', l => `architecture-beta\n  service s(server)[${l}]`, 's'],
    ['ZenUML message', l => `zenuml\n  A->B: ${l}`, 'statement:1'],
    ['ZenUML call', l => `zenuml\n  A.${l}()`, 'statement:1', 2, true],
    ['ZenUML participant', l => `zenuml\n  ${l}->B: hi`, l => l, 0, true],
    ['Event Modeling frame', l => `eventmodeling\n  tf 01 cmd ${l}`, '01', 0, true],
    ['Ishikawa effect', l => `ishikawa-beta\n  ${l}`, 'effect'],
  ]
  // One drawn character per token, of different UTF-16 and code-point shapes.
  const unicode = fc.constantFrom('a', 'Z', 'é', 'é', '中', '🎉', '👍🏽', '👨‍👩‍👧', '🇯🇵', 'ক্ষ', '7')
  const identifier = fc.constantFrom('a', 'Z', 'q', 'x')
  const label = (row: Row, drawn: number) => fc.array(row[4] ? identifier : unicode, { minLength: drawn - (row[3] ?? 0), maxLength: drawn - (row[3] ?? 0) })
    .map(glyphs => (row[4] ? 'P' : 'L') + glyphs.slice(1).join(''))
  const overflow = (source: string, cap: number) => verifyMermaid(source, { labelCharCap: cap }).warnings
    .flatMap(warning => warning.code === 'LABEL_OVERFLOW' ? [{ target: warning.target, charCount: warning.charCount }] : [])

  test('exactly one warning, at the drawn length and indexed id, exactly when the label exceeds the cap', () => {
    const scenario = fc.record({ row: fc.integer({ min: 0, max: rows.length - 1 }), cap: fc.integer({ min: 24, max: 48 }), delta: fc.integer({ min: -2, max: 2 }) })
      .chain(({ row, cap, delta }) => label(rows[row]!, cap + delta).map(text => ({ row, cap, text, drawn: cap + delta })))
    fc.assert(fc.property(scenario, ({ row, cap, text, drawn }) => {
      const [family, source, target] = rows[row]!
      const expected = drawn > cap ? [{ target: typeof target === 'string' ? target : target(text), charCount: drawn }] : []
      expect({ family, overflow: overflow(source(text), cap) }).toEqual({ family, overflow: expected })
    }), fcParameters({ numRuns: 120, examples: rows.map((row, index) => [{ row: index, cap: 40, text: (row[4] ? 'P' : 'L') + 'x'.repeat(40 - (row[3] ?? 0)), drawn: 41 }]) }))
  })
})

// Families that draw labels as written (upstream sets them with d3 `.text()`)
// measure them as written: `<br/>` and formatting tags are characters there.
// Gantt section titles are the exception upstream breaks at `<br>`.
describe('literal-label LABEL_OVERFLOW', () => {
  const long = `${'x'.repeat(36)}<br/>y`
  test.each([
    ['XYChart title', `xychart-beta\n  title "${long}"\n  x-axis [a, b]\n  bar [1, 2]`, [42]],
    ['GitGraph commit', `gitGraph\n  commit id: "${long}"`, [42]],
    ['Gantt task', `gantt\n  dateFormat YYYY-MM-DD\n  section s\n    ${long} :a1, 2024-01-01, 1d`, [42]],
    ['Gantt section title', `gantt\n  dateFormat YYYY-MM-DD\n  section ${long}\n    t :a1, 2024-01-01, 1d`, []],
    ['Timeline event', `timeline\n  2024 : ${long}`, [42]],
  ] as const)('%s', (context, source, charCounts) => {
    const overflow = verifyMermaid(source).warnings.flatMap(warning =>
      warning.code === 'LABEL_OVERFLOW' && 'charCount' in warning ? [warning.charCount] : [])
    expect({ context, overflow }).toEqual({ context, overflow: [...charCounts] })
  })
})
