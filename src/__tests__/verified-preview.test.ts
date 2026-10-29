import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { boundStandaloneCodec, packStandaloneWorker, standaloneCodecPlugin, standaloneWorkerNotices } from '../../scripts/build/standalone-worker-payload.ts'
import { minifyBrowserRuntime } from '../../scripts/build/runtime-minify.ts'
import { getFamily, knownBuiltinFamilies, replaceFamilyForTest } from '../agent/families.ts'
import { renderAndVerifyMermaid, verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import { PreviewWorkerClient, PreviewSupersededError } from '../browser-preview-client.ts'
import { buildDocsEditDemo } from '../../website/docs-edit-demo.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { asFlowchart } from '../agent/types.ts'
import { DeferredDependencyError } from '../layout/certification-error.ts'
import { createBrowserEditorAdapter } from '../browser-editor-adapter.ts'
import { chargeCodecLoop, limitCodecOutput, limitCodecWindow, withCodecBudget } from '../browser-standalone-budget.ts'

import { withRenderStageObserver } from '../layout/backend.ts'

describe('one positioned artifact for preview and verification', () => {
  test('source hook delivery omits mutation dispatch data while the SDK keeps native edits', async () => {
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL('../agent/families-source-hooks.ts', import.meta.url))],
      target: 'browser', format: 'esm', minify: true, metafile: true,
    })
    expect(built.success, built.logs.map(log => log.message).join('\n')).toBe(true)
    const retainedMutationBytes = Object.values(built.metafile!.outputs).reduce((sum, output) => sum
      + Object.entries(output.inputs).reduce((bytes, [path, contribution]) => bytes
        + (path.endsWith('/agent/generated/mutation-op-kinds.ts') ? contribution.bytesInOutput : 0), 0), 0)
    expect(retainedMutationBytes).toBe(0)
    const text = await built.outputs[0]!.text()
    const sourceModule = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`) as {
      BUILTIN_SOURCE_HOOKS: Record<string, { parse?: unknown; serialize?: unknown; buildSourceMap?: unknown; mutate?: unknown }>
    }
    for (const family of ['eventmodeling', 'zenuml']) {
      const hook = sourceModule.BUILTIN_SOURCE_HOOKS[family]!
      expect(typeof hook.parse).toBe('function')
      expect(typeof hook.serialize).toBe('function')
      expect(typeof hook.buildSourceMap).toBe('function')
      expect(hook.mutate).toBeUndefined()
      const full = getFamily(family)!
      const parsed = parseRegisteredMermaid(full.example)
      if (!parsed.ok) throw new Error(`Expected native ${family} example`)
      const body = parsed.value.body
      if (body.kind !== 'eventmodeling' && body.kind !== 'zenuml') throw new Error(`Expected native ${family} body`)
      const changed = full.mutate!(body, { kind: 'set_title', title: 'Edited title' })
      expect(changed.ok).toBe(true)
      if (changed.ok) expect(changed.value).toMatchObject({ kind: family, title: 'Edited title' })
    }
  })

  test.each(['flowchart', 'state', 'packet', 'eventmodeling', 'zenuml'])('the source-only %s worker preserves typed round trips and diagnoses unavailable mutation', async family => {
    // A fresh worker realm must not inherit the SDK's eagerly installed hooks.
    const child = Bun.spawn([process.execPath, '-e', `
      import install from ${JSON.stringify(new URL(`../browser-lazy/generated/verified/${family}.ts`, import.meta.url).pathname)};
      import { getFamily } from ${JSON.stringify(new URL('../agent/family-registry.ts', import.meta.url).pathname)};
      import { normalizeMermaidSource } from ${JSON.stringify(new URL('../mermaid-source.ts', import.meta.url).pathname)};
      const descriptor = install();
      const parse = text => {
        const source = normalizeMermaidSource(text);
        return descriptor.parse({ source, lines: source.familyLines, envelopeLines: source.familyLines,
          opaqueSource: source.familyBody, canonicalSource: source.familyBody, meta: { accessibility: {} } });
      };
      const parsed = parse(descriptor.example);
      if (!parsed.ok) throw new Error('Source worker parse failed');
      const serialized = descriptor.serialize(parsed.value), reparsed = parse(serialized);
      if (descriptor.id === 'state' && descriptor.renderSource(parsed.value) !== 'canonical') {
        throw new Error('State must retain authored paint order');
      }
      console.log(JSON.stringify({ mutation: descriptor.capabilityEvidence.find(cell => cell.capability === 'mutation').state,
        mutable: typeof descriptor.mutate === 'function', registered: getFamily(descriptor.id) === descriptor,
        typed: parsed.value.kind === descriptor.id,
        roundTrip: reparsed.ok && descriptor.serialize(reparsed.value) === serialized }));
    `], { stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ mutation: 'diagnosed', mutable: false, registered: true, typed: true, roundTrip: true })
  })

  test('verification preserves a suspended provider through a family layout wrapper', () => {
    const descriptor = getFamily('flowchart')!
    const deferred = new DeferredDependencyError('Layout provider', async () => {})
    const restore = replaceFamilyForTest('flowchart', { ...descriptor, layout: () => { throw deferred } })
    try {
      let failure: unknown
      try { verifyMermaid(descriptor.example) } catch (error) { failure = error }
      expect(failure).toBe(deferred)
    }
    finally { restore() }
  })
  test.each([
    { name: 'ELK', backend: 'elk', frame: false, fallback: false },
    { name: 'native', backend: 'agentic', frame: false, fallback: false },
    { name: 'native frame terminal', backend: 'agentic', frame: true, fallback: false },
    { name: 'explicit fallback', backend: 'agentic', frame: true, fallback: true },
  ] as const)('retains $name selection while positioning and verifying a preview once', ({ backend, frame, fallback }) => {
    // Only the fallback row exceeds the unchanged private-rank limit.
    const source = fallback
      ? `flowchart LR\nsubgraph One\n A[Leaf]\n B[Tail]\n A ${'-'.repeat(2049)}> B\nend`
      : `flowchart TB\nsubgraph One\n A --> B\nend\nsubgraph Two\n C --> D\nend\n${frame ? 'One' : 'B'} -->|handoff| C`
    const options = { security: 'strict' as const, embedFontImport: false,
      graphLayout: { backend, ...(fallback ? { fallback: 'elk' as const } : {}) } }
    const expected = renderMermaidSVGWithReceipt(source, options)
    const expectedVerification = verifyMermaid(source, { renderOptions: options })
    const descriptor = getFamily('flowchart')!, stages: string[] = []
    let calls = 0
    const restore = replaceFamilyForTest('flowchart', { ...descriptor, layout: context => { calls++; return descriptor.layout!(context) } })
    try {
      const result = withRenderStageObserver(sample => stages.push(sample.stage), () => renderAndVerifyMermaid(source, options))
      expect(calls).toBe(1)
      expect(result.svg).toBe(expected.svg)
      expect(result.receipt).toEqual(expected.receipt)
      expect(result.verification).toEqual(expectedVerification)
      expect(result.receipt.layoutDecisions?.[0]?.selected).toBe(fallback ? 'elk' : backend)
      if (backend === 'agentic' && !fallback) expect(stages).not.toContain('elk')
      else expect(stages).toContain('elk')
    } finally { restore() }
  })

  test('positions once while keeping canonical SVG, receipt and verification for every built-in example', () => {
    for (const id of knownBuiltinFamilies()) {
      const descriptor = getFamily(id)!, source = descriptor.example
      const options = { security: 'strict' as const, style: ['crisp', 'paper'], idPrefix: 'preview-test-' }
      const expected = renderMermaidSVGWithReceipt(source, options)
      const expectedVerification = verifyMermaid(source, { renderOptions: options })
      let calls = 0
      const restore = replaceFamilyForTest(id, { ...descriptor, layout: context => { calls++; return descriptor.layout!(context) } })
      try {
        const result = renderAndVerifyMermaid(source, options)
        expect(calls, id).toBe(1)
        expect(result.svg, id).toBe(expected.svg)
        expect(result.receipt, id).toEqual(expected.receipt)
        expect(result.verification, id).toEqual(expectedVerification)
      } finally { restore() }
    }
  })

  test('preserves authored config, accessibility, strict output security and source warnings', () => {
    const source = '---\nconfig:\n  flowchart:\n    nodeSpacing: 75\n---\nflowchart LR\naccTitle: Review safely\nA["&lt;script&gt;alert(1)&lt;/script&gt;"] --> B[Done]\n%% Keep a review note'
    const options = { security: 'strict' as const, style: ['hand-drawn', 'paper'], seed: 7 }
    const result = renderAndVerifyMermaid(source, options)
    expect(result.svg).toBe(renderMermaidSVGWithReceipt(source, options).svg)
    expect(result.verification).toEqual(verifyMermaid(source, { renderOptions: options }))
    expect(result.svg).toContain('Review safely')
    expect(verifyNoExternalRefs(result.svg).ok).toBe(true)
    expect(() => renderAndVerifyMermaid('this is not a diagram')).toThrow()
  })
})

interface FakePreviewWorker {
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { preventDefault(): void }) => void) | null
  onmessageerror: (() => void) | null
  terminated: boolean
  postMessage(request: { id: number; source: string }): void
  terminate(): void
}
function workerHarness(timeout = 30_000) {
  const sent: Array<{ id: number; source: string; options?: unknown; operation?: string; kind?: string; png?: Uint8Array; ok?: boolean }> = []
  const workers: FakePreviewWorker[] = []
  function create(): FakePreviewWorker {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null as ((event: { preventDefault(): void }) => void) | null,
      onmessageerror: null as (() => void) | null,
      terminated: false,
      postMessage(request: { id: number; source: string }) { sent.push(request) },
      terminate() { this.terminated = true },
    }
    workers.push(worker)
    return worker
  }
  const client = new PreviewWorkerClient(create as unknown as () => Worker, timeout)
  const replyArtifact = (id: number, artifact: unknown) => workers.at(-1)!.onmessage?.({ data: { id, ok: true, artifact } })
  const reply = (id: number, svg = '<svg/>') => replyArtifact(id, { svg, receipt: { output: 'svg' } })
  const raster = (id: number) => workers.at(-1)!.onmessage?.({ data: { id, kind: 'rasterize', svg: '<svg/>', context: { rasterDimensions: { width: 1, height: 1, pixels: 1 } } } })
  return { client, sent, workers, reply, replyArtifact, raster }
}

let standaloneSubject: Promise<string> | undefined
function standaloneSubjectScript(): Promise<string> {
  return standaloneSubject ??= (async () => {
    // Known CRC32 check vector isolates the bootstrap transport and lifecycle.
    // The emitted-browser owner exercises the actual bounded Brotli closure.
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL('../browser-standalone.ts', import.meta.url))],
      target: 'browser', format: 'iife',
      define: {
        AM_STANDALONE_PACKED_LENGTH: '9', AM_STANDALONE_PACKED_CRC32: '3421780262',
        AM_STANDALONE_WORKER_LENGTH: '9', AM_STANDALONE_WORKER_CRC32: '3421780262',
      },
      plugins: [{ name: 'standalone-transport-codec', setup(build) {
        build.onResolve({ filter: /^am-standalone-(?:brotli|crc32)$/ }, args => ({ path: args.path, namespace: 'standalone-transport-codec' }))
        build.onLoad({ filter: /.*/, namespace: 'standalone-transport-codec' }, args => ({ loader: 'js', contents: args.path.endsWith('brotli')
          ? `export default input => { globalThis.codecCalls++; const output = new Uint8Array(input); if (globalThis.damageDecoded) output[0] ^= 1; return output; }`
          : `export default (crc, bytes, length, offset) => { if (length !== 9 || offset !== 0) return 0; for (let i = 0; i < 9; i++) if (bytes[i] !== 49 + i) return 0; return 3421780262; }` }))
      } }],
    })
    if (!built.success) throw new AggregateError(built.logs, 'Could not build the standalone bootstrap subject')
    return built.outputs[0]!.text()
  })()
}

async function standaloneHarness(payload: string | null = 'MTIzNDU2Nzg5', damageDecoded = false) {
  const node = { textContent: payload }, events = new Map<string, Array<() => void>>()
  const sent: Array<{ id: number; source: string }> = [], workers: StandaloneWorker[] = []
  const blobs = new Map<string, Blob>(), revoked: string[] = []
  let nextUrl = 0
  class StandaloneWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null
    onerror: ((event: { preventDefault(): void }) => void) | null = null
    onmessageerror: (() => void) | null = null
    terminated = false
    listeners = new Map<string, Array<() => void>>()
    constructor(readonly url: string) { workers.push(this) }
    addEventListener(type: string, listener: () => void) {
      const listeners = this.listeners.get(type) ?? []
      listeners.push(listener); this.listeners.set(type, listeners)
    }
    postMessage(request: { id: number; source: string }) { sent.push(request) }
    terminate() { this.terminated = true }
    reply(id: number) {
      for (const listener of this.listeners.get('message') ?? []) listener()
      this.onmessage?.({ data: { id, ok: true, artifact: { svg: '<svg/>', receipt: { output: 'svg' } } } })
    }
    crash() {
      for (const listener of this.listeners.get('error') ?? []) listener()
      this.onerror?.({ preventDefault() {} })
    }
  }
  const window = {
    __mermaid: undefined as unknown as ReturnType<typeof createBrowserEditorAdapter>,
    addEventListener(type: string, listener: () => void) {
      const listeners = events.get(type) ?? []
      listeners.push(listener); events.set(type, listeners)
    },
  }
  const context = {
    window, document: { getElementById: () => payload === null ? null : node },
    Blob, Uint8Array, atob, structuredClone, performance, setTimeout, clearTimeout,
    Worker: StandaloneWorker, codecCalls: 0, damageDecoded,
    URL: {
      createObjectURL(blob: Blob) { const url = `blob:standalone-${++nextUrl}`; blobs.set(url, blob); return url },
      revokeObjectURL(url: string) { revoked.push(url) },
    },
  }
  runInNewContext(await standaloneSubjectScript(), context)
  const dispatch = (type: string) => { for (const listener of events.get(type) ?? []) listener() }
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve() }
  return { adapter: window.__mermaid, node, context, sent, workers, blobs, revoked, dispatch, flush }
}

describe('standalone worker payload lifecycle', () => {
  test('the actual bounded Brotli, dictionary and CRC closure returns the exact shipped worker bytes', async () => {
    const packed = packStandaloneWorker('123456789')
    const subject = fileURLToPath(new URL('../browser-standalone-payload.ts', import.meta.url))
    const built = await Bun.build({
      entrypoints: ['standalone-payload-subject'], target: 'browser', format: 'iife', minify: true,
      define: packed.define,
      plugins: [standaloneCodecPlugin(), { name: 'standalone-payload-subject', setup(build) {
        build.onResolve({ filter: /^standalone-payload-subject$/ }, () => ({ path: 'subject.ts', namespace: 'standalone-payload-subject' }))
        build.onLoad({ filter: /.*/, namespace: 'standalone-payload-subject' }, () => ({ loader: 'ts',
          contents: `import {standaloneWorkerPayload} from ${JSON.stringify(subject)}; globalThis.decode = text => standaloneWorkerPayload(text, () => false);` }))
      } }],
    })
    if (!built.success) throw new AggregateError(built.logs, 'Could not build the actual standalone codec subject')
    const context = { Blob, Uint8Array, atob, performance, decode: undefined as unknown as (text: string) => Blob }
    runInNewContext(await minifyBrowserRuntime(await built.outputs[0]!.text()), context)
    expect(await context.decode(packed.encoded).text()).toBe('123456789')
    const corrupted = (packed.encoded[0] === 'A' ? 'B' : 'A') + packed.encoded.slice(1)
    expect(() => context.decode(corrupted)).toThrow('checksum')
  })

  test('captures bytes before publication and reuses one immutable Blob across crashes and BFCache', async () => {
    const h = await standaloneHarness()
    try {
      h.node.textContent = 'changed after bootstrap'
      const first = h.adapter.renderMermaidSVGWithReceipt('first', {})
      await h.flush()
      expect(h.context.codecCalls).toBe(1)
      const initial = h.workers[0]!, blob = h.blobs.get(initial.url)!
      expect(await blob.text()).toBe('123456789')
      initial.reply(1); await first
      expect(h.revoked).toEqual([initial.url])
      initial.crash()
      const retry = h.adapter.renderMermaidSVGWithReceipt('retry', {})
      await h.flush()
      const replacement = h.workers[1]!
      expect(replacement.url).not.toBe(initial.url)
      expect(h.blobs.get(replacement.url)).toBe(blob)
      replacement.reply(2); await retry
      h.dispatch('pagehide')
      expect(replacement.terminated).toBe(true)
      h.dispatch('pageshow')
      const restored = h.adapter.renderMermaidSVGWithReceipt('restored', {})
      await h.flush()
      const resumed = h.workers[2]!
      expect(h.blobs.get(resumed.url)).toBe(blob)
      resumed.reply(3); await restored
      expect(h.context.codecCalls).toBe(1)
    } finally { h.dispatch('pagehide') }
  })

  test('a page hidden before decode cannot create a late worker or clear a restored load', async () => {
    const h = await standaloneHarness()
    try {
      const stale = h.adapter.renderMermaidSVGWithReceipt('old', {}).catch(error => error)
      h.dispatch('pagehide'); h.dispatch('pageshow')
      const current = h.adapter.renderMermaidSVGWithReceipt('current', {})
      await h.flush()
      expect((await stale).name).toBe('PreviewSupersededError')
      expect(h.sent.map(request => request.source)).toEqual(['current'])
      expect(h.context.codecCalls).toBe(1)
      h.workers[0]!.reply(1); await current
      expect(h.workers).toHaveLength(1)
    } finally { h.dispatch('pagehide') }
  })

  test.each(['missing', 'packed', 'decoded'] as const)('rejects a %s payload before any Worker or URL and retains a typed reload failure', async corruption => {
    const h = await standaloneHarness(corruption === 'missing' ? null : corruption === 'packed' ? 'MDIzNDU2Nzg5' : undefined, corruption === 'decoded')
    try {
      const first = await h.adapter.renderMermaidSVGWithReceipt('first', {}).catch(error => error)
      expect(first.name).toBe('PreviewRuntimeLoadError')
      const second = await h.adapter.renderMermaidSVGWithReceipt('second', {}).catch(error => error)
      expect(second).toBe(first)
      expect(h.workers).toHaveLength(0)
      expect(h.blobs.size).toBe(0)
      expect(h.context.codecCalls).toBe(corruption === 'decoded' ? 1 : 0)
    } finally { h.dispatch('pagehide') }
  })
})

describe('persistent preview worker queue', () => {
  test('keeps option snapshots and supersession while the worker client is still loading', async () => {
    const h = workerHarness()
    let ready!: (client: PreviewWorkerClient) => void
    const loading = new Promise<PreviewWorkerClient>(resolve => { ready = resolve })
    const adapter = createBrowserEditorAdapter(() => loading)
    try {
      const stale = adapter.renderMermaidSVGWithReceipt('old', {}).catch(error => error)
      adapter.cancelPendingRender()
      const options = { style: ['crisp', 'paper'] }
      const current = adapter.renderMermaidSVGWithReceipt('new', options)
      const exported = adapter.renderMermaidASCIIWithReceipt('export', {})
      options.style[1] = 'dusk'
      expect(h.workers).toHaveLength(0)
      ready(h.client)
      await Promise.resolve(); await Promise.resolve()
      expect((await stale).name).toBe('PreviewSupersededError')
      expect(h.sent).toHaveLength(1)
      expect(h.sent[0]).toMatchObject({ source: 'new', options: { style: ['crisp', 'paper'] } })
      h.reply(1)
      await current
      expect(h.sent.at(-1)?.operation).toBe('ascii')
      h.replyArtifact(2, { text: 'exported', receipt: { output: 'ascii' } })
      expect((await exported).text).toBe('exported')
      expect(h.workers).toHaveLength(1)
    } finally { h.client.dispose() }
  })

  test('preparing opt-in editor fitting keeps the worker idle and preserves authored budgets', async () => {
    const h = workerHarness(), adapter = createBrowserEditorAdapter(() => h.client)
    const dependencies = { allowedFields: adapter.SHARED_RENDER_OPTION_FIELDS, validate: adapter.validateSerializableRenderOptions, resolvePaletteInput: () => '' }
    const state = { fitLabelsToPane: true, source: '&#112;ie\n"Done": 2', paneWidth: 360.9 }
    try {
      expect(adapter.prepareEditorRenderOptions({ fitLabelsToPane: false })).toBeUndefined()
      await adapter.prepareEditorRenderOptions(state)
      expect(adapter.resolveEditorRenderOptions(state, dependencies)).toHaveProperty('pie.maxWidth', 360)
      expect(adapter.resolveEditorRenderOptions({ ...state, config: { pie: { maxWidth: 640 } } }, dependencies)).toHaveProperty('pie.maxWidth', 640)
      expect(adapter.resolveEditorRenderOptions({ ...state, source: 'flowchart TD\nA-->B' }, dependencies)).not.toHaveProperty('pie')
      expect(h.workers).toHaveLength(0)
    } finally { h.client.dispose() }
  })

  test('editor source edits use the queued worker and discard results after the draft changes', async () => {
    const h = workerHarness(), adapter = createBrowserEditorAdapter(() => h.client)
    const source = 'flowchart TD\nA[Old]\nclassDef retained border:1px s:::colid red'
    try {
      const ops = [{ kind: 'set_label', target: 'A', label: 'Reviewed' }]
      const edited = adapter.applyOps(source, ops, 'source-preserving')
      await Promise.resolve()
      ops[0]!.label = 'Changed after submission'
      expect(h.sent[0]).toMatchObject({ operation: 'mutate', source, mode: 'source-preserving', ops: [{ label: 'Reviewed' }] })
      h.replyArtifact(1, { mutation: { ok: true, source: source + '\nA[Reviewed]', mode: 'source-preserving', family: 'flowchart', verify: { ok: true, warnings: [] } } })
      expect(await edited).toMatchObject({ ok: true, mode: 'source-preserving' })
      const stale = adapter.applyOps(source, ops, 'source-preserving').catch(error => error)
      await Promise.resolve()
      adapter.cancelPendingRender()
      h.replyArtifact(2, { mutation: { ok: false, family: 'flowchart', error: { code: 'INVALID_OP', message: 'stale failure' } } })
      expect(await stale).toBeInstanceOf(PreviewSupersededError)
    } finally { h.client.dispose() }
  })

  test('editor worker performs source edits through the real mutation pipeline', async () => {
    const client = new PreviewWorkerClient(() => new Worker(new URL('../browser-preview-worker.ts', import.meta.url), { type: 'module' }))
    try {
      const source = 'classDiagram\nnamespace `~`{class P}'
      const before = await client.render(source, {})
      expect(before.svg).not.toContain('read()')
      const result = await client.applyOps(source, [{ kind: 'add_member', class: 'P', text: '+read()' }], 'source-preserving')
      expect(result).toMatchObject({ ok: true, mode: 'source-preserving', verify: { warnings: expect.arrayContaining([expect.objectContaining({ code: 'UNSUPPORTED_SYNTAX' })]) } })
      if (!result.ok) throw new Error(result.error.message)
      expect(result.source.startsWith(source)).toBe(true)
      expect(result.source).toContain('+read()')
      expect((await client.render(result.source, {})).svg).toContain('read()')
    } finally { client.dispose() }
  })
  test.each(['dependency import', 'worker error'])('reports runtime availability across a failed %s and successful retry', async failure => {
    const h = workerHarness(), availability: boolean[] = []
    const adapter = createBrowserEditorAdapter(() => h.client, available => availability.push(available))
    try {
      const failed = adapter.renderMermaidSVGWithReceipt('first', {}).catch(error => error)
      await Promise.resolve()
      if (failure === 'dependency import') h.workers[0]!.onmessage?.({ data: { id: 1, ok: false, error: 'Module download failed', dependencyLoadFailed: true } })
      else h.workers[0]!.onerror?.({ preventDefault() {} })
      expect((await failed).name).toBe('PreviewRuntimeLoadError')
      expect(availability).toEqual([false])
      const recovered = adapter.renderMermaidSVGWithReceipt('second', {})
      await Promise.resolve()
      h.reply(2)
      await recovered
      expect(availability).toEqual([false, true])
    } finally { h.client.dispose() }
  })

  test('does not show runtime recovery for a superseded preview failure', async () => {
    const h = workerHarness(), availability: boolean[] = []
    const adapter = createBrowserEditorAdapter(() => h.client, available => availability.push(available))
    try {
      const stale = adapter.renderMermaidSVGWithReceipt('old', {}).catch(error => error)
      await Promise.resolve()
      adapter.cancelPendingRender()
      const current = adapter.renderMermaidSVGWithReceipt('new', {})
      await Promise.resolve()
      h.workers[0]!.onmessage?.({ data: { id: 1, ok: false, error: 'Module download failed', dependencyLoadFailed: true } })
      await stale
      expect(availability).toEqual([])
      h.reply(2)
      await current
      expect(availability).toEqual([true])
    } finally { h.client.dispose() }
  })

  test.each(['ascii', 'png'] as const)('replaces a failed dependency worker even when its %s request was superseded', async operation => {
    const h = workerHarness()
    try {
      const cancelled = (operation === 'ascii'
        ? h.client.renderText('old', {}, true)
        : h.client.renderPng('old', {}, 1, async () => ({ png: new Uint8Array([137, 80]) }))).catch(error => error)
      h.client.invalidate()
      const preview = h.client.render('new', {}).catch(error => error)
      const exported = h.client.renderText('new', {}, false).catch(error => error)
      const failedWorker = h.workers[0]!
      failedWorker.onmessage?.({ data: { id: 1, ok: false, error: 'Module download failed', dependencyLoadFailed: true } })
      expect(await cancelled).toBeInstanceOf(PreviewSupersededError)
      expect(failedWorker.terminated).toBe(true)
      expect(h.workers).toHaveLength(2)
      expect(h.sent.map(request => request.operation)).toEqual([operation, 'preview'])
      h.reply(2)
      expect((await preview).svg).toBe('<svg/>')
      expect(h.sent.map(request => request.operation)).toEqual([operation, 'preview', 'unicode'])
      // Replies from the discarded worker cannot finish the new worker's job.
      failedWorker.onmessage?.({ data: { id: 3, ok: true, artifact: { text: 'stale', receipt: { output: 'unicode' } } } })
      h.replyArtifact(3, { text: 'recovered', receipt: { output: 'unicode' } })
      expect((await exported).text).toBe('recovered')
    } finally { h.client.dispose() }
  })

  test('orders text exports with the newest preview and bounds pending exports', async () => {
    const h = workerHarness()
    try {
      const first = h.client.render('first', {})
      const ascii = h.client.renderText('first', {}, true)
      const preview = h.client.render('latest', {})
      const unicode = h.client.renderText('first', {}, false)
      h.reply(1)
      await first
      expect(h.sent.map(r => r.operation)).toEqual(['preview', 'ascii'])
      h.replyArtifact(2, { text: 'plain', receipt: { output: 'ascii' } })
      expect((await ascii).text).toBe('plain')
      expect(h.sent.at(-1)?.source).toBe('latest')
      h.reply(3)
      await preview
      h.replyArtifact(4, { text: 'unicode', receipt: { output: 'unicode' } })
      expect((await unicode).text).toBe('unicode')
      const active = h.client.render('active', {}).catch(error => error)
      const exports = Array.from({ length: 4 }, () => h.client.renderText('queued', {}, true).catch(error => error))
      await expect(h.client.renderText('overflow', {}, true)).rejects.toThrow('queue is full')
      h.client.invalidate()
      for (const error of await Promise.all(exports)) expect(error).toBeInstanceOf(PreviewSupersededError)
      h.reply(5)
      await active
      expect(h.workers).toHaveLength(1)
    } finally { h.client.dispose() }
  })

  test('PNG raster transport snapshots bytes and host metadata without detaching the caller buffer', async () => {
    const h = workerHarness(), bytes = new Uint8Array([137, 80, 78, 71])
    let reads = 0
    try {
      const png = h.client.renderPng('PNG', {}, 1, async (_svg, context) => {
        expect(context.rasterDimensions.width).toBe(1)
        return { get png() { reads++; return bytes }, diagnostics: [{ code: 'FONT_NOTE', message: 'host note' }], fontSources: ['embedded-data-uri'] }
      })
      h.raster(1)
      await Promise.resolve(); await Promise.resolve()
      const transfer = h.sent.at(-1)!
      expect(transfer.kind).toBe('rasterized')
      expect(transfer.png).toEqual(bytes)
      expect(transfer.png).not.toBe(bytes)
      expect(bytes.byteLength).toBe(4)
      expect(reads).toBe(1)
      h.replyArtifact(1, { png: bytes, receipt: { output: 'png' }, diagnostics: [{ code: 'WORKER_NOTE' }] })
      const artifact = await png
      expect(artifact.diagnostics.map(d => d.code)).toEqual(['WORKER_NOTE', 'FONT_NOTE'])
      expect(artifact.runtime.fontSources).toEqual(['embedded-data-uri'])
    } finally { h.client.dispose() }
  })

  test('rejects oversized raster buffers before copying and ignores callback completion after a crash', async () => {
    const h = workerHarness()
    try {
      const rejected = h.client.renderPng('large', {}, 1, async () => ({ png: new Uint8Array(2_000_000) })).catch(error => error)
      h.raster(1)
      await Promise.resolve(); await Promise.resolve()
      expect(h.sent.at(-1)).toMatchObject({ kind: 'rasterized', ok: false })
      h.workers[0]!.onmessage?.({ data: { id: 1, ok: false, error: 'allocation-derived limit' } })
      expect((await rejected).message).toContain('allocation-derived')
      let finish!: (value: { png: Uint8Array }) => void
      const pending = h.client.renderPng('pending', {}, 1, () => new Promise(resolve => { finish = resolve })).catch(error => error)
      h.raster(2)
      h.workers[0]!.onerror?.({ preventDefault() {} })
      expect((await pending).message).toContain('crashed')
      const sentBefore = h.sent.length
      finish({ png: new Uint8Array([137, 80]) })
      await Promise.resolve(); await Promise.resolve()
      expect(h.sent).toHaveLength(sentBefore)
      const recovered = h.client.render('recovered', {})
      h.reply(3)
      expect((await recovered).svg).toBe('<svg/>')
    } finally { h.client.dispose() }
  })

  test('a wrong output receipt terminates the transaction and rejects queued callers', async () => {
    const h = workerHarness()
    const active = h.client.render('first', {}).catch(error => error)
    const queued = h.client.renderText('second', {}, true).catch(error => error)
    h.replyArtifact(1, { text: 'wrong', receipt: { output: 'ascii' } })
    for (const error of await Promise.all([active, queued])) expect(error.message).toContain('wrong output receipt')
    expect(h.workers[0]!.terminated).toBe(true)
    h.client.dispose()
  })

  test('a new source releases a PNG awaiting Canvas so the preview can proceed', async () => {
    const h = workerHarness()
    let finish!: (value: { png: Uint8Array }) => void
    try {
      const png = h.client.renderPng('old', {}, 1, () => new Promise(resolve => { finish = resolve })).catch(error => error)
      h.raster(1)
      h.client.invalidate()
      expect(h.sent.at(-1)).toMatchObject({ id: 1, kind: 'rasterized', ok: false })
      const preview = h.client.render('new', {})
      h.workers[0]!.onmessage?.({ data: { id: 1, ok: false, error: 'cancelled raster' } })
      expect(await png).toBeInstanceOf(PreviewSupersededError)
      expect(h.sent.at(-1)?.source).toBe('new')
      h.reply(2)
      await preview
      const count = h.sent.length
      finish({ png: new Uint8Array([137, 80]) })
      await Promise.resolve(); await Promise.resolve()
      expect(h.sent).toHaveLength(count)
      expect(h.workers).toHaveLength(1)
    } finally { h.client.dispose() }
  })

  test('keeps only the newest pending edit and ignores unmatched replies', async () => {
    const h = workerHarness()
    try {
      const first = h.client.render('first', {})
      const replaced = h.client.render('replaced', {})
      const rejected = replaced.catch(error => error)
      const options = { style: ['crisp', 'paper'], graphLayout: { backend: 'agentic' as const } }
      const newest = h.client.render('newest', options)
      options.style[1] = 'dusk'
      expect(await rejected).toBeInstanceOf(PreviewSupersededError)
      expect(h.sent.map(r => r.source)).toEqual(['first'])
      h.reply(99)
      expect(h.sent).toHaveLength(1)
      h.reply(1, '<svg>first</svg>')
      expect((await first).svg).toContain('first')
      expect(h.sent.map(r => r.source)).toEqual(['first', 'newest'])
      expect(h.sent[1]?.options).toEqual({ style: ['crisp', 'paper'], graphLayout: { backend: 'agentic' } })
      h.reply(3, '<svg>newest</svg>')
      expect((await newest).svg).toContain('newest')
      expect(h.workers).toHaveLength(1)
    } finally { h.client.dispose() }
  })

  test('a worker crash rejects all waiting callers, and the next edit starts a new worker', async () => {
    const h = workerHarness()
    try {
      const first = h.client.render('first', {}).catch(error => error)
      const next = h.client.render('queued', {}).catch(error => error)
      h.workers[0]!.onerror?.({ preventDefault() {} })
      for (const error of await Promise.all([first, next])) expect(error.message).toContain('crashed')
      expect(h.workers[0]!.terminated).toBe(true)
      const recovered = h.client.render('recovered', {})
      expect(h.workers).toHaveLength(2)
      h.reply(3)
      expect((await recovered).svg).toBe('<svg/>')
    } finally { h.client.dispose() }
  })

  test('a hung job terminates its worker instead of leaving a permanent pending preview', async () => {
    const h = workerHarness(5)
    await expect(h.client.render('hang', {})).rejects.toThrow('exceeded')
    expect(h.workers[0]!.terminated).toBe(true)
  })
})

test('codec admission shares one nested work budget and cannot swallow exhaustion', () => {
  expect(() => withCodecBudget(() => {
    for (let index = 0; index < 16_000_000; index++) chargeCodecLoop()
    try {
      withCodecBudget(() => {
        for (let index = 0; index <= 16_000_000; index++) chargeCodecLoop()
      })
    } catch { /* The enclosing admission must still reject this result. */ }
    return 'must not escape'
  })).toThrow('32000000 loop bodies')
  expect(withCodecBudget(() => { chargeCodecLoop(); return 'fresh admission' })).toBe('fresh admission')
})

test.each(['output', 'window', 'asynchronous work'] as const)('codec admission retains a caught %s refusal', violation => {
  expect(() => withCodecBudget(() => {
    try {
      withCodecBudget(() => {
        if (violation === 'output') limitCodecOutput(8 * 1024 * 1024 + 1)
        else if (violation === 'window') limitCodecWindow(23)
        else return { then() {} }
      })
    } catch { /* A rejected nested codec cannot produce an admitted result. */ }
  })).toThrow(violation === 'output' ? '8 MiB' : violation === 'window' ? '22-bit' : 'synchronous')
})

test('the docs replay changes one label and preserves the authored identities and directed connections', () => {
  const demo = buildDocsEditDemo()
  const read = (source: string) => {
    const parsed = parseRegisteredMermaid(source)
    if (!parsed.ok) throw new Error('Example did not parse')
    const diagram = asFlowchart(parsed.value)
    if (!diagram) throw new Error('Example is not a flowchart')
    return diagram.body.graph
  }
  const before = read(demo.beforeSource), after = read(demo.afterSource)
  expect([...before.nodes.values()].map(node => [node.id, node.label])).toEqual([['Draft', 'Draft'], ['Review', 'Review'], ['Publish', 'Publish']])
  expect([...after.nodes.values()].map(node => [node.id, node.label])).toEqual([['Draft', 'Draft'], ['Review', 'Approved'], ['Publish', 'Publish']])
  for (const body of [before, after]) expect(body.edges.map(edge => [edge.source, edge.target])).toEqual([['Draft', 'Review'], ['Review', 'Publish']])
  for (const state of demo.states) expect(state.warnings).toEqual([])
})


test('codec charging preserves labelled continue, unbraced loops and strict directives', () => {
  const source = `"use strict";
    const seen = [];
    outer: for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (j === 1) continue outer;
        seen.push(i);
      }
    }
    let k = 0;
    while (k++ < 2) seen.push(k);
    do seen.push('d'); while (false);
    for (const key in { a: 1, b: 2 }) seen.push(key);
    for (const value of [5, 6]) seen.push(value);
    for (let empty = 0; empty < 2; empty++);
    module.exports = { seen, strict: (function () { return this })() };
  `
  let charged = 0
  const exports = { exports: undefined as unknown }
  runInNewContext(boundStandaloneCodec(source, 'authored-codec.js', false), {
    module: exports,
    require(name: string) {
      expect(name).toBe('am-standalone-codec-budget')
      return { chargeCodecLoop() { charged++ } }
    },
  })
  expect(JSON.parse(JSON.stringify(exports.exports))).toEqual({ seen: [0, 1, 2, 1, 2, 'd', 'a', 'b', 5, 6] })
  expect((exports.exports as { strict: unknown }).strict).toBeUndefined()
  expect(charged).toBe(18)
})


test('standalone notices retain actual legal comments after regex quotes without promoting string contents', () => {
  const source = `const pattern = /['"]/; /*! @license retained-after-regexp */ const inert = '/* @license inert-string */';`
  const notices = standaloneWorkerNotices(source, [], process.cwd())
  expect(notices).toContain('/*! @license retained-after-regexp */')
  expect(notices).not.toContain('/* @license inert-string */')
})
