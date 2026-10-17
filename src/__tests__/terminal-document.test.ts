import { describe, expect, test } from 'bun:test'
import { TerminalDocument, measuredText, type TerminalOwner } from '../ascii/terminal-document.ts'
import { WIDE_CHAR_CONTINUATION } from '../ascii/width.ts'
import { terminalText } from './helpers/terminal-text.ts'

const owner = (id: string): TerminalOwner => ({ id, kind: 'node' })
const route = (id: string, bundle?: string): TerminalOwner => ({ id, kind: 'edge', ...(bundle ? { bundle } : {}) })

describe('owned terminal composition', () => {
  test('element handles and owner sets are immutable, canonical and reject conflicting identity', () => {
    const doc = new TerminalDocument()
    const a = doc.element({ ...route('a'), from: 'source', to: 'target' })
    const b = doc.element(route('b'))
    expect(doc.element({ ...route('a'), from: 'source' })).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
    expect(doc.owners([a, b, a])).toBe(doc.owners([b, a]))
    expect(Object.isFrozen(doc.owners([a, b]))).toBe(true)
    expect(() => doc.element({ ...route('a'), to: 'different' })).toThrow('Inconsistent terminal element a: to')
  })

  test('declared compartments may paint their parent surface, while a sibling cannot erase their text', () => {
    const doc = new TerminalDocument()
    const card = doc.element(owner('card'))
    const first = doc.element({ id: 'first', kind: 'compartment', parentId: card.id })
    const second = doc.element({ id: 'second', kind: 'compartment', parentId: card.id })
    doc.fill(0, 0, 2, 1, { owner: card })
    doc.text(0, 0, 'AB', { owner: first, owners: doc.owners([card, first]) })
    expect(doc.serialize()).toBe('AB')
    expect(doc.diagnostics).toEqual([])
    doc.text(0, 0, 'X', { owner: second, owners: doc.owners([card, second]) })
    expect(doc.serialize()).toBe('AB')
    expect(doc.diagnostics[0]?.code).toBe('TERMINAL_TEXT_COLLISION')
  })

  test.each([false, true])('stroke topology survives ASCII information loss and reflection (ASCII=%s)', ascii => {
    const doc = new TerminalDocument(3, 3)
    doc.stroke(0, 0, 6, { owner: route('a'), ascii, rounded: true })
    expect(doc.get(0, 0)).toBe(ascii ? '+' : '╭')
    expect(doc.cell(0, 0)?.stroke?.mask).toBe(6)
    doc.flip(true, false)
    expect(doc.cell(2, 0)?.stroke?.mask).toBe(12)
    expect(doc.get(2, 0)).toBe(ascii ? '+' : '╮')
    doc.flip(false, true)
    expect(doc.cell(2, 2)?.stroke?.mask).toBe(9)
    expect(doc.get(2, 2)).toBe(ascii ? '+' : '╯')
  })

  test('logical line style and marker direction do not depend on painted glyph decoding', () => {
    const doc = new TerminalDocument(3, 2)
    doc.stroke(0, 0, 10, { owner: route('a'), style: 'dashed' })
    doc.marker(2, 1, { shape: 'open-arrow', direction: 'R' }, { owner: route('a') })
    expect(doc.get(0, 0)).toBe('╌')
    expect(doc.get(2, 1)).toBe('▷')
    doc.flip(true, false)
    expect(doc.cell(0, 1)?.marker?.direction).toBe('L')
    expect(doc.get(0, 1)).toBe('◁')
    expect(doc.cell(2, 0)?.stroke).toMatchObject({ mask: 10, style: 'dashed' })
  })

  test.each(['horizontal', 'vertical'] as const)('numeric %s coverage is opaque regardless of line paint order', axis => {
    for (const lineFirst of [false, true]) for (const coverage of [1, 2, 3] as const) {
      const doc = new TerminalDocument(3, 1)
      const line = () => { for (let x = 0; x < 3; x++) doc.stroke(x, 0, 10, { owner: route('line') }) }
      if (lineFirst) line()
      doc.numericMark(1, 0, { axis, coverage }, { owner: owner('bar') })
      if (!lineFirst) line()
      const glyph = coverage === 3 ? '█' : axis === 'horizontal' ? coverage === 1 ? '▌' : '▐' : coverage === 1 ? '▄' : '▀'
      expect(doc.serialize()).toBe(`─${glyph}─`)
      expect(doc.cell(1, 0)?.owners.map(owner => owner.id)).toEqual(['bar'])
      const region = doc.regions().find(region => region.id === 'line')!
      expect(region.ownedCellSpans).toEqual([{ row: 0, start: 0, end: 1 }, { row: 0, start: 2, end: 3 }])
      expect(region.occludedCellSpans).toEqual([{ row: 0, start: 1, end: 2 }])
      expect(doc.diagnostics).toEqual([])
      doc.flip(axis === 'horizontal', axis === 'vertical')
      expect(doc.cell(1, 0)?.numericMark?.coverage).toBe(coverage === 1 ? 2 : coverage === 2 ? 1 : 3)
    }
  })

  test('measured text allocation rejects a late collision without emitting a partial label', () => {
    const text = measuredText(['界ab', 'é '])
    expect(text).toMatchObject({ width: 4, height: 2 })
    expect(Object.isFrozen(text.lines[0])).toBe(true)
    const doc = new TerminalDocument()
    doc.marker(3, 1, { shape: 'circle' }, { owner: owner('obstacle') })
    expect(doc.textBlock(0, 0, text, { owner: owner('label') })).toBeUndefined()
    expect([...doc.entries()].map(([x, y]) => [x, y])).toEqual([[3, 1]])
    expect(doc.regions().map(region => region.id)).toEqual(['obstacle'])
    expect(doc.diagnostics[0]?.code).toBe('TERMINAL_GEOMETRY_COLLISION')
  })

  test.each(['marker', 'surface', 'mark'] as const)('allocated text requires explicit authorization to replace an unowned %s', kind => {
    const doc = new TerminalDocument()
    if (kind === 'surface') doc.fill(1, 0, 1, 1)
    else doc.put(1, 0, kind === 'marker' ? '►' : '█', { kind })
    expect(doc.textBlock(0, 0, '界')).toBeUndefined()
    expect(doc.cell(0, 0)).toBeUndefined()
    expect(doc.cell(1, 0)?.kind).toBe(kind)
    expect(doc.diagnostics[0]).toMatchObject({ code: 'TERMINAL_GEOMETRY_COLLISION', cell: { column: 1, row: 0 } })
  })

  test('allocated text preserves complete occurrences and reserves unprinted padding', () => {
    const doc = new TerminalDocument()
    const label = owner('label')
    const allocation = doc.textBlock(1, 0, measuredText(['界', 'x']), { owner: label, textGroup: 'label' })!
    expect(Object.isFrozen(allocation)).toBe(true)
    doc.textBlock(2, 2, 'tail', { owner: label, textGroup: 'label' })
    doc.stroke(2, 1, 5, { owner: route('foreign') })
    expect(doc.get(2, 1)).toBe(' ')
    expect(doc.regions().find(region => region.id === 'label')?.projectedText).toBe('界\nx\ntail')
    expect(doc.diagnostics[0]?.code).toBe('TERMINAL_GEOMETRY_COLLISION')
  })

  test('an own-route label diagnoses every foreign route hidden at a crossing', () => {
    const doc = new TerminalDocument()
    for (let x = 0; x < 3; x++) doc.put(x, 1, '─', { owner: route('a') })
    for (let y = 0; y < 3; y++) doc.put(1, y, '│', { owner: route('b') })
    doc.text(1, 1, 'x', { owner: route('a') })
    expect(doc.serialize().split('\n')[1]).toBe('─x─')
    expect(doc.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: 'edge:a|edge:b' }))
  })

  test('overlay admits the complete owner set before changing an occupied surface', () => {
    const doc = new TerminalDocument()
    doc.fill(0, 0, 1, 1, { owner: route('a') })
    const source = new TerminalDocument()
    source.put(0, 0, '─', { owner: route('a') }); source.attribute(route('b'))
    doc.overlay(source)
    expect(doc.cell(0, 0)?.kind).toBe('surface')
    expect(doc.cell(0, 0)?.owners.map(owner => owner.id)).toEqual(['a'])
    expect(doc.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: 'edge:a|edge:b' }))
  })

  test('rectangular attribution rejects partial graphemes atomically and retains accepted provenance through composition', () => {
    const source = new TerminalDocument()
    source.text(0, 0, 'AB界', { owner: owner('card') })
    const before = source.regions()
    const compartment: TerminalOwner = { id: 'compartment', kind: 'compartment', parentId: 'card' }
    expect(() => source.attributeWithin(compartment, { x: 0, y: 0, width: 3, height: 1 })).toThrow('complete graphemes')
    expect(source.regions()).toEqual(before)
    expect(source.hasOwner(compartment.id)).toBe(false)
    expect(() => source.attributeWithin(compartment, { x: 3, y: 0, width: 1, height: 1 })).toThrow('complete graphemes')
    source.attributeWithin(compartment, { x: 2, y: 0, width: 2, height: 1 })
    expect(source.cell(2, 0)?.owners).toBe(source.cell(3, 0)?.owners)
    const composed = new TerminalDocument(8, 3)
    composed.overlay(source, 3, 1); composed.flip(true, true)
    expect(composed.get(3, 1)).toBe('界')
    expect(composed.cell(3, 1)?.owners).toBe(composed.cell(4, 1)?.owners)
    expect(composed.regions().find(region => region.id === compartment.id)?.ownedCellSpans).toEqual([{ row: 1, start: 3, end: 5 }])
    expect(source.regions().find(region => region.id === compartment.id)?.ownedCellSpans).toEqual([{ row: 0, start: 2, end: 4 }])
  })

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

  test.each(['marker', 'surface'] as const)('wide graphemes cannot erase a foreign %s in their second cell', kind => {
    const doc = new TerminalDocument()
    if (kind === 'marker') doc.put(1, 0, '●', { owner: owner('obstacle'), kind })
    else doc.fill(1, 0, 1, 1, { owner: owner('obstacle') })
    doc.text(0, 0, '界', { owner: owner('label') })
    expect(doc.cell(0, 0)).toBeUndefined()
    expect(doc.cell(1, 0)).toMatchObject({ kind, owners: [owner('obstacle')] })
    expect(doc.regions().map(region => region.id)).toEqual(['obstacle'])
    expect(doc.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_GEOMETRY_COLLISION', cell: { column: 1, row: 0 } }))
  })

  test('partial overlap cannot retire another owner’s wide marker', () => {
    const doc = new TerminalDocument()
    doc.put(1, 0, '界', { owner: owner('marker'), kind: 'marker' })
    doc.text(0, 0, '界', { owner: owner('label') })
    expect(doc.get(1, 0)).toBe('界')
    expect(doc.get(2, 0)).toBe(WIDE_CHAR_CONTINUATION)
    expect(doc.cell(0, 0)).toBeUndefined()
    expect(doc.diagnostics.map(diagnostic => diagnostic.code)).toEqual(['TERMINAL_GEOMETRY_COLLISION'])
  })

  test('text diagnoses foreign route erasure while own-route and declared-bundle labels stay compatible', () => {
    for (const relation of ['foreign', 'own', 'bundle'] as const) {
      const doc = new TerminalDocument()
      doc.put(0, 0, '─', { owner: route('a', relation === 'bundle' ? 'shared' : undefined) })
      doc.text(0, 0, 'X', { owner: route(relation === 'own' ? 'a' : 'b', relation === 'bundle' ? 'shared' : undefined) })
      expect(doc.serialize()).toBe('X')
      expect(doc.diagnostics.map(diagnostic => diagnostic.code)).toEqual(relation === 'foreign' ? ['TERMINAL_GEOMETRY_COLLISION'] : [])
      expect(doc.regions().find(region => region.id === (relation === 'own' ? 'a' : 'b'))?.projectedText).toBe('X')
    }
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

  test('diagnostic cells follow overlay and reflection without changing the source layer', () => {
    const layer = new TerminalDocument(4, 4)
    layer.text(1, 2, 'X', { owner: owner('label') })
    layer.put(1, 2, '─', { owner: route('route') })
    expect(layer.diagnostics[0]?.cell).toEqual({ column: 1, row: 2 })
    const drawing = new TerminalDocument(12, 10)
    drawing.overlay(layer, 3, 4)
    expect(drawing.diagnostics[0]?.cell).toEqual({ column: 4, row: 6 })
    expect(drawing.get(4, 6)).toBe('X')
    drawing.flip(true, true)
    expect(drawing.diagnostics[0]?.cell).toEqual({ column: 7, row: 3 })
    expect(drawing.get(7, 3)).toBe('X')
    expect(layer.diagnostics[0]?.cell).toEqual({ column: 1, row: 2 })
  })

  test('diagnostic reflection follows readable text blocks and wide continuations', () => {
    const drawing = new TerminalDocument(8, 6)
    drawing.scope(owner('label'), () => {
      drawing.text(1, 1, '界x')
      drawing.text(1, 2, 'abc')
    })
    drawing.put(2, 1, '│', { owner: route('route') })
    expect(drawing.diagnostics[0]?.cell).toEqual({ column: 2, row: 1 })
    drawing.flip(true, true)
    expect(drawing.diagnostics[0]?.cell).toEqual({ column: 5, row: 3 })
    expect(drawing.get(4, 3)).toBe('界')
    expect(drawing.get(5, 3)).toBe(WIDE_CHAR_CONTINUATION)
    expect(drawing.serialize().split('\n')[4]).toContain('abc')
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
