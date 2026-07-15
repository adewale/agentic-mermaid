import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mergeLcovTracefiles } from '../../scripts/ci/merge-lcov.ts'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function tracefile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-mermaid-lcov-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'lcov.info')
  writeFileSync(path, contents)
  return path
}

describe('CI LCOV shard merger', () => {
  test('sums line hits into one deterministic whole-suite tracefile', () => {
    const shard1 = tracefile(`TN:\nSF:src/a.ts\nFNF:2\nFNH:1\nDA:1,3\nDA:2,0\nLF:2\nLH:1\nend_of_record\n`)
    const shard2 = tracefile(`TN:\nSF:src/b.ts\nDA:4,2\nLF:1\nLH:1\nend_of_record\nTN:\nSF:src/a.ts\nDA:1,1\nDA:2,5\nLF:2\nLH:2\nend_of_record\n`)

    expect(mergeLcovTracefiles([shard2, shard1])).toBe(
      `TN:\nSF:src/a.ts\nDA:1,4\nDA:2,5\nLF:2\nLH:2\nend_of_record\n` +
      `TN:\nSF:src/b.ts\nDA:4,2\nLF:1\nLH:1\nend_of_record\n`,
    )
  })

  test('rejects conflicting checksums for the same source line', () => {
    const shard1 = tracefile(`SF:src/a.ts\nDA:1,1,aaa\nend_of_record\n`)
    const shard2 = tracefile(`SF:src/a.ts\nDA:1,1,bbb\nend_of_record\n`)
    expect(() => mergeLcovTracefiles([shard1, shard2])).toThrow('src/a.ts:1: conflicting LCOV checksums')
  })
})
