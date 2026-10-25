import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { committedWorkerRows, mergeWorkerRows, readWorkerRows } from '../unified/community-worker-evidence.ts'

describe('worker crash evidence contract', () => {
  test('a real interrupted writer retains committed prefix and ignores even parseable uncommitted tail', () => {
    const directory = mkdtempSync(join(tmpdir(), 'am-worker-ledger-')),
      file = join(directory, 'progress.jsonl')
    try {
      // This child models the exact append-before-final-report contract; it never emits a final report.
      execFileSync(process.execPath, ['-e', `const fs=require('node:fs');fs.writeFileSync(process.argv[1],JSON.stringify({id:'first',status:'passed',samplesMs:[2]})+'\\n'+JSON.stringify({id:'uncommitted',status:'passed',samplesMs:[1]}));`, file])
      const result = readWorkerRows(file)
      expect(result.rows).toEqual([{ id: 'first', status: 'passed', samplesMs: [2] }])
      expect(result.ignoredTail).toBe(true)
      expect(result.errors).toEqual([])
      const truncated = committedWorkerRows(readFileSync(file, 'utf8') + '{broken')
      expect(truncated.rows.map(row => row.id)).toEqual(['first'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  test('malformed committed data cannot erase independent earlier or later committed results', () => {
    const result = committedWorkerRows('{"id":"before","status":"passed"}\n{bad}\n{"id":"after","status":"failed"}\n{"id":')
    expect(result.rows.map(row => row.id)).toEqual(['before', 'after'])
    expect(result.errors).toHaveLength(1)
    expect(result.ignoredTail).toBe(true)
  })
  test('contradictory duplicate ledgers withhold that case timing and remain failed after later repeats', () => {
    const first = { id: 'case', status: 'passed', samplesMs: [2] },
      changed = { ...first, samplesMs: [1] }
    const result = mergeWorkerRows([first, changed, first], [first, { id: 'independent', status: 'passed', samplesMs: [3] }])
    expect(result.rows.find(row => row.id === 'case')).toMatchObject({ status: 'failed' })
    expect(result.rows.find(row => row.id === 'case')?.samplesMs).toBeUndefined()
    expect(result.rows.find(row => row.id === 'independent')).toMatchObject({ status: 'passed', samplesMs: [3] })
    expect(result.errors).toEqual(['Contradictory duplicate workload: case'])
  })
  test('identical incremental/completed duplicates agree despite harmless object member order', () => {
    expect(mergeWorkerRows([{ id: 'case', status: 'passed', samplesMs: [2] }], [{ samplesMs: [2], status: 'passed', id: 'case' }])).toEqual({ rows: [{ id: 'case', status: 'passed', samplesMs: [2] }], errors: [] })
  })
})
