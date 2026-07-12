import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileReceiptEntries, hashFileTree, sortRepositoryPaths } from '../../scripts/pr-assets/artifact-receipt.ts'

describe('generated-artifact receipt kernel', () => {
  test('orders by normalized repository path rather than caller or locale order', () => {
    const root = '/repo'
    expect(sortRepositoryPaths(root, ['/repo/z.ts', '/repo/a/b.ts', '/repo/A.ts']))
      .toEqual(['/repo/A.ts', '/repo/a/b.ts', '/repo/z.ts'])
  })

  test('a one-byte input change invalidates both entry and tree hashes', () => {
    const root = mkdtempSync(join(tmpdir(), 'am-receipt-'))
    const file = join(root, 'input.txt')
    writeFileSync(file, 'one')
    const beforeEntry = fileReceiptEntries(root, [file])
    const beforeTree = hashFileTree(root, [file])
    writeFileSync(file, 'two')
    expect(fileReceiptEntries(root, [file])).not.toEqual(beforeEntry)
    expect(hashFileTree(root, [file])).not.toBe(beforeTree)
  })
})
