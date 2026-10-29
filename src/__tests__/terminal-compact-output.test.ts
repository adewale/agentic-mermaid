import { describe, expect, test } from 'bun:test'
import { TerminalDocument } from '../ascii/terminal-document.ts'
import { terminalOutputPlainText } from '../terminal-security.ts'

describe('compact terminal cell output', () => {
  test('plain serialization retains final control sanitation across role and color boundaries', () => {
    const document = new TerminalDocument()
    document.text(0, 0, 'A B', { owner: { id: 'first', kind: 'label' }, role: 'text' })
    document.text(4, 0, '界👩‍💻é', { owner: { id: 'second', kind: 'label' }, role: 'arrow', color: '#123456' })
    // Retained cells remain inspectable and mutable; ingress sanitation alone
    // must not let a later cell edit inject a terminal control at emission.
    document.cell(0, 0)!.glyph = '\x1b'
    document.cell(2, 0)!.glyph = '\t'
    const plain = document.serialize({ colorMode: 'none' })
    expect(plain).toBe('?   界👩‍💻é')
    expect(terminalOutputPlainText(document.serialize({ colorMode: 'ansi16' }), 'ansi16')).toBe(plain)
    expect(terminalOutputPlainText(document.serialize({ colorMode: 'html' }), 'html')).toBe(plain)
  })

  test('surface runs preserve text ownership and typed geometry through overlay and reflection', () => {
    const document = new TerminalDocument(), owner = { id: 'card', kind: 'node' as const }
    document.fill(0, 0, 8, 3, { owner })
    document.text(1, 1, '界 A', { owner, role: 'text' })
    document.stroke(0, 0, 6, { owner, ascii: false, style: 'double', rounded: false, role: 'border' })
    document.stroke(1, 0, 10, { owner, ascii: false, style: 'double', role: 'border' })
    const layer = new TerminalDocument()
    layer.overlay(document, 2, 1)
    layer.flip(true, false)
    const cell = [...layer.entries()].find(([, , cell]) => cell.stroke?.mask === 12)![2]
    expect(cell.stroke).toEqual({ mask: 12, ascii: false, style: 'double', rounded: false })
    expect(cell.owners.map(item => item.id)).toEqual(['card'])
    expect(layer.serialize()).toContain('界 A')
    expect(layer.regions().find(region => region.id === 'card')?.projectedText).toBe('界 A')
    const before = layer.serialize()
    const text = [...layer.entries()].find(([, , cell]) => cell.glyph === '界')!
    layer.fill(text[0], text[1], 2, 1, { owner: { id: 'intruder', kind: 'node' } })
    expect(layer.serialize()).toBe(before)
    expect(layer.diagnostics.some(diagnostic => diagnostic.code === 'TERMINAL_TEXT_COLLISION')).toBe(true)
  })
})
