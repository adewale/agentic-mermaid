import { describe, expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import {
  resolveTerminalOutputPolicy,
  TerminalOutputPolicyError,
} from '../terminal-contract.ts'
import { RENDER_OUTPUT_DESCRIPTORS } from '../render-contract.ts'

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
})

describe('canonical terminal output policy', () => {
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
