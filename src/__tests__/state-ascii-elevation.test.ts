import { describe, expect, test } from 'bun:test'
import { decodeHTML } from 'entities'
import { renderMermaidASCII, renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalCell, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'
import { visualWidth } from '../ascii/width.ts'

interface Rect { left: number; right: number; top: number; bottom: number }

function locate(output: string, token: string): { row: number; col: number } {
  const rows = output.split('\n')
  const row = rows.findIndex(line => line.includes(token))
  return { row, col: row < 0 ? -1 : rows[row]!.indexOf(token) }
}

function rowBorders(output: string, token: string): { row: number; left: number; right: number } {
  const rows = output.split('\n')
  const { row, col } = locate(output, token)
  expect(row, `${token}: row`).toBeGreaterThanOrEqual(0)
  const left = rows[row]!.lastIndexOf('|', col)
  const right = rows[row]!.indexOf('|', col + token.length)
  expect(left, `${token}: left border`).toBeGreaterThanOrEqual(0)
  expect(right, `${token}: right border`).toBeGreaterThan(left)
  return { row, left, right }
}

function expectAsciiBox(output: string, token: string, rounded = false): Rect {
  const rows = output.split('\n')
  const { row, left, right } = rowBorders(output, token)
  const topChars = rounded ? new Set(['.', '+']) : new Set(['+'])
  const bottomChars = rounded ? new Set(["'", '+']) : new Set(['+'])
  let top = row
  while (top >= 0 && !(topChars.has(rows[top]![left]!) && topChars.has(rows[top]![right]!))) top--
  let bottom = row
  while (bottom < rows.length && !(bottomChars.has(rows[bottom]![left]!) && bottomChars.has(rows[bottom]![right]!))) bottom++
  expect(top, `${token}: top border`).toBeGreaterThanOrEqual(0)
  expect(bottom, `${token}: bottom border`).toBeLessThan(rows.length)
  expect(rows[top]!.slice(left + 1, right)).toMatch(/^-+$/)
  expect(rows[bottom]!.slice(left + 1, right)).toMatch(/^-+$/)
  for (let y = top + 1; y < bottom; y++) {
    expect(rows[y]![left], `${token}: left border row ${y}`).toBe('|')
    expect(rows[y]![right], `${token}: right border row ${y}`).toBe('|')
  }
  return { left, right, top, bottom }
}

const portDirections = {
  T: { dx: 0, dy: -1, outward: 1, inward: 4 },
  R: { dx: 1, dy: 0, outward: 2, inward: 8 },
  B: { dx: 0, dy: 1, outward: 4, inward: 1 },
  L: { dx: -1, dy: 0, outward: 8, inward: 2 },
} as const

/** Ports describe attachment; only mutually connected, visible owned ink proves it. */
function expectAttachedNote(doc: TerminalDocument, edge: TerminalRegion, targetKind: 'node' | 'cluster'): void {
  const ports = edge.ports ?? []
  expect(ports, `${edge.id}: two attached endpoints`).toHaveLength(2)
  const ink = new Map<string, { x: number; y: number; cell: TerminalCell }>([...doc.entries()].filter(([, , cell]) => cell.stroke && cell.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id))
    .map(([x, y, cell]) => [`${x},${y}`, { x, y, cell }] as const))
  expect(ink.size, `${edge.id}: visible route`).toBeGreaterThan(0)
  for (const { cell } of ink.values()) expect(cell.glyph.trim(), `${edge.id}: owned stroke is visible`).not.toBe('')
  const attached = ports.map(port => {
    expect(port.nodeId, `${edge.id}: declared endpoint`).toBe(port.end === 'start' ? edge.from! : edge.to!)
    const ownerKind = port.end === 'start' ? targetKind : 'node'
    const endpoint = doc.cell(port.x, port.y)
    expect(endpoint?.owners.some(owner => owner.kind === ownerKind && owner.id === port.nodeId), `${edge.id}: endpoint belongs to ${port.nodeId}`).toBe(true)
    expect(port.side, `${edge.id}: attachment side`).toBeDefined()
    const direction = portDirections[port.side!]
    const adjacent = `${port.x + direction.dx},${port.y + direction.dy}`
    const stroke = ink.get(adjacent)
    expect(stroke, `${edge.id}: actual owned ink beside ${port.end}`).toBeDefined()
    expect(stroke!.cell.stroke!.mask & direction.inward, `${edge.id}: ink enters ${port.end}`).not.toBe(0)
    return adjacent
  })
  const seen = new Set([attached[0]!]), queue = [attached[0]!]
  for (let index = 0; index < queue.length; index++) {
    const { x, y, cell } = ink.get(queue[index]!)!
    for (const { dx, dy, outward, inward } of Object.values(portDirections)) {
      const key = `${x + dx},${y + dy}`, next = ink.get(key)
      if (next && (cell.stroke!.mask & outward) && (next.cell.stroke!.mask & inward) && !seen.has(key)) {
        seen.add(key)
        queue.push(key)
      }
    }
  }
  expect(seen.has(attached[1]!), `${edge.id}: connected to note`).toBe(true)
  expect(seen.size, `${edge.id}: no disconnected owned fragments`).toBe(ink.size)
}

function ownedBounds(region: TerminalRegion): Rect {
  return {
    left: Math.min(...region.ownedCellSpans.map(span => span.start)),
    right: Math.max(...region.ownedCellSpans.map(span => span.end)) - 1,
    top: Math.min(...region.ownedCellSpans.map(span => span.row)),
    bottom: Math.max(...region.ownedCellSpans.map(span => span.row)),
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom
}

function expectTransitionMarkers(doc: TerminalDocument, edges: TerminalRegion[]): void {
  for (const edge of edges) {
    const end = edge.ports!.find(port => port.end === 'end')!
    const { dx, dy } = portDirections[end.side!]
    const marker = doc.cell(end.x + dx, end.y + dy)
    expect(marker?.marker?.shape, `${edge.id}: incoming arrow survives note placement`).toBe('arrow')
    expect(marker?.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
    expect(marker?.glyph.trim()).not.toBe('')
  }
}

const noteAttachmentCases = [
  { name: 'right of a child across its parent frame', source: 'stateDiagram-v2\nstate Outer {\n B\n}\nnote right of B: Note', notes: [{ target: 'B', text: 'Note', kind: 'node' }] },
  { name: 'left of a child across its parent frame', source: 'stateDiagram-v2\nstate Outer {\n B\n}\nnote left of B: Note', notes: [{ target: 'B', text: 'Note', kind: 'node' }] },
  { name: 'opposite sides of a deeply nested wide state in LR', source: 'stateDiagram-v2\ndirection LR\nstate Outer {\n state Inner {\n  state "状態界" as B\n }\n}\nnote left of B: 左側界\nnote right of B: 右側界', notes: [{ target: 'B', text: '左側界', kind: 'node' }, { target: 'B', text: '右側界', kind: 'node' }] },
  { name: 'two notes beside a nested transition in BT', source: 'stateDiagram-v2\ndirection BT\nstate Outer {\n B --> C\n}\nnote right of B: First\nnote right of B: Second', notes: [{ target: 'B', text: 'First', kind: 'node' }, { target: 'B', text: 'Second', kind: 'node' }] },
  { name: 'a nested composite target in RL', source: 'stateDiagram-v2\ndirection RL\nstate Outer {\n state Inner {\n  B\n }\n}\nnote right of Inner: Group note', notes: [{ target: 'Inner', text: 'Group note', kind: 'cluster' }] },
  { name: 'a simple leaf', source: 'stateDiagram-v2\nA --> B\nnote right of A: Leaf note', notes: [{ target: 'A', text: 'Leaf note', kind: 'node' }] },
  { name: 'an incoming-marker face in LR', source: 'stateDiagram-v2\ndirection LR\nA --> B\nnote left of B: Note', notes: [{ target: 'B', text: 'Note', kind: 'node' }] },
  { name: 'an incoming-marker face with zero horizontal padding', source: 'stateDiagram-v2\ndirection LR\nA --> B\nnote left of B: Note', paddingX: 0, notes: [{ target: 'B', text: 'Note', kind: 'node' }] },
  { name: 'an incoming-marker face in RL', source: 'stateDiagram-v2\ndirection RL\nA --> B\nnote right of B: Note', notes: [{ target: 'B', text: 'Note', kind: 'node' }] },
  { name: 'a nested incoming-marker face', source: 'stateDiagram-v2\ndirection LR\nstate Outer {\n A --> B\n}\nnote left of B: Note', notes: [{ target: 'B', text: 'Note', kind: 'node' }] },
  { name: 'opposite sides of concurrent regions', source: 'stateDiagram-v2\nstate Outer {\n A --> B\n --\n C --> D\n}\nnote left of C: First\nnote right of A: Second', notes: [{ target: 'C', text: 'First', kind: 'node' }, { target: 'A', text: 'Second', kind: 'node' }] },
  { name: 'an outer composite', source: 'stateDiagram-v2\nstate Outer {\n A --> B\n}\nnote left of Outer: Outer note', notes: [{ target: 'Outer', text: 'Outer note', kind: 'cluster' }] },
  { name: 'both sides of an empty composite', source: 'stateDiagram-v2\nstate Empty {\n}\nnote left of Empty: Left empty\nnote right of Empty: Right empty', notes: [{ target: 'Empty', text: 'Left empty', kind: 'cluster' }, { target: 'Empty', text: 'Right empty', kind: 'cluster' }] },
] satisfies Array<{ name: string; source: string; paddingX?: number; notes: Array<{ target: string; text: string; kind: 'node' | 'cluster' }> }>

describe('State terminal notes and concurrency regions (B05/S4)', () => {
  for (const useAscii of [false, true]) test.each(noteAttachmentCases)('attaches $name with complete owned geometry (ASCII=' + useAscii + ')', fixture => {
    const result = renderMermaidASCIIWithReceipt(fixture.source, { useAscii, colorMode: 'none', paddingX: fixture.paddingX })
    const doc = terminalDocumentOf(result)!
    expect(doc).toBeDefined()
    const regions = doc.regions()
    for (const [index, spec] of fixture.notes.entries()) {
      const note = regions.find(region => region.kind === 'node' && region.id === `note#${index}`)!
      expect(note, spec.text).toBeDefined()
      expect(note.projectedText).toBe(spec.text)
      expect(note.annotationTarget).toEqual({ kind: spec.kind, id: spec.target })
      expect(note.parentId).toBeUndefined()
      for (const text of note.authoredTextCells ?? []) {
        const cell = doc.cell(text.column, text.row)
        expect(cell?.glyph).toBe(text.glyph)
        expect(cell?.owners.some(owner => owner.kind === 'node' && owner.id === note.id)).toBe(true)
      }
      for (const other of regions.filter(region => region.kind === 'node' && region.id !== note.id)) {
        expect(overlaps(ownedBounds(note), ownedBounds(other)), `${note.id}: box does not cover ${other.id}`).toBe(false)
      }
      const edge = regions.find(region => region.kind === 'edge' && region.from === spec.target && region.to === note.id)!
      expect(edge).toBeDefined()
      expectAttachedNote(doc, edge, spec.kind)
    }
    expectTransitionMarkers(doc, regions.filter(region => region.kind === 'edge' && !fixture.notes.some((_, index) => region.to === `note#${index}`)))
    expect(doc.diagnostics).toEqual([])
    expect(result.terminalStyle.diagnostics.filter(diagnostic => /COLLISION|OVERLAP|ROUTE.*FAIL|ATTACH/.test(diagnostic.code))).toEqual([])
    expect(structuredClone(result.receipt.layoutCertification)).toMatchObject({ status: 'passed', issues: [], budget: { exhausted: false } })
  })

  for (const useAscii of [false, true]) test(`reserves independent note approaches between interleaved groups (ASCII=${useAscii})`, () => {
    const result = renderMermaidASCIIWithReceipt('stateDiagram-v2\nstate X {\n A --> B\n}\nstate Y {\n C --> D\n}\nA --> D\nC --> B\nnote right of A: Anote\nnote left of D: Dnote', { useAscii, colorMode: 'none' })
    const doc = terminalDocumentOf(result)!, regions = doc.regions()
    for (const [index, target, text] of [[0, 'A', 'Anote'], [1, 'D', 'Dnote']] as const) {
      const note = regions.find(region => region.kind === 'node' && region.id === `note#${index}`)!
      expect(note?.projectedText).toBe(text)
      expect(note?.annotationTarget).toEqual({ id: target, kind: 'node' })
      expect(note?.parentId).toBeUndefined()
      const edge = regions.find(region => region.kind === 'edge' && region.from === target && region.to === note.id)!
      expect(edge).toBeDefined()
      expectAttachedNote(doc, edge, 'node')
      for (const other of regions.filter(region => region.kind === 'node' && region.id !== note.id)) {
        expect(overlaps(ownedBounds(note), ownedBounds(other)), `${note.id}: box does not cover ${other.id}`).toBe(false)
      }
    }
    expectTransitionMarkers(doc, regions.filter(region => region.kind === 'edge' && !region.to?.startsWith('note#')))
    // The pre-existing transition routing can report unrelated overlaps here.
    expect(doc.diagnostics.filter(diagnostic => /state-note:|note#/.test(diagnostic.feature))).toEqual([])
  })

  for (const useAscii of [false, true]) test(`keeps nested attachment ink and ownership through plain, ANSI and HTML (ASCII=${useAscii})`, () => {
    const source = 'stateDiagram-v2\ndirection LR\nstate Outer {\n A --> B\n}\nnote left of B: Note & 界'
    const baseline = renderMermaidASCIIWithReceipt(source, { useAscii, colorMode: 'none' })
    const baselineRegions = terminalDocumentOf(baseline)!.regions()
    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      const result = colorMode === 'none' ? baseline : renderMermaidASCIIWithReceipt(source, { useAscii, colorMode })
      const visible = colorMode === 'html'
        ? decodeHTML(result.text.replace(/<span style="color:[^"]+">|<\/span>/g, ''))
        : result.text.replace(/\u001b\[[0-9;]*m/g, '')
      expect(visible, colorMode).toBe(baseline.text)
      expect(visible).toContain('Note & 界')
      const doc = terminalDocumentOf(result)!, regions = doc.regions()
      expect(regions).toEqual(baselineRegions)
      const edge = regions.find(region => region.kind === 'edge' && region.from === 'B' && region.to === 'note#0')!
      expect(edge).toBeDefined()
      expectAttachedNote(doc, edge, 'node')
      const cells = visible.split('\n').map(row => {
        const result = new Map<number, string>()
        let column = 0
        for (const glyph of row) { result.set(column, glyph); column += visualWidth(glyph) }
        return result
      })
      for (const [x, y, cell] of doc.entries()) if (cell.head === x && cell.owners.some(owner => owner.id === edge.id || owner.kind === 'node' && owner.id === 'note#0')) {
        expect(cells[y]?.get(x), `${colorMode}: note ink at ${x},${y}`).toBe(cell.glyph)
      }
      expect(doc.diagnostics).toEqual([])
    }
  })

  test('places an intact right-note box beside its target with a continuous connector', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      [*] --> Active
      note right of Active : retries are bounded
      Active --> [*]`, { useAscii: true, colorMode: 'none' })
    const state = rowBorders(output, 'Active')
    const note = expectAsciiBox(output, 'retries are bounded')
    expect(note.left).toBeGreaterThan(state.right)
    expect(Math.abs(note.top + Math.floor((note.bottom - note.top) / 2) - state.row)).toBeLessThanOrEqual(2)
    const connectorRow = output.split('\n')[state.row]!.slice(state.right + 1, note.left)
    expect(connectorRow).toMatch(/^\.+$/)
  })

  test('wraps note geometry within a hard display-cell target', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      [*] --> Active
      note right of Active : retries are bounded and failures stay visible
      Active --> [*]`, { colorMode: 'none', targetWidth: 40 })
    expect(Math.max(...output.split('\n').map(visualWidth))).toBeLessThanOrEqual(40)
    expect(output).toContain('failures stay')
  })

  test('places an intact left block-note box outside a composite frame with a continuous connector', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      state Processing {
        Idle --> Busy
      }
      note left of Processing
        Composite note
        stays visible
      end note`, { useAscii: true, colorMode: 'none' })
    const rows = output.split('\n')
    const composite = rowBorders(output, 'Processing')
    const note = expectAsciiBox(output, 'Composite note')
    expect(note.right).toBeLessThan(composite.left)
    expect(output).toContain('stays visible')
    const connectorRow = rows.find(row => row.slice(note.right + 1, composite.left).includes('.'))
    expect(connectorRow).toBeDefined()
    expect(connectorRow!.slice(note.right + 1, composite.left)).toMatch(/^\.+$/)
  })

  test('places one continuous concurrency separator strictly between intact region node boxes', () => {
    const output = renderMermaidASCII(`stateDiagram-v2
      state Parallel {
        [*] --> LeftWork
        --
        RightWork --> [*]
      }`, { useAscii: true, colorMode: 'none' })
    const rows = output.split('\n')
    const left = expectAsciiBox(output, 'LeftWork', true)
    const right = expectAsciiBox(output, 'RightWork', true)
    const counts = Array.from({ length: Math.max(...rows.map(row => row.length)) }, (_, col) =>
      rows.reduce((count, row) => count + (row[col] === ':' ? 1 : 0), 0),
    )
    const separator = counts.indexOf(Math.max(...counts))
    expect(separator).toBeGreaterThan(left.right)
    expect(separator).toBeLessThan(right.left)
    for (let row = Math.min(left.top, right.top); row <= Math.max(left.bottom, right.bottom); row++) {
      expect(rows[row]![separator], `separator row ${row}`).toBe(':')
    }
  })
})
