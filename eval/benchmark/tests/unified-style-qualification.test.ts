import { describe, expect, test } from 'bun:test'
import { qualifyOutput } from '../unified/qualification.ts'
import { qualifyStyleOutput, styleDisplayTransforms } from '../unified/style-qualification.ts'
import type { UnifiedWorkload } from '../unified/types.ts'

const workload = (labels: string[]): UnifiedWorkload => ({ id: 'authored-style-admission', family: 'flowchart', source: 'flowchart LR', features: [], provenance: 'independently authored public-style/output examples', expectedLabels: labels })
const uniform = (textTransform: string) => ({ roles: { node: { textTransform }, edge: { textTransform }, group: { textTransform } } })
const admitted = (labels: string[], svg: string, specs: unknown[]) => qualifyStyleOutput(workload(labels), svg, 'svg', styleDisplayTransforms(specs), qualifyOutput)

describe('registered style display admission', () => {
  test('requires the declared uniform uppercase display instead of accepting untransformed text', () => {
    expect(admitted(['Checkout', 'straße'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>CHECKOUT</text><text>STRASSE</text></svg>', [uniform('uppercase')]).ok).toBe(true)
    expect(admitted(['Checkout'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Checkout</text></svg>', [uniform('uppercase')]).ok).toBe(false)
  })
  test('admits only declared mixed-role variants and explicitly leaves role correspondence unmeasured', () => {
    const spec = { roles: { group: { textTransform: 'uppercase' } } }
    const result = admitted(['Backend', 'Service'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>BACKEND</text><text>Service</text></svg>', [spec])
    expect(result.ok).toBe(true)
    expect(result.scope).toBe('style-admitted display retention; role correspondence unmeasured')
    expect(admitted(['Backend'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>backend</text></svg>', [spec]).ok).toBe(false)
  })
  test('unchanged public style tokens do not permit arbitrary case changes', () => {
    expect(admitted(['Ready'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>READY</text></svg>', [{ roles: { node: { fontSize: 14 } } }]).ok).toBe(false)
  })
  test('projects supported Unicode capitalization and lowercase without reading renderer output', () => {
    expect(admitted(['élan ready_steady 3d'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Élan Ready_steady 3d</text></svg>', [uniform('capitalize')]).ok).toBe(true)
    expect(admitted(['HTTP Ready'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>http ready</text></svg>', [uniform('lowercase')]).ok).toBe(true)
  })
  test('retains visible-text and identity boundaries after applying a style transform', () => {
    expect(admitted(['Node 1'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>NODE 12</text></svg>', [uniform('uppercase')]).ok).toBe(false)
    expect(admitted(['Cache'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><metadata><text>CACHE</text></metadata><!-- <text>CACHE</text> --><text>DATABASE</text></svg>', [uniform('uppercase')]).ok).toBe(false)
  })
  test('honors left-to-right public role token overrides', () => {
    const later = { roles: { node: { textTransform: 'lowercase' }, edge: { textTransform: 'lowercase' }, group: { textTransform: 'lowercase' } } }
    expect(admitted(['Ready'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>ready</text></svg>', [uniform('uppercase'), later]).ok).toBe(true)
    expect(admitted(['Ready'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>READY</text></svg>', [uniform('uppercase'), later]).ok).toBe(false)
  })
  test('reports missing or unsupported public transform inputs rather than silently weakening expectations', () => {
    expect(styleDisplayTransforms([undefined]).blockedReason).toBeDefined()
    expect(styleDisplayTransforms([uniform('reverse')]).blockedReason).toContain('Unsupported')
    expect(admitted(['Ready'], '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><text>Ready</text></svg>', [uniform('reverse')]).ok).toBe(false)
  })
})
