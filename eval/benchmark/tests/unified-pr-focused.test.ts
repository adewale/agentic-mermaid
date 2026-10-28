import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORE_CASE_IDS, completePrControlRounds, PR_CORE_WORKER, parsePrCampaignOptions, prCorePortfolio, selectedCoreMetrics } from '../unified/pr-campaign.ts'

describe('focused PR protocol', () => {
  test('control evidence needs every requested round and unique admitted keys', () => {
    const rows = [1, 2, 3].map(round => ({ round, key: `main:${round}:1` }))
    expect(completePrControlRounds(rows, 3)).toBe(true)
    expect(completePrControlRounds(rows.slice(0, 2), 3)).toBe(false)
    expect(completePrControlRounds([...rows, rows[0]!], 3)).toBe(false)
    expect(
      completePrControlRounds(
        [
          { round: 1, key: 'a' },
          { round: 1, key: 'b' },
          { round: 1, key: 'c' },
        ],
        3,
      ),
    ).toBe(false)
    expect(completePrControlRounds([...rows, { round: 4, key: 'extra' }], 3)).toBe(false)
  })
  test('explicit selection is validated while defaults preserve the full protocol', () => {
    const options = parsePrCampaignOptions(['--profile', 'full', '--api-only', '--core-metrics', 'svg,svgReceipt,firstSvg,import', '--extra-core-cases', 'gitGraph20'])
    expect(options.apiOnly).toBe(true)
    expect(selectedCoreMetrics(options)).toEqual(['svg', 'svgReceipt', 'firstSvg', 'import'])
    expect(selectedCoreMetrics(parsePrCampaignOptions(['--profile', 'full']))).toContain('pngReceipt')
    expect(() => parsePrCampaignOptions(['--core-metrics', 'svg,svg'])).toThrow()
    expect(() => parsePrCampaignOptions(['--core-metrics', 'fiction'])).toThrow()
    expect(() => parsePrCampaignOptions(['--extra-core-cases', 'flow5'])).toThrow()
  })
  test('supplemental case cannot change the fixed six portfolio or conceal its failure', () => {
    const rows = [...CORE_CASE_IDS, 'gitGraph20'].map(id => ({ id, family: 'fixture', metric: 'svg', status: 'passed', samplesMs: [id === 'gitGraph20' ? 99 : 2] }))
    const result = { rows, runtime: 'test', memory: {}, extraCases: ['gitGraph20'] }
    expect(prCorePortfolio({ ...result, extraCases: [] }, 'svg')).toBeUndefined()
    expect(prCorePortfolio(result, 'svg')).toBe(12)
    expect(prCorePortfolio(result, 'svg', ['gitGraph20'])).toBe(99)
    rows[6]!.status = 'failed'
    expect(prCorePortfolio(result, 'svg')).toBe(12)
    expect(prCorePortfolio(result, 'svg', ['gitGraph20'])).toBeUndefined()
  })
  test('focused worker actually calls only selected APIs and emits only selected metrics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-focused-worker-'))
    try {
      writeFileSync(join(dir, 'api.mjs'), `export const renderMermaidSVG=()=>'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>';export const renderMermaidSVGWithReceipt=()=>({svg:renderMermaidSVG(),receipt:{valid:true}});export const renderMermaidASCII=()=>{throw Error('unselected terminal API called')}`)
      writeFileSync(join(dir, 'qualifier.mjs'), 'export const qualifyOutput=()=>({ok:true,findings:[],scope:"authored worker fixture"})')
      writeFileSync(join(dir, 'receipt.mjs'), `import{appendFileSync}from'node:fs';export function assertInvocationReceipt(r){appendFileSync(${JSON.stringify(join(dir, 'receipt-checks'))},'check\\n');if(!r?.valid)throw Error("missing receipt")}`)
      writeFileSync(join(dir, 'worker.mjs'), PR_CORE_WORKER)
      const metrics = ['svg', 'svgReceipt', 'firstSvg', 'import']
      writeFileSync(
        join(dir, 'job.json'),
        JSON.stringify({
          index: join(dir, 'api.mjs'),
          agent: join(dir, 'must-not-import-agent.mjs'),
          workflow: join(dir, 'must-not-import-workflow.mjs'),
          qualifier: join(dir, 'qualifier.mjs'),
          receiptValidator: join(dir, 'receipt.mjs'),
          workloads: [{ id: 'small', family: 'flowchart', source: 'flowchart TD' }],
          metrics,
          receiptValidation: 'pre-post-outside-clocks',
          coreCases: ['small'],
          extraCases: [],
          out: join(dir, 'result.json'),
        }),
      )
      execFileSync('node', [join(dir, 'worker.mjs'), join(dir, 'job.json')], { timeout: 10000 })
      const result = JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))
      expect(result.selectedMetrics).toEqual(metrics)
      expect(readFileSync(join(dir, 'receipt-checks'), 'utf8').trim().split('\n')).toHaveLength(2)
      expect(result.receiptValidation).toBe('pre-post-outside-clocks')
      expect(new Set(result.rows.map((row: any) => row.metric))).toEqual(new Set(metrics))
      expect(result.rows.every((row: any) => row.status === 'passed')).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
