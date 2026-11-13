import { expect, test } from 'bun:test'
import fc from 'fast-check'
import { preparePixelText } from '../shared/prepared-text.ts'
import { layoutTextRows } from '../shared/text-rows.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const block = (text: string) => preparePixelText(text, { display: 'literal', fontSize: 12, fontWeight: 400, maxWidth: 80 })

test('measured rows retain owned text, reserve decoration height and distinguish trailing space', () => {
  const items = [Object.freeze({ id: 'header', block: block('First'), reservedWidth: 250 }), Object.freeze({ id: 'body', block: block('Second\nThird') })]
  const stack = layoutTextRows(items, { gap: 5, minRowHeight: 80 })
  expect(stack.width).toBe(250)
  expect(stack.height).toBe(165)
  expect(stack.rows.map(row => [row.top, row.height, row.textY])).toEqual([[0, 80, 40], [85, 80, 125]])
  for (const [index, row] of stack.rows.entries()) {
    expect(row.item).toBe(items[index]!)
    expect(row.item.block).toBe(items[index]!.block)
  }
  const start = layoutTextRows(items, { gap: 5, minRowHeight: 80, align: 'start', trailingGap: true })
  expect(start.height).toBe(170)
  expect(start.rows[0]!.textY - items[0]!.block.height / 2).toBe(0)
  expect(start.rows[1]!.textY - items[1]!.block.height / 2).toBe(85)
  expect(layoutTextRows([], { gap: 5, minRowHeight: 80, trailingGap: true })).toEqual({ width: 0, height: 0, bottom: 0, rows: [] })
  const placed = layoutTextRows(items, { top: 100, gap: 5, minRowHeight: 80 })
  expect(placed.height).toBe(165)
  expect(placed.bottom).toBe(265)
  expect(placed.rows.map(row => row.textY)).toEqual([140, 225])
})

test('wrapped and wide text stays inside ordered disjoint row regions without mutating the prepared blocks', () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom('one', 'First\nSecond\nThird', '界 é 👩🏽‍💻', 'long unbroken token '.repeat(5)), { maxLength: 15 }),
    fc.integer({ min: 0, max: 30 }), fc.integer({ min: 0, max: 90 }), fc.boolean(),
    (labels, gap, minRowHeight, start) => {
      const items = labels.map((label, id) => Object.freeze({ id, block: block(label) }))
      const stack = layoutTextRows(items, { gap, minRowHeight, align: start ? 'start' : 'center' })
      expect(stack.rows).toHaveLength(items.length)
      for (const [index, row] of stack.rows.entries()) {
        expect(row.item).toBe(items[index]!)
        expect(row.height).toBeGreaterThanOrEqual(minRowHeight)
        expect(row.textY - row.item.block.height / 2).toBeGreaterThanOrEqual(row.top - 1e-9)
        expect(row.textY + row.item.block.height / 2).toBeLessThanOrEqual(row.top + row.height + 1e-9)
        expect(row.item.block.width).toBeLessThanOrEqual(stack.width)
        expect(row.top + row.height).toBeLessThanOrEqual(stack.height + 1e-9)
        if (index) {
          const prior = stack.rows[index - 1]!
          expect(row.top - prior.top - prior.height).toBeCloseTo(gap, 9)
        }
      }
    },
  ), fcParameters({ numRuns: 100 }))
})
