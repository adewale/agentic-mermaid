import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { committedDataIdentity } from '../unified/committed-data-identity.ts'

test('vendored TypeScript corpus inputs bind their own bytes without resolving original parser imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'benchmark-corpus-identity-'))
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    git('init', '-q')
    git('config', 'user.name', 'Benchmark fixture')
    git('config', 'user.email', 'benchmark@example.invalid')
    git('config', 'commit.gpgsign', 'false')
    mkdirSync(join(root, 'corpus'))
    const path = 'corpus/original.spec.ts'
    const source = "import { parser } from './parser/mindmap.jison'; parser.parse('mindmap\\nroot')\n"
    writeFileSync(join(root, path), source)
    writeFileSync(join(root, 'report.ts'), 'export const heading="first report"\n')
    git('add', '.')
    git('commit', '-qm', 'Committed corpus')
    const before = committedDataIdentity(root, [path])
    expect(before).toHaveLength(1)
    writeFileSync(join(root, 'report.ts'), 'export const heading="changed report"\n')
    expect(committedDataIdentity(root, [path])).toEqual(before)
    writeFileSync(join(root, path), source + '// additional original callback\n')
    expect(() => committedDataIdentity(root, [path])).toThrow('Commit benchmark corpus inputs')
    git('add', path)
    git('commit', '-qm', 'Changed corpus')
    expect(committedDataIdentity(root, [path])).not.toEqual(before)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
