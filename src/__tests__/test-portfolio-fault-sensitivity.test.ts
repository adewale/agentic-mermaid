import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { getStyle, resolveStyleStack } from '../scene/style-registry.ts'
import { buildRenderConformancePlan } from './helpers/render-conformance-plan.ts'
import { verifyCoreConformancePlan } from './helpers/render-conformance-verifier.ts'

const FLOW = 'flowchart LR\n  A[Start] --> B[Done]'

// TEST-3 fault sensitivity: each check pairs the correct behaviour with a
// faulted input or plan and shows the oracle tells them apart. The faults are
// injected into inputs, outputs and plans, not into production code; mutation
// of production code belongs to the sabotage lane. Seed re-rolls are covered
// by styled-output.test.ts, transparency by styled-output and
// render-conformance-plan, and the removed-family plan fault by
// render-conformance-plan.test.ts.
describe('TEST-3 portfolio fault sensitivity', () => {
  test('a Look/Palette stack applies left to right: the reversed stack loses the palette background', () => {
    const palette = getStyle('dracula')!
    const correct = resolveStyleStack(['hand-drawn', 'dracula'])!
    const reversedFault = resolveStyleStack(['dracula', 'hand-drawn'])!
    expect(correct.colors?.bg).toBe(palette.colors?.bg)
    expect(reversedFault.colors?.bg).not.toBe(palette.colors?.bg)
  })

  test('strict security strips an authored external link, and the verifier flags an injected one', () => {
    const external = 'flowchart LR\n  A[Docs] --> B[Done]\n  click A href "https://example.com/docs"'
    const strict = renderMermaidSVG(external, { security: 'strict', embedFontImport: false })
    expect(verifyNoExternalRefs(strict)).toEqual({ ok: true, refs: [] })
    expect(verifyNoExternalRefs(strict.replace('</svg>', '<image href="https://example.com/fault.png"/></svg>')).ok).toBe(false)
  })

  test('ASCII mode never leaks Unicode connector glyphs', () => {
    const ascii = renderMermaidASCII(FLOW, { useAscii: true, colorMode: 'none' })
    expect(ascii).not.toMatch(/[┌┐└┘─│├┤┬┴┼╭╮╯╰]/u)
    expect(ascii).toMatch(/[+|\-]/u)
  })

  test('the core plan verifier flags a plan with no transparent-background rows', () => {
    const rows = buildRenderConformancePlan()
    expect(verifyCoreConformancePlan(rows).missing).toEqual([])
    const withoutTransparent = rows.filter(row => row.background !== 'transparent')
    expect(verifyCoreConformancePlan(withoutTransparent).missing.some(id => id.includes('background=transparent'))).toBe(true)
  })
})
