import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCatalogEligibility } from '../unified/catalog-eligibility.ts'
import { communityCoreWorkloads, installedNpmIntegrity, planCommunitySourceAliases, rankCommunityFamilyObservations, rankCommunityObservations, runCommunityCli, runCommunityNodeRound } from '../unified/community.ts'
import { runExternalCommunity } from '../unified/community-external.ts'
import type { PreparedCommunity } from '../unified/community-types.ts'
import type { BenchmarkObservation, UnifiedWorkload } from '../unified/types.ts'

const driver = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const example: UnifiedWorkload = { id: 'authored-flow', family: 'flowchart', source: 'flowchart LR\nA[Start] --> B[End]', features: [], provenance: 'independently authored admission regression', expectedLabels: ['Start', 'End'] }

describe('community benchmark artifact admission', () => {
  test('preserves external JSONL results and restarts inputs after a worker crash', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-external-progress-'))
    try {
      const executable = join(directory, 'worker.mjs')
      writeFileSync(
        executable,
        `#!/usr/bin/env node
import fs from 'node:fs';const job=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));for(const w of job.workloads){if(w.source==='CRASH')process.exit(42);fs.appendFileSync(process.argv[3],JSON.stringify({workload:w.id,status:'ok',samplesMs:[1],outputBytes:2})+'\\n')}
`,
      )
      chmodSync(executable, 0o755)
      const peer: PreparedCommunity = { node: { id: 'fixture/external', roles: ['renderer'], outputs: ['svg'], benchmark: { adapter: 'external', outputs: ['svg'] } }, artifact: { kind: 'jsonl-worker', executable, version: 'fixture' } }
      const rows = await runExternalCommunity(
        peer,
        [
          { ...example, id: 'before' },
          { ...example, id: 'crash', source: 'CRASH' },
          { ...example, id: 'after' },
        ],
        'svg',
        1,
        { root: driver, out: directory, rounds: 1, profile: 'smoke' },
      )
      expect(rows.map(row => [row.caseId, row.status])).toEqual([
        ['before', 'passed'],
        ['crash', 'failed'],
        ['after', 'passed'],
      ])
      expect(rows.find(row => row.caseId === 'after')?.metrics?.workerAttempt).toBe(2)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  test('binds physical npm lock keys and rejects ambiguous or malformed integrity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-npm-identity-'))
    try {
      const physical = join(directory, 'physical'),
        logical = join(directory, 'logical'),
        root = join(physical, 'node_modules/example-peer'),
        integrity = 'sha512-' + Buffer.alloc(64, 7).toString('base64')
      mkdirSync(root, { recursive: true })
      symlinkSync(physical, logical, 'dir')
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'example-peer', version: '1.2.3' }))
      const key = relative(logical, root),
        record = { version: '1.2.3', integrity }
      writeFileSync(join(physical, 'package-lock.json'), JSON.stringify({ packages: { [key]: record } }))
      expect(installedNpmIntegrity(logical, join(logical, 'node_modules/example-peer'), 'example-peer', '1.2.3')).toBe(integrity)
      writeFileSync(join(physical, 'package-lock.json'), JSON.stringify({ packages: { [key]: record, 'node_modules/example-peer': record } }))
      expect(() => installedNpmIntegrity(logical, root, 'example-peer', '1.2.3')).toThrow('found 2')
      writeFileSync(join(physical, 'package-lock.json'), JSON.stringify({ packages: { [key]: { ...record, integrity: 'sha512-not-canonical' } } }))
      expect(() => installedNpmIntegrity(logical, root, 'example-peer', '1.2.3')).toThrow('Noncanonical')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  test('never admits source/metadata JSON as terminal ink or a missing file as stdout', () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-cli-admission-'))
    try {
      const executable = process.execPath,
        script = join(directory, 'sidecar.js')
      writeFileSync(script, 'console.log(JSON.stringify({ text: "", source: "Start End" }))\n')
      const peer: PreparedCommunity = { node: { id: 'fixture/sidecar', roles: ['renderer'], outputs: ['ascii-unicode'], benchmark: { adapter: 'source-cli', outputs: ['terminal'] } }, artifact: { kind: 'cli', executable, args: [script], input: 'stdin', format: 'terminal', version: 'fixture' } }
      const result = runCommunityCli(peer, 'terminal', example, 1, directory)
      expect(result.status).toBe('failed')
      expect(result.detail).toContain('sidecars')
      writeFileSync(script, '')
      peer.artifact!.args = [script, '{output}']
      peer.artifact!.format = 'svg'
      writeFileSync(join(directory, 'cli-output.svg'), '<svg><text>Start End</text></svg>')
      const missing = runCommunityCli(peer, 'svg', example, 1, directory)
      expect(missing.status).toBe('failed')
      expect(missing.detail).toContain('without producing')
      expect(existsSync(join(directory, 'cli-output.svg'))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  test('rejects empty/echo ASTs and resumes remaining cases after a crashing worker', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-parser-admission-'))
    try {
      const module = join(directory, 'parser.mjs')
      writeFileSync(module, `export function parseAsync(source) { if(source==='CRASH')process.exit(42);if(source==='EMPTY')return undefined;return {type:'flowchart',code:'Start End',nodes:new Map(),links:[]}; }\n`)
      const peer: PreparedCommunity = { node: { id: 'fixture/parser', roles: ['parser'], outputs: ['ast'], benchmark: { adapter: 'mermaid-ast', outputs: ['parse'] } }, artifact: { kind: 'node', root: directory, module, version: 'fixture' } }
      const inputs: UnifiedWorkload[] = [
        { ...example, id: 'header-only', source: 'flowchart TD', expectedLabels: [] },
        { ...example, id: 'empty', source: 'EMPTY' },
        { ...example, id: 'source-echo' },
        { ...example, id: 'crash', source: 'CRASH', expectedLabels: [] },
        { ...example, id: 'after-crash', source: 'flowchart TD', expectedLabels: [] },
      ]
      const rows = await runCommunityNodeRound(peer, 'parse', inputs, 1, { root: driver, harnessRoot: driver, out: directory, rounds: 1, profile: 'smoke' })
      expect(rows.map(row => [row.caseId, row.status])).toEqual([
        ['header-only', 'passed'],
        ['empty', 'failed'],
        ['source-echo', 'failed'],
        ['crash', 'failed'],
        ['after-crash', 'passed'],
      ])
      expect(rows.find(row => row.caseId === 'source-echo')?.detail).toContain('raw source/sidecars excluded')
      expect(rows.find(row => row.caseId === 'after-crash')?.metrics?.workerAttempt).toBe(2)
      const attempts = JSON.parse(readFileSync(join(directory, 'community-raw/fixture_parser-parse-r1-attempts.json'), 'utf8'))
      expect(attempts[0].exitCode).toBe(42)
      expect(attempts[1].exitCode).toBe(0)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('matched family evidence and artifact alias guards', () => {
  test('qualifies a complete existing flowchart cohort while withholding broader/missing/duplicate/failed/zero claims', () => {
    const rows: BenchmarkObservation[] = [1, 2, 3].flatMap(round =>
      communityCoreWorkloads()
        .filter(workload => workload.family === 'flowchart')
        .map(workload => ({ suite: 'community', surface: 'node:public-api', runtime: 'fixture runtime', family: workload.family, caseId: workload.id, operation: 'render', format: 'svg', mode: 'core-api-repeat', status: 'passed', samplesMs: [4, 5, 6], metrics: { implementation: 'fixture/flow-only', round } })),
    )
    expect(rankCommunityFamilyObservations(rows, 3)[0]).toMatchObject({ family: 'flowchart', qualified: true, medianMs: 10, requiredCaseIds: ['core:flow5', 'core:tree50'] })
    expect(rankCommunityObservations(rows, 3)[0]?.qualified).toBe(false)
    expect(rankCommunityFamilyObservations(rows.slice(1), 3)[0]?.qualified).toBe(false)
    expect(rankCommunityFamilyObservations([...rows, rows[0]!], 3)[0]?.qualified).toBe(false)
    expect(
      rankCommunityFamilyObservations(
        rows.map((row, index) => (index ? row : { ...row, status: 'failed' })),
        3,
      )[0]?.qualified,
    ).toBe(false)
    expect(
      rankCommunityFamilyObservations(
        rows.map((row, index) => (index ? row : { ...row, samplesMs: [0] })),
        3,
      )[0]?.qualified,
    ).toBe(false)
    expect(
      rankCommunityFamilyObservations(
        rows.map(row => ({ ...row, metrics: { ...row.metrics, evidenceImplementation: 'fixture/representative', evidenceReuse: true } })),
        3,
      )[0],
    ).toMatchObject({ qualified: true, independentMeasurement: false, evidenceImplementation: 'fixture/representative' })
  })
  test('same Git pin and equal bytes never alias interpreted programs or different reviewed protocols', () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-artifact-alias-'))
    try {
      const module = join(directory, 'compiled-renderer.mjs'),
        bytes = 'export const admitted = true;\n'
      writeFileSync(module, bytes)
      const node = (id: string) => ({ id, outputs: ['svg'], roles: ['observed'], benchmark: { adapter: 'extra-source', sourceAdapter: 'fixture-compiled', sourcePin: 'a'.repeat(40), outputs: ['svg'] } })
      const catalog = { nodes: [node('fixture/a'), node('fixture/b')] },
        artifact = { module, sha256: createHash('sha256').update(bytes).digest('hex'), revision: 'a'.repeat(40), reviewed: true, buildRecipeId: 'reviewed-build-v1', runtimeCommandId: 'reviewed-render-v1', runtimeVersion: 'fixture-runtime1', artifactClass: 'compiled-or-shipped' as const }
      const result = createCatalogEligibility(catalog, { 'fixture/a': artifact, 'fixture/b': artifact })
      expect(result.equivalenceGroups[0]).toMatchObject({ status: 'verified-artifact-equivalence', aliases: [{ id: 'fixture/b', evidenceFrom: 'fixture/a' }] })
      const prepared = catalog.nodes.map(n => ({ node: n, artifact: { ...artifact, kind: 'node' as const, root: directory, version: 'fixture' } }))
      expect(planCommunitySourceAliases(prepared, catalog).aliases.has('fixture/b')).toBe(true)
      expect(planCommunitySourceAliases([{ ...prepared[0]! }, { ...prepared[1]!, node: { ...prepared[1]!.node, benchmark: { ...prepared[1]!.node.benchmark, terminalSubpath: 'different-public-entry' } } }], catalog).aliases.has('fixture/b')).toBe(false)
      expect(planCommunitySourceAliases([{ ...prepared[0]! }, { ...prepared[1]!, artifact: { ...prepared[1]!.artifact, global: 'differentRuntimeBinding' } }], catalog).aliases.has('fixture/b')).toBe(false)
      expect(createCatalogEligibility(catalog, { 'fixture/a': artifact, 'fixture/b': { ...artifact, sourceProgramClass: 'git-interpreted-source' } }).equivalenceGroups[0]?.status).toBe('candidate-only-no-evidence-reuse')
      expect(createCatalogEligibility(catalog, { 'fixture/a': artifact, 'fixture/b': { ...artifact, runtimeCommandId: 'other-protocol' } }).equivalenceGroups[0]?.status).toBe('candidate-only-no-evidence-reuse')
      writeFileSync(module, bytes + '// changed artifact\n')
      expect(createCatalogEligibility(catalog, { 'fixture/a': artifact, 'fixture/b': artifact }).equivalenceGroups[0]?.status).toBe('candidate-only-no-evidence-reuse')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('negative admission survives crashed workers', () => {
  test('retains first-attempt sidecar and withholds earlier core pass after contradictory restarted admission', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-negative-attempts-'))
    const referenceDir = process.env.MERMAID_REFERENCE_DIR
    // This parser fixture uses our declared jsdom, not a sibling reference checkout.
    process.env.MERMAID_REFERENCE_DIR = driver
    try {
      const module = join(directory, 'parser.mjs'),
        counter = join(directory, 'imports.txt')
      writeFileSync(
        module,
        `import fs from 'node:fs';const file=${JSON.stringify(counter)};const attempt=Number(fs.existsSync(file)?fs.readFileSync(file,'utf8'):0)+1;fs.writeFileSync(file,String(attempt));export function initialize(){};export function parse(source){if(source.startsWith('This is deliberately')){if(attempt>1)return undefined;throw Error('unknown family')}if(source==='graph LR\\n --> -->')throw Error('invalid supported grammar');if(source==='CRASH')process.exit(42);return undefined}\n`,
      )
      const peer: PreparedCommunity = { node: { id: 'fixture/negative-restart', roles: ['parser'], outputs: ['ast'], benchmark: { adapter: 'mermaid', outputs: ['parse'] } }, artifact: { kind: 'node', root: directory, module, version: 'fixture', runtime: 'Node' } }
      const rows = await runCommunityNodeRound(
        peer,
        'parse',
        [
          { ...example, id: 'core:flow5' },
          { ...example, id: 'crash', source: 'CRASH' },
          { ...example, id: 'core:tree50' },
        ],
        1,
        { root: driver, harnessRoot: driver, out: directory, rounds: 1, profile: 'smoke' },
      )
      expect(rows.find(row => row.caseId === 'core:flow5')?.status).toBe('failed')
      expect(rows.find(row => row.caseId === 'core:flow5')?.detail).toContain('negative-admission')
      expect(rows.find(row => row.caseId === 'parser-negative-admission:parser-negative-1')?.status).toBe('failed')
      const history = JSON.parse(readFileSync(join(directory, 'community-raw/fixture_negative-restart-parse-r1-negative-admission-attempts.json'), 'utf8'))
      expect(history.some((entry: any) => entry.attempt === 1 && entry.file.endsWith('.parser-admission.json') && entry.controls.length === 2)).toBe(true)
      expect(history.some((entry: any) => entry.attempt === 2 && entry.controls?.some((control: any) => control.actualAccepted === true))).toBe(true)
    } finally {
      if (referenceDir === undefined) delete process.env.MERMAID_REFERENCE_DIR
      else process.env.MERMAID_REFERENCE_DIR = referenceDir
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
