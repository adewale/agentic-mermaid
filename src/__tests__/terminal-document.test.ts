import { describe, expect, test } from 'bun:test'
import { TerminalDocument, type TerminalOwner } from '../ascii/terminal-document.ts'
import { WIDE_CHAR_CONTINUATION } from '../ascii/width.ts'
import { terminalText } from './helpers/terminal-text.ts'

const owner = (id: string): TerminalOwner => ({ id, kind: 'node' })
const route = (id: string, bundle?: string): TerminalOwner => ({ id, kind: 'edge', ...(bundle ? { bundle } : {}) })

describe('owned terminal composition', () => {
  test('authored spaces are opaque, including trailing and all-space labels', () => {
    const doc = new TerminalDocument(12, 3)
    doc.text(2, 0, 'push = build ', { owner: owner('label') })
    doc.text(2, 1, '  ', { owner: owner('space') })
    const stroke = new TerminalDocument()
    for (let x = 0; x < 16; x++) stroke.put(x, 0, '─', { owner: route('edge') })
    doc.overlay(stroke)
    expect(doc.serialize({ trimEnd: true }).split('\n')).toEqual(['──push = build ─', '    '])
    expect(doc.regions().find(region => region.id === 'label')?.projectedText).toBe('push = build ')
    expect(doc.regions().find(region => region.id === 'space')?.projectedText).toBe('  ')
    expect(doc.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_TEXT_COLLISION' }))
  })

  test('wide-grapheme collision admission checks both cells and never leaves a partial write', () => {
    const doc = new TerminalDocument()
    doc.text(1, 0, 'X', { owner: owner('right') })
    doc.text(0, 0, '界', { owner: owner('left') })
    expect(doc.serialize()).toBe(' X')
    expect(doc.cell(0, 0)).toBeUndefined()
    expect(doc.regions().map(region => region.id)).toEqual(['right'])
    expect(doc.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['TERMINAL_TEXT_COLLISION'])
  })

  test('replacing a continuation retires the whole previous grapheme', () => {
    const doc = new TerminalDocument()
    doc.text(0, 0, '👩‍💻')
    expect(doc.get(1, 0)).toBe(WIDE_CHAR_CONTINUATION)
    doc.text(1, 0, 'é')
    expect(doc.get(0, 0)).toBe(' ')
    expect(doc.get(1, 0)).toBe('é')
    expect(doc.serialize()).toBe(' é')
  })

  test('same-glyph text collisions preserve the first owner and diagnose the second', () => {
    const doc = new TerminalDocument()
    doc.text(0, 0, 'same', { owner: owner('a') })
    const next = new TerminalDocument()
    next.text(0, 0, 'same', { owner: owner('b') })
    doc.overlay(next)
    expect(doc.regions().map(region => region.id)).toEqual(['a'])
    expect(doc.diagnostics).toHaveLength(1)
  })

  test.each([['─', '│', '┼'], ['-', '|', '+']] as const)('crossing %s and %s keeps distinct route owners', (horizontal, vertical, crossing) => {
    const doc = new TerminalDocument()
    doc.put(1, 1, horizontal, { owner: route('a') })
    doc.put(1, 1, vertical, { owner: route('b') })
    expect(doc.get(1, 1)).toBe(crossing)
    expect(doc.cell(1, 1)?.owners.map(item => item.id)).toEqual(['a', 'b'])
    expect(doc.diagnostics).toEqual([])
  })

  test('only declared bundles can share a collinear run without a diagnostic', () => {
    for (const bundled of [true, false]) {
      const doc = new TerminalDocument()
      doc.put(0, 0, '-', { owner: route('a', bundled ? 'bundle' : undefined) })
      doc.put(0, 0, '-', { owner: route('b', bundled ? 'bundle' : undefined) })
      expect(doc.cell(0, 0)?.owners.map(item => item.id)).toEqual(['a', 'b'])
      expect(doc.diagnostics.map(diagnostic => diagnostic.code)).toEqual(bundled ? [] : ['TERMINAL_ROUTE_OVERLAP'])
    }
  })

  test('coincident markers retain every owner, while a later stroke cannot erase them', () => {
    const doc = new TerminalDocument()
    doc.put(0, 0, '●', { owner: owner('a'), kind: 'marker' })
    doc.put(0, 0, '●', { owner: owner('b'), kind: 'marker' })
    expect(doc.cell(0, 0)?.owners.map(item => item.id)).toEqual(['a', 'b'])
    doc.put(0, 0, '─', { owner: route('edge') })
    expect(doc.get(0, 0)).toBe('●')
    expect(doc.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['TERMINAL_GEOMETRY_COLLISION'])
  })

  test('card surfaces reserve their interior against foreign routes', () => {
    const doc = new TerminalDocument()
    doc.fill(0, 0, 3, 2, { owner: owner('card') })
    doc.put(1, 1, '│', { owner: route('edge') })
    expect(doc.get(1, 1)).toBe(' ')
    expect(doc.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['TERMINAL_GEOMETRY_COLLISION'])
    doc.text(1, 1, 'X', { owner: owner('card') })
    expect(doc.get(1, 1)).toBe('X')
  })

  test('reflection transforms geometry and markers while keeping multiline text readable', () => {
    const doc = new TerminalDocument(16, 8)
    doc.scope(owner('a'), () => { doc.text(1, 1, '<界>'); doc.text(2, 2, 'é 👩‍💻') })
    doc.text(11, 6, '<界>', { owner: owner('a') })
    doc.put(0, 0, '▲', { kind: 'marker', owner: route('arrow') })
    doc.port(route('arrow'), { nodeId: 'a', x: 0, y: 0, side: 'T', end: 'start' })
    doc.port(route('arrow'), { nodeId: 'b', x: 15, y: 7, side: 'B', end: 'end' })
    doc.region({ id: 'group', kind: 'cluster', members: ['a'] }, { x: 0, y: 0, width: 8, height: 4 })
    const before = doc.serialize()
    doc.flip(true, true)
    expect(doc.get(15, 7)).toBe('▼')
    expect(doc.regions().find(region => region.id === 'arrow')?.ports).toEqual([
      { nodeId: 'a', x: 15, y: 7, side: 'B', end: 'start' },
      { nodeId: 'b', x: 0, y: 0, side: 'T', end: 'end' },
    ])
    const a = doc.regions().find(region => region.id === 'a')!
    expect(a.ownedCellSpans).toEqual([{ row: 1, start: 1, end: 5 }, { row: 5, start: 10, end: 14 }, { row: 6, start: 11, end: 15 }])
    expect(doc.serialize().split('\n')[5]).toContain('<界>')
    expect(doc.serialize().split('\n')[6]).toContain('é 👩‍💻')
    expect(doc.regions().find(region => region.id === 'group')).toEqual(expect.objectContaining({ canvasRow: 4, canvasColStart: 8, canvasColEnd: 16, rowSpan: 4, members: ['a'] }))
    doc.flip(true, true)
    expect(doc.serialize()).toBe(before)
  })

  test('all encodings share owned geometry and complete text, including literal markup', () => {
    const doc = new TerminalDocument()
    doc.text(0, 0, '<x> & 界 é 👩‍💻 ', { role: 'text', owner: owner('a') })
    doc.put(0, 1, '─', { role: 'line', owner: route('b') })
    const baseline = doc.serialize({ trimEnd: true })
    const regions = doc.regions()
    for (const colorMode of ['none', 'ansi16', 'ansi256', 'truecolor', 'html'] as const) {
      expect(terminalText(doc.serialize({ colorMode, trimEnd: true }), colorMode)).toBe(baseline)
      expect(doc.regions()).toEqual(regions)
    }
  })

  test('sparse empty layers allocate no cells and overlay visits only occupied graphemes', () => {
    const doc = new TerminalDocument(10_000, 10_000)
    const layer = doc.blank()
    expect(layer.occupiedCells).toBe(0)
    layer.text(100, 200, '界x', { owner: owner('a') })
    doc.overlay(layer)
    expect(doc.occupiedCells).toBe(3)
    expect(doc.metrics.overlayVisits).toBe(2)
    expect(doc.regions()[0]?.ownedCellSpans).toEqual([{ row: 200, start: 100, end: 103 }])
  })

  test('coordinates are finite nonnegative integers at every admission boundary', () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new TerminalDocument(value, 0)).toThrow(RangeError)
      const doc = new TerminalDocument()
      expect(() => doc.put(value, 0, 'x')).toThrow(RangeError)
      expect(() => doc.text(0, value, 'x')).toThrow(RangeError)
      expect(() => doc.overlay(new TerminalDocument(), value, 0)).toThrow(RangeError)
      expect(() => doc.region(owner('a'), { x: 0, y: 0, width: value, height: 1 })).toThrow(RangeError)
    }
  })
})
