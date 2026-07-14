import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  NIGHTLY_MUTATION_LANES,
  buildNightlyMutationPlan,
  calibratedMutationFloor,
  compactMutationReport,
  compareExpectedMutants,
  loadStrykerConfig,
  mutationBreakFloor,
  mutationOracleOptions,
  mutationScore,
  parseMutationTarget,
  shardMutationTargets,
  validateMutationReport,
} from '../../scripts/quality/nightly-mutation.ts'

const ROOT = join(import.meta.dir, '..', '..')

function expandedTargets(specs: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const spec of specs) {
    const target = parseMutationTarget(spec, ROOT)
    for (let line = target.start; line <= target.end; line++) out.add(`${target.file}:${line}`)
  }
  return out
}

function scopedSource(spec: string): string {
  const target = parseMutationTarget(spec, ROOT)
  return readFileSync(join(ROOT, target.file), 'utf8').split(/\r?\n/).slice(target.start - 1, target.end).join('\n')
}

describe('nightly mutation orchestration', () => {
  test('the plan covers every configured source line exactly once', async () => {
    const plan = await buildNightlyMutationPlan(ROOT)
    expect(new Set(plan.map(item => item.name)).size).toBe(plan.length)

    for (const lane of NIGHTLY_MUTATION_LANES) {
      const config = await loadStrykerConfig(lane.config, ROOT)
      const expected = expandedTargets(config.mutate!)
      const actualSpecs = plan.filter(item => item.lane === lane.id).flatMap(item => item.mutate)
      const actual = expandedTargets(actualSpecs)
      expect({ lane: lane.id, covered: actual.size, expected: expected.size }).toEqual({ lane: lane.id, covered: expected.size, expected: expected.size })
      expect(actual).toEqual(expected)
      expect(actualSpecs.reduce((sum, spec) => {
        const target = parseMutationTarget(spec, ROOT)
        return sum + target.end - target.start + 1
      }, 0)).toBe(expected.size)

      if (lane.maxLinesPerShard) {
        for (const item of plan.filter(item => item.lane === lane.id)) {
          const lines = item.mutate.reduce((sum, spec) => {
            const target = parseMutationTarget(spec, ROOT)
            return sum + target.end - target.start + 1
          }, 0)
          if (lines > lane.maxLinesPerShard) expect(item.mutate).toHaveLength(1)
        }
      }
    }
  })

  test('the union of AST-safe shards is exactly the full Stryker mutant multiset', async () => {
    const plan = await buildNightlyMutationPlan(ROOT)
    const lanes = []
    for (const lane of NIGHTLY_MUTATION_LANES.filter(candidate => candidate.maxLinesPerShard)) {
      const config = await loadStrykerConfig(lane.config, ROOT)
      for (const spec of config.mutate!) {
        const target = parseMutationTarget(spec, ROOT)
        const fullLineCount = readFileSync(join(ROOT, target.file), 'utf8').split(/\r?\n/).length
        expect({ lane: lane.id, target }).toEqual({ lane: lane.id, target: { file: target.file, start: 1, end: fullLineCount } })
      }
      lanes.push({
        id: lane.id,
        full: config.mutate,
        ...mutationOracleOptions(lane.config, config),
        shards: plan.filter(item => item.lane === lane.id).map(item => item.mutate),
        reported: [],
      })
    }
    const result = spawnSync('node', [join(ROOT, 'scripts/quality/mutation-shard-oracle.mjs')], {
      cwd: ROOT,
      input: JSON.stringify({ root: ROOT, lanes }),
      encoding: 'utf8',
      timeout: 180_000,
    })
    expect({ status: result.status, signal: result.signal, stderr: result.stderr }).toEqual({ status: 0, signal: null, stderr: '' })
    const summaries = JSON.parse(result.stdout) as Array<{
      lane: string
      full: number
      shardMutants: number
      missing: number
      extra: number
      exact: boolean
      reportExact: boolean
      missingReportMutants: number
    }>
    expect(summaries.map(summary => summary.lane)).toEqual(lanes.map(lane => lane.id))
    expect(summaries.every(summary => summary.exact && summary.full === summary.shardMutants && summary.missing === 0 && summary.extra === 0)).toBe(true)
    expect(summaries.every(summary => !summary.reportExact && summary.missingReportMutants === summary.full)).toBe(true)
  }, 180_000)

  test('focused scopes follow their semantic markers instead of historical line numbers', async () => {
    const route = await loadStrykerConfig('stryker.route-certificates.config.mjs', ROOT)
    expect(route.mutate).toHaveLength(2)
    expect(scopedSource(route.mutate![0]!)).toContain('const finalizeCertificate')
    expect(scopedSource(route.mutate![0]!)).toContain('return certificates')
    expect(scopedSource(route.mutate![1]!)).toContain('ROUTE_STALE_AFTER_NODE_MOVE')

    const subgraph = await loadStrykerConfig('stryker.subgraph-routing.config.mjs', ROOT)
    expect(subgraph.mutate).toHaveLength(2)
    expect(scopedSource(subgraph.mutate![0]!)).toContain('const endpointSubgraph')
    expect(scopedSource(subgraph.mutate![0]!)).toContain('crossHierarchyEdges.push')
    expect(scopedSource(subgraph.mutate![1]!)).toContain('function deepestCommonAncestor')
  })

  test('the production oracle bridge normalizes coordinates and rejects incomplete or altered reports', () => {
    const file = 'src/agent/sequence-body.ts'
    const content = readFileSync(join(ROOT, file), 'utf8')
    const sourceLine = content.split(/\r?\n/).find(value => value.startsWith('const BLOCK_OPEN_RE ='))
    expect(sourceLine).toBeDefined()
    const line = content.split(/\r?\n/).indexOf(sourceLine!) + 1
    expect(line).toBeGreaterThan(0)
    const regexColumn = sourceLine!.indexOf('/')
    const originalRegex = sourceLine!.slice(regexColumn)
    const mutant = {
      status: 'Killed',
      // Stryker's reporter inserts end before start. The oracle fingerprint
      // must depend on coordinates, not object-key insertion order.
      location: {
        end: { line, column: regexColumn + originalRegex.length + 1 },
        start: { line, column: regexColumn + 1 },
      },
      mutatorName: 'Regex',
      replacement: originalRegex.replace('/^', '/'),
    }
    const spec = `${file}:${line}-${line}`
    const lane = { id: 'one-based-report', config: 'fixture', timeout: 1 }
    const config = { mutate: [spec] }
    const item = { name: lane.id, lane: lane.id, config: lane.config, timeout: 1, mutate: [spec], report: 'fixture.json' }
    const report = { files: { [file]: { mutants: [mutant] } } }

    expect(compareExpectedMutants(lane, config, [item], [report], ROOT)).toEqual(expect.objectContaining({
      lane: lane.id, exact: true, reportExact: true, missingReportMutants: 0, extraReportMutants: 0,
    }))

    const missing = structuredClone(report)
    missing.files[file]!.mutants = []
    expect(compareExpectedMutants(lane, config, [item], [missing], ROOT)).toEqual(expect.objectContaining({
      reportExact: false, missingReportMutants: 1, extraReportMutants: 0,
    }))

    const altered = structuredClone(report)
    altered.files[file]!.mutants[0]!.replacement = '/altered/'
    expect(compareExpectedMutants(lane, config, [item], [altered], ROOT)).toEqual(expect.objectContaining({
      reportExact: false, missingReportMutants: 1, extraReportMutants: 1,
    }))

    const duplicated = structuredClone(report)
    duplicated.files[file]!.mutants.push(structuredClone(mutant))
    expect(compareExpectedMutants(lane, config, [item], [duplicated], ROOT)).toEqual(expect.objectContaining({
      reportExact: false, missingReportMutants: 0, extraReportMutants: 1,
    }))
  })

  test('report validation enforces compatible provenance and one-based source bounds', async () => {
    const item = (await buildNightlyMutationPlan(ROOT)).find(candidate => candidate.lane === 'route-certificates')!
    const target = parseMutationTarget(item.mutate[0]!, ROOT)
    const report = {
      schemaVersion: '1.1',
      config: {
        mutate: item.mutate,
        thresholds: { break: 0 },
        jsonReporter: { fileName: `reports/mutation/${item.report}` },
      },
      files: {
        [target.file]: {
          mutants: [{
            status: 'Killed',
            mutatorName: 'BooleanLiteral',
            replacement: 'false',
            location: {
              start: { line: target.start, column: 1 },
              end: { line: target.start, column: 2 },
            },
          }],
        },
      },
    }
    expect(validateMutationReport(item, report, ROOT)).toEqual([])
    const malformedVersion = structuredClone(report)
    malformedVersion.schemaVersion = '1.bad'
    expect(validateMutationReport(item, malformedVersion, ROOT)).toEqual([
      `${item.name}: unsupported report schema 1.bad`,
    ])

    const invalid = structuredClone(report)
    invalid.schemaVersion = '2.0'
    invalid.config.mutate = [...item.mutate, item.mutate[0]!]
    invalid.config.thresholds.break = 1
    invalid.config.jsonReporter.fileName = 'wrong.json'
    invalid.files[target.file]!.mutants[0]!.location.start.line = 0
    invalid.files[target.file]!.mutants[0]!.location.end.line = 0
    expect(validateMutationReport(item, invalid, ROOT)).toEqual([
      `${item.name}: unsupported report schema 2.0`,
      `${item.name}: report mutate scope does not match the plan`,
      `${item.name}: shard report was not run with break=0`,
      `${item.name}: report filename provenance does not match ${item.report}`,
      `${item.name}: ${target.file} mutant lies outside its planned source scope`,
    ])
  })

  test('sharded lanes reject globs and ranged or column-addressed targets', () => {
    expect(() => shardMutationTargets(['src/**/*.ts'], 100, ROOT)).toThrow('must name concrete files')
    expect(() => shardMutationTargets(['src/route-contracts.ts:1-10'], 100, ROOT)).toThrow('requires a bare whole-file target')
    expect(() => parseMutationTarget('src/route-contracts.ts:1:0-10:0', ROOT)).toThrow('do not support column coordinates')
  })

  test('aggregate score counts killed and timeout as detected and rejects pending statuses', () => {
    const report = {
      files: {
        'src/example.ts': {
          mutants: [
            { status: 'Killed' },
            { status: 'Timeout' },
            { status: 'Survived' },
            { status: 'NoCoverage' },
            { status: 'CompileError' },
            { status: 'Ignored' },
            { status: 'Pending' },
          ],
        },
      },
    }
    expect(mutationScore([report])).toEqual({ detected: 2, valid: 4, excluded: 2, unknown: 1, score: 50 })
  })

  test('artifact compaction drops only repeated killed-mutant diagnostics', () => {
    const report = {
      files: {
        'src/example.ts': {
          mutants: [
            { status: 'Killed', statusReason: 'repeated full test output', killedBy: ['t1'] },
            { status: 'Timeout', statusReason: 'diagnostic timeout output' },
            { status: 'RuntimeError', statusReason: 'diagnostic error output' },
          ],
        },
      },
    }
    expect(compactMutationReport(report)).toEqual({
      files: {
        'src/example.ts': {
          mutants: [
            { status: 'Killed', killedBy: ['t1'] },
            { status: 'Timeout', statusReason: 'diagnostic timeout output' },
            { status: 'RuntimeError', statusReason: 'diagnostic error output' },
          ],
        },
      },
    })
  })

  test('aggregate floors must be finite percentages', () => {
    expect(mutationBreakFloor('valid', { thresholds: { break: 0.01 } })).toBe(0.01)
    expect(mutationBreakFloor('valid', { thresholds: { break: 100 } })).toBe(100)
    for (const floor of [undefined, 0, -1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => mutationBreakFloor('invalid', { thresholds: { break: floor } })).toThrow(
        'nightly lanes require a finite aggregate thresholds.break floor in (0, 100]',
      )
    }
  })

  test('calibration floors round down from integer evidence instead of presentation text', () => {
    expect(calibratedMutationFloor(63, 91)).toBe(69.23)
    expect(calibratedMutationFloor(2, 3)).toBe(66.66)
    expect(calibratedMutationFloor(1, 8)).toBe(12.5)
    expect(calibratedMutationFloor(0, 0)).toBe(0)
    for (const counts of [[-1, 1], [2, 1], [1.5, 2], [1, Number.POSITIVE_INFINITY]] as const) {
      expect(() => calibratedMutationFloor(counts[0], counts[1])).toThrow('Mutation floor counts must be safe integers')
    }
  })

  test('oracle options fail early when future configs need unsupported instrumentation', () => {
    expect(mutationOracleOptions('valid', {})).toEqual({ excludedMutations: [] })
    expect(mutationOracleOptions('valid', { mutator: { excludedMutations: ['BlockStatement'] } })).toEqual({
      excludedMutations: ['BlockStatement'],
    })
    expect(() => mutationOracleOptions('plugins', { mutator: { plugins: ['custom'] } })).toThrow(
      'nightly mutation oracle does not yet support custom mutator plugins',
    )
    expect(() => mutationOracleOptions('ignorers', { ignorers: ['custom'] })).toThrow(
      'nightly mutation oracle does not yet support custom ignorers',
    )
    expect(() => mutationOracleOptions('excluded', { mutator: { excludedMutations: [1] } })).toThrow(
      'mutator.excludedMutations must be an array of strings',
    )
  })
})
