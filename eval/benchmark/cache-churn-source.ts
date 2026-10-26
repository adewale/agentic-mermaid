import { assertBenchmarkExecutionAllowed } from './ci-policy.ts'
// Build-only instrumentation stays in the evaluator. Production sources and
// public globals/API remain unchanged. Never use these bundles for timings.
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cacheChurnGenerator, cacheChurnPopulation } from './cache-churn-population.ts'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const event = (layer: string, name: string) => `cacheProbeEvent(this, ${layer}, '${name}', this.#weight, this.#entries.size${name === 'get' || name === 'set' ? ', key' : ''});`

/** Bind private counters to the owner, not an obsolete key-length budget. */
export function cacheProbeLayers(elkSource: string): Record<string, string> {
  for (const owner of [
    'const ELK_CACHE_MAX_ENTRIES = 64',
    'const ELK_CACHE_MAX_RESIDENCY = 8 * 1024 * 1024',
    'const elkResults = new WeightedLru<string, ElkNode>(ELK_CACHE_MAX_ENTRIES, ELK_CACHE_MAX_RESIDENCY)',
    'const weight = Math.max(key.length * 8, key.length * 2 + estimatedResidency(result, ELK_CACHE_MAX_RESIDENCY))',
  ]) if (elkSource.split(owner).length !== 2) throw new Error('ELK cache diagnostic owner or residency policy changed')
  return { 'weighted:128:16777216': 'outer positioned artifact cache',
    'weighted:64:8388608': 'ELK geometry cache (estimated residency weight, not resident bytes)',
    'native:8388608': 'owned measured geometry', 'native:1048576': 'owned order choices' }
}

function once(source: string, search: string, replacement: string): string {
  if (source.split(search).length !== 2) throw new Error(`Cache instrumentation expected exactly one occurrence: ${search}`)
  return source.replace(search, replacement)
}

export function instrumentCacheSource(source: string, native: boolean, statePath: string): string {
  const layer = native ? '`native:${this.#maxWeight}`' : '`weighted:${this.#maxEntries}:${this.#maxWeight}`'
  source = once(source, 'const found = this.#entries.get(key)', `const found = this.#entries.get(key); ${event(layer, 'get')} ${event(layer, 'placeholder')}`)
  source = once(source, event(layer, 'placeholder'), `cacheProbeEvent(this, ${layer}, found ? 'hit' : 'miss', this.#weight, this.#entries.size);`)
  if (native) {
    source = once(source, 'constructor(maxWeight: number) { this.#maxWeight = maxWeight }', `constructor(maxWeight: number) { this.#maxWeight = maxWeight; ${event(layer, 'create')} }`)
    source = once(source, 'if (weight > this.#maxWeight) return', `if (weight > this.#maxWeight) { ${event(layer, 'rejected')} return }`)
    source = once(source, 'this.#entries.set(key, { value, weight }); this.#weight += weight', `this.#entries.set(key, { value, weight }); this.#weight += weight; ${event(layer, 'set')}`)
    source = once(source, 'this.#weight -= this.#entries.get(oldest)!.weight; this.#entries.delete(oldest)', `this.#weight -= this.#entries.get(oldest)!.weight; this.#entries.delete(oldest); ${event(layer, 'evict')}`)
  } else {
    source = once(source, 'this.#maxEntries = maxEntries; this.#maxWeight = maxWeight }', `this.#maxEntries = maxEntries; this.#maxWeight = maxWeight; ${event(layer, 'create')} }`)
    source = once(source, 'if (!Number.isFinite(weight) || weight < 0 || weight > this.#maxWeight) return', `if (!Number.isFinite(weight) || weight < 0 || weight > this.#maxWeight) { ${event(layer, 'rejected')} return }`)
    source = once(source, 'this.#entries.set(key, { value, weight }); this.#weight += weight', `this.#entries.set(key, { value, weight }); this.#weight += weight; ${event(layer, 'set')}`)
    source = once(source, 'this.#weight -= this.#entries.get(oldest)!.weight; this.#entries.delete(oldest)', `this.#weight -= this.#entries.get(oldest)!.weight; this.#entries.delete(oldest); ${event(layer, 'evict')}`)
    source = once(source, 'this.#entries.clear(); this.#weight = 0', `this.#entries.clear(); this.#weight = 0; ${event(layer, 'clear')}`)
  }
  return `import { cacheProbeEvent } from ${JSON.stringify(statePath)};\n${source}`
}

async function main() {
  const options = new Map<string, string>()
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index], value = process.argv[index + 1]
    if (!key || !['--source-root', '--out', '--population', '--layout-cache', '--budget-ms'].includes(key) || !value || options.has(key)) throw new Error(`Invalid argument ${key}`)
    options.set(key, value)
  }
  for (const key of ['--source-root', '--out', '--population', '--layout-cache']) if (!options.has(key)) throw new Error(`${key} is required`)
  const root = resolve(options.get('--source-root')!), out = resolve(options.get('--out')!), count = Number(options.get('--population'))
  const cache = options.get('--layout-cache')!, budget = Number(options.get('--budget-ms') ?? 480000)
  if (!['off', 'normal'].includes(cache) || !Number.isSafeInteger(budget) || budget < 1 || budget > 480000) throw new Error('Invalid cache policy or bounded budget')
  if (existsSync(out) && readdirSync(out).length) throw new Error(`Refusing nonempty output directory: ${out}`)
  mkdirSync(out, { recursive: true })
  const started = Date.now(), deadline = started + budget, inputs = cacheChurnPopulation(count)
  const transformations: unknown[] = [], observations: unknown[] = []
  const metadata = { protocol: 'source-cache-layer-diagnosis@1', sourceRoot: root, population: count, generator: cacheChurnGenerator(count), inputs, layoutCache: cache, budgetMs: budget,
    sourceFiles: ['src/experimental/weighted-lru.ts', 'src/layout/agentic-producer-core.ts'].map(path => ({ path, sha256: sha(readFileSync(join(root, path), 'utf8')) })),
    layers: cacheProbeLayers(readFileSync(join(root, 'src/elk-instance.ts'), 'utf8')),
    limitations: ['Instrumented source/Bun only; no timing or memory-performance claim.', 'Paired uninstrumented source control must produce identical SVG/receipt hashes.',
      'Event weights retain each cache implementation\'s estimated units and are not measured resident bytes.',
      'Canonical cache observations are reported separately from private key/cardinality/eviction instrumentation; neither is a performance measurement.',
      'Distinct key cardinality uses full SHA256 fingerprints of actual get/set keys. Hashes/counts are evaluator-only, not inferred from authored sources.',
      'No public renderer globals, exports or source files are modified.'] }
  const save = (status: string, extra: Record<string, unknown> = {}) => writeFileSync(join(out, 'report.json'), `${JSON.stringify({ ...metadata, status, transformations, observations, ...extra }, null, 2)}\n`)
  save('building')
  try {
    for (const instrumented of [false, true]) {
      const target = join(out, instrumented ? 'instrumented.js' : 'control.js')
      const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'cache-probe-worker.ts')], target: 'bun', format: 'esm',
        plugins: [{ name: 'private-cache-diagnosis', setup(build) {
          build.onResolve({ filter: /^@layout-probe\/source$/ }, () => ({ path: join(root, 'src/svg.ts') }))
          if (instrumented) build.onLoad({ filter: /\/(?:experimental\/weighted-lru|layout\/agentic-producer-core)\.ts$/ }, async args => {
            const original = readFileSync(args.path, 'utf8'), transformed = instrumentCacheSource(original, args.path.endsWith('agentic-producer-core.ts'), join(import.meta.dir, 'cache-probe-state.ts'))
            transformations.push({ file: args.path, originalSha256: sha(original), transformedSha256: sha(transformed) })
            return { contents: transformed, loader: 'ts' }
          })
        } }] })
      if (!built.success) throw new Error(`Diagnostic bundle failed: ${built.logs.join('\n')}`)
      if (built.outputs.length !== 1) throw new Error('Expected a single self-contained diagnostic bundle')
      writeFileSync(target, await built.outputs[0]!.text())
      if (instrumented && new Set((transformations as Array<{ file: string }>).map(item => item.file)).size !== 2) throw new Error('Expected both outer/ELK and native cache source transforms')
      if (Date.now() >= deadline) throw new Error('Shared diagnostic budget exhausted during build')
    }
    // Fresh process per policy/backend/instrumentation arm. No timer is read
    // around a render; counts diagnose cache behavior, not performance.
    for (const outer of ['normal', 'off']) for (const backend of ['elk', 'agentic']) for (const instrumented of [false, true]) {
      const label = `${outer}-${backend}-${instrumented ? 'instrumented' : 'control'}`, prefix = join(out, label)
      const job = { inputs, backend, observeCaches: instrumented, out: `${prefix}.json` }; writeFileSync(`${prefix}.job.json`, JSON.stringify(job))
      const remaining = deadline - Date.now()
      if (remaining <= 0) { observations.push({ label, failure: 'shared diagnostic budget exhausted before launch' }); save('running'); continue }
      const child = spawnSync(process.execPath, [join(out, instrumented ? 'instrumented.js' : 'control.js'), `${prefix}.job.json`], {
        cwd: root, encoding: 'utf8', timeout: remaining, killSignal: 'SIGKILL', env: { ...process.env, AGENTIC_MERMAID_ELK_CACHE: cache === 'normal' ? '1' : '0',
          AGENTIC_MERMAID_EXPERIMENTS: outer === 'normal' ? 'text-spans,position-cache' : 'text-spans', AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' } })
      let result: unknown, failure: string | undefined
      if (child.status === 0) {
        try { result = JSON.parse(readFileSync(job.out, 'utf8')) } catch (error) { failure = `Result invalid: ${error}` }
      } else failure = `${child.error?.message ?? `exit ${child.status ?? child.signal}`}: ${child.stderr}`
      observations.push({ label, outer, backend, instrumented, exitCode: child.status, signal: child.signal, failure, result }); save('running')
    }
    const comparisons = []
    let ok = true
    for (const outer of ['normal', 'off']) for (const backend of ['elk', 'agentic']) {
      const rows = observations as Array<{ outer?: string; backend?: string; instrumented?: boolean; failure?: string; result?: { phases: Array<{
        svgSha256: string; receiptSha256: string; outcomes: Array<{ ok: boolean }>;
        after: Array<{ layer: string; distinctGetKeys: number; distinctSetKeys: number; events: Record<string, number> }>;
      }> } }>
      const control = rows.find(row => row.outer === outer && row.backend === backend && row.instrumented === false)
      const measured = rows.find(row => row.outer === outer && row.backend === backend && row.instrumented === true)
      const output = (row: typeof control) => row?.result?.phases.map(phase => ({ svg: phase.svgSha256, receipt: phase.receiptSha256, outcomes: phase.outcomes }))
      const equal = !!control?.result && !!measured?.result && !control.failure && !measured.failure && JSON.stringify(output(control)) === JSON.stringify(output(measured))
      const successful = equal && measured!.result!.phases.every(phase => phase.outcomes.every(outcome => outcome.ok))
      const actualKeyCardinality = measured?.result?.phases.at(-1)?.after.map(layer => ({ layer: layer.layer,
        distinctGetKeys: layer.distinctGetKeys, distinctSetKeys: layer.distinctSetKeys, observedEvictions: layer.events.evict ?? 0 })) ?? []
      const target = backend === 'elk' ? 'weighted:64:8388608' : 'native:8388608'
      const geometry = actualKeyCardinality.filter(layer => layer.layer === target)
      const requiresStrongCheck = count !== 96 && cache === 'normal' && outer === 'off'
      // Only actual instrumented geometry keys+evictions substantiate solver
      // churn. A shortfall remains a failed diagnostic, never a cardinality claim.
      const distinctGeometryAndEvictionObserved = geometry.some(layer => layer.distinctGetKeys >= count && layer.distinctSetKeys >= count && layer.observedEvictions > 0)
      comparisons.push({ outer, backend, equal, successful, actualKeyCardinality, requiresStrongCheck, distinctGeometryAndEvictionObserved })
      ok &&= successful && (!requiresStrongCheck || distinctGeometryAndEvictionObserved)
    }
    save('completed', { ok, comparisons }); if (!ok) process.exitCode = 1
  } catch (error) { save('failed', { ok: false, error: String(error) }); throw error }
}

if (import.meta.main) {
  assertBenchmarkExecutionAllowed()
  await main()
}
