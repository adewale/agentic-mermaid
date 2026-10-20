import { describe, expect, test } from 'bun:test'
import { getFamily, knownBuiltinFamilies, replaceFamilyForTest } from '../agent/families.ts'
import { renderAndVerifyMermaid, verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVGWithReceipt } from '../index.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import { PreviewWorkerClient, PreviewSupersededError } from '../browser-preview-client.ts'
import { buildDocsEditDemo } from '../../website/docs-edit-demo.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { asFlowchart } from '../agent/types.ts'

describe('one positioned artifact for preview and verification', () => {
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
  const sent: Array<{ id: number; source: string; options?: unknown }> = []
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
  const reply = (id: number, svg = '<svg/>') => workers.at(-1)!.onmessage?.({ data: { id, ok: true, artifact: { svg } } })
  return { client, sent, workers, reply }
}

describe('persistent preview worker queue', () => {
  test('keeps only the newest pending edit and ignores unmatched replies', async () => {
    const h = workerHarness()
    try {
      const first = h.client.render('first', {})
      const replaced = h.client.render('replaced', {})
      const rejected = replaced.catch(error => error)
      const options = { style: ['crisp', 'paper'] }
      const newest = h.client.render('newest', options)
      options.style[1] = 'dusk'
      expect(await rejected).toBeInstanceOf(PreviewSupersededError)
      expect(h.sent.map(r => r.source)).toEqual(['first'])
      h.reply(99)
      expect(h.sent).toHaveLength(1)
      h.reply(1, '<svg>first</svg>')
      expect((await first).svg).toContain('first')
      expect(h.sent.map(r => r.source)).toEqual(['first', 'newest'])
      expect(h.sent[1]?.options).toEqual({ style: ['crisp', 'paper'] })
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
