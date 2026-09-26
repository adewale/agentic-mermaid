import { expect, test } from 'bun:test'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { sourcePreservationSpans } from '../family-detection.ts'
import { parseAccessibilityDirective, scanAccessibilityDirectives } from '../shared/accessibility-directives.ts'

test('whitespace-only accDescr is not an empty directive and stays bounded through the public parser', () => {
  const emptyDescription = `  accDescr${' '.repeat(48_000)}`
  for (const line of [emptyDescription, `  accDescr:${' '.repeat(48_000)}`]) {
    expect(parseAccessibilityDirective([line], 0)).toBeNull()
    expect(scanAccessibilityDirectives(['journey', line, 'Task: 3: Me']).familyLines.includes(line)).toBe(true)
    expect(sourcePreservationSpans(`journey\n${line}\nTask: 3: Me`, 'journey').accessibilityDirectives).toBeUndefined()
  }

  const started = performance.now()
  const parsed = parseRegisteredMermaid(`journey\n${emptyDescription}\nTask: 3: Me`)
  expect(parsed.ok).toBe(true)
  expect(performance.now() - started).toBeLessThan(1_000)
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
