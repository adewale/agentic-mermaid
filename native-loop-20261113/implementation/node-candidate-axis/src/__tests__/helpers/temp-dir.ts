// Per-file temporary directories that are removed after the file's tests, so
// suites stop leaking fixtures into the shared OS temp root.

import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TempDirs {
  /** A fresh directory under the OS temp root, removed after the file's tests. */
  dir(prefix?: string): string
  /** Write `content` to `name` inside a fresh directory and return its path. */
  file(name: string, content: string): string
}

/** Call once at a test file's top level; registers the cleanup hook. */
export function useTempDirs(prefix = 'am-test-'): TempDirs {
  const created: string[] = []
  afterAll(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const dir = (dirPrefix = prefix): string => {
    const path = mkdtempSync(join(tmpdir(), dirPrefix))
    created.push(path)
    return path
  }
  return {
    dir,
    file(name, content) {
      const path = join(dir(), name)
      writeFileSync(path, content)
      return path
    },
  }
}
