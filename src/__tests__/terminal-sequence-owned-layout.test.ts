import { describe, expect, test } from 'bun:test'
import { renderSequenceAscii } from '../ascii/sequence.ts'
import { beginTerminalCapture, capturedTerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'
import type { AsciiConfig } from '../ascii/types.ts'
import { visualWidth } from '../ascii/width.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'

function render(body: string, useAscii = false, targetWidth?: number) {
  const source = `sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\n${body}`
  const config: AsciiConfig = { useAscii, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
  beginTerminalCapture(config)
  const output = renderSequenceAscii(source, config, 'none', undefined, {}, targetWidth)
  const doc = capturedTerminalDocument(config)!
  const regions = doc.regions()
  const diagram = parseSequenceDiagram(source.split('\n'))
  const region = (id: string) => regions.find(item => item.id === id)!
  const block = (label: string) => region(`block:${diagram.blocks.findIndex(item => item.label === label)}`)
  return { source, output, doc, regions, region, block }
}

const bottom = (region: TerminalRegion) => region.canvasRow + (region.rowSpan ?? 1)
const right = (region: TerminalRegion) => region.canvasColEnd

describe('Sequence terminal ordered ownership and measured fragment bounds', () => {
  test('closes a fragment before a later note at the same message cursor (#391)', () => {
    const { output, doc, region, block } = render(`loop inside
A->>B: hi
Note over B: inside note
end
Note over B: outside note
A->>B: done`)
    expect(output).toContain('inside note')
    expect(output).toContain('outside note')
    expect(region('note:0').parentId).toBe(block('inside').id)
    expect(region('note:1').parentId).toBeUndefined()
    expect(bottom(region('note:0'))).toBeLessThan(bottom(block('inside')))
    expect(region('note:1').canvasRow).toBeGreaterThanOrEqual(bottom(block('inside')))
    expect(region('message:1').canvasRow).toBeGreaterThan(bottom(region('note:1')))
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('distinguishes notes before, inside, and after note-only and empty siblings', () => {
    const { region, block } = render(`Note left of A: before
loop first
Note over B: contained
end
rect rgb(220, 220, 220)
end
opt last
end
Note right of C: after`)
    const first = block('first'), last = block('last')
    expect(bottom(region('note:0'))).toBeLessThan(first.canvasRow)
    expect(region('note:1').parentId).toBe(first.id)
    expect(bottom(region('note:1'))).toBeLessThan(bottom(first))
    expect(last.canvasRow).toBeGreaterThan(bottom(first))
    expect(region('note:2').canvasRow).toBeGreaterThan(bottom(last))
    expect(region('note:2').parentId).toBeUndefined()
  })

  test('keeps a note between nested closes in its parent fragment', () => {
    const { region, block } = render(`loop outer
opt child
end
Note over B: parent only
end
Note over B: uncontained`)
    expect(region('note:0').parentId).toBe(block('outer').id)
    expect(region('note:0').canvasRow).toBeGreaterThan(bottom(block('child')))
    expect(bottom(region('note:0'))).toBeLessThan(bottom(block('outer')))
    expect(region('note:1').canvasRow).toBeGreaterThan(bottom(block('outer')))
  })

  test.each([
    ['alt', 'else'], ['par', 'and'], ['critical', 'option'],
  ])('reserves empty and note-only %s sections and complete multiline conditions', (kind, divider) => {
    const { output, doc, block, region } = render(`${kind} opening<br/>condition
opt empty child
end
${divider} alternative<br/>complete condition
Note over B: section note
end`)
    const outer = block('opening\ncondition'), child = block('empty child')
    expect(output).toContain('opening')
    expect(output).toContain('condition]')
    expect(output).toContain('alternative')
    expect(output).toContain('complete condition]')
    expect(child.parentId).toBe(outer.id)
    expect(region('note:0').parentId).toBe(outer.id)
    const rows = output.split('\n')
    const dividerRow = rows.findIndex(row => row.includes('alternative'))
    expect(dividerRow).toBeGreaterThan(bottom(child))
    expect(region('note:0').canvasRow).toBeGreaterThan(dividerRow + 1)
    expect(bottom(region('note:0'))).toBeLessThan(bottom(outer))
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test.each([false, true])('uses opaque note surfaces and reserves left, right, and over footprints (ASCII=%s)', useAscii => {
    const { output, doc, regions } = render(`loop notes
Note left of A: leftmost
Note right of B: right side
Note over A,C: across actors
end`, useAscii)
    expect(output).toContain('leftmost')
    expect(output).toContain('right side')
    expect(output).toContain('across actors')
    for (const note of regions.filter(item => item.id.startsWith('note:'))) {
      for (let y = note.canvasRow + 1; y < bottom(note) - 1; y++) {
        for (let x = note.canvasColStart + 1; x < right(note) - 1; x++) {
          const cell = doc.cell(x, y)!
          expect(cell.owners.map(owner => owner.id)).toEqual([note.id])
          expect(['│', '|']).not.toContain(cell.glyph)
        }
      }
    }
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('keeps complete graphemes and whitespace in labels and fragment geometry', () => {
    const { output, doc, region, block } = render(`loop 条件👩‍🔬<br/>é spaced condition
B->>B: 自己👨‍👩‍👧‍👦<br/>é full message
Note over B: 広い🙂 é note
end`)
    expect(output).toContain('条件👩‍🔬')
    expect(output).toContain('自己👨‍👩‍👧‍👦')
    expect(output).toContain('é full message')
    expect(output).toContain('広い🙂 é note')
    expect(output).not.toContain('\0')
    expect(new Set(output.split('\n').map(visualWidth)).size).toBe(1)
    const frame = block('条件👩‍🔬\né spaced condition')
    expect(right(frame)).toBeGreaterThan(right(region('note:0')))
    expect(right(frame)).toBeGreaterThan(right(region('message:0')))
    for (const label of ['message:0', 'note:0']) {
      const cells = [...doc.entries()].filter(([, , cell]) => cell.kind === 'text' && cell.owners.some(owner => owner.id === label))
      expect(cells.some(([, , cell]) => cell.glyph === ' ')).toBe(true)
    }
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('wraps display labels without changing semantic participant or message identities', () => {
    const { doc, output, regions } = render('A->>B: a very long label with every word retained', false, 60)
    expect(Math.max(...output.split('\n').map(visualWidth))).toBeLessThanOrEqual(60)
    expect(regions.some(item => item.id === 'A')).toBe(true)
    expect(regions.some(item => item.id === 'B')).toBe(true)
    const cells = [...doc.entries()].filter(([, , cell]) => cell.kind === 'text' && cell.owners.some(owner => owner.id === 'message:0'))
    expect(cells.map(([, , cell]) => cell.glyph).join('')).toContain('a very long label')
    expect(output).toContain('retained')
  })

  test.each([false, true])('mixed-height participant labels join every lifeline to its measured card (ASCII=%s)', useAscii => {
    const config: AsciiConfig = { useAscii, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
    beginTerminalCapture(config)
    renderSequenceAscii('sequenceDiagram\nparticipant A as Short\nparticipant B as First<br/>Second<br/>Third\nA->>B: message', config)
    const doc = capturedTerminalDocument(config)!, regions = doc.regions()
    expect(regions.find(region => region.id === 'B')?.projectedText).toBe('First\nSecond\nThird')
    const x = regions.find(region => region.id === 'message:0')!.ports!.find(port => port.nodeId === 'A')!.x
    expect(doc.cell(x - 1, 4)?.glyph).toBe(useAscii ? '-' : '─')
    expect(doc.cell(x, 4)?.glyph).toBe(useAscii ? '-' : '┬')
    expect(doc.cell(x, 5)?.glyph).toBe(useAscii ? '|' : '│')
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('reserves participant box titles and retains membership beside lifecycle and activations', () => {
    const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
    beginTerminalCapture(config)
    const output = renderSequenceAscii(`sequenceDiagram
box Aqua Team title<br/>complete second line
participant A as Alice
participant B as Bob
end
A->>+B: start
activate B
activate B
B-->>-A: response
deactivate B
deactivate B
create participant C as Created
A->>C: welcome
destroy C
A-xC: goodbye`, config)
    const doc = capturedTerminalDocument(config)!
    const regions = doc.regions()
    expect(output).toContain('Team title')
    expect(output).toContain('complete second line')
    expect(output.indexOf('complete second line')).toBeLessThan(output.indexOf('Alice'))
    expect(regions.find(item => item.id === 'box:0')).toMatchObject({ kind: 'group', members: ['A', 'B'] })
    expect(regions.find(item => item.id === 'A')?.parentId).toBe('box:0')
    expect(regions.filter(item => item.kind === 'band' && item.id.startsWith('activation:'))).toHaveLength(3)
    const createdText = [...doc.entries()].filter(([, , cell]) => cell.kind === 'text' && cell.owners.some(owner => owner.id === 'C'))
    expect(createdText.map(([, , cell]) => cell.glyph).join('')).toBe('Created')
    expect(Math.min(...createdText.map(([, y]) => y))).toBeGreaterThan(output.split('\n').findIndex(row => row.includes('response')))
    expect([...doc.entries()].some(([, , cell]) => cell.glyph === 'X' && cell.kind === 'marker' && cell.owners.some(owner => owner.id === 'C' || owner.id === 'message:3'))).toBe(true)
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('reports authored silhouette and background projections while default participant cards stay quiet', () => {
    const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
    beginTerminalCapture(config)
    renderSequenceAscii('sequenceDiagram\nbox Aqua Team\nactor A\nparticipant B\nend\nrect rgb(220, 220, 220)\nA->>B: message\nend', config)
    const diagnostics = capturedTerminalDocument(config)!.diagnostics
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'sequence.A.glyph' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'sequence.box:0.background' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'sequence.block:0.background' }))
    expect(diagnostics.some(item => item.feature === 'sequence.B.glyph')).toBe(false)
    expect(render('A->>B: message').doc.diagnostics).toEqual([])
  })

  test('native authored participant IDs cannot alias generated note or fragment IDs', () => {
    const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
    beginTerminalCapture(config)
    const source = 'sequenceDiagram\nparticipant note:0 as Authored\nparticipant block:0 as Other\nparticipant A\nloop generated\nNote over A: Generated note\nend'
    // Exercise the real accepted source grammar, rather than a fabricated model.
    expect(parseSequenceDiagram(source.split('\n')).actors.map(actor => actor.id)).toEqual(['note:0', 'block:0', 'A'])
    const output = renderSequenceAscii(source, config), regions = capturedTerminalDocument(config)!.regions()
    expect(output).toContain('Authored')
    expect(output).toContain('Generated note')
    expect(regions.find(item => item.kind === 'node' && item.id === 'note:0')?.projectedText).toBe('Authored')
    expect(regions.find(item => item.kind === 'node' && item.id === 'note:0#1')?.projectedText).toBe('Generated note')
    expect(regions.find(item => item.kind === 'compartment')?.id).toBe('block:0#1')
    expect(regions.find(item => item.id === 'note:0#1')?.parentId).toBe('block:0#1')
  })

  test('empty and title-only native diagrams retain captures, including actor-free fragments', () => {
    for (const [source, required] of [['sequenceDiagram', ''], ['sequenceDiagram\ntitle Only title', 'Only title'], ['sequenceDiagram\nloop Empty fragment\nend', 'Empty fragment']] as const) {
      const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
      beginTerminalCapture(config)
      const output = renderSequenceAscii(source, config)
      expect(output).toContain(required)
      expect(capturedTerminalDocument(config)).toBeDefined()
    }
  })
})
