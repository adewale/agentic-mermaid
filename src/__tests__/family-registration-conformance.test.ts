import { describe, expect, test } from 'bun:test'

import {
  FamilyConformanceError,
  detectRegisteredFamilyFromFirstLine,
  getFamily,
  getFamilyConformanceReport,
  registerFamily,
  parseRegisteredMermaid,
  verifyMermaid,
  type ExternalFamilyId,
  type FamilyDescriptor,
} from '../agent/index.ts'
import { createExtensionIdentity } from '../shared/extension-identity.ts'
import { toFinite } from '../agent/types.ts'
import { declareFamilyScenePrimitiveEvidence } from '../agent/families.ts'
import { explicitFamilyConfigDiagnostics } from '../shared/family-config-diagnostics.ts'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { renderMermaidSVG } from '../index.ts'
import {
  admitExternalTerminalOutput,
  EXTERNAL_TERMINAL_OUTPUT_LIMITS,
} from '../terminal-security.ts'
import { RESOLVED_TERMINAL_COLOR_MODES } from '../terminal-contract.ts'
import {
  FAMILY_SCOPED_RENDER_OPTION_FIELDS,
  receiptOf,
  resolveRenderRequest,
  type FamilyScopedRenderOptionField,
} from '../render-contract.ts'
import type { ConfigDiagnostic, RenderOptions } from '../types.ts'

const EVIDENCE = 'src/__tests__/family-registration-conformance.test.ts'

const FAMILY_SCOPED_OPTION_VALUES = {
  layoutHints: { ranks: {} },
  graphLayout: { backend: 'elk' },
  padding: 12,
  nodeSpacing: 77,
  layerSpacing: 91,
  wrappingWidth: 120,
  componentSpacing: 66,
  interactive: true,
  shadow: true,
  class: { hierarchicalNamespaces: false },
  kanban: { maxWidth: 600 },
  pie: { maxWidth: 360 },
  radar: { maxWidth: 360 },
  architecture: { visual: { groupCornerRadius: 12 } },
  timeline: { maxWidth: 300 },
  journey: { experienceCurve: false },
  gantt: { dependencyArrows: true, criticalPath: true },
  ganttToday: '2026-01-08',
} as const satisfies Record<FamilyScopedRenderOptionField, unknown>

function directDescriptor(localId: string): FamilyDescriptor {
  const id = `family:test/conformance-${localId}` as ExternalFamilyId
  const header = `conformance${localId.replace(/[^a-z0-9]/gi, '')}Diagram`
  return {
    contractVersion: 2,
    identity: createExtensionIdentity({
      id,
      kind: 'family',
      version: '1.0.0',
      compatibility: { core: '^0.5.0' },
      provenance: { owner: 'family-conformance-test', source: 'test', reference: EVIDENCE },
    }),
    id,
    label: `Conformance ${localId}`,
    example: `${header}\n  example payload`,
    headers: [header],
    aliases: [],
    maturity: 'experimental',
    collisionPriority: 0,
    detect: line => line === header.toLowerCase(),
    semanticRoles: [],
    semanticChannels: [],
    scenePrimitiveEvidence: [],
    capabilityEvidence: [
      { capability: 'detection', state: 'native', evidence: [EVIDENCE] },
      { capability: 'source-preservation', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'parse', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'serialize', state: 'source-preserved', evidence: [EVIDENCE] },
      { capability: 'mutation', state: 'diagnosed', evidence: [EVIDENCE] },
      { capability: 'verify', state: 'native', evidence: [EVIDENCE] },
      { capability: 'layout', state: 'native', evidence: [EVIDENCE] },
      { capability: 'scene', state: 'absent', evidence: [EVIDENCE] },
      { capability: 'svg', state: 'native', evidence: [EVIDENCE] },
      { capability: 'terminal', state: 'native', evidence: [EVIDENCE] },
    ],
    verify: () => [],
    layout: () => ({ width: 120, height: 40 }),
    projectPositioned: () => ({
      version: 1,
      nodes: [{
        id: 'node', x: toFinite(8), y: toFinite(8), w: toFinite(104), h: toFinite(24),
        shape: 'rectangle', label: 'Conformance',
      }],
      edges: [],
      groups: [],
      bounds: { w: toFinite(120), h: toFinite(40) },
    }),
    renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><text x="8" y="24">Conformance</text></svg>',
    renderAscii: context => context.config.useAscii ? '+ Conformance +' : '┌ Conformance ┐',
  }
}

function throwingSceneDescriptor(localId: string): FamilyDescriptor {
  const base = directDescriptor(localId)
  const roles = [{ role: 'prelude' as const, primitives: ['document' as const] }]
  return {
    ...base,
    identity: createExtensionIdentity({
      ...base.identity,
      compatibility: { core: '^0.5.0', scene: '^2.0.0' },
    }),
    semanticRoles: ['prelude'],
    semanticChannels: [],
    scenePrimitiveEvidence: declareFamilyScenePrimitiveEvidence(base.id, roles, [EVIDENCE]),
    capabilityEvidence: base.capabilityEvidence.map(claim => {
      if (claim.capability === 'verify') return { ...claim, state: 'diagnosed' }
      if (claim.capability === 'layout') return { ...claim, state: 'diagnosed' }
      if (claim.capability === 'scene') return { ...claim, state: 'native' }
      if (claim.capability === 'terminal') return { ...claim, state: 'absent' }
      return claim
    }),
    projectPositioned: undefined,
    renderSvg: undefined,
    renderAscii: undefined,
    lowerScene: () => { throw new Error('scene sabotage') },
  }
}

function expectRejected(descriptor: FamilyDescriptor, message: RegExp): void {
  try {
    registerFamily(descriptor)
    throw new Error('registration unexpectedly succeeded')
  } catch (error) {
    expect(error).toBeInstanceOf(FamilyConformanceError)
    expect(error).toMatchObject({ report: { familyId: descriptor.id, passed: false } })
    expect((error as Error).message).toMatch(message)
  }
  expect(getFamily(descriptor.id)).toBeUndefined()
  expect(getFamilyConformanceReport(descriptor.id)).toBeUndefined()
}

describe('external family executable registration conformance', () => {
  test('known source-loss evidence survives failures injected into each family execution phase', () => {
    let phase: 'verify' | 'layout' | 'projection' | 'svg' | undefined
    const base = directDescriptor('source-evidence-faults')
    const fail = (current: typeof phase) => {
      if (phase === current) throw new TypeError(`injected ${current} failure`)
    }
    const unregister = registerFamily({
      ...base,
      verify: (...args) => { fail('verify'); return base.verify!(...args) },
      layout: (...args) => { fail('layout'); return base.layout!(...args) },
      projectPositioned: (...args) => { fail('projection'); return base.projectPositioned!(...args) },
      renderSvg: (...args) => { fail('svg'); return base.renderSvg!(...args) },
    })
    try {
      const parsed = parseRegisteredMermaid(base.example)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
      const input = { ...parsed.value, meta: { ...parsed.value.meta, droppedComments: [{ text: 'known lost comment', line: 2 }] } }
      for (const current of ['verify', 'layout', 'projection', 'svg'] as const) {
        phase = current
        const result = verifyMermaid(input, { suppress: ['COMMENT_DROPPED'] })
        expect(result.checks?.sourceLoss).toBe('detected')
        expect(result.warnings.some(warning => warning.code === 'COMMENT_DROPPED')).toBe(false)
        expect(result.warnings.some(warning => warning.code === 'INTERNAL_ERROR' && warning.reason.includes(`injected ${current} failure`))).toBe(true)
      }
    } finally { unregister() }
  })

  test('captures an opt-in config diagnostic hook once and preserves root ordering and frozen results', () => {
    const base = directDescriptor('config-diagnostics')
    const warnings = Object.freeze([
      Object.freeze({ code: 'INEFFECTIVE_CONFIG', field: 'custom.z', message: 'custom.z is ineffective' } as const),
      Object.freeze({ code: 'INEFFECTIVE_CONFIG', field: 'custom.limit', message: 'custom.limit must be positive' } as const),
      Object.freeze({ code: 'INEFFECTIVE_CONFIG', field: 'custom.limit', message: 'custom.limit must be positive' } as const),
    ])
    const expected = [warnings[1]!, warnings[0]!]
    const config = { section: 'custom', keys: ['limit', 'z'] }
    let reads = 0
    let calls = 0
    const hook: NonNullable<FamilyDescriptor['configDiagnostics']> = ({ root, config: captured }) => {
      calls++
      expect(captured.keys).toEqual(['limit', 'z'])
      return root && typeof root === 'object' && 'custom' in root ? warnings : []
    }
    const descriptor = { ...base, config }
    Object.defineProperty(descriptor, 'configDiagnostics', {
      get() { reads++; return reads === 1 ? hook : () => { throw new Error('read hook again') } },
    })
    const unregister = registerFamily(descriptor)
    try {
      config.keys.push('later')
      expect(Object.isFrozen(getFamily(base.id))).toBe(true)
      expect(Object.isFrozen(getFamily(base.id)?.config?.keys)).toBe(true)
      const root = { custom: { limit: -1, z: true } }
      const source = `---\nconfig:\n  custom:\n    limit: -1\n    z: true\n---\n%%{init: ${JSON.stringify(root)}}%%\n${base.example}`
      expect(explicitFamilyConfigDiagnostics(base.id, root)).toEqual(expected)
      const callsBeforeVerify = calls
      expect(verifyMermaid(source).warnings).toEqual(expected)
      expect(calls - callsBeforeVerify).toBe(2)
      const diagnostics: ConfigDiagnostic[] = []
      renderMermaidSVG(base.example, {
        mermaidConfig: root, onConfigDiagnostic: item => diagnostics.push(item),
      })
      expect(diagnostics).toEqual(expected)
      expect(reads).toBe(1)
    } finally {
      unregister()
    }
    expect(() => registerFamily({ ...base, config, configDiagnostics: 1 as never })).toThrow(/configDiagnostics must be a function/)
  })

  test('keeps config diagnostics opt-in for extension source and retains explicit fallback messages', () => {
    const base = directDescriptor('config-without-hook')
    const unregister = registerFamily({ ...base, config: { section: 'custom', keys: ['legacy'], noopKeys: ['legacy'] } })
    try {
      const root = { custom: { legacy: true, unknown: true } }
      const source = `%%{init: ${JSON.stringify(root)}}%%\n${base.example}`
      expect(verifyMermaid(source).warnings).toEqual([])
      expect(explicitFamilyConfigDiagnostics(base.id, root)).toEqual([
        { code: 'INEFFECTIVE_CONFIG', field: 'custom.legacy', message: `${base.id} config field "legacy" is accepted for compatibility but has no effect on this renderer.` },
        { code: 'INEFFECTIVE_CONFIG', field: 'custom.unknown', message: `${base.id} config field "unknown" is unknown and has no effect; check the spelling or remove it.` },
      ])
    } finally {
      unregister()
    }
  })

  test('rejects the removed v1 family descriptor contract before callbacks execute', () => {
    const base = directDescriptor('descriptor-v1')
    let detectorCalls = 0
    expect(() => registerFamily({
      ...base,
      contractVersion: 1,
      detect(line: string) {
        detectorCalls++
        return base.detect(line)
      },
    } as unknown as FamilyDescriptor)).toThrow(/unsupported descriptor contract/i)
    expect(detectorCalls).toBe(0)
    expect(getFamily(base.id)).toBeUndefined()
  })

  test('requires a compatible core range before any family callback executes', () => {
    const base = directDescriptor('missing-core-range')
    let detectorCalls = 0
    const descriptor: FamilyDescriptor = {
      ...base,
      identity: createExtensionIdentity({
        ...base.identity,
        compatibility: {},
      }),
      detect(line) {
        detectorCalls++
        return base.detect(line)
      },
    }
    expect(() => registerFamily(descriptor))
      .toThrow(/must declare an explicit compatible "core" range/i)
    expect(detectorCalls).toBe(0)
    expect(getFamily(descriptor.id)).toBeUndefined()
  })

  test('commits one immutable per-capability report for a deterministic passing family', () => {
    const descriptor = directDescriptor('passing')
    const unregister = registerFamily(descriptor)
    try {
      const report = getFamilyConformanceReport(descriptor.id)!
      expect(Object.isFrozen(report)).toBe(true)
      expect(Object.isFrozen(report.capabilities)).toBe(true)
      expect(report.capabilities.every(result => Object.isFrozen(result))).toBe(true)
      expect(report).toMatchObject({ version: 2, familyId: descriptor.id, passed: true, example: descriptor.example })
      expect(report.capabilities).toHaveLength(10)
      for (const result of report.capabilities) {
        if (result.declaredState === 'native') {
          expect(result).toMatchObject({ status: 'passed', witnessId: expect.stringContaining(descriptor.id) })
        } else {
          expect(result).toMatchObject({ status: 'unverified-extension', diagnostic: expect.any(String) })
        }
      }
    } finally {
      unregister()
    }
    expect(getFamilyConformanceReport(descriptor.id)).toBeUndefined()
  })

  test('validates snapshotted family-scoped RenderOptions before executable callbacks', () => {
    for (const [suffix, applicableRenderOptions, message] of [
      ['unknown', ['bg'], /unknown family-scoped field "bg"/i],
      ['future', ['futureSpacing'], /unknown family-scoped field "futureSpacing"/i],
      ['duplicate', ['componentSpacing', 'componentSpacing'], /repeats "componentSpacing"/i],
    ] as const) {
      const base = directDescriptor(`render-option-${suffix}`)
      let detectorCalls = 0
      const descriptor: FamilyDescriptor = {
        ...base,
        applicableRenderOptions: applicableRenderOptions as never,
        detect(line) {
          detectorCalls++
          return base.detect(line)
        },
      }
      expect(() => registerFamily(descriptor)).toThrow(message)
      expect(detectorCalls).toBe(0)
      expect(getFamily(descriptor.id)).toBeUndefined()
    }
  })

  test('diagnoses every undeclared family-scoped option and admits every declared one', () => {
    expect(FAMILY_SCOPED_RENDER_OPTION_FIELDS).toEqual(
      Object.keys(FAMILY_SCOPED_OPTION_VALUES) as FamilyScopedRenderOptionField[],
    )

    const absent = directDescriptor('render-options-absent')
    const unregisterAbsent = registerFamily(absent)
    try {
      for (const field of FAMILY_SCOPED_RENDER_OPTION_FIELDS) {
        const request = resolveRenderRequest(absent.example, {
          [field]: FAMILY_SCOPED_OPTION_VALUES[field],
        } as RenderOptions)
        expect(receiptOf(request).diagnostics).toContainEqual({
          code: 'RENDER_OPTION_NOT_APPLICABLE',
          feature: `render-option:${field}`,
          message: `Render option "${field}" does not apply to extension family "${absent.id}". Its FamilyDescriptor does not list the field in applicableRenderOptions.`,
        })
      }
    } finally {
      unregisterAbsent()
    }

    const declaredFields = [...FAMILY_SCOPED_RENDER_OPTION_FIELDS]
    const declared: FamilyDescriptor = {
      ...directDescriptor('render-options-declared'),
      applicableRenderOptions: declaredFields,
    }
    const unregisterDeclared = registerFamily(declared)
    try {
      declaredFields.length = 0
      const installed = getFamily(declared.id)!
      expect(installed.applicableRenderOptions).toEqual(FAMILY_SCOPED_RENDER_OPTION_FIELDS)
      expect(Object.isFrozen(installed.applicableRenderOptions)).toBe(true)
      for (const field of FAMILY_SCOPED_RENDER_OPTION_FIELDS) {
        const request = resolveRenderRequest(declared.example, {
          [field]: FAMILY_SCOPED_OPTION_VALUES[field],
        } as RenderOptions)
        expect(receiptOf(request).diagnostics?.filter(diagnostic =>
          diagnostic.code === 'RENDER_OPTION_NOT_APPLICABLE'
          && diagnostic.feature === `render-option:${field}`) ?? []).toEqual([])
      }
    } finally {
      unregisterDeclared()
    }
  })

  test('captures the complete descriptor and nested claims once before validation', () => {
    const base = directDescriptor('accessor-snapshot')
    const header = base.headers[0]!
    const capabilityEvidence = base.capabilityEvidence.map(claim => ({ ...claim }))
    const firstClaim = capabilityEvidence[0]!
    const reads = { headers: 0, renderSvg: 0, renderOptions: 0, claimState: 0, coreRange: 0 }
    let armed = false

    Object.defineProperty(firstClaim, 'state', {
      enumerable: true,
      get() {
        reads.claimState++
        return reads.claimState === 1 ? 'native' : 'absent'
      },
    })
    const compatibility = {} as Record<string, string | undefined>
    Object.defineProperty(compatibility, 'core', {
      enumerable: true,
      get() {
        reads.coreRange++
        return reads.coreRange === 1 ? '^0.5.0' : undefined
      },
    })
    const descriptor = {
      ...base,
      identity: {
        ...base.identity,
        compatibility,
        provenance: { ...base.identity.provenance },
      },
      capabilityEvidence,
      collisionPriority: 999,
      detect: (line: string) => base.detect(line) || (armed && line === 'flowchart'),
    } as FamilyDescriptor
    Object.defineProperties(descriptor, {
      headers: {
        enumerable: true,
        get() {
          reads.headers++
          if (reads.headers > 1) armed = true
          return reads.headers === 1 ? [header] : [header, 'flowchart']
        },
      },
      renderSvg: {
        enumerable: true,
        get() {
          reads.renderSvg++
          return reads.renderSvg === 1
            ? base.renderSvg
            : () => '<svg xmlns="http://www.w3.org/2000/svg" data-poisoned="true" />'
        },
      },
      applicableRenderOptions: {
        enumerable: true,
        get() {
          reads.renderOptions++
          return reads.renderOptions === 1 ? ['componentSpacing'] : ['class']
        },
      },
    })

    const unregister = registerFamily(descriptor)
    try {
      expect(reads).toEqual({ headers: 1, renderSvg: 1, renderOptions: 1, claimState: 1, coreRange: 1 })
      expect(getFamily(base.id)?.headers).toEqual([header])
      expect(getFamily(base.id)?.applicableRenderOptions).toEqual(['componentSpacing'])
      expect(detectRegisteredFamilyFromFirstLine('flowchart')).toBe('flowchart')
      expect(armed).toBe(false)
    } finally {
      unregister()
    }
  })

  test('runs both glyph encodings through every resolved terminal mode twice', () => {
    const base = directDescriptor('terminal-matrix')
    const calls = new Map<string, number>()
    const descriptor: FamilyDescriptor = {
      ...base,
      renderAscii: context => {
        const key = `${context.config.useAscii ? 'ascii' : 'unicode'}/${context.colorMode}`
        calls.set(key, (calls.get(key) ?? 0) + 1)
        return context.config.useAscii ? '+ matrix +' : '┌ matrix ┐'
      },
    }
    const unregister = registerFamily(descriptor)
    try {
      expect(calls.size).toBe(RESOLVED_TERMINAL_COLOR_MODES.length * 2)
      for (const encoding of ['ascii', 'unicode'] as const) {
        for (const colorMode of RESOLVED_TERMINAL_COLOR_MODES) {
          expect(calls.get(`${encoding}/${colorMode}`)).toBe(2)
        }
      }
    } finally {
      unregister()
    }
  })

  test('rolls back native layout, Scene, SVG, and terminal sabotage', () => {
    const layout = { ...directDescriptor('layout-throws'), layout: () => { throw new Error('layout sabotage') } }
    const svg = { ...directDescriptor('svg-throws'), renderSvg: () => { throw new Error('svg sabotage') } }
    const terminal = { ...directDescriptor('terminal-throws'), renderAscii: () => { throw new Error('terminal sabotage') } }
    expectRejected(layout, /layout sabotage/)
    expectRejected(throwingSceneDescriptor('scene-throws'), /scene sabotage/)
    expectRejected(svg, /svg sabotage/)
    expectRejected(terminal, /terminal sabotage/)
  })

  test('rejects nondeterministic output and invalid PNG pre-raster geometry', () => {
    let tick = 0
    const nondeterministic = {
      ...directDescriptor('nondeterministic'),
      renderAscii: () => `tick-${tick++}`,
    }
    expectRejected(nondeterministic, /nondeterministic/)

    const invalidRaster = {
      ...directDescriptor('invalid-raster'),
      renderSvg: () => '<svg xmlns="http://www.w3.org/2000/svg" width="auto" height="40"><text>bad</text></svg>',
    }
    expectRejected(invalidRaster, /intrinsic dimensions|width|viewBox/i)
  })

  test('witnesses every terminal color mode and rejects empty native output', () => {
    const modeSabotage = directDescriptor('terminal-mode-sabotage')
    expectRejected({
      ...modeSabotage,
      renderAscii: context => context.colorMode === 'truecolor'
        ? '\u001b]52;c;SGFja2Vk\u0007'
        : 'safe terminal output',
    }, /terminal.*disallowed control.*truecolor/i)

    for (const [suffix, output] of [['empty', ''], ['whitespace', ' \n  ']] as const) {
      const descriptor = directDescriptor(`terminal-${suffix}`)
      expectRejected({ ...descriptor, renderAscii: () => output }, /ascii\/none.*no visible content/i)
    }
  })

  test('admits only bounded strings and the exact ANSI color grammar for external terminal output', () => {
    expect(admitExternalTerminalOutput('\u001b[31mred\u001b[0m', 'ansi16')).toBe('\u001b[31mred\u001b[0m')
    expect(admitExternalTerminalOutput('\u001b[38;5;255mred\u001b[0m', 'ansi256')).toBe('\u001b[38;5;255mred\u001b[0m')
    expect(admitExternalTerminalOutput('\u001b[38;2;1;2;255mred\u001b[0m', 'truecolor')).toBe('\u001b[38;2;1;2;255mred\u001b[0m')
    expect(admitExternalTerminalOutput('\u001b[31mred\u001b[0m plain', 'ansi16')).toBe('\u001b[31mred\u001b[0m plain')
    expect(admitExternalTerminalOutput('<b>safe</b>', 'html')).toBe('&lt;b&gt;safe&lt;/b&gt;')
    const trustedHtml = '<span style="color:#123456">&lt;safe&gt;</span>'
    expect(admitExternalTerminalOutput(trustedHtml, 'html')).toBe(trustedHtml)

    expect(() => admitExternalTerminalOutput(42, 'none')).toThrow(/must return a string/i)
    expect(() => admitExternalTerminalOutput('\u001b[31mwrong mode\u001b[0m', 'none')).toThrow(/disallowed control/i)
    expect(() => admitExternalTerminalOutput('\u001b]52;c;SGFja2Vk\u0007', 'ansi16')).toThrow(/disallowed control/i)
    expect(() => admitExternalTerminalOutput('\u001bP1;2|payload\u001b\\', 'truecolor')).toThrow(/disallowed control/i)
    expect(() => admitExternalTerminalOutput('\u001b[2Jcursor', 'ansi16')).toThrow(/disallowed control/i)
    expect(() => admitExternalTerminalOutput('\u001b[38;5;1mwrong grammar\u001b[0m', 'ansi16')).toThrow(/disallowed control/i)
    expect(() => admitExternalTerminalOutput('\u001b[38;5;256mrange\u001b[0m', 'ansi256')).toThrow(/disallowed control/i)
    expect(() => admitExternalTerminalOutput('\u001b[38;2;0;0;256mrange\u001b[0m', 'truecolor')).toThrow(/disallowed control/i)
    for (const [colorMode, output] of [
      ['ansi16', '\u001b[31mbleed'],
      ['ansi256', '\u001b[38;5;196mbleed'],
      ['truecolor', '\u001b[38;2;255;0;0mbleed'],
    ] as const) {
      expect(() => admitExternalTerminalOutput(output, colorMode)).toThrow(/leaves ANSI color state active/i)
    }
    expect(() => admitExternalTerminalOutput('\u009d52;c;SGFja2Vk\u009c', 'html')).toThrow(/disallowed control/i)
    // Bidi overrides reorder cells; noncharacters and lone surrogates are not
    // text. sanitizeTerminalText never emits them, so admission refuses them.
    for (const output of ['a\u202eb', 'a\u2066b\u2069', 'a\ufffeb', 'a\u{10ffff}b', 'a\ud800b']) {
      expect(() => admitExternalTerminalOutput(output, 'none')).toThrow(/disallowed control/i)
    }
    expect(() => admitExternalTerminalOutput(' \n ', 'none')).toThrow(/no visible content/i)
    expect(() => admitExternalTerminalOutput('\u001b[0m  \u001b[0m', 'ansi16')).toThrow(/no visible content/i)
    expect(() => admitExternalTerminalOutput('<span style="color:#123456"> </span>', 'html')).toThrow(/no visible content/i)
    const entity = admitExternalTerminalOutput('<span style="color:#123456">&#27;]52;payload</span>', 'html')
    expect(entity).not.toContain('<span')
    expect(entity).toContain('&amp;#27;')

    const exactBytes = `${'x'.repeat(49_999)}\n`.repeat(39) + 'x'.repeat(50_000)
    expect(exactBytes.length).toBe(EXTERNAL_TERMINAL_OUTPUT_LIMITS.maxBytes)
    expect(admitExternalTerminalOutput(exactBytes, 'none')).toBe(exactBytes)
    expect(() => admitExternalTerminalOutput(`${exactBytes}x`, 'none')).toThrow(/byte limit/i)

    const exactLines = `${'x\n'.repeat(EXTERNAL_TERMINAL_OUTPUT_LIMITS.maxLines - 1)}x`
    expect(admitExternalTerminalOutput(exactLines, 'none')).toBe(exactLines)
    expect(() => admitExternalTerminalOutput(`${exactLines}\nx`, 'none')).toThrow(/line limit/i)

    const exactCells = 'x'.repeat(EXTERNAL_TERMINAL_OUTPUT_LIMITS.maxLineCells)
    expect(admitExternalTerminalOutput(exactCells, 'none')).toBe(exactCells)
    expect(() => admitExternalTerminalOutput(
      `${exactCells}x`,
      'none',
    )).toThrow(/cell limit/i)
    const literalSpans = '<span style="color:#123456"></span>'.repeat(3_000) + 'x'
    for (const colorMode of ['none', 'ansi16'] as const) {
      expect(() => admitExternalTerminalOutput(literalSpans, colorMode)).toThrow(/cell limit/i)
    }
  })

  test('rechecks external terminal output on every source after registration', () => {
    const base = directDescriptor('terminal-runtime-sabotage')
    const renderAscii = base.renderAscii!
    const descriptor: FamilyDescriptor = {
      ...base,
      renderAscii: context => {
        if (context.source.body.includes('non-string')) return 42 as unknown as string
        if (context.source.body.includes('control')) return '\u001b]52;c;SGFja2Vk\u0007'
        return renderAscii(context)
      },
    }
    const unregister = registerFamily(descriptor)
    try {
      const header = descriptor.headers[0]!
      expect(() => renderMermaidASCIIWithReceipt(`${header}\n  non-string`, { colorMode: 'none' }))
        .toThrow(/must return a string/i)
      for (const colorMode of RESOLVED_TERMINAL_COLOR_MODES) {
        expect(() => renderMermaidASCIIWithReceipt(`${header}\n  control`, { colorMode }))
          .toThrow(/disallowed control/i)
      }
    } finally {
      unregister()
    }
  })

  test('preserves authored source for external family hooks while refusing echoed controls', () => {
    const base = directDescriptor('terminal-authored-source')
    let observed: Parameters<NonNullable<FamilyDescriptor['renderAscii']>>[0]['source'] | undefined
    const descriptor: FamilyDescriptor = {
      ...base,
      renderAscii(context) {
        if (context.source.body.includes('retain')) { observed = context.source; return 'Safe display' }
        if (context.source.body.includes('echo')) return context.source.familyText
        return base.renderAscii!(context)
      },
    }
    const unregister = registerFamily(descriptor)
    try {
      const header = descriptor.headers[0]!
      const source = `---\ntitle: "Title\\tX"\n---\n${header}\nretain A\tB`
      renderMermaidASCIIWithReceipt(source, { colorMode: 'none' })
      expect(observed?.originalText).toBe(source)
      expect(observed?.familyText).toBe(`${header}\nretain A\tB`)
      expect(observed?.frontmatter.title).toBe('Title\tX')
      expect(Object.isFrozen(observed)).toBe(true)
      for (const colorMode of RESOLVED_TERMINAL_COLOR_MODES) {
        expect(() => renderMermaidASCIIWithReceipt(`${header}\necho A\u001b]52;c;payload\u0007`, { colorMode }))
          .toThrow(/disallowed control/i)
      }
    } finally { unregister() }
  })

  test('rejects zero-sized or semantically empty native layout witnesses', () => {
    const zeroSized = directDescriptor('zero-sized-layout')
    expectRejected({
      ...zeroSized,
      layout: () => ({ width: 0, height: 0 }),
    }, /layout and projected bounds must be finite and positive/i)

    const emptyProjection = directDescriptor('empty-projected-layout')
    expectRejected({
      ...emptyProjection,
      projectPositioned: () => ({
        version: 1,
        nodes: [],
        edges: [],
        groups: [],
        bounds: { w: toFinite(120), h: toFinite(40) },
      }),
    }, /at least one semantic node, edge, or group/i)
  })

  test('forbids reentrant registry mutation during validation and staging', () => {
    const nested = directDescriptor('nested')
    const reentrant = directDescriptor('reentrant')
    const originalDetect = reentrant.detect
    let attempted = false
    const candidate: FamilyDescriptor = {
      ...reentrant,
      detect: line => {
        if (!attempted) {
          attempted = true
          registerFamily(nested)
        }
        return originalDetect(line)
      },
    }
    expect(() => registerFamily(candidate)).toThrow(/registry mutation is forbidden.*undergoing conformance/i)
    expect(getFamily(candidate.id)).toBeUndefined()
    expect(getFamily(nested.id)).toBeUndefined()

    const accessorReentrant = directDescriptor('accessor-reentrant')
    let accessorAttempted = false
    Object.defineProperty(accessorReentrant, 'headers', {
      enumerable: true,
      get() {
        accessorAttempted = true
        registerFamily(nested)
        return ['accessorReentrantDiagram']
      },
    })
    expect(() => registerFamily(accessorReentrant))
      .toThrow(/registry mutation is forbidden.*undergoing conformance/i)
    expect(accessorAttempted).toBe(true)
    expect(getFamily(accessorReentrant.id)).toBeUndefined()
    expect(getFamily(nested.id)).toBeUndefined()
  })

  test('requires one bounded canonical example even for detection-only extensions', () => {
    const base = directDescriptor('missing-example')
    const missing = { ...base, example: '' }
    expect(() => registerFamily(missing)).toThrow(/must declare a canonical example/)
    expect(getFamily(base.id)).toBeUndefined()
  })
})
