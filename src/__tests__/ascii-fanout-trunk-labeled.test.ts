// BUILD-10 (#111 class): labeled TB fan-out must share one trunk with T-junction
// branches and place each label on its own vertical drop — NOT on an L-shaped
// horizontal detour.
//
// The fork's sibling edges all exit the SAME side of the source. Unlabeled
// fan-outs already get a shared trunk via edge-bundling, but bundling explicitly
// refuses labeled edges (labels would collide at the junction), so each labeled
// sibling used to route its own A* path — producing a horizontal mid-path run
// with the label sitting on it (`─center*─`) and stray corner detours.
//
// Invariants asserted here are charset-independent and complement the golden
// fixture (testdata/unicode/td_fanout_labeled.txt).

import { describe, test, expect } from 'bun:test'
import { renderMermaidASCII } from '../index.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const TB_SRC = `flowchart TB
    Src["Source"]
    Left["Left Target"]
    Center["Center Target"]
    Right["Right Target"]
    Src -->|left*| Left
    Src -->|center*| Center
    Src -->|right*| Right`

describe('#111 labeled TB fan-out shares one trunk, labels on vertical drops', () => {
  const out = renderMermaidASCII(TB_SRC)
  const lines = out.split('\n')

  test('(a) one shared trunk with T-junctions, no second parallel horizontal run', () => {
    // The source's bottom-side siblings must branch off a single horizontal
    // trunk via ┬ tees. There must be exactly one trunk row directly under the
    // source carrying the tee glyph.
    const teeRows = lines.filter(l => l.includes('┬'))
    expect(teeRows.length).toBeGreaterThanOrEqual(1)
    // The branch trunk leaves the Source box: the row with the box-start ├ must
    // also carry the horizontal trunk with ┬ tees feeding the other siblings.
    const trunkRow = lines.find(l => l.includes('├') && l.includes('┬'))
    expect(trunkRow).toBeDefined()
    // No SECOND horizontal run carrying a label: labels never appear flanked by
    // horizontal line glyphs (that is the L-shaped detour we are removing).
    expect(out).not.toMatch(/─(left|center|right)\*─/)
  })

  test('(b) each label sits on its own vertical drop segment (│ above and below)', () => {
    for (const label of ['left*', 'center*', 'right*']) {
      const rowIdx = lines.findIndex(l => l.includes(label))
      expect(rowIdx).toBeGreaterThan(-1)
      const col = lines[rowIdx]!.indexOf(label)
      // The label is not surrounded by horizontal line characters in its row:
      // i.e. it is NOT sitting on a `─label─` horizontal detour.
      const before = lines[rowIdx]![col - 1] ?? ' '
      const after = lines[rowIdx]![col + label.length] ?? ' '
      expect(before).not.toBe('─')
      expect(after).not.toBe('─')
      // A vertical drop runs through the label's segment: the label is centred
      // on its line, so the │ sits within the span [col-1, col+labelLen]. Both
      // the row above and below the label must carry that vertical glyph (the
      // drop continues past the label, proving it is on a vertical segment).
      const span = (row: string): boolean => {
        for (let c = col - 1; c <= col + label.length; c++) {
          if (row[c] === '│') return true
        }
        return false
      }
      expect(span(lines[rowIdx - 1] ?? '')).toBe(true)
      expect(span(lines[rowIdx + 1] ?? '')).toBe(true)
    }
  })

  test('(c) each label appears exactly once', () => {
    for (const label of ['left*', 'center*', 'right*']) {
      const count = out.split(label).length - 1
      expect(count).toBe(1)
    }
  })

  test('(d) no stray + corners or diagonal arrowheads', () => {
    expect(out).not.toContain('+')
    expect(out).not.toMatch(/[◢◣◤◥]/)
  })

  test('matches the committed golden fixture', () => {
    const golden = readFileSync(
      join(import.meta.dir, 'testdata', 'unicode', 'td_fanout_labeled.txt'),
      'utf8',
    )
    // The fixture stores `<mermaid>\n---\n<expected>`; compare the expected half,
    // normalizing trailing whitespace per line.
    const expected = golden.split('\n---\n')[1] ?? golden
    const norm = (s: string) => s.split('\n').map(l => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '')
    expect(norm(out)).toBe(norm(expected))
  })
})
