import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII, renderMermaidSVG, verifyNoExternalRefs } from '../index.ts'
import { getStyle, resolveStyleStack } from '../scene/style-registry.ts'
import { buildRenderConformancePlan } from './helpers/render-conformance-plan.ts'
import { verifyCoreConformancePlan } from './helpers/render-conformance-verifier.ts'

const FLOW = 'flowchart LR\n  A[Start] --> B[Done]'

describe('TEST-3 portfolio fault sensitivity', () => {
  test('kills reversed Look/Palette precedence', () => {
    const palette = getStyle('dracula')!
    const correct = resolveStyleStack(['hand-drawn', 'dracula'])!
    const reversedFault = resolveStyleStack(['dracula', 'hand-drawn'])!
    expect(correct.colors?.bg).toBe(palette.colors?.bg)
    expect(reversedFault.colors?.bg).not.toBe(palette.colors?.bg)
  })

  test('kills missing strict-reference stripping and transparent-page repainting', () => {
    const external = 'flowchart LR\n  A[Docs] --> B[Done]\n  click A href "https://example.com/docs"'
    const strict = renderMermaidSVG(external, { security: 'strict', embedFontImport: false })
    expect(verifyNoExternalRefs(strict)).toEqual({ ok: true, refs: [] })
    expect(verifyNoExternalRefs(strict.replace('</svg>', '<image href="https://example.com/fault.png"/></svg>')).ok).toBe(false)

    const transparent = renderMermaidSVG(FLOW, { style: 'publication-figure', transparent: true })
    expect(transparent).not.toContain('data-backdrop="page"')
    expect(`${transparent}<rect data-backdrop="page"/>`).toContain('data-backdrop="page"')
  })

  test('kills seed nondeterminism and ASCII connector leakage', () => {
    const first = renderMermaidSVG(FLOW, { style: 'hand-drawn', seed: 17 })
    expect(renderMermaidSVG(FLOW, { style: 'hand-drawn', seed: 17 })).toBe(first)
    expect(renderMermaidSVG(FLOW, { style: 'hand-drawn', seed: 18 })).not.toBe(first)

    const ascii = renderMermaidASCII(FLOW, { useAscii: true, colorMode: 'none' })
    expect(ascii).not.toMatch(/[┌┐└┘─│├┤┬┴┼╭╮╯╰]/u)
    expect(ascii).toMatch(/[+|\-]/u)
  })

  test('kills omitted-family and missing-variable-strength rows', () => {
    const rows = buildRenderConformancePlan()
    expect(verifyCoreConformancePlan(rows).missing).toEqual([])
    const withoutRadar = rows.filter(row => row.family !== 'radar')
    expect(verifyCoreConformancePlan(withoutRadar).missing.some(id => id.includes('family=radar'))).toBe(true)
    const withoutTransparent = rows.filter(row => row.background !== 'transparent')
    expect(verifyCoreConformancePlan(withoutTransparent).missing.some(id => id.includes('background=transparent'))).toBe(true)
  })
})
