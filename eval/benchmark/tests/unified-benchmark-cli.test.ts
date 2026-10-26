import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeBenchmarkDocument } from '../portable/project-records.ts'
import { parseOptions, testCounts } from '../unified/run.ts'
import { benchmarkSuites } from '../unified/suites.ts'

test('a copied Trident package builds relative outputs and runs its compiled worker without Agentic source, docs or Git', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trident-copied-package-')),
    packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    copied = join(directory, 'standalone', 'trident'),
    empty = join(directory, 'empty')
  try {
    mkdirSync(copied, { recursive: true })
    mkdirSync(empty)
    cpSync(packageDirectory, copied, {
      recursive: true,
      filter: path =>
        !relative(packageDirectory, path)
          .split(sep)
          .some(part => ['node_modules', 'dist', '__pycache__', '.cache', '.git'].includes(part)),
    })
    const require = createRequire(join(packageDirectory, 'package.json'))
    mkdirSync(join(copied, 'node_modules'))
    for (const name of ['esbuild', 'saxes']) {
      let installed = dirname(require.resolve(name))
      while (!existsSync(join(installed, 'package.json')) || JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8')).name !== name) {
        const parent = dirname(installed)
        if (parent === installed) throw Error('Installed build dependency unavailable: ' + name)
        installed = parent
      }
      symlinkSync(installed, join(copied, 'node_modules', name), 'dir')
    }
    const env = { ...process.env }
    delete env.TRIDENT_AGENTIC_ROOT
    delete env.AM_BENCH_REPOSITORY_ROOT
    const node = execFileSync(process.env.NODE_BIN ?? 'node', ['-p', 'process.execPath'], { encoding: 'utf8' }).trim()
    const missingKit = spawnSync(node, [join(copied, 'commands.ts'), 'run', '--help'], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect(missingKit.status).not.toBe(0)
    expect(missingKit.stderr).toContain('compiled kit is missing')
    const built = spawnSync(node, [join(copied, 'commands.ts'), 'build', '--out', 'portable/dist'], { cwd: empty, env, encoding: 'utf8', timeout: 30_000 })
    expect(built.status).toBe(0)
    expect(existsSync(join(copied, 'portable/dist/run.mjs'))).toBe(true)
    expect(existsSync(join(empty, 'portable/dist/run.mjs'))).toBe(false)
    expect(JSON.parse(readFileSync(join(copied, 'portable/dist/harness-artifact.json'), 'utf8')).sourceRevision).toBeNull()
    rmSync(join(copied, 'node_modules'), { recursive: true })
    const entry = spawnSync(node, [join(copied, 'commands.ts'), 'run', '--help'], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect(entry.status).toBe(0)
    const help = spawnSync(node, [join(copied, 'portable/dist/run.mjs'), '--help'], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('--artifact-root')
    const toy = join(empty, 'toy'),
      called = join(empty, 'called.txt'),
      resultFile = join(empty, 'result.json')
    mkdirSync(toy)
    writeFileSync(join(toy, 'package.json'), '{"name":"trident-copy-fixture","version":"1.0.0","type":"module"}')
    writeFileSync(join(toy, 'index.mjs'), `import{appendFileSync}from'node:fs';export function render(){appendFileSync(${JSON.stringify(called)},'actual public render\\n');return{svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="2" y="20">Visible</text></svg>'}}`)
    const plan = spawnSync(node, [join(copied, 'commands.ts'), 'run', '--project', 'fixture/trident', '--artifact-root', toy, '--adapter', 'pele', '--entry', 'index.mjs', '--out', 'plan-evidence', '--records', 'plan-records', '--plan'], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect({ status: plan.status, stderr: plan.stderr }).toEqual({ status: 0, stderr: '' })
    expect(JSON.parse(plan.stdout).action).toBe('measure')
    expect(existsSync(called)).toBe(false)
    const job = join(empty, 'job.json')
    writeFileSync(
      job,
      JSON.stringify({
        artifact: { project: 'fixture/trident', root: toy, entry: join(toy, 'index.mjs'), version: '1.0.0', adapter: 'pele' },
        testCase: { id: 'standalone-render', family: 'flowchart', cohort: 'family', source: 'flowchart LR\nA[Visible]', expected: { accept: true, labels: ['Visible'] } },
        mode: 'cold',
        samples: 1,
        round: 1,
        replica: 'B',
        sample: 0,
        resultFile,
      }),
    )
    const rendered = spawnSync(node, [join(copied, 'portable/dist/worker.mjs'), job], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect({ status: rendered.status, stderr: rendered.stderr }).toEqual({ status: 0, stderr: '' })
    const result = JSON.parse(readFileSync(resultFile, 'utf8'))
    expect(readFileSync(called, 'utf8')).toBe('actual public render\n')
    expect(result.qualification.accepted).toBe(true)
    expect(result.qualification.checks.filter((check: any) => check.status === 'failed')).toEqual([])
    expect(result.qualification.checks.find((check: any) => check.name === 'label:Visible')?.status).toBe('passed')
    expect(result.qualification.semanticComplete).toBe(false)
    expect(result.tracks['first-use']).toHaveLength(1)
    const campaign = join(empty, 'campaign'), records = join(empty, 'records')
    const campaignArgs = ['--project', 'fixture/trident', '--artifact-root', toy, '--adapter', 'pele', '--entry', 'index.mjs', '--node', node, '--out', campaign, '--records', records, '--rounds', '1', '--samples', '1', '--cold-samples', '1', '--min-sample-ms', '0', '--preparation-concurrency', '1', '--cohort', 'invalid', '--allow-partial']
    const measured = spawnSync(node, [join(copied, 'commands.ts'), 'run', ...campaignArgs], { cwd: empty, env, encoding: 'utf8', timeout: 25_000 })
    // This intentionally permissive toy accepts invalid sources: the failed
    // record is retained, never promoted to a successful fidelity result.
    expect(measured.status).toBe(1)
    const first = JSON.parse(measured.stdout.slice(measured.stdout.lastIndexOf('\n{\n') + 1)), callsBeforeReuse = readFileSync(called, 'utf8')
    expect(first.reused).toBe(false)
    const cached = spawnSync(node, [join(copied, 'commands.ts'), 'run', ...campaignArgs], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect(cached.status).toBe(1)
    const second = JSON.parse(cached.stdout)
    expect(second.reused).toBe(true)
    expect(second.recordId).toBe(first.recordId)
    expect(readFileSync(called, 'utf8')).toBe(callsBeforeReuse)
    const indexFile = join(records, 'current.json'), indexBefore = readFileSync(indexFile), cancelScript = join(empty, 'cancel-cached.mjs')
    writeFileSync(cancelScript, `import{parsePortableOptions,runPortable}from${JSON.stringify(pathToFileURL(join(copied, 'portable/dist/run.mjs')).href)};import{PortableCancelled,terminatePortableWorkers}from${JSON.stringify(pathToFileURL(join(copied, 'portable/dist/execution.mjs')).href)};process.once('SIGTERM',terminatePortableWorkers);process.kill(process.pid,'SIGTERM');try{await runPortable(parsePortableOptions(${JSON.stringify(campaignArgs)}));throw Error('Cached campaign ignored pending cancellation')}catch(error){if(!(error instanceof PortableCancelled))throw error;console.log('cancelled')}`)
    const cancelled = spawnSync(node, [cancelScript], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect({ status: cancelled.status, stdout: cancelled.stdout.trim(), stderr: cancelled.stderr }).toEqual({ status: 0, stdout: 'cancelled', stderr: '' })
    expect(readFileSync(called, 'utf8')).toBe(callsBeforeReuse)
    expect(readFileSync(indexFile).equals(indexBefore)).toBe(true)
    const core = join(empty, 'core.json'),
      comparison = join(empty, 'comparison')
    writeFileSync(
      core,
      JSON.stringify({
        criteriaProtocol: { producers: ['authored-reader-fixture'] },
        cases: [{ id: 'reader-case', family: 'flowchart', required: true, source: 'flowchart LR\nA[Visible]', expected: { labels: ['Visible'] } }],
        targets: [{ project: 'mermaid-js/mermaid' }],
        toolVersions: [{ tool: 'mermaid-js/mermaid', version: '12.2.0', source: 'authored-reader-fixture' }],
        observations: [],
        artifacts: [],
      }),
    )
    const reported = spawnSync(node, [join(copied, 'commands.ts'), 'fidelity:report', '--core', core, '--out', comparison], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect({ status: reported.status, stderr: reported.stderr }).toEqual({ status: 0, stderr: '' })
    const document = join(comparison, 'comparison.json'),
      original = readFileSync(document, 'utf8')
    const exported = spawnSync(node, [join(copied, 'commands.ts'), 'export', '--input', document], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect({ status: exported.status, stderr: exported.stderr }).toEqual({ status: 0, stderr: '' })
    expect(JSON.parse(exported.stdout).declaredCaseCount).toBe(1)
    const fresh = join(empty, 'full.json'),
      written = spawnSync(node, [join(copied, 'commands.ts'), 'export', '--input', document, '--out', fresh], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect(written.status).toBe(0)
    expect(JSON.parse(readFileSync(fresh, 'utf8')).declaredCaseCount).toBe(1)
    const clobber = spawnSync(node, [join(copied, 'commands.ts'), 'export', '--input', document, '--out', document], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect(clobber.status).not.toBe(0)
    expect(readFileSync(document, 'utf8')).toBe(original)
    const missing = spawnSync(process.execPath, [join(copied, 'commands.ts'), 'agentic', '--list'], { cwd: empty, env, encoding: 'utf8', timeout: 10_000 })
    expect(missing.status).not.toBe(0)
    expect(missing.stderr).toContain('Optional Agentic source adapter unavailable')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 45_000)

test('an explicit Agentic adapter runs its own checkout protocol with the original arguments', () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'trident-agentic-adapter-'))),
    source = join(directory, 'source'),
    command = resolve(dirname(fileURLToPath(import.meta.url)), '../commands.ts')
  try {
    mkdirSync(join(source, 'eval/benchmark/unified'), { recursive: true })
    writeFileSync(join(source, 'package.json'), '{"name":"agentic-mermaid"}')
    writeFileSync(join(source, 'eval/benchmark/unified/run.ts'), 'console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))')
    for (const variable of ['TRIDENT_AGENTIC_ROOT', 'AM_BENCH_REPOSITORY_ROOT']) {
      const env = { ...process.env }
      delete env.TRIDENT_AGENTIC_ROOT
      delete env.AM_BENCH_REPOSITORY_ROOT
      env[variable] = source
      const result = spawnSync(process.execPath, [command, 'bench', '--list', '--profile', 'full'], { cwd: directory, env, encoding: 'utf8', timeout: 10_000 })
      expect(result.status).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ cwd: source, args: ['--list', '--profile', 'full'] })
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('unified benchmark CLI preflight', () => {
  test('advance-from admits a recorded target from both plain and compressed reports before checking the new candidate', async () => {
    const { main } = await import('../unified/community-campaign.ts')
    const directory = mkdtempSync(join(tmpdir(), 'trident-advance-document-'))
    try {
      for (const encoding of ['plain', 'compressed']) {
        const original = join(directory, encoding); mkdirSync(original)
        const archive = join(original, 'original-archive.bin'), bytes = Buffer.from('retained archive bytes')
        writeFileSync(archive, bytes)
        writeFileSync(join(original, 'invocation.json'), JSON.stringify({ root: original, packageRoot: join(original, 'package'), candidateTarball: archive, candidateSha256: createHash('sha256').update(bytes).digest('hex') }))
        const report = { targetRevision: 'retained-target-revision' }, path = join(original, 'report.json')
        if (encoding === 'plain') writeFileSync(path, JSON.stringify(report))
        else writeBenchmarkDocument(path, report)
        await expect(main(['--prepare-only', '--advance-from', original, '--out', join(original, 'new-run')])).rejects.toThrow('A target advance requires --package-root, --candidate-tarball and --candidate-sha256')
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
  test('sums independent owning-process summaries while retaining ordinary single summaries', () => {
    expect(testCounts('\n 8 pass\n 0 fail\n 12 expect() calls\n')).toEqual({ passed: 8, failed: 0, skipped: 0, assertions: 12 })
    expect(testCounts('\u001b[32m\n 8 pass\n 0 fail\n 12 expect() calls\n\u001b[0m\n 3 pass\n 1 fail\n 2 skip\n 9 expect() calls\n')).toEqual({ passed: 11, failed: 1, skipped: 2, assertions: 21 })
    expect(testCounts('A process started without reporting any completed tests')).toBeUndefined()
  })
  test('rejects invalid execution requests before any suite can launch', () => {
    expect(() => parseOptions(['--profile', 'quick'])).toThrow('--profile')
    expect(() => parseOptions(['--rounds', '0'])).toThrow('--rounds')
    expect(() => parseOptions(['--timeout-ms', 'NaN'])).toThrow('--timeout-ms')
    expect(() => parseOptions(['--rounds', '3', '--rounds', '4'])).toThrow('Duplicate')
    expect(() => parseOptions(['--suites', 'family,,invocation'])).toThrow('--suites')
    expect(() => parseOptions(['--unknown', 'value'])).toThrow('Invalid option')
    expect(() => parseOptions(['--out'])).toThrow('Invalid option')
    expect(() => parseOptions(['--baseline', '/tmp/base', '--baseline-npm', 'latest'])).toThrow('not both')
    expect(() => parseOptions(['--baseline-lock', '/tmp/lock.json', '--baseline-tarball', '/tmp/base.tgz'])).toThrow('not both')
  })
  test('retains different target, installed artifact and output roots', () => {
    const options = parseOptions(['--target', '/tmp/source candidate', '--package-root', '/tmp/installed package', '--out', '/tmp/evidence', '--ownership-site', '/tmp/frozen ownership pair', '--profile', 'full', '--suites', 'family,invocation'])
    expect(options.root).toBe(resolve('/tmp/source candidate'))
    expect(options.packageRoot).toBe(resolve('/tmp/installed package'))
    expect(options.out).toBe(resolve('/tmp/evidence'))
    expect(options.ownershipSite).toBe(resolve('/tmp/frozen ownership pair'))
    expect(options.harnessRoot).not.toBe(options.root)
    expect(options.rounds).toBe(3)
    expect(options.selected).toEqual(['family', 'invocation'])
  })
  test('binds artifact digests to tarball requests rather than source paths', () => {
    expect(() => parseOptions(['--candidate-sha256', 'a'.repeat(64)])).toThrow('requires its tarball')
    expect(() => parseOptions(['--baseline-tarball', '/tmp/package.tgz', '--baseline-sha256', 'A'.repeat(64)])).toThrow('lowercase SHA-256')
    const options = parseOptions(['--candidate-tarball', '/tmp/package.tgz', '--candidate-sha256', 'a'.repeat(64)])
    expect(options.candidateTarball).toBe('/tmp/package.tgz')
    expect(options.candidateSha256).toBe('a'.repeat(64))
  })
  test('Dave measures the supplied artifact without rebuilding the driver checkout', () => {
    const options = parseOptions(['--candidate-tarball', '/tmp/candidate.tgz', '--candidate-sha256', 'a'.repeat(64)])
    const dave = benchmarkSuites(options).find(suite => suite.id === 'dave')!
    expect(dave.command?.slice(0, 3)).toEqual(['bun', 'run', 'eval/benchmark/release-browser-bench.ts'])
    expect(dave.command).toContain('/tmp/candidate.tgz')
    expect(dave.command).toContain('a'.repeat(64))
    expect(dave.command?.slice(dave.command.indexOf('--warmup'), dave.command.indexOf('--warmup') + 2)).toEqual(['--warmup', '30'])
  })
})

describe('unified suite execution lifecycle', () => {
  test('continues after a timeout and retains both failures and later evidence', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { runUnified } = await import('../unified/run.ts')
    const directory = mkdtempSync(join(tmpdir(), 'am-unified-lifecycle-'))
    const detachedPid = join(directory, 'detached.pid')
    try {
      for (const path of ['src/__tests__', 'docs/project', 'eval/mermaid-upstream-suite-bench', 'eval/agent-usage']) mkdirSync(join(directory, path), { recursive: true })
      writeFileSync(join(directory, 'docs/project/upstream-mermaid-policy.json'), JSON.stringify({ pin: { version: 'fixture', commit: 'fixture' } }))
      writeFileSync(join(directory, 'eval/mermaid-upstream-suite-bench/manifest.json'), JSON.stringify({ upstream: { revision: 'fixture' } }))
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { 'bench:slow-fixture': 'bun run slow.ts', 'bench:after-fixture': 'bun run after.ts', 'bench:incomplete-fixture': 'bun run incomplete.ts', 'bench:uncalibrated-fixture': 'bun run uncalibrated.ts', 'bench:plain-failure-fixture': 'bun run plain-failure.ts', 'bench:compressed-failure-fixture': 'bun run compressed-failure.ts' } }))
      writeFileSync(join(directory, 'eval/agent-usage/live.ts'), 'throw new Error("blocked provider must never launch")\n')
      writeFileSync(join(directory, 'grandchild.ts'), 'setInterval(() => {}, 1000)\n')
      writeFileSync(
        join(directory, 'slow.ts'),
        process.platform === 'linux'
          ? `import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const child=spawn(process.execPath,['run',${JSON.stringify(join(directory, 'grandchild.ts'))}],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(detachedPid)},String(child.pid));setInterval(()=>{},1000)\n`
          : 'setInterval(() => {}, 1000)\n',
      )
      writeFileSync(join(directory, 'incomplete.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/qualification-status.json",JSON.stringify({status:"incomplete"}))\n')
      writeFileSync(join(directory, 'uncalibrated.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/qualification-status.json",JSON.stringify({status:"uncalibrated",complete:true}))\n')
      writeFileSync(join(directory, 'after.ts'), 'console.log("later suite completed")\n')
      writeFileSync(join(directory, 'plain-failure.ts'), 'import{writeFileSync}from"node:fs";writeFileSync(process.env.AM_BENCH_SUITE_OUT+"/report.json",JSON.stringify({status:"failed"}))')
      const documents = fileURLToPath(new URL('../portable/project-records.ts', import.meta.url))
      writeFileSync(join(directory, 'compressed-failure.ts'), `import{writeBenchmarkDocument}from${JSON.stringify(documents)};writeBenchmarkDocument(process.env.AM_BENCH_SUITE_OUT+"/report.json",{status:"failed"})`)
      const options = parseOptions(['--out', join(directory, 'evidence'), '--suites', 'slow-fixture,agent-live,incomplete-fixture,uncalibrated-fixture,plain-failure-fixture,compressed-failure-fixture,after-fixture', '--timeout-ms', '800'])
      const report = await runUnified({ ...options, harnessRoot: directory, root: directory })
      const slow = report.suites.find(suite => suite.id === 'slow-fixture')!
      const after = report.suites.find(suite => suite.id === 'after-fixture')!
      expect(report.status).toBe('failed')
      expect(slow.status).toBe('failed')
      expect(slow.timedOut).toBe(true)
      if (process.platform === 'linux') {
        const pid = Number(readFileSync(detachedPid, 'utf8'))
        let state: string | undefined
        try {
          const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
          state = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[0]
        } catch {}
        expect(state === undefined || state === 'Z').toBe(true)
      }
      expect(after.status).toBe('passed')
      const unavailable = report.suites.find(suite => suite.id === 'agent-live')!
      expect(unavailable.status).toBe('blocked')
      expect(unavailable.elapsedMs).toBeUndefined()
      expect(unavailable.result?.observations).toEqual([])
      const incomplete = report.suites.find(suite => suite.id === 'incomplete-fixture')!
      expect(incomplete.exitCode).toBe(0)
      expect(incomplete.status).toBe('blocked')
      expect(incomplete.result?.gaps.join(' ')).toContain('declares incomplete')
      const uncalibrated = report.suites.find(suite => suite.id === 'uncalibrated-fixture')!
      expect(uncalibrated.exitCode).toBe(0)
      expect(uncalibrated.status).toBe('blocked')
      expect(uncalibrated.result?.gaps.join(' ')).toContain('declares uncalibrated')
      for (const id of ['plain-failure-fixture', 'compressed-failure-fixture']) {
        const failed = report.suites.find(suite => suite.id === id)!
        expect(failed.exitCode).toBe(0)
        expect(failed.status).toBe('failed')
        expect(failed.result?.gaps.join(' ')).toContain('declares failed qualification')
      }
      expect(readFileSync(join(options.out, after.log!), 'utf8')).toContain('later suite completed')
      expect(existsSync(join(options.out, 'report.json'))).toBe(true)
      const cancelling = runUnified({ ...options, harnessRoot: directory, root: directory, out: join(directory, 'cancelled'), timeoutMs: 5000, selected: ['slow-fixture', 'after-fixture'] })
      process.emit('SIGTERM')
      const cancelled = await cancelling
      expect(cancelled.suites.find(suite => suite.id === 'slow-fixture')?.status).toBe('failed')
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.status).toBe('blocked')
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.elapsedMs).toBeUndefined()
      expect(cancelled.suites.find(suite => suite.id === 'after-fixture')?.result?.gaps.join(' ')).toContain('SIGTERM')
    } finally {
      try {
        process.kill(Number(readFileSync(detachedPid, 'utf8')), 'SIGKILL')
      } catch {}
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
