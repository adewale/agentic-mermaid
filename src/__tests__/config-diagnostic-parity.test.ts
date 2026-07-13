import { describe, expect, test } from 'bun:test'
import { configWarningsForMermaid } from '../agent/verify.ts'
import { explicitFamilyConfigDiagnostics } from '../shared/family-config-diagnostics.ts'

const tuple = (diagnostic: { code: string; field?: string; message?: string }) =>
  [diagnostic.code, diagnostic.field, diagnostic.message]

describe('family config diagnostics have one schema-owned contract', () => {
  test('source wrappers and explicit config use the same fully qualified Journey diagnostic', () => {
    const source = `---\nconfig:\n  journey:\n    boxMargin: 10\n---\njourney\n  Task: 3: Me`
    const sourceDiagnostics = configWarningsForMermaid(source).filter(warning => warning.code === 'INEFFECTIVE_CONFIG').map(tuple)
    const explicit = explicitFamilyConfigDiagnostics('journey', { journey: { boxMargin: 10 } }).map(tuple)
    expect(sourceDiagnostics).toEqual(explicit)
    expect(sourceDiagnostics[0]?.[1]).toBe('journey.boxMargin')
  })

  test('duplicate wrapper diagnostics are deduplicated and deterministically ordered', () => {
    const source = `---\nconfig:\n  journey:\n    rightAngles: true\n    boxMargin: 10\n---\n%%{init: {"journey":{"boxMargin":10,"rightAngles":true}}}%%\njourney\n  Task: 3: Me`
    const fields = configWarningsForMermaid(source)
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
})
