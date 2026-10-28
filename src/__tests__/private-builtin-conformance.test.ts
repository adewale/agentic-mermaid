import { expect, test } from 'bun:test'
import { DefaultBackend, registerBackend, type StyleBackend } from '../scene/backend.ts'
import { RoughBackend } from '../scene/rough-backend.ts'
import { HybridBackend } from '../scene/hybrid-backend.ts'
import { backendWithAdmittedConformanceFixture, runBackendConformance, type BackendConformanceReport } from '../scene/backend-conformance.ts'
import { graphicalBackendCapabilityClaims } from '../scene/capabilities.ts'
import { capturePrivateBuiltinConformance, requirePrivateBuiltinConformance } from '../scene/private-builtin-conformance.ts'
import { assertConformanceSourceSnapshot } from '../../scripts/build/private-builtin-conformance.ts'
import { buildPrivateBackendProbe } from './helpers/private-backend-probe.ts'

test('private proof retains the actual report and rejects mutated, copied and accessor-backed owners', () => {
  const backend: StyleBackend = { id: 'default', capabilities: graphicalBackendCapabilityClaims('backend:default', 'crisp'), drawNode: DefaultBackend.drawNode, render: DefaultBackend.render }
  const actual = runBackendConformance(backendWithAdmittedConformanceFixture(backend), 'backend:default')
  expect(actual.passed).toBe(true)
  capturePrivateBuiltinConformance(backend, actual)
  expect(requirePrivateBuiltinConformance(backend)).toBe(actual)
  expect(Object.isFrozen(actual)).toBe(true)
  expect(Object.isFrozen(actual.contracts)).toBe(true)
  expect(actual.checks.every(Object.isFrozen)).toBe(true)
  expect(actual.claims.every(Object.isFrozen)).toBe(true)
  expect(Reflect.set(actual, 'passed', false)).toBe(false)
  expect(Reflect.set(actual.claims[0]!, 'status', 'failed')).toBe(false)
  expect(() => requirePrivateBuiltinConformance({ ...backend })).toThrow('changed after certification')
  let reads = 0, calls = 0
  const proxy = new Proxy(backend, { get() { reads++; throw Error('Proxy trap ran') }, getOwnPropertyDescriptor() { reads++; throw Error('Proxy descriptor trap ran') } })
  expect(() => requirePrivateBuiltinConformance(proxy)).toThrow('changed after certification')
  expect(reads).toBe(0)
  for (const field of ['id', 'capabilities', 'drawNode', 'render'] as const) {
    const original = Object.getOwnPropertyDescriptor(backend, field)!
    const replacement = field === 'id' ? 'rough' : field === 'capabilities' ? Object.freeze([...backend.capabilities]) : () => { calls++; return '' }
    Object.defineProperty(backend, field, { ...original, value: replacement })
    expect(() => requirePrivateBuiltinConformance(backend)).toThrow('changed after certification')
    Object.defineProperty(backend, field, { ...original, value: original.value })
    Object.defineProperty(backend, field, { configurable: true, enumerable: true, get() { reads++; throw Error('Getter ran') } })
    expect(() => requirePrivateBuiltinConformance(backend)).toThrow('changed after certification')
    Object.defineProperty(backend, field, original)
    expect(requirePrivateBuiltinConformance(backend)).toBe(actual)
  }
  expect(reads).toBe(0)
  expect(calls).toBe(0)
  expect(() => capturePrivateBuiltinConformance(backend, actual)).toThrow('does not match its owner')
})

test('source certification refuses changed bytes, additions and removals without mutating a checkout', () => {
  const before = new Map([['backend.ts', 'implementation'], ['bun.lock', 'dependencies']])
  expect(() => assertConformanceSourceSnapshot(before, new Map(before))).not.toThrow()
  expect(() => assertConformanceSourceSnapshot(before, new Map([['backend.ts', 'changed bytes'], ['bun.lock', 'dependencies']]))).toThrow('Sources changed')
  expect(() => assertConformanceSourceSnapshot(before, new Map([['backend.ts', 'implementation']]))).toThrow('Sources changed')
  expect(() => assertConformanceSourceSnapshot(before, new Map([...before, ['new.ts', 'new dependency']]))).toThrow('Sources changed')
})

test('compiled private reports retain every executed claim and admission while public registration stays executable', async () => {
  const code = await buildPrivateBackendProbe()
  const compiled = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) as { reports: BackendConformanceReport[]; renderProbe(mode?: string): string; customRegistration(): void }
  const canonical = [DefaultBackend, RoughBackend, HybridBackend].map(backend => runBackendConformance(backend === DefaultBackend ? backendWithAdmittedConformanceFixture(backend) : backend, `backend:${backend.id}`))
  const expected = canonical.map(report => ({ ...report, claims: report.claims.map(claim => ({ ...claim, observation: '' })) }))
  expect(compiled.reports).toEqual(expected)
  expect(compiled.renderProbe()).toContain('<svg')
  for (const mode of ['invalid', 'unsafe', 'external']) expect(() => compiled.renderProbe(mode)).toThrow()
  expect(() => compiled.customRegistration()).toThrow('unavailable in this private source renderer')
  const id = 'backend:private-certificate-public-control' as const
  const dispose = registerBackend({ id, capabilities: graphicalBackendCapabilityClaims(id, 'crisp'), drawNode: DefaultBackend.drawNode, render: DefaultBackend.render }, { compatibility: { core: '^0.4.0', scene: '^2.0.0' } })
  dispose()
}, 120_000)
