import { describe, expect, test } from 'bun:test'
import { explicitFamilyConfigDiagnostics } from '../shared/family-config-diagnostics.ts'
import { verifyMermaid } from '../agent/index.ts'
import { renderMermaidSVG, type ConfigDiagnostic } from '../index.ts'

const tuple = (diagnostic: { code: string; field?: string; message?: string }) =>
  [diagnostic.code, diagnostic.field, diagnostic.message]

describe('family config diagnostics have one schema-owned contract', () => {
  test('source wrappers and explicit config use the same fully qualified Journey diagnostic', () => {
    const source = `---\nconfig:\n  journey:\n    boxMargin: 10\n---\njourney\n  Task: 3: Me`
    const sourceDiagnostics = verifyMermaid(source).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG').map(tuple)
    const explicit = explicitFamilyConfigDiagnostics('journey', { journey: { boxMargin: 10 } }).map(tuple)
    expect(sourceDiagnostics).toEqual(explicit)
    expect(sourceDiagnostics[0]?.[1]).toBe('journey.boxMargin')
  })

  test('duplicate wrapper diagnostics are deduplicated and deterministically ordered', () => {
    const source = `---\nconfig:\n  journey:\n    rightAngles: true\n    boxMargin: 10\n---\n%%{init: {"journey":{"boxMargin":10,"rightAngles":true}}}%%\njourney\n  Task: 3: Me`
    const fields = verifyMermaid(source).warnings
      .filter(warning => warning.code === 'INEFFECTIVE_CONFIG')
      .map(warning => warning.field)
    expect(fields).toEqual(['journey.boxMargin', 'journey.rightAngles'])
  })

  test('explicit diagnostics use code-point order for Unicode keys regardless of insertion order', () => {
    const first = explicitFamilyConfigDiagnostics('journey', { journey: { ä: 1, z: 1, boxMargin: 10 } })
    const second = explicitFamilyConfigDiagnostics('journey', { journey: { z: 1, boxMargin: 10, ä: 1 } })
    expect(first).toEqual(second)
    expect(first.map(item => item.field)).toEqual(['journey.boxMargin', 'journey.z', 'journey.ä'])
  })

  // `theme` is shared by every family; a misspelling silently left the
  // default colors, with no warning on verify or render.
  test.each(['flowchart LR\n  A --> B', 'pie\n  "A": 1', 'gitGraph\n  commit'])('an invalid Mermaid theme is named on verify and render: %j', body => {
    const themeWarnings = (source: string) => verifyMermaid(source).warnings.filter(warning => warning.code === 'INEFFECTIVE_CONFIG' && warning.field === 'theme')
    const renderDiagnostics = (theme: unknown) => {
      const seen: ConfigDiagnostic[] = []
      // Config is untyped JSON at the boundary; a number reaches it too.
      renderMermaidSVG(body, { mermaidConfig: { theme: theme as string }, onConfigDiagnostic: diagnostic => seen.push(diagnostic) })
      return seen.filter(diagnostic => diagnostic.field === 'theme')
    }
    const misspelled = expect.objectContaining({ field: 'theme', message: expect.stringMatching(/"darkk".*Did you mean "dark"\?.*Valid themes: .*\bdefault\b/) })
    for (const source of [`%%{init: {"theme":"darkk"}}%%\n${body}`, `---\nconfig:\n  theme: darkk\n---\n${body}`]) {
      expect(themeWarnings(source)).toEqual([misspelled])
    }
    expect(renderDiagnostics('darkk')).toEqual([misspelled])
    expect(renderDiagnostics(5)).toEqual([expect.objectContaining({ field: 'theme', message: expect.stringContaining('5') })])
    for (const theme of ['default', 'base', 'dark', 'Forest', 'neutral', 'null']) {
      expect(themeWarnings(`%%{init: {"theme":"${theme}"}}%%\n${body}`)).toEqual([])
      expect(renderDiagnostics(theme)).toEqual([])
    }
  })
})
