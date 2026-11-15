import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOptions, runUnified } from '../unified/run.ts'

test('release child receives the exact selected baseline archive instead of an npm selector', async () => {
  const root = mkdtempSync(join(tmpdir(), 'release-baseline-controller-'))
  try {
    for (const path of ['src/__tests__', 'docs/project', 'eval/mermaid-upstream-suite-bench', 'eval/benchmark']) mkdirSync(join(root, path), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { 'bench:release': 'bun run eval/benchmark/release-fixture.ts' } }))
    writeFileSync(join(root, 'docs/project/upstream-mermaid-policy.json'), JSON.stringify({ pin: { version: 'fixture', commit: 'fixture' } }))
    writeFileSync(join(root, 'eval/mermaid-upstream-suite-bench/manifest.json'), JSON.stringify({ upstream: { revision: 'fixture' } }))
    const received = join(root, 'received.json')
    writeFileSync(join(root, 'eval/benchmark/release-fixture.ts'), `import { writeFileSync } from 'node:fs';writeFileSync(${JSON.stringify(received)}, JSON.stringify(process.argv.slice(2)));`)
    const candidate = join(root, 'candidate.tgz'), baseline = join(root, 'baseline.tgz'), digest = 'b'.repeat(64)
    const args = ['--profile', 'full', '--suites', 'release', '--candidate-tarball', candidate, '--candidate-sha256', 'a'.repeat(64), '--baseline-tarball', baseline]
    const options = parseOptions([...args, '--baseline-sha256', digest, '--out', join(root, 'complete')])
    const report = await runUnified({ ...options, root, harnessRoot: root })
    expect(report.status).toBe('passed')
    const actual: string[] = JSON.parse(readFileSync(received, 'utf8'))
    expect(actual[actual.indexOf('--baseline-tarball') + 1]).toBe(baseline)
    expect(actual[actual.indexOf('--baseline-sha256') + 1]).toBe(digest)
    expect(actual).not.toContain('--baseline-npm')
    expect(actual).not.toContain('--baseline-lock')
    rmSync(received)
    const missingDigest = parseOptions([...args, '--out', join(root, 'missing-digest')])
    const blocked = await runUnified({ ...missingDigest, root, harnessRoot: root })
    expect(blocked.suites.find(suite => suite.id === 'release')!.status).toBe('blocked')
    expect(() => readFileSync(received)).toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
