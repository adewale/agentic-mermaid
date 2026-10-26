import { afterEach, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { communityProtocolIdentity } from '../unified/community-protocol-identity.ts'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'community-protocol-'))
  directories.push(root)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const put = (path: string, value: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), value)
  }
  const commit = () => {
    git('add', '.')
    git('-c', 'user.name=Benchmark test', '-c', 'user.email=benchmark@example.test', 'commit', '-qm', 'fixture')
  }
  git('init', '-q')
  put('eval/benchmark/unified/community.ts', "import { measure } from './clock-helper.ts'; export const run = measure\n")
  put('eval/benchmark/unified/clock-helper.ts', 'export const measure = () => 1\n')
  put('eval/benchmark/unified/report.ts', 'export const report = 1\n')
  put('eval/benchmark/tests/community.test.ts', '// unrelated tests\n')
  put('eval/benchmark/unified/family-suite.ts', 'export const familySuite = 1\n')
  put('eval/benchmark/portable/worker.mjs', 'export const otherLane = 1\n')
  put('docs/benchmark.md', 'Overview\n')
  commit()
  return { root, put, commit }
}

test('producer and transitively imported helper changes invalidate retained community clocks', () => {
  const f = fixture()
  const before = communityProtocolIdentity(f.root)
  f.put('eval/benchmark/unified/clock-helper.ts', 'export const measure = () => 2\n')
  expect(() => communityProtocolIdentity(f.root)).toThrow('Commit community measurement')
  f.commit()
  const helperChanged = communityProtocolIdentity(f.root)
  expect(helperChanged).not.toEqual(before)
  f.put('eval/benchmark/unified/community.ts', "import { measure } from './clock-helper.ts'; export const run = () => measure() * 2\n")
  expect(() => communityProtocolIdentity(f.root)).toThrow('Commit community measurement')
  f.commit()
  expect(communityProtocolIdentity(f.root)).not.toEqual(helperChanged)
})

test('dirty and committed reports, tests, documentation and independent suites retain the identity', () => {
  const f = fixture()
  const before = communityProtocolIdentity(f.root)
  f.put('eval/benchmark/unified/report.ts', 'export const report = 2\n')
  f.put('eval/benchmark/tests/community.test.ts', '// revised tests\n')
  f.put('eval/benchmark/unified/family-suite.ts', 'export const familySuite = 2\n')
  f.put('eval/benchmark/portable/worker.mjs', 'export const otherLane = 2\n')
  f.put('docs/benchmark.md', 'Updated overview\n')
  expect(communityProtocolIdentity(f.root)).toEqual(before)
  f.commit()
  expect(communityProtocolIdentity(f.root)).toEqual(before)
})

test('a new runtime helper is bound immediately, including dynamic imports; type-only dependencies are excluded', () => {
  const f = fixture()
  f.put('eval/benchmark/unified/community.ts', "import type { Report } from './report.ts'; export const run = () => import('./new-helper.ts')\n")
  f.put('eval/benchmark/unified/new-helper.ts', 'export const measure = () => 1\n')
  expect(() => communityProtocolIdentity(f.root)).toThrow('Commit community measurement')
  f.commit()
  const before = communityProtocolIdentity(f.root)
  f.put('eval/benchmark/unified/report.ts', 'export interface Report { rows: number }\n')
  expect(communityProtocolIdentity(f.root)).toEqual(before)
  f.put('eval/benchmark/unified/new-helper.ts', 'export const measure = () => 2\n')
  expect(() => communityProtocolIdentity(f.root)).toThrow('Commit community measurement')
})
