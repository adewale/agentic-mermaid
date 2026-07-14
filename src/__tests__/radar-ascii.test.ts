import { describe, expect, test } from 'bun:test'
import { renderMermaidASCII } from '../agent/index.ts'

const BASIC = 'radar-beta\n  title Skills\n  axis speed["Speed"], power["Power"], range["Range"]\n  curve now["Current"]{4, 3, 5}\n  curve goal["Target"]{5, 5, 4}\n  max 5'

describe('radar ASCII renderer', () => {
  test('renders a grouped bar table with title, legend, axes, and curves', () => {
    const out = renderMermaidASCII(BASIC, { colorMode: 'none' })
    expect(out).toContain('Skills')
    expect(out).toContain('Speed')
    expect(out).toContain('Current')
    expect(out).toContain('Target')
    expect(out).toContain('█') // unicode bar
    expect(out).toContain('│') // unicode separator
  })

  test('ascii-safe mode uses ASCII glyphs only', () => {
    const out = renderMermaidASCII(BASIC, { colorMode: 'none', useAscii: true })
    expect(out).not.toContain('█')
    expect(out).not.toContain('│')
    expect(out).toContain('#')
    expect(out).toContain('|')
  })

  test('shares SVG scale semantics: clamps values, bounds bar allocation, and rejects a degenerate auto-scale', () => {
    const out = renderMermaidASCII('radar-beta\n  axis a\n  curve x{10}\n  max 5', { colorMode: 'none' })
    const bar = out.match(/█+/)?.[0] ?? ''
    expect(bar).toHaveLength(24)
    const hostile = renderMermaidASCII(`radar-beta\n  axis a\n  curve x{${'9'.repeat(300)}}\n  max 5`, { colorMode: 'none' })
    expect(hostile.match(/█+/)?.[0]).toHaveLength(24)
    expect(() => renderMermaidASCII('radar-beta\n  axis a, b\n  curve x{1,2}\n  min 5', { colorMode: 'none' })).toThrow(/degenerate/i)
  })

  test('honors showLegend while retaining a legend for every mismatched curve when enabled', () => {
    const hidden = renderMermaidASCII('radar-beta\n  axis a, b\n  curve x["Hidden"]{1,2}\n  max 3\n  showLegend false', { colorMode: 'none' })
    expect(hidden).not.toContain('● Hidden')
    expect(hidden).toContain('Hidden │')

    const mismatched = renderMermaidASCII('radar-beta\n  title Mismatch\n  axis a, b, c\n  curve bad["Still listed"]{1,2}\n  max 3', { colorMode: 'none' })
    expect(mismatched).toContain('● Still listed')
    expect(mismatched).toContain('! Still listed: expected 3 values, got 2; not plotted')
  })

  test('renders wrapped multiline labels as aligned table rows without detached fragments', () => {
    const out = renderMermaidASCII('radar-beta\n  axis quality["Quality<br/>Signal"], speed["Speed"]\n  curve now["Current<br/>Team"]{4,3}\n  max 5', { colorMode: 'none' })
    const data = out.split('\n\n').at(-1)!
    expect(data).toContain('Quality')
    expect(data).toContain('Signal')
    expect(data).toContain('Current')
    expect(data).toContain('Team')
    expect(data.split('\n').every(line => line.includes('│'))).toBe(true)
  })

  test('renders frontmatter title in terminal output', () => {
    const out = renderMermaidASCII('---\ntitle: Grades\n---\nradar-beta\n  axis a, b\n  curve x{1,2}\n  max 3', { colorMode: 'none' })
    expect(out.split('\n')[0]).toBe('Grades')
  })

  test('retains axis structure when no curve is drawable', () => {
    const axisOnly = renderMermaidASCII('radar-beta\n axis a, b, c\n max 5', { colorMode: 'none' })
    expect(axisOnly).toContain('a')
    expect(axisOnly).toContain('b')
    expect(axisOnly).toContain('c')

    const mismatched = renderMermaidASCII('radar-beta\n axis alpha, beta\n curve bad{1}\n max 5', { colorMode: 'none' })
    expect(mismatched).toContain('alpha')
    expect(mismatched).toContain('beta')
  })

  test('is deterministic', () => {
    expect(renderMermaidASCII(BASIC, { colorMode: 'none' })).toBe(renderMermaidASCII(BASIC, { colorMode: 'none' }))
  })
})
