import { describe, expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import {
  resolveTerminalOutputPolicy,
  TerminalOutputPolicyError,
} from '../terminal-contract.ts'
import { RENDER_OUTPUT_DESCRIPTORS } from '../render-contract.ts'
import {
  getFamily,
  knownBuiltinFamilies,
  replaceFamilyForTest,
} from '../agent/families.ts'
import { colorizeText } from '../ascii/ansi.ts'
import { secureTerminalHtmlOutput } from '../terminal-security.ts'

const SOURCE = 'flowchart LR\n  A[Start] --> B[Finish]'
const OSC52 = '\u001b]52;c;dGVybWluYWwtZXhmaWx0cmF0aW9u\u0007'
const C1_OSC = '\u009d52;c;YzEtZXhmaWx0cmF0aW9u\u009c'

const withoutTrustedSgr = (value: string): string => value.replace(/\u001b\[[0-9;]*m/g, '')
const containsTerminalControl = (value: string): boolean => /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(value)

describe('terminal text security boundary', () => {
  test('neutralizes OSC 52 and C1 controls before none, ANSI, and HTML projection', () => {
    const hostile = `flowchart LR\n  A["${OSC52}${C1_OSC}"] --> B[Done]`
    const inert = 'flowchart LR\n  A["?]52;c;dGVybWluYWwtZXhmaWx0cmF0aW9u??52;c;YzEtZXhmaWx0cmF0aW9u?"] --> B[Done]'

    for (const colorMode of ['none', 'ansi16', 'html'] as const) {
      const rendered = renderMermaidASCIIWithReceipt(hostile, { useAscii: true, colorMode })
      const expected = renderMermaidASCIIWithReceipt(inert, { useAscii: true, colorMode })
      expect(rendered.text).toBe(expected.text)
      expect(rendered.text).not.toContain('\u001b]')
      expect(rendered.text).not.toContain('\u0007')
      expect(rendered.text).not.toContain('\u009d')
      expect(containsTerminalControl(withoutTrustedSgr(rendered.text))).toBe(false)
      expect(rendered.terminalStyle.diagnostics).toContainEqual(expect.objectContaining({
        code: 'TERMINAL_CONTROL_CHARACTERS_REPLACED',
        feature: 'terminal-text',
      }))
    }
  })

  test('sanitizes connector receipt labels as well as emitted cells', () => {
    const rendered = renderMermaidASCIIWithReceipt(
      `flowchart LR\n  A -- "${OSC52}" --> B`,
      { colorMode: 'none' },
    )
    const serializedProjection = JSON.stringify(rendered.terminalStyle.connectorProjection)
    expect(containsTerminalControl(serializedProjection)).toBe(false)
    expect(serializedProjection).not.toContain('\\u001b')
  })

  test('escapes authored HTML in family renderers that concatenate plain labels', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const pie = renderMermaidASCIIWithReceipt(`pie\n  "${payload}" : 5`, { colorMode: 'html' })
    const quadrant = renderMermaidASCIIWithReceipt(`quadrantChart\n  title ${payload}\n  P: [0.2, 0.8]`, { colorMode: 'html' })

    for (const rendered of [pie, quadrant]) {
      expect(rendered.text).not.toContain(payload)
      expect(rendered.text).not.toContain('<img')
      expect(rendered.text).toContain('&lt;img src=x onerror=alert(1)&gt;')
    }
  })

  test('does not mistake an active or attribute-bearing authored span for an internal color span', () => {
    const payload = '<span style="color:#123456"><img src=x onerror=alert(1)></span>'
    const attributePayload = '<span style="color:#123456" onmouseover="alert(1)">hover</span>'
    const rendered = secureTerminalHtmlOutput(`${payload}${attributePayload}`)

    expect(rendered).not.toContain('<img')
    expect(rendered).not.toContain('<span')
    expect(rendered).toContain('&lt;span style="color:#123456"&gt;')
    expect(rendered).toContain('&lt;span style="color:#123456" onmouseover="alert(1)"&gt;')
  })

  test('every registered terminal family crosses the final HTML boundary without double-escaping trusted spans', () => {
    const payload = '<img src=x onerror=alert(1)>'
    const trusted = colorizeText('<trusted>', '#123456', 'html')

    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      expect(descriptor.example, `${id} example`).toBeDefined()
      expect(descriptor.renderAscii, `${id} terminal renderer`).toBeDefined()
      if (!descriptor.example || !descriptor.renderAscii) continue
      const original = descriptor.renderAscii
      const restore = replaceFamilyForTest(id, {
        ...descriptor,
        renderAscii(context) {
          return `${original(context)}\n${trusted}\n${payload}`
        },
      })
      try {
        const rendered = renderMermaidASCIIWithReceipt(descriptor.example, { colorMode: 'html' })
        expect(rendered.text, id).toContain('<span style="color:#123456">&lt;trusted&gt;</span>')
        expect(rendered.text, id).not.toContain('&lt;span style=')
        expect(rendered.text, id).not.toContain('<img')
        expect(rendered.text, id).toContain('&lt;img src=x onerror=alert(1)&gt;')
      } finally {
        restore()
      }
    }
  })
})

describe('canonical terminal output policy', () => {
  test('native terminal rendering does not depend on optional graphical hooks', () => {
    const descriptor = getFamily('flowchart')!
    const originalAscii = descriptor.renderAscii!
    const restore = replaceFamilyForTest('flowchart', {
      ...descriptor,
      lowerScene() {
        throw new Error('optional Scene projection unavailable')
      },
      renderAscii(context) {
        return originalAscii(context)
      },
    })
    try {
      const rendered = renderMermaidASCIIWithReceipt(SOURCE, { useAscii: true, colorMode: 'none' })
      expect(rendered.text).toContain('Start')
      expect(rendered.terminalStyle.diagnostics).toContainEqual({
        code: 'TERMINAL_CONNECTOR_PROJECTION_UNAVAILABLE',
        feature: 'connectors',
        message: 'Optional Scene connector projection failed; native terminal rendering continued independently.',
      })
      expect(rendered.terminalStyle.connectorProjection.evidence).toBe('unavailable')
    } finally {
      restore()
    }
  })

  test('every registered family preserves terminal semantics in every color mode', () => {
    const plain = (value: string) => value
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/<span style="color:[^"]+">/g, '')
      .replace(/<\/span>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!
      if (!descriptor.example || !descriptor.renderAscii) continue
      for (const useAscii of [false, true]) {
        const baseline = renderMermaidASCIIWithReceipt(descriptor.example, { useAscii, colorMode: 'none' })
        for (const colorMode of ['none', 'ansi16', 'ansi256', 'truecolor', 'html'] as const) {
          const rendered = renderMermaidASCIIWithReceipt(descriptor.example, { useAscii, colorMode })
          expect(plain(rendered.text), `${id}/${useAscii ? 'ascii' : 'unicode'}/${colorMode}`).toBe(baseline.text)
          expect(rendered.receipt.diagnostics, `${id}/${colorMode}`).toEqual(rendered.terminalStyle.diagnostics)
          expect(rendered.terminalStyle.connectorProjection.digest, `${id}/${colorMode}`)
            .toBe(baseline.terminalStyle.connectorProjection.digest)
        }
      }
    }
  })

  test('the output registry records the terminal security gate', () => {
    for (const id of ['ascii', 'unicode', 'html'] as const) {
      const descriptor = RENDER_OUTPUT_DESCRIPTORS.find(output => output.id === id)!
      expect(descriptor.security).toBe('enforced')
      expect(descriptor.evidence).toContain('terminal-output-policy@1')
      expect(descriptor.evidence).toContain('terminal-control-sanitization')
    }
  })

  test('resolves and freezes every executed terminal control', () => {
    const theme = { fg: '#123456' }
    const policy = resolveTerminalOutputPolicy({
      useAscii: true,
      paddingX: 2,
      paddingY: 3,
      boxBorderPadding: 0,
      colorMode: 'none',
      theme,
      targetWidth: 80,
    })
    theme.fg = '#ffffff'
    expect(policy).toEqual({
      version: 1,
      useAscii: true,
      paddingX: 2,
      paddingY: 3,
      boxBorderPadding: 0,
      colorMode: 'none',
      theme: { fg: '#123456' },
      targetWidth: 80,
    })
    expect(Object.isFrozen(policy)).toBe(true)
    expect(Object.isFrozen(policy.theme)).toBe(true)
  })

  test('rejects null, wrong-type, non-finite, negative, fractional, and bogus values', () => {
    const invalid: unknown[] = [
      null,
      [],
      { useAscii: 'true' },
      { useAscii: null },
      { paddingX: -1 },
      { paddingY: Number.NaN },
      { boxBorderPadding: 0.5 },
      { maxWidth: 0 },
      { maxWidth: Number.POSITIVE_INFINITY },
      { targetWidth: -1 },
      { targetWidth: 12.5 },
      { colorMode: 'ansi1024' },
      { colorMode: null },
      { theme: null },
      { theme: [] },
      { theme: { fg: 42 } },
      { theme: { unknown: '#000000' } },
      { maxWidth: 80, targetWidth: 80 },
      { surprise: true },
    ]
    for (const value of invalid) {
      expect(() => resolveTerminalOutputPolicy(value as never), JSON.stringify(value))
        .toThrow(TerminalOutputPolicyError)
    }
    expect(() => renderMermaidASCIIWithReceipt(SOURCE, { paddingX: -1 })).toThrow(/non-negative finite integer/)
    expect(() => renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'ansi1024' as never })).toThrow(/colorMode/)
  })

  test('hashes the exact normalized object used for execution', () => {
    const implicit = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none' })
    const explicitDefaults = renderMermaidASCIIWithReceipt(SOURCE, {
      useAscii: false,
      paddingX: 5,
      paddingY: 5,
      boxBorderPadding: 1,
      colorMode: 'none',
      theme: {},
    })
    const widerPadding = renderMermaidASCIIWithReceipt(SOURCE, { colorMode: 'none', paddingX: 6 })

    expect(implicit.outputPolicy).toEqual(explicitDefaults.outputPolicy)
    expect(implicit.receipt.requestDigest).toBe(explicitDefaults.receipt.requestDigest)
    expect(widerPadding.outputPolicy.paddingX).toBe(6)
    expect(widerPadding.receipt.requestDigest).not.toBe(implicit.receipt.requestDigest)
    expect(widerPadding.text).not.toBe(implicit.text)
  })
})
