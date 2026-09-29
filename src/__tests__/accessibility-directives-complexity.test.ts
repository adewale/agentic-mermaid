import { expect, test } from 'bun:test'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { maskAccessibilityDirectivesForSourceMap, sourcePreservationSpans } from '../family-detection.ts'
import { parseAccessibilityDirective, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'
import { expectNearLinearGrowth } from './helpers/complexity.ts'

test('whitespace-only accDescr is not an empty directive and stays bounded through the public parser', () => {
  const emptyDescription = `  accDescr${' '.repeat(48_000)}`
  for (const line of [emptyDescription, `  accDescr:${' '.repeat(48_000)}`]) {
    expect(parseAccessibilityDirective([line], 0)).toBeNull()
    expect(scanAccessibilityDirectives(['journey', line, 'Task: 3: Me']).familyLines.includes(line)).toBe(true)
    expect(sourcePreservationSpans(`journey\n${line}\nTask: 3: Me`, 'journey').accessibilityDirectives).toBeUndefined()
  }

  expectNearLinearGrowth('whitespace-only accDescr through the public parser', size => {
    expect(parseRegisteredMermaid(`journey\n  accDescr${' '.repeat(size)}\nTask: 3: Me`).ok).toBe(true)
  }, 48_000)
})

test('valid inline and block accDescr directives retain their text and suffix', () => {
  for (const line of ['accDescr: A description', 'accDescr A description', 'accDescr : A description']) {
    expect(parseAccessibilityDirective([line], 0)).toMatchObject({
      title: false,
      form: 'inline',
      value: 'A description',
    })
  }
  expect(parseAccessibilityDirective(['accDescr: { first line', 'second line } Task: 3: Me'], 0)).toMatchObject({
    title: false,
    form: 'block',
    value: 'first line\nsecond line',
    endIndex: 1,
    suffixLine: 'Task: 3: Me',
  })
  expect(parseAccessibilityDirective([`accDescr${' '.repeat(48_000)}{text} Task: 3: Me`], 0)).toMatchObject({
    form: 'block',
    value: 'text',
    suffixLine: 'Task: 3: Me',
  })
})

test('repeated unclosed accDescr blocks do not rescan the remaining source', () => {
  expectNearLinearGrowth('repeated unclosed accDescr blocks', size => {
    const source = `journey\n${'accDescr: {\n'.repeat(size)}accTitle: hidden\nTask: 3: Me\n`
    expect(sourcePreservationSpans(source, 'journey').accessibilityDirectives).toBeUndefined()
    expect(maskAccessibilityDirectivesForSourceMap(source)).toBe(source)
    expect(parseRegisteredMermaid(source).ok).toBe(true)
  }, 12_000)
})
