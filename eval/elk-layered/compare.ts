// bun eval/elk-layered/compare.ts eval/elk-layered/output/capture-<id> [candidate-module]
import { deepStrictEqual, strictEqual } from 'node:assert'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deserialize } from 'node:v8'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { ElkNode } from 'elkjs'
import { withoutGeneratedIdentity } from './comparison.ts'

process.env.AGENTIC_MERMAID_ELK_CACHE = '0'
const directory = process.argv[2]
if (!directory) throw new Error('Pass a complete capture directory')
const solverModule = process.argv[3]
  ? pathToFileURL(resolve(process.argv[3])).href
  : new URL('../../src/elk-instance.ts', import.meta.url).href
const metadata = JSON.parse(readFileSync(join(directory, 'capture.json'), 'utf8')) as {
  complete: boolean; captures: number; runtime: string; resumed?: { captures: number }[]
}
if (!metadata.complete) throw new Error('The capture is incomplete; retain it and finish capture before comparison')
if (metadata.runtime !== `Bun ${Bun.version}`) throw new Error(`Read this lossless capture with ${metadata.runtime}`)
// Keep the original process boundaries and lossless captures. The owner permits
// excluding generated GWT identity metadata, but no domain JSON differences.
if (isMainThread) {
  let exactDomainReturns = 0
  let matchedFailures = 0
  const boundaries = [0, ...(metadata.resumed ?? []).map(session => session.captures), metadata.captures]
  for (let session = 0; session + 1 < boundaries.length; session++) {
    const worker = new Worker(import.meta.filename, {
      argv: process.argv.slice(2), workerData: { start: boundaries[session], end: boundaries[session + 1] },
    })
    worker.on('message', (counts: { exactDomainReturns: number; matchedFailures: number }) => {
      exactDomainReturns += counts.exactDomainReturns
      matchedFailures += counts.matchedFailures
    })
    const [status] = await once(worker, 'exit')
    if (status !== 0) { process.exitCode = status as number; break }
  }
  const report = {
    source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: join(import.meta.dir, '../..'), encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: join(import.meta.dir, '../..'), encoding: 'utf8' }).length > 0,
    solverModule, comparison: 'strict domain JSON; exclude only output-added numeric $H',
    exactDomainReturns, matchedFailures, total: metadata.captures,
    complete: exactDomainReturns + matchedFailures === metadata.captures && !process.exitCode,
  }
  writeFileSync(join(directory, `comparison-${Date.now()}.json`), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} else {
const { elkLayoutSync } = await import(solverModule) as { elkLayoutSync(graph: ElkNode): ElkNode }
if (typeof elkLayoutSync !== 'function') throw new Error('Candidate module must export elkLayoutSync')
const { start, end } = workerData as { start: number; end: number }
let exactDomainReturns = 0
let matchedFailures = 0
for (let index = start; index < end; index++) {
  const filename = join(directory, `${index}.bin`)
  const captured = deserialize(readFileSync(filename)) as {
    render: number; ordinal: number; input: ElkNode;
    outcome: { kind: 'return'; value: ElkNode } | { kind: 'throw'; error: unknown }
  }
  let actual: typeof captured.outcome
  try {
    actual = { kind: 'return', value: elkLayoutSync(structuredClone(captured.input)) }
  } catch (error) {
    actual = { kind: 'throw', error }
  }
  try {
    strictEqual(actual.kind, captured.outcome.kind)
    if (actual.kind === 'return' && captured.outcome.kind === 'return') {
      // Preserve numbers, array order and authored keys exactly. Only generated
      // GWT identity hashes are outside the revised owner-approved contract.
      deepStrictEqual(
        withoutGeneratedIdentity(actual.value, captured.input),
        withoutGeneratedIdentity(captured.outcome.value, captured.input),
      )
      exactDomainReturns++
    } else if (actual.kind === 'throw' && captured.outcome.kind === 'throw') {
      // TypeScript errors retain the diagnostic, not GWT's Java throwable,
      // runtime-specific stack or Java exception qualification.
      strictEqual(diagnosticMessage(actual.error), diagnosticMessage(captured.outcome.error))
      matchedFailures++
    }
  } catch (difference) {
    const details = deserialize(readFileSync(join(directory, `render-${captured.render}.bin`))) as {
      sample: string; family: string; strategy: string; depth: number
    }
    const report = {
      input: filename, sample: details.sample, family: details.family,
      strategy: details.strategy, depth: details.depth, ordinal: captured.ordinal,
      expectedKind: captured.outcome.kind, actualKind: actual.kind,
      ...(actual.kind === 'throw' ? {
        actualFailure: diagnosticMessage(actual.error),
        actualStack: actual.error instanceof Error ? actual.error.stack : undefined,
      } : {}),
      difference: String(difference),
    }
    writeFileSync(join(directory, `divergence-${index}-${Date.now()}.json`), JSON.stringify(report, null, 2))
    console.error(JSON.stringify(report))
    process.exitCode = 1
    break
  }
  if ((index + 1) % 1000 === 0) console.log(JSON.stringify({ checkedThrough: index + 1, exactDomainReturns, matchedFailures, total: metadata.captures }))
  await new Promise<void>(resolve => setImmediate(resolve))
}
parentPort!.postMessage({ exactDomainReturns, matchedFailures })
}

function diagnosticMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^(?:java\.(?:lang|util)\.[\w$]+|org\.eclipse\.[\w.$]+):\s*/, '')
}
