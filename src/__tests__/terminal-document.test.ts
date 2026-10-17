import { describe, expect, test } from 'bun:test'
import { TerminalDocument, measuredText, type TerminalOwner } from '../ascii/terminal-document.ts'
import { WIDE_CHAR_CONTINUATION } from '../ascii/width.ts'
import { terminalText } from './helpers/terminal-text.ts'

const owner = (id: string): TerminalOwner => ({ id, kind: 'node' })
const route = (id: string, bundle?: string): TerminalOwner => ({ id, kind: 'edge', ...(bundle ? { bundle } : {}) })

describe('owned terminal composition', () => {
  const identityAdmissions = {
    element: (doc: TerminalDocument, foreign: TerminalOwner) => doc.element(foreign),
    scope: (doc: TerminalDocument, foreign: TerminalOwner) => doc.scope(foreign, () => doc.put(8, 8, 'x')),
    region: (doc: TerminalDocument, foreign: TerminalOwner) => doc.region(foreign, { x: 8, y: 8, width: 2, height: 2 }),
    port: (doc: TerminalDocument, foreign: TerminalOwner) => doc.port(foreign, { nodeId: 'X', x: 8, y: 8, end: 'start' }),
    paint: (doc: TerminalDocument, foreign: TerminalOwner) => doc.stroke(8, 8, 10, { owner: foreign }),
    owners: (doc: TerminalDocument, foreign: TerminalOwner) => doc.owners([owner('fresh'), foreign]),
    attribution: (doc: TerminalDocument, foreign: TerminalOwner) => doc.attribute([owner('fresh'), foreign]),
    rectangle: (doc: TerminalDocument, foreign: TerminalOwner) => doc.attributeWithin(foreign, { x: 0, y: 0, width: 1, height: 1 }),
    text: (doc: TerminalDocument, foreign: TerminalOwner) => doc.text(8, 8, 'new', { owner: owner('fresh'), owners: [foreign] }),
    allocation: (doc: TerminalDocument, foreign: TerminalOwner) => doc.textBlock(8, 8, 'new', { owner: owner('fresh'), owners: [foreign] }),
    fill: (doc: TerminalDocument, foreign: TerminalOwner) => doc.fill(8, 8, 2, 2, { owner: owner('fresh'), owners: [foreign] }),
    line: (doc: TerminalDocument, foreign: TerminalOwner) => doc.line([{ text: 'new', owner: owner('fresh') }, { text: 'bad', owner: foreign }]),
    overlay: (doc: TerminalDocument, foreign: TerminalOwner) => {
      const layer = new TerminalDocument()
      layer.stroke(0, 0, 10, { owner: owner('fresh') })
      layer.stroke(1, 0, 10, { owner: foreign })
      doc.overlay(layer, 8, 8)
    },
  }

  test.each(Object.entries(identityAdmissions))('conflicting complete definitions fail before %s changes the target', (_boundary, admit) => {
    const doc = new TerminalDocument()
    doc.stroke(0, 0, 10, { owner: doc.element({ ...route('r'), from: 'A', to: 'B' }) })
    const foreign = new TerminalDocument().element({ ...route('r'), from: 'X', to: 'Y' })
    const before = { output: doc.serialize(), regions: doc.regions(), width: doc.width, height: doc.height }
    expect(() => admit(doc, foreign)).toThrow('Inconsistent terminal element r: from')
    expect({ output: doc.serialize(), regions: doc.regions(), width: doc.width, height: doc.height }).toEqual(before)
    expect(doc.hasOwner('fresh')).toBe(false)
    expect(doc.diagnostics).toEqual([])
  })

  test('same complete definitions from another document retain one canonical identity', () => {
    const doc = new TerminalDocument(), layer = new TerminalDocument()
    const definition = { ...route('r'), from: 'A', to: 'B', members: ['A', 'B'] }
    const local = doc.element(definition), foreign = layer.element({ ...definition, members: [...definition.members] })
    layer.stroke(0, 0, 10, { owner: foreign })
    doc.overlay(layer)
    expect(doc.cell(0, 0)?.owners).toBe(doc.owners([local]))
    expect(doc.element({ ...route('r'), from: 'A' })).toBe(local)
    expect(doc.regions()[0]).toMatchObject({ from: 'A', to: 'B', members: ['A', 'B'] })
    expect(doc.diagnostics).toEqual([])
  })

  test.each([
    ['sourceLine', 2], ['parent', { id: 'parent', kind: 'cluster' }], ['bundle', 'other'],
    ['from', 'other'], ['to', 'other'], ['members', ['other']],
  ] as const)('imported definitions validate the immutable %s field', (field, value) => {
    const definition: TerminalOwner = { ...route('r'), sourceLine: 1, parent: { id: 'parent', kind: 'node' }, bundle: 'shared', from: 'A', to: 'B', members: ['A', 'B'] }
    const doc = new TerminalDocument()
    doc.element(definition)
    const foreign = new TerminalDocument().element({ ...definition, [field]: value })
    expect(() => doc.owners([foreign])).toThrow(`Inconsistent terminal element r: ${field}`)
    expect(doc.occupiedCells).toBe(0)
  })

  test('parent references are immutable and authorize only the declared kind', () => {
    const parent: { id: string; kind: 'node' | 'cluster' } = { id: 'same', kind: 'node' }
    const doc = new TerminalDocument(), child = doc.element({ id: 'child', kind: 'compartment', parent })
    parent.kind = 'cluster'
    expect(child.parent).toEqual({ id: 'same', kind: 'node' })
    expect(Object.isFrozen(child.parent)).toBe(true)
    doc.fill(0, 0, 2, 1, { owner: { id: 'same', kind: 'cluster' } })
    expect(doc.textBlock(0, 0, 'NO', { owner: child })).toBeUndefined()
    expect(doc.get(0, 0)).toBe(' ')
    expect(doc.diagnostics[0]?.code).toBe('TERMINAL_GEOMETRY_COLLISION')
    const compatible = new TerminalDocument()
    compatible.fill(0, 0, 2, 1, { owner: { id: 'same', kind: 'node' } })
    expect(compatible.textBlock(0, 0, 'OK', { owner: child })).toBeDefined()
    expect(compatible.serialize()).toBe('OK')
    expect(compatible.regions().find(region => region.id === 'child')).toMatchObject({ parentId: 'same', parentKind: 'node' })
  })

  test.each(['text', 'textBlock'] as const)('arbitrary owner and group strings retain independent %s allocations', method => {
    const first = owner('a\0b'), second = owner('a'), source = new TerminalDocument(8, 2)
    source[method](0, 0, 'AA', { owner: first, textGroup: 'c' })
    source[method](4, 1, 'BB', { owner: second, textGroup: 'b\0c' })
    const target = new TerminalDocument()
    target.marker(5, 1, { shape: 'circle' }, { owner: owner('obstacle') })
    target.overlay(source)
    expect(target.regions().find(region => region.id === first.id)?.projectedText).toBe('AA')
    expect(target.regions().some(region => region.id === second.id)).toBe(false)
    expect(target.diagnostics).toHaveLength(1)
    source.flip(true, false)
    expect(source.get(6, 0)).toBe('A')
    expect(source.get(2, 1)).toBe('B')
    expect(source.regions().find(region => region.id === first.id)?.projectedText).toBe('AA')
  })

  test('distinct owner tuples retain separate diagnostics through composition and reflection', () => {
    const source = new TerminalDocument()
    for (const [x, previous, next] of [[0, 'a', 'b|node:c'], [2, 'a|node:b', 'c'], [4, 'a', 'b|node:c']] as const) {
      source.fill(x, 0, 1, 1, { owner: owner(previous) })
      expect(source.textBlock(x, 0, 'X', { owner: owner(next) })).toBeUndefined()
    }
    expect(source.diagnostics).toHaveLength(2)
    expect(source.diagnostics.map(diagnostic => diagnostic.feature)).toEqual(['node:a|node:b|node:c', 'node:a|node:b|node:c'])
    const target = new TerminalDocument()
    target.overlay(source, 3, 1)
    target.overlay(source, 3, 1)
    expect(target.diagnostics).toHaveLength(2)
    expect(target.diagnostics.map(diagnostic => diagnostic.cell)).toEqual([{ column: 3, row: 1 }, { column: 5, row: 1 }])
    target.flip(true, true)
    const composed = new TerminalDocument()
    composed.overlay(target, 1, 2)
    expect(composed.diagnostics).toHaveLength(2)
    expect(composed.diagnostics.map(diagnostic => diagnostic.cell)).toEqual([{ column: 5, row: 2 }, { column: 3, row: 2 }])
  })

  test('caller-owned frozen definitions and accessor arrays are revalidated on each import', () => {
    const doc = new TerminalDocument()
    doc.element({ ...route('r'), from: 'A', to: 'B' })
    let from = 'A', reads = 0
    const supplied = Object.freeze([{ ...route('r'), get from() { reads++; return from }, to: 'B' }])
    doc.owners(supplied)
    expect(reads).toBe(1)
    from = 'X'
    expect(() => doc.owners(supplied)).toThrow('Inconsistent terminal element r: from')
    expect(reads).toBe(2)
    const source = new TerminalDocument()
    let current = source.element({ ...route('r'), from: 'A', to: 'B' })
    const accessors: TerminalOwner[] = []
    Object.defineProperty(accessors, '0', { enumerable: true, get: () => current })
    Object.freeze(accessors)
    doc.owners(accessors)
    current = new TerminalDocument().element({ ...route('r'), from: 'X', to: 'Y' })
    expect(() => doc.owners(accessors)).toThrow('Inconsistent terminal element r: from')
  })

  test('an external definition is snapshotted before deriving its identity key', () => {
    const doc = new TerminalDocument()
    let reads = 0
    doc.stroke(0, 0, 10, { owner: { get id() { return ++reads === 1 ? 'first' : 'later' }, kind: 'node' } })
    expect(reads).toBe(1)
    expect(doc.hasOwner('first')).toBe(true)
    expect(doc.hasOwner('later')).toBe(false)
    expect(doc.regions()[0]?.id).toBe('first')
  })

  test.each(['text', 'textBlock', 'fill', 'line'] as const)('a %s batch snapshots a caller paint getter once before admission', method => {
    for (const conflicting of [false, true]) {
      const doc = new TerminalDocument(), good = doc.element({ ...route('r'), from: 'A' })
      const bad = new TerminalDocument().element({ ...route('r'), from: 'X' })
      let reads = 0
      const paint = { get owner() { return ++reads === 1 ? conflicting ? bad : good : conflicting ? good : bad } }
      const draw = () => {
        if (method === 'line') doc.line([{ text: 'A' }, { text: 'B' }], paint)
        else if (method === 'fill') doc.fill(0, 0, 2, 1, paint)
        else doc[method](0, 0, 'AB', paint)
      }
      if (conflicting) {
        expect(draw).toThrow('Inconsistent terminal element r: from')
        expect([doc.width, doc.height, doc.occupiedCells]).toEqual([0, 0, 0])
      } else {
        expect(draw).not.toThrow()
        expect(doc.occupiedCells).toBe(2)
        expect(doc.regions()[0]?.from).toBe('A')
      }
      expect(reads).toBe(1)
    }
  })

  test('multi-cell paint snapshots an explicit owners getter once', () => {
    const doc = new TerminalDocument(), good = doc.element({ ...route('r'), from: 'A' })
    const bad = new TerminalDocument().element({ ...route('r'), from: 'X' })
    let reads = 0
    doc.fill(0, 0, 2, 1, { get owners() { return ++reads === 1 ? [good] : [bad] } })
    expect(reads).toBe(1)
    expect(doc.occupiedCells).toBe(2)
    expect(doc.cell(0, 0)?.owners).toBe(doc.cell(1, 0)?.owners)
  })

  test.each(['text', 'allocation', 'overlay'] as const)('positioned %s extends an existing line without widening untouched rows', method => {
    const doc = new TerminalDocument()
    doc.line([{ text: 'A', owner: owner('a') }])
    doc.line([{ text: 'untouched ', owner: owner('untouched') }])
    doc.line([{ text: 'X', owner: owner('x') }])
    if (method === 'text') doc.text(4, 0, '界 ', { owner: owner('b') })
    else if (method === 'allocation') doc.textBlock(4, 0, '界 ', { owner: owner('b') })
    else {
      const layer = new TerminalDocument()
      layer.textBlock(0, 0, '界 ', { owner: owner('b') })
      doc.overlay(layer, 4, 0)
    }
    expect(doc.serialize({ trimEnd: true })).toBe('A   界 \nuntouched \nX')
    expect(doc.regions().find(region => region.id === 'b')?.ownedCellSpans).toEqual([{ row: 0, start: 4, end: 7 }])
    expect(doc.diagnostics).toEqual([])
  })

  test.each([[true, false], [false, true], [true, true]])('positioned row extents follow complete readable groups through reflection (%s, %s)', (horizontal, vertical) => {
    const doc = new TerminalDocument()
    doc.line([{ text: 'ab', owner: owner('group'), textGroup: 'label' }])
    doc.line([{ text: 'x', owner: owner('group'), textGroup: 'label' }])
    doc.line([{ text: 'Z', owner: owner('independent') }])
    doc.textBlock(5, 0, '界 ', { owner: owner('extension') })
    const before = 'ab   界 \nx\nZ'
    expect(doc.serialize()).toBe(before)
    doc.flip(horizontal, vertical)
    doc.serialize()
    expect(doc.regions().find(region => region.id === 'group')?.projectedText).toBe('ab\nx')
    expect(doc.regions().find(region => region.id === 'extension')?.projectedText).toBe('界 ')
    doc.flip(horizontal, vertical)
    expect(doc.serialize()).toBe(before)
    expect(doc.diagnostics).toEqual([])
  })

  test('vertical reflection retains allocated empty row widths beside positioned line output', () => {
    const doc = new TerminalDocument(4, 2)
    doc.line([{ text: 'x', owner: owner('x') }])
    const before = '    \n    \nx'
    expect(doc.serialize()).toBe(before)
    doc.flip(false, true)
    expect(doc.serialize()).toBe('x\n    \n    ')
    doc.flip(false, true)
    expect(doc.serialize()).toBe(before)
  })

  test('a frozen owner array does not make its mutable element definitions immutable', () => {
    const doc = new TerminalDocument()
    const first = route('A'), second = route('B'), supplied = Object.freeze([first, second])
    doc.put(0, 0, '─', { owners: supplied })
    second.id = 'C'
    doc.put(0, 1, '─', { owners: supplied })
    expect(doc.cell(0, 0)?.owners.map(owner => owner.id)).toEqual(['A', 'B'])
    expect(doc.cell(0, 1)?.owners.map(owner => owner.id)).toEqual(['A', 'C'])
    expect(doc.regions().map(region => region.id)).toEqual(['A', 'B', 'C'])
    expect(doc.diagnostics).toEqual([])
  })

  test.each([[true, false], [false, true], [true, true]])('reflection moves ragged text and its opaque padding together (%s, %s)', (horizontal, vertical) => {
    const doc = new TerminalDocument(6, 4)
    doc.textBlock(1, 1, ['ab', 'x'], { owner: owner('label') })
    const before = doc.serialize()
    doc.flip(horizontal, vertical)
    expect(doc.regions().find(region => region.id === 'label')?.projectedText).toBe('ab\nx')
    const textX = horizontal ? 3 : 1
    expect(doc.get(textX + 1, 2)).toBe(' ')
    expect(doc.cell(textX + 1, 2)?.kind).toBe('surface')
    expect(doc.diagnostics).toEqual([])
    doc.flip(horizontal, vertical)
    expect(doc.serialize()).toBe(before)
  })

  test('reflection carries compatible card surface through a grouped multiline label', () => {
    const doc = new TerminalDocument(6, 4)
    doc.scope(owner('card'), () => {
      doc.fill(0, 0, 6, 4)
      doc.textBlock(1, 1, 'ab')
      doc.textBlock(1, 2, 'x')
    })
    doc.flip(false, true)
    expect(doc.regions().find(region => region.id === 'card')?.projectedText).toBe('ab\nx')
    expect(doc.cell(2, 2)?.kind).toBe('surface')
    expect(doc.occupiedCells).toBe(24)
    expect(doc.diagnostics).toEqual([])
  })

  test('a compatible padding repaint retains its complete text allocation during reflection', () => {
    const doc = new TerminalDocument(6, 4)
    doc.scope(owner('card'), () => {
      doc.fill(0, 0, 6, 4)
      doc.textBlock(1, 1, ['ab', 'x'])
      doc.fill(2, 2, 1, 1)
    })
    doc.flip(false, true)
    expect(doc.occupiedCells).toBe(24)
    expect(doc.regions().find(region => region.id === 'card')?.projectedText).toBe('ab\nx')
    expect(doc.cell(2, 2)?.kind).toBe('surface')
    expect(doc.diagnostics).toEqual([])
  })

  test.each(['text', 'textBlock'] as const)('reflection preserves a long ragged grouped %s label over its card surface', method => {
    const lines = Array.from({ length: 80 }, (_, row) => row % 3 ? `row${row}` : `Long row ${row} 界`)
    const doc = new TerminalDocument(24, lines.length + 2)
    doc.scope(owner('card'), () => {
      doc.fill(0, 0, 24, lines.length + 2)
      lines.forEach((line, row) => doc[method](1, row + 1, line))
    })
    const before = doc.serialize()
    doc.flip(true, true)
    expect(doc.regions().find(region => region.id === 'card')?.projectedText).toBe(lines.join('\n'))
    expect(doc.occupiedCells).toBe(24 * (lines.length + 2))
    expect(doc.diagnostics).toEqual([])
    doc.flip(true, true)
    expect(doc.serialize()).toBe(before)
  })

  test('a default-direction semantic arrow reflects like an explicit right arrow', () => {
    const doc = new TerminalDocument(3, 1)
    doc.marker(0, 0, { shape: 'arrow' }, { owner: route('a') })
    expect(doc.cell(0, 0)?.marker?.direction).toBe('R')
    doc.flip(true, false)
    expect(doc.get(2, 0)).toBe('◄')
    expect(doc.cell(2, 0)?.marker?.direction).toBe('L')
  })

  test('horizontal reflection updates ragged line extents before serialization and metadata', () => {
    const doc = new TerminalDocument()
    doc.line([{ text: 'abcd', owner: owner('first') }])
    doc.line([{ text: 'x', owner: owner('second') }])
    const before = doc.serialize()
    doc.flip(true, false)
    expect(doc.serialize()).toBe('abcd\n   x')
    expect(doc.regions().find(region => region.id === 'second')?.ownedCellSpans).toEqual([{ row: 1, start: 3, end: 4 }])
    doc.flip(true, false)
    expect(doc.serialize()).toBe(before)
    doc.flip(true, false)
    doc.flip(false, true)
    expect(doc.serialize()).toBe('   x\nabcd')
  })

  test('reflection retains unowned cells inside an ambient owner scope', () => {
    const doc = new TerminalDocument(2, 1)
    doc.stroke(0, 0, 10)
    doc.scope(owner('intruder'), () => doc.flip(true, false))
    expect(doc.cell(1, 0)?.owners).toHaveLength(0)
    expect(doc.regions()).toEqual([])
  })

  test('element handles and owner sets are immutable, canonical and reject conflicting identity', () => {
    const doc = new TerminalDocument()
    const a = doc.element({ ...route('a'), from: 'source', to: 'target' })
    const b = doc.element(route('b'))
    expect(doc.element({ ...route('a'), from: 'source' })).toBe(a)
    expect(Object.isFrozen(a)).toBe(true)
    expect(doc.owners([a, b, a])).toBe(doc.owners([b, a]))
    expect(doc.owners([a])).toBe(doc.owners(new Set([a])))
    expect(doc.owners([a])).toBe(doc.owners([a, a]))
    expect(doc.owners([])).toBe(doc.owners(new Set()))
    expect(Object.isFrozen(doc.owners([a, b]))).toBe(true)
    expect(() => doc.element({ ...route('a'), to: 'different' })).toThrow('Inconsistent terminal element a: to')
  })

  test('declared compartments may paint their parent surface, while a sibling cannot erase their text', () => {
    const doc = new TerminalDocument()
    const card = doc.element(owner('card'))
    const first = doc.element({ id: 'first', kind: 'compartment', parent: { id: card.id, kind: 'node' } })
    const second = doc.element({ id: 'second', kind: 'compartment', parent: { id: card.id, kind: 'node' } })
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

  test.each(['text', 'marker', 'surface', 'mark'] as const)('overlay rejects a complete text group after a late %s collision', kind => {
    const source = new TerminalDocument()
    source.textBlock(0, 0, ['AB', '界x'], { owner: owner('label') })
    source.stroke(4, 0, 10, { owner: route('independent') })
    source.marker(4, 1, { shape: 'circle' }, { owner: owner('independent-marker') })
    const before = source.serialize()
    const target = new TerminalDocument()
    if (kind === 'text') target.textBlock(2, 1, 'X', { owner: owner('obstacle') })
    else target.put(2, 1, kind === 'marker' ? '○' : kind === 'mark' ? '█' : ' ', { owner: owner('obstacle'), kind })
    target.overlay(source)
    expect(target.regions().some(region => region.id === 'label')).toBe(false)
    expect([...target.entries()].some(([, , cell]) => cell.textBlock !== undefined && cell.owners.some(owner => owner.id === 'label'))).toBe(false)
    expect(target.cell(2, 1)?.kind).toBe(kind)
    expect(target.get(4, 0)).toBe('─')
    expect(target.get(4, 1)).toBe('○')
    expect(target.diagnostics).toContainEqual(expect.objectContaining({
      code: kind === 'text' ? 'TERMINAL_TEXT_COLLISION' : 'TERMINAL_GEOMETRY_COLLISION', cell: { column: 2, row: 1 },
    }))
    expect(source.serialize()).toBe(before)
  })

  test('offset overlay preserves a wide multiline group, its padding and all explicit owners', () => {
    const a = owner('a'), b = owner('b')
    const source = new TerminalDocument()
    source.textBlock(0, 0, ['界A', 'x'], { owner: a, owners: [a, b] })
    const target = new TerminalDocument()
    target.fill(3, 2, 3, 2, { owner: a, owners: [a, b] })
    target.overlay(source, 3, 2)
    expect(target.get(3, 2)).toBe('界')
    expect(target.get(4, 2)).toBe(WIDE_CHAR_CONTINUATION)
    expect(target.cell(4, 3)?.kind).toBe('surface')
    expect(target.cell(4, 3)?.textBlock).toMatchObject({ x: 3, y: 2, width: 3, height: 2 })
    for (const id of ['a', 'b']) expect(target.regions().find(region => region.id === id)?.projectedText).toBe('界A\nx')
    expect(target.diagnostics).toEqual([])
    expect(target.metrics.overlayVisits).toBe(5)
    target.flip(true, true)
    for (const id of ['a', 'b']) expect(target.regions().find(region => region.id === id)?.projectedText).toBe('界A\nx')
    expect(target.diagnostics).toEqual([])
  })

  test('an overlay text group sharing one owner still rejects a foreign co-owner', () => {
    const a = owner('a'), b = owner('b'), c = owner('c')
    const source = new TerminalDocument()
    source.textBlock(0, 0, 'AB', { owner: a, owners: [a, c] })
    const target = new TerminalDocument()
    target.marker(4, 1, { shape: 'circle' }, { owner: a, owners: [a, b] })
    target.overlay(source, 3, 1)
    expect(target.cell(3, 1)).toBeUndefined()
    expect(target.get(4, 1)).toBe('○')
    expect(target.cell(4, 1)?.owners.map(owner => owner.id)).toEqual(['a', 'b'])
    expect(target.diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_GEOMETRY_COLLISION', feature: 'node:a|node:b|node:c' }))
  })

  test('rectangular attribution rejects partial graphemes atomically and retains accepted provenance through composition', () => {
    const source = new TerminalDocument()
    source.text(0, 0, 'AB界', { owner: owner('card') })
    const before = source.regions()
    const compartment: TerminalOwner = { id: 'compartment', kind: 'compartment', parent: { id: 'card', kind: 'node' } }
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
