import { expect, test } from 'bun:test'
import { quotedTextEnds } from '../shared/trailing-comment.ts'
import { expectNearLinearGrowth } from './helpers/complexity.ts'

// A quoted string runs to its closing quote across lines. Finding that quote
// must not rescan the rest of the source for each string that never closes.
test('the line that closes quoted text is found in linear time', () => {
  const shapes: ReadonlyArray<readonly [string, (index: number) => string, (index: number) => number]> = [
    ['one string that never closes', index => (index === 0 ? '"open' : 'A: 1'), index => index],
    ['strings closing on the next line', index => (index % 2 === 0 ? '"a' : 'b": 1'), index => (index % 2 === 0 ? index + 1 : index)],
    // Each line closes the string before it and opens one nothing closes.
    ['strings that reopen on every line', () => 'x" "y', index => index],
  ]
  for (const [shape, line, end] of shapes) {
    expectNearLinearGrowth(shape, size => {
      const lines = Array.from({ length: size }, (_, index) => line(index))
      const ends = quotedTextEnds(lines)
      expect(ends).toHaveLength(size)
      expect(ends.every((value, index) => value === end(index))).toBe(true)
    }, 20_000)
  }
})
