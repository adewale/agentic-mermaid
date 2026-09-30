import { describe, expect, test } from 'bun:test'
import { labelDisplayLength, labelOverflowWarning } from '../agent/label-metrics.ts'
import { verifyMermaid } from '../agent/verify.ts'

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
