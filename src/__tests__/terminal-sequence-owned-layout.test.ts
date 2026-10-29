import { serializeTerminalArtifact } from '../ascii/terminal-artifact.ts'
import { describe, expect, test } from 'bun:test'
import { renderSequenceTerminal as renderSequenceAscii } from '../ascii/sequence.ts'
import { type TerminalRegion } from '../ascii/terminal-document.ts'
import type { AsciiConfig, ColorMode } from '../ascii/types.ts'
import { visualWidth, WIDE_CHAR_CONTINUATION } from '../ascii/width.ts'
import { parseSequenceDiagram } from '../sequence/parser.ts'

function render(body: string, useAscii = false, targetWidth?: number) {
  const source = `sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\n${body}`
  const config: AsciiConfig = { useAscii, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
  const artifact = renderSequenceAscii(source, config, 'none', undefined, {}, targetWidth)
  const output = serializeTerminalArtifact(artifact)
  const doc = artifact.document
  const regions = doc.regions()
  const diagram = parseSequenceDiagram(source.split('\n'))
  const region = (id: string) => regions.find(item => item.id === id)!
  const block = (label: string) => region(`block:${diagram.blocks.findIndex(item => item.label === label)}`)
  return { source, output, doc, regions, region, block }
}

const bottom = (region: TerminalRegion) => region.canvasRow + (region.rowSpan ?? 1)
const right = (region: TerminalRegion) => region.canvasColEnd

describe('Sequence terminal ordered ownership and measured fragment bounds', () => {
  test('parallel overlays share rows for independent branches and join below their complete owned ink', () => {
    const { output, doc, region, block } = render('participant D\npar_over Independent\nA->>B: first\nA->>B: longest\nand Other\nC->>D: second\nend\nA->>D: joined')
    const lines = output.split('\n')
    expect(output).toContain('first')
    expect(output).toContain('second')
    expect(lines.findIndex(line => line.includes('first'))).toBe(lines.findIndex(line => line.includes('second')))
    expect(output).toContain('[Other]')
    expect(region('message:0').canvasRow).toBe(region('message:2').canvasRow)
    expect(region('message:3').canvasRow).toBeGreaterThan(bottom(block('Independent')))
    for (const id of ['message:0', 'message:1', 'message:2']) {
      expect(region(id).parentId).toBe('block:0')
      expect(region(id).parentKind).toBe('compartment')
    }
    expect(doc.diagnostics).toEqual([])
  })

  test('parallel overlays keep colliding messages and branch labels on separate rows', () => {
    const { output, doc, region } = render('par_over Shared\nA->>B: first\nand Other\nB->>A: second\nend\nA->>C: joined')
    expect(output).toContain('[Other]')
    expect(region('message:1').canvasRow).toBeGreaterThan(bottom(region('message:0')))
    expect(doc.diagnostics).toEqual([])
  })

  test('empty overlay branches retain every label before the following message', () => {
    const { output, region, block, doc } = render('par_over Work\nand Empty one\nand Empty two\nend\nA->>B: joined')
    expect(output).toContain('[Empty one]')
    expect(output).toContain('[Empty two]')
    expect(region('message:0').canvasRow).toBeGreaterThan(bottom(block('Work')))
    expect(doc.diagnostics).toEqual([])
  })

  test('a later nested frame cannot cover a message from an earlier overlay branch', () => {
    const { output, doc, region, block } = render('par_over Work\nA->>B: first\nand Other\nloop Nested\nA->>B: second\nend\nend\nA->>B: joined')
    expect(output).toContain('first')
    expect(block('Nested').canvasRow).toBeGreaterThan(bottom(region('message:0')))
    expect(doc.diagnostics).toEqual([])
  })
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
    const notes = regions.filter(item => item.id.startsWith('note:'))
    expect(notes.map(note => note.id).sort()).toEqual(['note:0', 'note:1', 'note:2'])
    for (const note of notes) {
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
    for (const word of ['a', 'very', 'long', 'label', 'with', 'every', 'word', 'retained']) expect(output).toContain(word)
  })

  test.each([
    ['a skipped participant', 'A->>C: hello', [['message:0', 'hello']]],
    ['multiline text over an active participant', 'A->>+B: start\nA->>C: hello<br/>日本 é\nB-->>-A: finish', [['message:1', 'hello\n日本 é']]],
    ['self messages and nested activations', 'activate B\nactivate B\nactivate B\nB->>B: self message<br/>second line\ndeactivate B\ndeactivate B\ndeactivate B', [['message:0', 'self message\nsecond line']]],
    ['an opaque note over an active participant', 'A->>+B: start\nNote over A,C: note covering B\nB-->>-A: finish', [['note:0', 'note covering B']]],
    ['fragment headers and dividers over an activation', 'A->>+B: start\nalt a complete condition across the active actor\nA->>C: hello\nelse another complete condition across the active actor\nA->>C: finish\nend\nB-->>-A: done', [['block:0', 'alt [a complete condition across the active actor]'], ['block:0', '[another complete condition across the active actor]']]],
    ['created and destroyed participants', 'A->>+B: start\ncreate participant D as Dynamic\nA->>D: created across B and C\nNote over B,D: created note\ndestroy D\nA-xD: destroyed across B and C\nB-->>-A: done', [['D', 'Dynamic'], ['message:1', 'created across B and C'], ['message:2', 'destroyed across B and C'], ['note:0', 'created note']]],
  ] as const)('reserves %s before lifelines and activations in every output mode', (_name, body, expected) => {
    const source = `sequenceDiagram\nparticipant A\nparticipant B\nparticipant C\n${body}`
    for (const useAscii of [false, true]) for (const colorMode of ['none', 'ansi16', 'ansi256', 'truecolor', 'html'] satisfies ColorMode[]) {
      const config: AsciiConfig = { useAscii, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
      const artifact = renderSequenceAscii(source, config, colorMode)
      expect(serializeTerminalArtifact(artifact).length).toBeGreaterThan(0)
      const doc = artifact.document
      for (const [id, text] of expected) {
        const rows = new Map<number, string>()
        for (const [, y, cell] of [...doc.entries()].sort(([ax, ay], [bx, by]) => ay - by || ax - bx)) {
          if (cell.kind === 'text' && cell.glyph !== WIDE_CHAR_CONTINUATION && cell.owners.some(owner => owner.id === id)) rows.set(y, (rows.get(y) ?? '') + cell.glyph)
        }
        expect([...rows.values()].join('\n')).toContain(text)
      }
      expect(doc.diagnostics.filter(item => /COLLISION|OVERLAP/.test(item.code))).toEqual([])
      const activationCells = [...doc.entries()].filter(([, , cell]) => cell.owners.some(owner => owner.kind === 'band'))
      if (body.includes('activate B') || body.includes('->>+B')) expect(activationCells.length).toBeGreaterThan(0)
      expect(activationCells.every(([, , cell]) => cell.kind !== 'text')).toBe(true)
    }
  })

  test('keeps the crossed lifeline on each side of a reserved message label', () => {
    const { doc, region } = render('A->>C: hello')
    const column = region('B').authoredTextCells![0]!.column
    const message = region('message:0')
    for (const row of [message.canvasRow - 1, message.ports![0]!.y + 1]) {
      expect(doc.cell(column, row)?.kind).toBe('stroke')
      expect(doc.cell(column, row)?.owners.some(owner => owner.id === 'B')).toBe(true)
    }
    const label = doc.cell(column, message.canvasRow)!
    expect(label.kind).toBe('text')
    expect(label.owners.map(owner => owner.id)).toEqual(['message:0'])
    expect(doc.diagnostics.filter(item => /COLLISION|OVERLAP/.test(item.code))).toEqual([])
  })

  test.each([false, true])('mixed-height labels keep the shorter participant lifeline joined to its card (ASCII=%s)', useAscii => {
    const config: AsciiConfig = { useAscii, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
    const artifact = renderSequenceAscii('sequenceDiagram\nparticipant A as Short\nparticipant B as First<br/>Second<br/>Third\nA->>B: message', config)
    serializeTerminalArtifact(artifact)
    const doc = artifact.document, regions = doc.regions()
    expect(regions.find(region => region.id === 'B')?.projectedText).toBe('First\nSecond\nThird')
    const x = regions.find(region => region.id === 'message:0')!.ports!.find(port => port.nodeId === 'A')!.x
    expect(doc.cell(x - 1, 4)?.glyph).toBe(useAscii ? '-' : '─')
    expect(doc.cell(x, 4)?.glyph).toBe(useAscii ? '-' : '┬')
    expect(doc.cell(x, 5)?.glyph).toBe(useAscii ? '|' : '│')
    expect(doc.diagnostics.filter(item => item.code === 'TERMINAL_TEXT_COLLISION')).toEqual([])
  })

  test('reserves participant box titles and retains membership beside lifecycle and activations', () => {
    const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
    const artifact = renderSequenceAscii(`sequenceDiagram
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
    const output = serializeTerminalArtifact(artifact)
    const doc = artifact.document
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
    const artifact = renderSequenceAscii('sequenceDiagram\nbox Aqua Team\nactor A\nparticipant B\nend\nrect rgb(220, 220, 220)\nA->>B: message\nend', config)
    const diagnostics = artifact.document.diagnostics
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'sequence.A.glyph' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'sequence.box:0.background' }))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'TERMINAL_FAMILY_PROJECTION', feature: 'sequence.block:0.background' }))
    expect(diagnostics.some(item => item.feature === 'sequence.B.glyph')).toBe(false)
    expect(render('A->>B: message').doc.diagnostics).toEqual([])
  })

  test('native authored participant IDs cannot alias generated note or fragment IDs', () => {
    const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
    const source = 'sequenceDiagram\nparticipant note:0 as Authored\nparticipant block:0 as Other\nparticipant A\nloop generated\nNote over A: Generated note\nend'
    // Exercise the real accepted source grammar, rather than a fabricated model.
    expect(parseSequenceDiagram(source.split('\n')).actors.map(actor => actor.id)).toEqual(['note:0', 'block:0', 'A'])
    const artifact = renderSequenceAscii(source, config)
    const output = serializeTerminalArtifact(artifact), regions = artifact.document.regions()
    expect(output).toContain('Authored')
    expect(output).toContain('Generated note')
    expect(regions.find(item => item.kind === 'node' && item.id === 'note:0')?.projectedText).toBe('Authored')
    expect(regions.find(item => item.kind === 'node' && item.id === 'note:0#1')?.projectedText).toBe('Generated note')
    expect(regions.find(item => item.kind === 'compartment')?.id).toBe('block:0#1')
    expect(regions.find(item => item.id === 'note:0#1')?.parentId).toBe('block:0#1')
  })

  test('empty and title-only native diagrams retain drawings, including actor-free fragments', () => {
    for (const [source, required] of [['sequenceDiagram', ''], ['sequenceDiagram\ntitle Only title', 'Only title'], ['sequenceDiagram\nloop Empty fragment\nend', 'Empty fragment']] as const) {
      const config: AsciiConfig = { useAscii: false, paddingX: 1, paddingY: 1, boxBorderPadding: 1, graphDirection: 'TD' }
        const artifact = renderSequenceAscii(source, config)
      expect(serializeTerminalArtifact(artifact)).toContain(required)
      expect(artifact.document).toBeDefined()
    }
  })
})
