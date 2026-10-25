import { describe, expect, test } from 'bun:test'
import { CORE_CASE_IDS, mergeBenchmarkPackage, prCorePortfolio } from '../unified/pr-campaign.ts'

describe('PR benchmark preparation and comparable portfolio admission', () => {
  test('main override conflicts retain independent PR build-tool and override additions', () => {
    const base = { dependencies: { yaml: '2.9.0' }, overrides: { undici: '7.29.1' }, devDependencies: {} }
    const main = { ...base, overrides: { undici: '7.30.1' } }
    const head = { ...base, overrides: { undici: '7.29.2', zod: '4.6.6' }, devDependencies: { '@swc/core': '1.15.8' } }
    expect(mergeBenchmarkPackage(base, main, head)).toEqual({ dependencies: { yaml: '2.9.0' }, overrides: { undici: '7.30.1', zod: '4.6.6' }, devDependencies: { '@swc/core': '1.15.8' } })
  })
  test('runtime dependency conflicts cannot be silently resolved as override changes', () => {
    expect(() => mergeBenchmarkPackage({ dependencies: { yaml: '2.8.3' } }, { dependencies: { yaml: '2.9.0' } }, { dependencies: { yaml: '3.0.0' } })).toThrow('Non-override package conflict at dependencies.yaml')
  })
  test('one missing or duplicate case withholds a fast-looking portfolio', () => {
    const rows = CORE_CASE_IDS.map(id => ({ id, family: 'fixture', metric: 'svg', status: 'passed', samplesMs: [2, 4, 6] }))
    const complete = { rows, runtime: 'test', memory: {} }
    expect(prCorePortfolio(complete, 'svg')).toBe(24)
    expect(prCorePortfolio({ ...complete, rows: rows.slice(1) }, 'svg')).toBeUndefined()
    expect(prCorePortfolio({ ...complete, rows: [rows[0]!, ...rows.slice(0, -1)] }, 'svg')).toBeUndefined()
    expect(prCorePortfolio({ ...complete, rows: rows.map((row, index) => (index === 0 ? { ...row, status: 'failed', samplesMs: [0.001] } : row)) }, 'svg')).toBeUndefined()
  })
})

describe('receipt-bearing invocation admission', () => {
  test('rejects absent, wrong-output and incompletely materialized receipts', async () => {
    const { assertInvocationReceipt } = await import('../unified/invocation-receipt.ts')
    const receipt = { version: 2, output: 'svg', requestDigest: 'request', sharedRequestDigest: 'shared', appearanceDigest: 'appearance', capabilityDecision: { accepted: true, resolutions: [] } }
    expect(() => assertInvocationReceipt(undefined, 'svg')).toThrow('no receipt')
    expect(() => assertInvocationReceipt(receipt, 'png')).toThrow('does not match')
    expect(() => assertInvocationReceipt({ ...receipt, sharedRequestDigest: '' }, 'svg')).toThrow('sharedRequestDigest')
    expect(() => assertInvocationReceipt({ ...receipt, capabilityDecision: null }, 'svg')).toThrow('capability decision')
    expect(() => assertInvocationReceipt(receipt, 'svg')).not.toThrow()
  })
})
