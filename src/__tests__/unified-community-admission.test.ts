import { describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installedNpmIntegrity, runCommunityCli, runCommunityNodeRound } from '../../eval/benchmark/unified/community.ts'
import { runExternalCommunity } from '../../eval/benchmark/unified/community-external.ts'
import type { PreparedCommunity } from '../../eval/benchmark/unified/community-types.ts'
import type { UnifiedWorkload } from '../../eval/benchmark/unified/types.ts'
const driver = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
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
