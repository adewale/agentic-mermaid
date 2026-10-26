import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactNativeArtifact, releaseNativeArtifact, restoreNativeArtifact } from '../unified/native-storage.ts'

test('compiled executable restores byte-for-byte with permissions and runs directly', () => {
  const directory = mkdtempSync(join(tmpdir(), 'am-native-storage-')),
    file = join(directory, 'true'),
    archive = join(directory, 'true.gz'),
    shipped = readFileSync('/usr/bin/true')
  try {
    copyFileSync('/usr/bin/true', file)
    chmodSync(file, 0o751)
    const proof = compactNativeArtifact(file, archive)
    expect(existsSync(file)).toBe(false)
    restoreNativeArtifact(proof)
    expect(readFileSync(file).equals(shipped)).toBe(true)
    expect(statSync(file).mode & 0o7777).toBe(0o751)
    expect(execFileSync(file).length).toBe(0)
    releaseNativeArtifact(proof)
    expect(existsSync(file)).toBe(false)
    restoreNativeArtifact(proof)
    expect(execFileSync(file).length).toBe(0)
    // A damaged archive cannot remove a valid restored executable or replace
    // its bytes during another compact/restore attempt.
    writeFileSync(archive, Buffer.from('damaged gzip'))
    expect(() => releaseNativeArtifact(proof)).toThrow()
    expect(() => restoreNativeArtifact(proof)).toThrow()
    expect(() => compactNativeArtifact(file, archive)).toThrow()
    expect(readFileSync(file).equals(shipped)).toBe(true)
    expect(execFileSync(file).length).toBe(0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
