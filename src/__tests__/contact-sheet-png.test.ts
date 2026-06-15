import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { renderContactSheetPng } from '../../eval/visual-rubric/contact-sheet.ts'

describe('contact sheet PNG visual regression', () => {
  test('committed PR contact sheet byte-matches the renderer output', () => {
    const expected = readFileSync('docs/pr-assets/contact-sheet.png')
    const actual = renderContactSheetPng()
    expect(actual.equals(expected)).toBe(true)
  })
})
