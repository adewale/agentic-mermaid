import { describe, expect, test } from 'bun:test'

import { renderContactSheetPng } from '../../eval/visual-rubric/contact-sheet.ts'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'
import { decodePng, inkColumns } from './helpers/png-pixels.ts'

// Grid geometry of eval/visual-rubric/contact-sheet.ts: two 700x300 cells per
// row, each holding a 640x230 image box offset (20, 50) inside a 20px margin.
// The scenario geometry itself is pinned by contact-sheet.test.ts; this suite
// only proves the reviewer sheet generator still produces one painted cell
// per lettered scenario.
const COLS = 2
const CELL_W = 700
const CELL_H = 300

describe('contact sheet PNG generator', () => {
  test('renders a decodable PNG with one painted cell per lettered scenario', () => {
    const scenarios = contactSheetScenarios()
    const png = decodePng(new Uint8Array(renderContactSheetPng()))
    expect(png.width).toBe(COLS * CELL_W + 40)
    expect(png.height).toBe(Math.ceil(scenarios.length / COLS) * CELL_H + 60)

    const blankCells = scenarios.filter((_, i) => {
      const x = (i % COLS) * CELL_W + 20
      const y = Math.floor(i / COLS) * CELL_H + 50
      return inkColumns(png, x, x + CELL_W - 60, y, y + CELL_H - 70).length === 0
    }).map(scenario => scenario.letter)
    expect(blankCells).toEqual([])
  })
})
