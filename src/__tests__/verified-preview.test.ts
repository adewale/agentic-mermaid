import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
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

describe('persistent preview worker queue', () => {
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
