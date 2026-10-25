import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, watch, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mutationWitnessForFamily } from './family-suite.ts'
import { runInvocationBrowser } from './invocation-browser.ts'
import { runInvocationMcp } from './invocation-mcp.ts'
import { qualifyOutput, withReferenceLabels } from './qualification.ts'
import type { BenchmarkObservation, UnifiedRunOptions, UnifiedSuiteResult, UnifiedWorkload } from './types.ts'
import { unifiedWorkloads } from './workloads.ts'

export interface InvocationOptions extends UnifiedRunOptions {
  nodeExecutable?: string
  bunExecutable?: string
  packageRoot?: string
  harnessRoot?: string
  workloads?: readonly UnifiedWorkload[]
  libraryExports?: readonly string[]
  surfaces?: readonly ('library' | 'cli' | 'mcp' | 'browser')[]
}
let invocationRuntime = process.versions.bun ? `bun:${process.versions.bun}` : `node:${process.versions.node}`
export const invocationHarnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
export function invocationRow(surface: string, w: UnifiedWorkload, operation: string, format: string, mode: string): BenchmarkObservation {
  return { suite: 'invocation', surface, runtime: invocationRuntime, family: w.family, caseId: w.id, operation, format, mode, status: 'passed' }
}
export function entryImport(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return entryImport(v.import ?? v.default)
  }
  return undefined
}
function selectedLibraryEntries(pkg: { exports?: Record<string, unknown> }, selection?: readonly string[]) {
  const eligible = Object.entries(pkg.exports ?? {}).filter(([name, spec]) => {
    const path = entryImport(spec)
    return path && !path.endsWith('.json') && !name.startsWith('./browser')
  })
  if (selection) {
    const unknown = selection.filter(name => !eligible.some(([key]) => key === name))
    if (unknown.length || selection.length === 0) throw Error(`Unknown or non-library package exports: ${unknown.join(', ') || '(empty selection)'}`)
  }
  return eligible.filter(([name]) => !selection || selection.includes(name))
}
export function decodeToolPayload(result: any): any {
  if (result?.isError) throw Error(JSON.stringify(result.content))
  const text = result?.content
    ?.filter((v: any) => v.type === 'text')
    .map((v: any) => v.text)
    .join('\n')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return text
  }
  if (value?.ok === false) throw Error(JSON.stringify(value.error ?? value))
  return value?.value ?? value
}
export async function childCommand(command: string, args: string[], options: { cwd: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; processGroup?: boolean }): Promise<{ code: number | null; stdout: Buffer; stderr: string; wallMs: number }> {
  return await new Promise(resolve => {
    const started = performance.now(),
      child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, detached: options.processGroup && process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }),
      out: Buffer[] = [],
      err: Buffer[] = []
    let settled = false,
      abortedCode: number | undefined,
      force: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals = 'SIGKILL') => {
      try {
        if (options.processGroup && process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {}
    }
    const abort = (code: number) => {
      abortedCode = code
      kill('SIGTERM')
      force ??= setTimeout(() => {
        kill('SIGKILL')
        process.exit(code)
      }, 2000)
    }
    const terminate = () => abort(143),
      interrupt = () => abort(130)
    if (options.processGroup) {
      process.once('SIGTERM', terminate)
      process.once('SIGINT', interrupt)
    }
    const timer = setTimeout(() => kill(), options.timeoutMs ?? 120_000)
    child.stdout.on('data', b => out.push(Buffer.from(b)))
    child.stderr.on('data', b => err.push(Buffer.from(b)))
    const finish = (code: number | null, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (force) clearTimeout(force)
      if (options.processGroup) {
        process.off('SIGTERM', terminate)
        process.off('SIGINT', interrupt)
      }
      if (abortedCode) {
        kill('SIGKILL') // Keep the group ID until descendants are gone even if its leader closed early.
        process.exit(abortedCode)
      }
      resolve({ code, stdout: Buffer.concat(out), stderr: [Buffer.concat(err).toString(), error ? String(error) : ''].join(''), wallMs: performance.now() - started })
    }
    child.stdin.on('error', () => {})
    child.on('error', error => finish(null, error))
    child.on('close', code => finish(code))
    child.stdin.end(options.input ?? '')
  })
}
/** Bundle helpers may move; their independent dependency lookup must remain owned by the harness. */
export async function buildInvocationLibraryHarness(options: { out: string; harnessRoot?: string }) {
  const harnessRoot = resolve(options.harnessRoot ?? invocationHarnessRoot),
    require = createRequire(join(harnessRoot, 'package.json')),
    esbuild = require('esbuild'),
    workerSource = join(harnessRoot, 'eval/benchmark/unified/invocation-library-worker.ts'),
    qualifierSource = join(harnessRoot, 'eval/benchmark/unified/qualification.ts'),
    qualifierAnchor = pathToFileURL(qualifierSource).href,
    qualificationRequire = createRequire(qualifierAnchor),
    saxesModule = qualificationRequire.resolve('saxes'),
    saxesPackageJson = qualificationRequire.resolve('saxes/package.json'),
    saxesVersion = String(qualificationRequire('saxes/package.json').version),
    worker = join(options.out, 'installed-library-worker.mjs'),
    qualifier = join(options.out, 'artifact-qualifier.mjs'),
    provenanceFile = join(options.out, 'qualification-dependencies.json')
  mkdirSync(options.out, { recursive: true })
  await esbuild.build({ entryPoints: [workerSource], outfile: worker, bundle: true, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' })
  // createRequire(import.meta.url) belongs to qualification.ts, even when its bundle
  // is emitted beneath an isolated result directory without development dependencies.
  await esbuild.build({ entryPoints: [qualifierSource], outfile: qualifier, bundle: true, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent', define: { 'import.meta.url': JSON.stringify(qualifierAnchor) } })
  const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')
  const provenance = {
    harnessRoot,
    qualificationSource: qualifierSource,
    moduleResolutionAnchor: qualifierAnchor,
    nodeXmlParser: { name: 'saxes', version: saxesVersion, module: saxesModule, packageJson: saxesPackageJson },
    bundle: { path: qualifier, sha256: digest(qualifier) },
    worker: { path: worker, sha256: digest(worker) },
    policy: 'Independent validation resolves from the actual harness source. Candidate packages receive no validation dependency. Qualifier load and XML parsing remain after stopped production API clocks.',
  }
  writeFileSync(provenanceFile, JSON.stringify(provenance, null, 2))
  return { worker, qualifier, provenanceFile, provenance }
}
async function library(options: InvocationOptions, workloads: UnifiedWorkload[]): Promise<{ rows: BenchmarkObservation[]; gaps: string[]; artifacts: string[] }> {
  const root = options.packageRoot ?? options.root,
    out = join(options.out, 'library')
  mkdirSync(out, { recursive: true })
  const rows: BenchmarkObservation[] = [],
    gaps: string[] = [],
    artifacts: string[] = [],
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const eligible = selectedLibraryEntries(pkg, options.libraryExports)
  const { worker, qualifier, provenanceFile } = await buildInvocationLibraryHarness({ out, harnessRoot: options.harnessRoot })
  artifacts.push(provenanceFile)
  const runtimes = [
    { name: 'node', command: options.nodeExecutable ?? 'node', args: ['--expose-gc'] },
    { name: 'bun', command: options.bunExecutable ?? (process.versions.bun ? process.execPath : 'bun'), args: [] },
  ]
  if (process.env.NODE22_EXECUTABLE) runtimes.push({ name: 'node22', command: process.env.NODE22_EXECUTABLE, args: ['--expose-gc'] })
  else gaps.push('Minimum supported Node22 is not configured; set NODE22_EXECUTABLE to enroll a separate real Node22 installed-artifact run. Node24 and Bun are distinct observed runtimes.')
  for (const [name, spec] of eligible) {
    const path = entryImport(spec)
    if (!path || path.endsWith('.json') || name.startsWith('./browser')) continue
    const entry = join(root, path)
    if (!existsSync(entry)) {
      rows.push({ ...invocationRow(`library:${name}`, workloads[0]!, 'import', 'module', 'fresh-process'), family: '*', caseId: 'package-import', status: 'blocked', detail: `Missing built package entry ${path}; build/pack the candidate first.` })
      continue
    }
    for (const runtime of runtimes)
      for (let round = 1; round <= options.rounds; round++) {
        const stem = runtime.name + '-' + (name === '.' ? 'root' : name.replaceAll('/', '_').replaceAll('.', '')),
          result = join(out, `${stem}-${round}.json`),
          job = join(out, `${stem}-${round}.job.json`)
        rmSync(result, { force: true })
        writeFileSync(job, JSON.stringify({ root, entry, qualifier, exportName: name, workloads, full: options.profile === 'full', out: result, round }))
        const child = await childCommand(runtime.command, [...runtime.args, worker, job], { cwd: root, timeoutMs: options.profile === 'full' ? 30 * 60_000 : 10 * 60_000 })
        writeFileSync(join(out, `${stem}-${round}.log`), child.stderr)
        artifacts.push(result)
        if (existsSync(result)) {
          const data = JSON.parse(readFileSync(result, 'utf8'))
          rows.push(...data.rows)
          if (data.error) gaps.push(`${name}: ${data.error}`)
        }
        if (child.code !== 0) rows.push({ ...invocationRow(`library:${name}`, workloads[0]!, 'worker', 'module', 'fresh-process'), family: '*', caseId: `worker-${round}`, status: 'failed', detail: child.stderr || `worker exited ${child.code}` })
      }
  }
  return { rows, gaps, artifacts }
}
function changedAuthoredTitle(source: string, title: string): string {
  if (/^\s*accTitle\s*:/im.test(source)) return source.replace(/^\s*accTitle\s*:.*$/im, `accTitle: ${title}`)
  const lines = source.split('\n')
  let header = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex(line => line.trim() === '---')
    if (end >= 0) header = end + 2
  }
  while (header < lines.length && (!lines[header]!.trim() || lines[header]!.trim().startsWith('%%'))) header++
  lines.splice(header + 1, 0, `accTitle: ${title}`)
  return lines.join('\n')
}
export async function awaitInvocationArtifact(file: string, marker: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<string> {
  return await new Promise((resolve, reject) => {
    let observer: ReturnType<typeof watch> | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      settled = false
    const cleanup = () => {
      observer?.close()
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true
        cleanup()
        reject(error)
      }
    }
    const abort = () => fail(Error('Artifact watch cancelled'))
    const check = () => {
      if (settled || !existsSync(file)) return
      try {
        const text = readFileSync(file, 'utf8')
        if (!text.includes(marker) || !text.trimEnd().endsWith('</svg>')) return
        settled = true
        cleanup()
        resolve(text)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') fail(error)
      }
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    try {
      observer = watch(dirname(file), check)
      observer.on('error', fail)
      timer = setTimeout(() => fail(Error('Watch did not emit current authored artifact')), timeoutMs)
      check()
    } catch (error) {
      fail(error)
    }
  })
}
/** Shared installed/native render protocol. Readback and independent admission follow the stopped process clock. */
export async function runCliRenderInvocation(options: { command: string; prefix: readonly string[]; cwd: string; out: string; sourceFile: string; workload: UnifiedWorkload; format: string; inputMode: string; rounds: number; surface: string; runtime: string }) {
  mkdirSync(options.out, { recursive: true })
  const w = options.workload,
    row = invocationRow(options.surface, w, 'render', options.format, 'process-to-artifact'),
    artifacts: string[] = [],
    roundEvidence: { round: number; status: string; wallMs?: number; exitCode?: number | null; bytes?: number; detail?: string }[] = []
  row.runtime = options.runtime
  row.samplesMs = []
  for (let round = 1; round <= options.rounds; round++) {
    const outputFile = join(options.out, `${w.family}-${options.format}-${options.inputMode}-${round}.${options.format === 'png' ? 'png' : 'out'}`)
    rmSync(outputFile, { force: true })
    let result: Awaited<ReturnType<typeof childCommand>> | undefined
    try {
      result = await childCommand(options.command, [...options.prefix, 'render', options.inputMode === 'file' ? options.sourceFile : '-', '--format', options.format, '--output', outputFile], { cwd: options.cwd, input: options.inputMode === 'stdin' ? w.source : undefined })
      if (result.code !== 0) throw Error(result.stderr || result.stdout.toString() || `exit ${result.code}`)
      if (!existsSync(outputFile)) throw Error('CLI reported success without requested artifact')
      const bytes = readFileSync(outputFile),
        value = options.format === 'png' ? new Uint8Array(bytes) : options.format === 'layout' ? JSON.parse(bytes.toString()) : bytes.toString(),
        q = qualifyOutput(w, value, options.format)
      if (!q.ok) throw Error(q.findings.join('; '))
      row.samplesMs.push(result.wallMs)
      row.bytes = bytes.length
      roundEvidence.push({ round, status: 'passed', wallMs: result.wallMs, exitCode: result.code, bytes: bytes.length })
      artifacts.push(outputFile)
    } catch (error) {
      row.status = 'failed'
      row.detail = String(error)
      roundEvidence.push({ round, status: 'failed', ...(result ? { wallMs: result.wallMs, exitCode: result.code } : {}), detail: String(error) })
    }
  }
  const evidenceFile = join(options.out, `${w.family}-${options.format}-${options.inputMode}-rounds.json`)
  writeFileSync(evidenceFile, JSON.stringify(roundEvidence, null, 2))
  artifacts.push(evidenceFile)
  row.metrics = {
    rounds: options.rounds,
    attemptedRounds: roundEvidence.length,
    qualifiedRounds: row.samplesMs.length,
    inputMode: options.inputMode,
    executable: options.command,
    roundEvidenceFile: evidenceFile,
    clock: 'process spawn through exit/output completion; file readback and independent qualification after clock; failed attempts retain elapsed time in round evidence',
  }
  return { row, artifacts }
}
export async function runInvocationCliProgram(options: InvocationOptions, workloads: UnifiedWorkload[], executor?: { command: string; prefix: readonly string[]; out: string; runtime: string }): Promise<{ rows: BenchmarkObservation[]; gaps: string[]; artifacts: string[] }> {
  const root = options.packageRoot ?? options.root,
    out = executor?.out ?? join(options.out, 'cli')
  mkdirSync(out, { recursive: true })
  const rows: BenchmarkObservation[] = [],
    gaps: string[] = [],
    artifacts: string[] = [],
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
    bins = pkg.bin ?? {}
  const commandEntry = bins.am ?? bins['agentic-mermaid']
  if (!commandEntry || !existsSync(join(root, commandEntry))) return { rows: [{ ...invocationRow(executor ? 'cli:native-binary' : 'cli', workloads[0]!, 'spawn', 'module', 'process-to-output'), status: 'blocked', detail: 'Installed CLI entry is absent' }], gaps: ['CLI artifacts absent'], artifacts }
  const entry = join(root, commandEntry),
    core = await import(pathToFileURL(join(root, 'dist/agent-core.js')).href)
  const executable = executor?.command ?? 'node',
    argvPrefix = executor?.prefix ?? [entry],
    runtime = executor?.runtime ?? invocationRuntime
  const surfaceFor = (surface: string) => (executor ? surface.replace(/^cli(?=:)/, 'cli:native-binary') : surface)
  const programRow = (surface: string, workload: UnifiedWorkload, operation: string, format: string, mode: string): BenchmarkObservation => ({ ...invocationRow(surfaceFor(surface), workload, operation, format, mode), runtime })
  // The aliases are package-install contracts; identical target bytes are not duplicate speed votes.
  if (!executor)
    for (const [alias, path] of Object.entries(bins) as [string, string][]) {
      if (alias.endsWith('-mcp')) continue
      const r = await childCommand('node', [join(root, path), '--help'], { cwd: root })
      rows.push({ ...programRow(`cli-alias:${alias}`, workloads[0]!, 'help', 'text', 'process-to-output'), family: '*', caseId: 'alias-help', status: r.code === 0 && r.stdout.length ? 'passed' : 'failed', samplesMs: [r.wallMs], bytes: r.stdout.length, detail: r.code === 0 ? undefined : r.stderr })
    }
  if (executor) {
    const help = await childCommand(executable, [...argvPrefix, '--help'], { cwd: root })
    rows.push({ ...programRow('cli:discovery', workloads[0]!, 'help', 'text', 'process-to-output'), family: '*', caseId: 'native-help', status: help.code === 0 && help.stdout.length ? 'passed' : 'failed', samplesMs: [help.wallMs], bytes: help.stdout.length, detail: help.code === 0 ? undefined : help.stderr })
  }
  for (const command of ['capabilities', 'styles', 'llms-txt', 'init-agent']) {
    const row = programRow('cli:discovery', workloads[0]!, command, command === 'llms-txt' ? 'text' : 'json', 'process-to-output')
    row.family = '*'
    row.caseId = command
    row.samplesMs = []
    try {
      for (let round = 1; round <= options.rounds; round++) {
        const args = [...argvPrefix, command, ...(command === 'styles' || command === 'init-agent' ? ['--json'] : []), ...(command === 'init-agent' ? ['--dir', join(out, `agent-install-${round}`), '--force'] : [])]
        const result = await childCommand(executable, args, { cwd: root })
        if (result.code !== 0 || !result.stdout.length) throw Error(result.stderr || 'Missing command output')
        if (command !== 'llms-txt') JSON.parse(result.stdout.toString())
        row.samplesMs.push(result.wallMs)
        row.bytes = result.stdout.length
      }
    } catch (e) {
      row.status = 'failed'
      row.detail = String(e)
    }
    rows.push(row)
  }
  const { CLI_RENDER_FORMATS } = await import(join(options.harnessRoot ?? invocationHarnessRoot, 'src/render-output-metadata.ts'))
  const formats = options.profile === 'full' ? [...CLI_RENDER_FORMATS] : ['svg', 'ascii', 'unicode', 'layout']
  const inputModes = options.profile === 'full' ? ['stdin', 'file'] : ['stdin']
  for (const w of workloads) {
    const sourceFile = join(out, `${w.family}.mmd`)
    writeFileSync(sourceFile, w.source)
    artifacts.push(sourceFile)
    for (const format of formats)
      for (const inputMode of inputModes) {
        const rendered = await runCliRenderInvocation({ command: executable, prefix: argvPrefix, cwd: root, out, sourceFile, workload: w, format, inputMode, rounds: options.rounds, surface: surfaceFor(`cli:${inputMode}`), runtime })
        rows.push(rendered.row)
        artifacts.push(...rendered.artifacts)
      }
    // Source/IR/verification commands preserve their own process envelopes.
    let parsedCli: string | undefined
    for (const verb of ['parse', 'verify', 'describe', 'format', 'preview']) {
      const row = programRow('cli:stdin', w, verb, verb === 'parse' || verb === 'verify' || verb === 'describe' ? 'json' : verb === 'preview' ? 'html' : 'source', 'process-to-output')
      try {
        const previewFile = join(out, `${w.family}-preview.html`),
          args = [...argvPrefix, verb, '-', ...(verb === 'describe' ? ['--format', 'json'] : []), ...(verb === 'preview' ? ['--output', previewFile] : [])]
        if (verb === 'preview') rmSync(previewFile, { force: true })
        const r = await childCommand(executable, args, { cwd: root, input: w.source })
        row.samplesMs = [r.wallMs]
        row.bytes = r.stdout.length
        if (r.code !== 0) throw Error(r.stderr || r.stdout.toString())
        const value = verb === 'preview' ? readFileSync(previewFile, 'utf8') : r.stdout.toString()
        if (verb === 'parse') {
          const parsed = JSON.parse(value)
          if (parsed.kind !== w.family) throw Error('CLI parse returned wrong family')
          parsedCli = value
        } else if (verb === 'verify') {
          const verified = JSON.parse(value)
          row.metrics = { verificationOk: !!verified.ok }
        } else if (verb === 'format') {
          const q = qualifyOutput(w, value, 'source')
          if (!q.ok) throw Error(q.findings.join('; '))
        } else if (!value.trim()) throw Error('Empty command output')
      } catch (e) {
        row.status = 'failed'
        row.detail = String(e)
      }
      rows.push(row)
    }
    if (parsedCli) {
      const row = programRow('cli:stdin', w, 'serialize', 'source', 'process-to-output')
      try {
        const r = await childCommand(executable, [...argvPrefix, 'serialize'], { cwd: root, input: parsedCli })
        row.samplesMs = [r.wallMs]
        row.bytes = r.stdout.length
        const q = qualifyOutput(w, r.stdout.toString(), 'source')
        if (r.code !== 0 || !q.ok) throw Error(r.stderr || q.findings.join('; '))
      } catch (e) {
        row.status = 'failed'
        row.detail = String(e)
      }
      rows.push(row)
    }
    const mutation = mutationWitnessForFamily(core as any, w.family)
    if (mutation) {
      const row = programRow('cli:stdin', w, 'mutate', 'source', 'process-to-output')
      try {
        const r = await childCommand(executable, [...argvPrefix, 'mutate', '-', '--op', JSON.stringify(mutation)], { cwd: root, input: w.source })
        row.samplesMs = [r.wallMs]
        row.bytes = r.stdout.length
        if (r.code !== 0 || !r.stdout.toString().includes('UnifiedBenchmarkWitness')) throw Error(r.stderr || 'Mutation lost independently requested witness')
      } catch (e) {
        row.status = 'failed'
        row.detail = String(e)
      }
      rows.push(row)
    }
    if (options.profile === 'full') {
      const row = programRow('cli:watch', w, 'render', 'svg', 'long-lived-metadata-changed-input')
      row.samplesMs = []
      const watchRounds: { round: number; status: string; wallMs: number; detail?: string }[] = []
      row.metrics = { clock: 'metadata file write through observed complete changed SVG after watcher announces readiness; startup checkpoint includes initial artifact and watcher readiness' }
      try {
        for (let round = 1; round <= options.rounds; round++) {
          const roundStart = performance.now()
          try {
            const input = join(out, `${w.family}-watch-${round}.mmd`),
              output = join(out, `${w.family}-watch-${round}.svg`),
              first = `InvocationWatchInitial_${round}`,
              changed = `InvocationWatchChanged_${round}`
            rmSync(output, { force: true })
            writeFileSync(input, changedAuthoredTitle(w.source, first))
            const cancellation = new AbortController()
            const firstReady = awaitInvocationArtifact(output, first, 30_000, cancellation.signal),
              start = performance.now(),
              child = spawn(executable, [...argvPrefix, 'render', input, '--format', 'svg', '--watch', '--output', output], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] })
            let errorText = '',
              childClosed = false,
              spawnFailed = false
            child.once('close', () => {
              childClosed = true
            })
            let markListening: (() => void) | undefined
            const listening = new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer)
                reject(Error('CLI watch readiness cancelled'))
              }
              const timer = setTimeout(() => {
                cancellation.signal.removeEventListener('abort', abort)
                reject(Error('CLI watch readiness timeout'))
              }, 30000)
              cancellation.signal.addEventListener('abort', abort, { once: true })
              markListening = () => {
                clearTimeout(timer)
                cancellation.signal.removeEventListener('abort', abort)
                resolve()
              }
            })
            const failure = new Promise<never>((_, reject) => {
              child.on('error', error => {
                spawnFailed = true
                reject(error)
              })
              child.on('exit', (code, signal) => reject(Error(`Watch exited before artifact: ${code}/${signal}`)))
            })
            child.stderr.on('data', chunk => {
              errorText += chunk.toString()
              if (errorText.includes('watching ')) markListening?.()
            })
            try {
              await Promise.race([Promise.all([firstReady, listening]), failure])
              row.metrics = { ...row.metrics, startupToFirstArtifactMs: performance.now() - start }
              const ready = awaitInvocationArtifact(output, changed, 30_000, cancellation.signal),
                pending = Promise.race([ready, failure]),
                editStart = performance.now()
              writeFileSync(input, changedAuthoredTitle(w.source, changed))
              const artifact = await pending,
                changedMs = performance.now() - editStart
              row.bytes = Buffer.byteLength(artifact)
              const q = qualifyOutput(w, artifact, 'svg')
              if (!q.ok) throw Error(q.findings.join('; '))
              row.samplesMs.push(changedMs)
            } catch (e) {
              throw Error(String(e) + ' ' + errorText)
            } finally {
              cancellation.abort()
              if (!childClosed && child.pid && !spawnFailed) {
                await new Promise<void>((resolve, reject) => {
                  const finish = (error?: Error) => {
                    clearTimeout(force)
                    clearTimeout(deadline)
                    child.removeListener('close', closed)
                    error ? reject(error) : resolve()
                  }
                  const closed = () => finish()
                  child.once('close', closed)
                  const force = setTimeout(() => child.kill('SIGKILL'), 2000),
                    deadline = setTimeout(() => finish(Error('Watch process did not close after bounded SIGKILL cleanup')), 3000)
                  child.kill('SIGTERM')
                  if (childClosed) finish()
                })
              }
            }
            watchRounds.push({ round, status: 'passed', wallMs: performance.now() - roundStart })
          } catch (error) {
            row.status = 'failed'
            row.detail = String(error)
            watchRounds.push({ round, status: 'failed', wallMs: performance.now() - roundStart, detail: String(error) })
          }
        }
      } catch (e) {
        row.status = 'failed'
        row.detail = String(e)
      }
      const evidenceFile = join(out, `${w.family}-watch-rounds.json`)
      writeFileSync(evidenceFile, JSON.stringify(watchRounds, null, 2))
      artifacts.push(evidenceFile)
      row.metrics = {
        ...row.metrics,
        rounds: options.rounds,
        attemptedRounds: watchRounds.length,
        qualifiedRounds: watchRounds.filter(value => value.status === 'passed').length,
        roundWallScope: 'entire watch attempt including readiness, edits, independent qualification and cleanup; samplesMs contains qualified changed-artifact latency only',
        roundEvidenceFile: evidenceFile,
      }
      rows.push(row)
    }
    // JSONL keeps one process alive across an entire per-family operation batch.
    const batchInput =
      [
        { op: 'render', source: w.source, options: { format: 'svg' } },
        { op: 'parse', source: w.source },
        { op: 'verify', source: w.source },
      ]
        .map(v => JSON.stringify(v))
        .join('\n') + '\n'
    const row = programRow('cli:batch', w, 'render-parse-verify', 'jsonl', 'process-to-output')
    row.samplesMs = []
    try {
      for (let round = 1; round <= options.rounds; round++) {
        const r = await childCommand(executable, [...argvPrefix, 'batch', '--jsonl'], { cwd: root, input: batchInput }),
          values = r.stdout
            .toString()
            .trim()
            .split('\n')
            .map(line => JSON.parse(line))
        if (r.code !== 0 || values.length !== 3 || !values[0]?.ok || !values[1]?.ok) throw Error(r.stderr || JSON.stringify(values))
        const q = qualifyOutput(w, values[0]?.data?.svg, 'svg')
        if (!q.ok) throw Error(q.findings.join('; '))
        row.samplesMs.push(r.wallMs)
        row.bytes = r.stdout.length
        row.metrics = { verifyOk: !!values[2]?.ok, records: values.length }
      }
    } catch (e) {
      row.status = 'failed'
      row.detail = String(e)
    }
    rows.push(row)
    const md = join(out, `${w.family}.md`)
    writeFileSync(md, '```mermaid\n' + w.source + '\n```\n')
    const mr = programRow('cli:markdown', w, 'render-markdown', 'svg', 'process-to-output')
    mr.samplesMs = []
    try {
      for (let round = 1; round <= options.rounds; round++) {
        const r = await childCommand(executable, [...argvPrefix, 'render-markdown', md], { cwd: root }),
          value = JSON.parse(r.stdout.toString())
        if (r.code !== 0 || value.blocks?.length !== 1 || !value.blocks[0]?.ok) throw Error(r.stderr || r.stdout.toString())
        const q = qualifyOutput(w, value.blocks[0].output, 'svg')
        if (!q.ok) throw Error(q.findings.join('; '))
        mr.samplesMs.push(r.wallMs)
        mr.bytes = r.stdout.length
      }
    } catch (e) {
      mr.status = 'failed'
      mr.detail = String(e)
    }
    rows.push(mr)
  }
  const manifest = join(out, 'cli-program.json')
  writeFileSync(
    manifest,
    JSON.stringify(
      {
        command: executable,
        prefix: argvPrefix,
        runtime,
        root,
        formats,
        inputModes,
        rounds: options.rounds,
        helperVerbRounds: 1,
        policy: 'Render, discovery, watch, JSONL and Markdown retain their actual repeated rounds; parse/verify/describe/format/preview/serialize/mutate are single functional calls per family. Actual stdout/files are fully consumed and qualified; no command is credited by metadata alone.',
      },
      null,
      2,
    ),
  )
  artifacts.push(manifest)
  return { rows, gaps, artifacts }
}
async function cli(options: InvocationOptions, workloads: UnifiedWorkload[]): Promise<{ rows: BenchmarkObservation[]; gaps: string[]; artifacts: string[] }> {
  const result = await runInvocationCliProgram(options, workloads),
    native = join(options.root, 'dist/am'),
    root = options.packageRoot ?? options.root
  if (existsSync(native)) {
    if (options.profile === 'full') {
      const nativeResult = await runInvocationCliProgram(options, workloads, { command: realpathSync(native), prefix: [], out: join(options.out, 'cli/native'), runtime: 'bun-compiled:embedded-runtime' })
      result.rows.push(...nativeResult.rows)
      result.gaps.push(...nativeResult.gaps)
      result.artifacts.push(...nativeResult.artifacts)
    } else
      for (const w of workloads) {
        const row = invocationRow('cli:native-binary', w, 'render', 'svg', 'process-to-output')
        row.runtime = 'bun-compiled:embedded-runtime'
        try {
          const r = await childCommand(native, ['render', '-', '--format', 'svg'], { cwd: root, input: w.source })
          row.samplesMs = [r.wallMs]
          row.bytes = r.stdout.length
          const q = qualifyOutput(w, r.stdout.toString(), 'svg')
          row.status = r.code === 0 && q.ok ? 'passed' : 'failed'
          row.findings = q.findings
          row.detail = r.code === 0 ? undefined : r.stderr
        } catch (error) {
          row.status = 'failed'
          row.detail = String(error)
        }
        result.rows.push(row)
      }
  } else {
    result.gaps.push('Compiled Bun CLI binary was not present: run bun run build:binary to enroll native startup. Installed Node CLI aliases were measured.')
    result.rows.push({ ...invocationRow('cli:native-binary', workloads[0]!, 'spawn', 'svg', 'process-to-output'), family: '*', caseId: 'native-build', status: 'blocked', detail: 'Compiled dist/am artifact is absent; installed Node CLI does not substitute for native startup.' })
  }
  return result
}
export async function runInvocationSuite(options: InvocationOptions): Promise<UnifiedSuiteResult> {
  const startedAt = new Date().toISOString()
  if (options.libraryExports) selectedLibraryEntries(JSON.parse(readFileSync(join(options.packageRoot ?? options.root, 'package.json'), 'utf8')), options.libraryExports)
  mkdirSync(options.out, { recursive: true })
  const nodeProbe = await childCommand('node', ['-p', 'process.versions.node'], { cwd: options.root })
  invocationRuntime = nodeProbe.code === 0 ? `node:${nodeProbe.stdout.toString().trim()}` : 'node:unavailable'
  const enriched = await withReferenceLabels([...(options.workloads ?? unifiedWorkloads('smoke'))], { root: options.harnessRoot ?? invocationHarnessRoot })
  writeFileSync(join(options.out, 'invocation-inputs.json'), JSON.stringify(enriched, null, 2))
  const workloads = enriched.workloads,
    observations: BenchmarkObservation[] = [],
    gaps: string[] = [...enriched.gaps],
    artifacts: string[] = [join(options.out, 'invocation-inputs.json')]
  const selected = options.surfaces ?? ['library', 'cli', 'mcp', 'browser']
  for (const surface of selected) {
    try {
      const result = surface === 'library' ? await library(options, workloads) : surface === 'cli' ? await cli(options, workloads) : surface === 'mcp' ? await runInvocationMcp(options, workloads) : await runInvocationBrowser(options, workloads)
      observations.push(...result.rows)
      gaps.push(...result.gaps)
      artifacts.push(...result.artifacts)
    } catch (e) {
      gaps.push(`${surface} could not complete: ${String(e)}`)
      observations.push({ ...invocationRow(surface, workloads[0]!, 'surface-start', 'mixed', 'initialization'), family: '*', caseId: 'surface-initialization', status: 'blocked', detail: String(e) })
    }
  }
  gaps.push(
    'Invocation routing uses every built-in family representative; deep syntax/feature evidence belongs to the connected family suite, not every feature × transport Cartesian product.',
    'Live provider/model task cost requires configured credentials and is orchestrated separately; invocation timings do not estimate token or dollar cost.',
    'CLI/MCP child peak RSS is not inferred from parent RSS; library fresh-process memory checkpoints are separate diagnostics.',
  )
  const result: UnifiedSuiteResult = { id: 'invocation', status: observations.some(r => r.status === 'failed') ? 'failed' : observations.some(r => r.status === 'blocked') ? 'blocked' : 'passed', startedAt, finishedAt: new Date().toISOString(), observations, gaps: [...new Set(gaps)], artifacts }
  writeFileSync(join(options.out, 'invocation.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}
if (import.meta.main) {
  const values = new Map<string, string>()
  for (let i = 2; i < process.argv.length; i += 2) values.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1]!)
  const root = resolve(values.get('root') ?? invocationHarnessRoot),
    out = resolve(values.get('out') ?? join(root, 'bench-report/invocation'))
  const result = await runInvocationSuite({
    root,
    out,
    packageRoot: values.get('package-root'),
    harnessRoot: invocationHarnessRoot,
    rounds: Number(values.get('rounds') ?? 3),
    profile: values.get('profile') === 'full' ? 'full' : 'smoke',
    executable: values.get('executable'),
    surfaces: values.get('surfaces')?.split(',') as InvocationOptions['surfaces'],
    libraryExports: values.get('library-exports')?.split(','),
  })
  console.log(JSON.stringify({ status: result.status, observations: result.observations.length, gaps: result.gaps }))
  if (result.status === 'failed') process.exitCode = 1
}
