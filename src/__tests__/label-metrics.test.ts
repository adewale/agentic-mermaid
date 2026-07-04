import { describe, expect, test } from 'bun:test'
import { labelDisplayLength, labelOverflowWarning } from '../agent/label-metrics.ts'

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
