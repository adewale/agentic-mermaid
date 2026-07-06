// Loop 13 M6: agent-usage validation harness — scenarios + anti-pattern linter.

import { describe, test, expect } from 'bun:test'
import { readFileSync, mkdtempSync, writeFileSync as fsWriteFileSync, readFileSync as fsReadFileSync, rmSync, existsSync as fsExistsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runAllScenarios, lintAgentTrace, type SdkCall } from '../../eval/agent-usage/harness.ts'
import { DEFAULT_CASES, KNOWLEDGE_CASES, CREATE_CASES, checkAgentUsageTaskSource, requiresStructuredMutation, runAgentUsageEval } from '../../eval/agent-usage/run.ts'
import { AGENT_USAGE_SUPPORTED_FAMILIES, scoreAgentUsageRenderedQuality } from '../../eval/agent-usage/render-quality.ts'
import { extractHomepageAgentPrompt, homepagePromptChecklist, HOMEPAGE_AGENT_POINTER, buildHomepageFullPrompt, readStartMd } from '../../eval/agent-usage/homepage-prompt.ts'
import { buildSubagentPromptEvalRequest, extractBareTask, prepareSubagentPromptEval, finalizeSubagentPromptEval } from '../../eval/agent-usage/capture-subagent-prompt-eval.ts'
import { runCli } from '../cli/index.ts'
import { executeInSandbox } from '../mcp/sandbox.ts'
import { handleRequest } from '../mcp/server.ts'
import { parseMermaid, verifyMermaid, serializeMermaid, mutate, buildMermaid } from '../agent/index.ts'
import { asFlowchart } from '../agent/types.ts'
import { handleHostedRequest } from '../mcp/hosted-server.ts'

const REPO = join(import.meta.dir, '..', '..')

type FailureCorpus = {
  cases: FailureCase[]
}

type FailureCase = {
  id: string
  kind: 'raw-response' | 'code-mode'
  source: string
  caseId: string
  prompt: string
  rawResponse: string
  expectedRawFindings?: string[]
  expectedResult?: { ok: boolean; taskOk: boolean; traceOk: boolean; findings: string[] }
}

function loadFailureCorpus(): FailureCorpus {
  return JSON.parse(readFileSync(join(REPO, 'eval/agent-usage/failure-corpus/cases.json'), 'utf8')) as FailureCorpus
}

function classifyRawAgentFailure(text: string): string[] {
  const findings = new Set<string>()
  if (/```mermaid/i.test(text)) findings.add('MERMAID_FENCE_NOT_CODE_MODE')
  if (/`?am\s+(mutate|render|verify|batch|preview)\b/i.test(text)) findings.add('CLI_MISUSE')
  if (!/\bmermaid\.(parseMermaid|asFlowchart|asSequence|asTimeline|asClass|asEr|mutate|verifyMermaid|serializeMermaid)\b/.test(text)) findings.add('NO_SDK_CALLS')
  if (/^\s*```mermaid/i.test(text) && !/\bverifyMermaid\b/.test(text)) findings.add('REGENERATED_SOURCE')
  if (/\n\s*```mermaid/i.test(text) && /Used Agentic Mermaid|Verification result|source-level path/i.test(text)) findings.add('PROSE_NOT_CODE_MODE')
  if (/source-level path/i.test(text) && /alt/i.test(text) && /```mermaid\s*sequenceDiagram/i.test(text)) findings.add('SOURCE_LEVEL_OPAQUE_EDIT')
  return [...findings].sort()
}

describe('agent-usage scenarios (the mutation loop works)', () => {
  test('all scripted scenarios pass', () => {
    for (const r of runAllScenarios()) {
      expect({ name: r.name, ok: r.ok, detail: r.detail }).toEqual({ name: r.name, ok: true, detail: r.detail })
    }
  })

  test('serialized scenarios take clean mutation paths', () => {
    for (const r of runAllScenarios().filter(r => r.trace.some(c => c.verb === 'serialize'))) {
      const verbs = r.trace.map(c => c.verb)
      expect(verbs[0]).toBe('parse')
      expect(verbs).toContain('mutate')
      expect(verbs.indexOf('verify')).toBeGreaterThan(-1)
      expect(verbs.indexOf('verify')).toBeLessThan(verbs.indexOf('serialize'))
      expect(lintAgentTrace(r.trace)).toEqual([])
    }
  })
})

describe('anti-pattern linter (the affordances steer agents right)', () => {
  test('clean loop produces zero findings', () => {
    const trace: SdkCall[] = [
      { verb: 'parse' }, { verb: 'mutate', body: 'flowchart' }, { verb: 'verify' }, { verb: 'serialize' },
    ]
    expect(lintAgentTrace(trace)).toEqual([])
  })

  test('serialize without intervening verify is flagged', () => {
    const trace: SdkCall[] = [
      { verb: 'parse' }, { verb: 'mutate', body: 'flowchart' }, { verb: 'serialize' },
    ]
    const found = lintAgentTrace(trace)
    expect(found.map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('verify between mutate and serialize clears the legacy no-id flag', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart' }, { verb: 'verify' }, { verb: 'serialize' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).not.toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('real trace verify_inspect before serialize clears the diagram', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: true, inspected: false },
      { verb: 'verify_inspect', diagram: 'd1', property: 'ok' },
      { verb: 'serialize', diagram: 'd1' },
    ]
    expect(lintAgentTrace(trace)).toEqual([])
  })

  test('verify inspected only after serialize does not clear the commit point', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: true, inspected: false },
      { verb: 'serialize', diagram: 'd1' },
      { verb: 'verify_inspect', diagram: 'd1', property: 'ok' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('verify must clear the same diagram that is serialized', () => {
    const trace: SdkCall[] = [
      { verb: 'parse', diagram: 'd0' },
      { verb: 'mutate', body: 'flowchart', input: 'd0', output: 'd1' },
      { verb: 'verify', diagram: 'd0', ok: true, inspected: true },
      { verb: 'serialize', diagram: 'd1' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('failed verify does not clear a diagram for serialize', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: false, inspected: true },
      { verb: 'serialize', diagram: 'd1' },
    ]
    const codes = lintAgentTrace(trace).map(f => f.code)
    expect(codes).toContain('SERIALIZE_AFTER_FAILED_VERIFY')
    expect(codes).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('verify result must be inspected', () => {
    const trace: SdkCall[] = [
      { verb: 'mutate', body: 'flowchart', output: 'd1' },
      { verb: 'verify', diagram: 'd1', ok: true, inspected: false },
      { verb: 'serialize', diagram: 'd1' },
    ]
    expect(lintAgentTrace(trace).map(f => f.code)).toContain('VERIFY_NOT_INSPECTED')
  })

  test('string concatenation is flagged', () => {
    expect(lintAgentTrace([{ verb: 'string_concat' }])[0]!.code).toBe('STRING_CONCAT')
  })

  test('regenerate-whole-source is flagged', () => {
    expect(lintAgentTrace([{ verb: 'regenerate' }])[0]!.code).toBe('REGENERATE')
  })

  test('mutate on an opaque body is flagged', () => {
    expect(lintAgentTrace([{ verb: 'mutate', body: 'opaque' }])[0]!.code).toBe('MUTATE_ON_OPAQUE')
  })

  test('findings carry the call index', () => {
    const trace: SdkCall[] = [{ verb: 'parse' }, { verb: 'mutate', body: 'flowchart' }, { verb: 'serialize' }]
    expect(lintAgentTrace(trace)[0]!.at).toBe(2)
  })
})

describe('homepage prompt eval contract', () => {
  test('homepage CTA prompt is the prompt used by default agent eval cases', () => {
    const prompt = extractHomepageAgentPrompt()
    expect(homepagePromptChecklist(prompt)).toEqual([])
    expect(prompt).toContain('Create or edit a Mermaid diagram')
    expect(prompt).toContain('Do not assume this repository is checked out')
    expect(prompt).toContain('one channel available to you')
    expect(prompt).toContain('the hosted MCP at `https://agentic-mermaid.dev/mcp`')
    expect(prompt).toContain('Library imports, when available')
    expect(prompt).toContain('For a new diagram, author Mermaid source directly')
    expect(prompt).toContain('Mutation ops use a `kind` discriminator')
    expect(prompt).toContain('return an object with `{ source }`')
    expect(prompt).toContain('In Trace, name the channel and the calls/ops you actually ran')
    expect(prompt).toContain('For an existing diagram, parse it')
    for (const c of DEFAULT_CASES) {
      expect({ id: c.id, hasPrompt: c.prompt.includes('Create or edit a Mermaid diagram') }).toEqual({ id: c.id, hasPrompt: true })
      expect({ id: c.id, unresolved: /<replace with|<include the facts|<paste existing/.test(c.prompt) }).toEqual({ id: c.id, unresolved: false })
    }
  })

  test('the pointer and the graded inline prompt are one fetch flow, both derived from start.md', () => {
    // The homepage primary CTA is a short pointer that tells an agent to fetch
    // start.md; the eval grades the inline fallback (buildHomepageFullPrompt).
    // This proves those two surfaces are the same protocol: the inline prompt
    // embeds the entire start.md body, and the pointer targets that same hosted
    // file with the same fill-in slots — so grading the inline prompt grades
    // exactly what an agent gets by following the pointer.
    const startBody = readStartMd().replace(/^#[^\n]*\n+/, '').trim()
    const inline = buildHomepageFullPrompt()
    expect(inline.includes(startBody)).toBe(true)
    expect(HOMEPAGE_AGENT_POINTER).toContain('Fetch https://agentic-mermaid.dev/start.md and follow it')
    expect(HOMEPAGE_AGENT_POINTER).toContain('<replace with the requested diagram goal or edit>')
    for (const shared of ['Create or edit a Mermaid diagram with Agentic Mermaid.', 'Task:', 'Context:', 'Mermaid source (for edits; leave blank for a new diagram):']) {
      expect({ shared, inPointer: HOMEPAGE_AGENT_POINTER.includes(shared), inInline: inline.includes(shared) })
        .toEqual({ shared, inPointer: true, inInline: true })
    }
  })

  test('authoring facts stated by the prompt are true', () => {
    // Mirrors the prompt's "Authoring facts" section: each claim below is a
    // fact agents previously burned tokens rediscovering. If a claim stops
    // holding, fix the prompt in website/source/pages/home.html too.
    const workerLabel = 'Cloudflare Worker\nHTTP router, API routes, SPA asset server'
    const src = [
      'flowchart LR',
      '  subgraph edge["Cloudflare edge"]',
      '    worker["Cloudflare Worker\\nHTTP router, API routes, SPA asset server"]',
      '    kv["Cloudflare KV: SESSIONS"]',
      '  end',
      '  debug["Debug tools"]',
      '  worker -- "create session, fallback reads" --> kv',
      '  debug -. "reads diagnostics" .-> worker',
    ].join('\n')

    // Quoted punctuation labels, \n line breaks, subgraphs, and labeled solid/
    // dotted edges all parse into the structured flowchart body (not opaque).
    const parsed = parseMermaid(src)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const flow = asFlowchart(parsed.value)
    expect(flow?.body.kind).toBe('flowchart')
    expect(flow?.body.graph.nodes.get('worker')?.label).toBe(workerLabel)
    expect(flow?.body.graph.edges.map(e => e.label)).toContain('reads diagnostics')

    // LABEL_OVERFLOW counts the longest RENDERED line (a \n splits the label
    // into display lines) and stays advisory: verify.ok remains true.
    const longestLine = Math.max(...workerLabel.split('\n').map(l => l.length))
    const verified = verifyMermaid(parsed.value)
    expect(verified.ok).toBe(true)
    expect(verified.warnings).toContainEqual({ code: 'LABEL_OVERFLOW', target: 'worker', charCount: longestLine, limit: 40 })

    // labelCharCap is the sanctioned escape hatch for intentionally long labels.
    const capped = verifyMermaid(parsed.value, { labelCharCap: 80 })
    expect(capped.warnings.filter(w => w.code === 'LABEL_OVERFLOW')).toEqual([])

    // \n canonicalizes to <br> on serialize and the result still parses.
    const round = serializeMermaid(parsed.value)
    expect(round).toContain('<br>')
    const reparsed = parseMermaid(round)
    expect(reparsed.ok).toBe(true)
    if (reparsed.ok) expect(asFlowchart(reparsed.value)?.body.graph.nodes.size).toBe(3)
  })

  test('the hosted MCP call shape quoted by the prompt works verbatim', async () => {
    // The prompt quotes an exact JSON-RPC body so agents stop rediscovering
    // the transport. Run that literal body through the hosted handler: if the
    // tool name, argument shape, or handshake-free contract drifts, this fails
    // before the prompt lies to anyone.
    const prompt = extractHomepageAgentPrompt()
    const quoted = prompt.match(/\{"jsonrpc":"2\.0"[^`]*\}/)?.[0]
    expect(quoted).toBeDefined()
    // verify/tools-list never reach Code Mode, so the execute stub must not run.
    const context = { execute: async () => { throw new Error('unexpected execute') } }
    const res = await handleHostedRequest(JSON.parse(quoted!), context) as {
      result?: { content: Array<{ text: string }>; isError?: boolean }
      error?: unknown
    }
    expect(res.error).toBeUndefined()
    expect(res.result?.isError).toBe(false)
    expect(JSON.parse(res.result!.content[0]!.text).ok).toBe(true)
    // Every tool the prompt lists exists on the hosted server.
    const list = await handleHostedRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, context) as {
      result?: { tools: Array<{ name: string }> }
    }
    const names = new Set(list.result!.tools.map(t => t.name))
    for (const tool of ['execute', 'render_svg', 'render_ascii', 'render_png', 'verify', 'describe']) {
      expect({ tool, listed: names.has(tool) }).toEqual({ tool, listed: true })
    }
  })

  test('the no-docs baseline surface carries the bare task and zero product guidance', () => {
    for (const c of DEFAULT_CASES) {
      const bare = extractBareTask(c.prompt)
      expect({ id: c.id, hasTask: bare.task.length > 0, hasContext: bare.context.length > 0 })
        .toEqual({ id: c.id, hasTask: true, hasContext: true })
      expect({ id: c.id, sourceMatchesInput: (bare.source ?? undefined) === (c.input ?? undefined) })
        .toEqual({ id: c.id, sourceMatchesInput: true })
      const request = buildSubagentPromptEvalRequest(c, 'none', 'chat')
      // The baseline exists to measure what the docs add; any leaked guidance
      // (product name, channels, workflow, response contract) poisons it.
      for (const leak of ['Agentic Mermaid', 'agentic-mermaid', 'parseMermaid', 'verifyMermaid', 'am capabilities', 'Updated Mermaid', 'Trace']) {
        expect({ id: c.id, leak, leaked: request.includes(leak) }).toEqual({ id: c.id, leak, leaked: false })
      }
      expect(request).toContain(bare.task)
    }
    expect(() => buildSubagentPromptEvalRequest(DEFAULT_CASES[0]!, 'none', 'code')).toThrow('chat-only')
  })

  test('knowledge-proof cases discriminate: tool-backed answers pass, plausible naive answers fail', async () => {
    // The stored Code Mode scripts (the docs-informed route) must satisfy
    // their own oracles end-to-end through the sandbox and trace linter.
    const summary = await runAgentUsageEval(KNOWLEDGE_CASES)
    for (const r of summary.results) {
      expect({ id: r.id, ok: r.ok, error: r.error }).toEqual({ id: r.id, ok: true, error: undefined })
    }
    // A structurally correct edit that keeps the input's messy style (quoted
    // labels, literal \n, four-space indent) is what a no-docs agent returns;
    // it must fail the canonical fixed-point oracle.
    const naiveCanonical = 'flowchart TD\n    api["API"] --> logs["Log store\\nretention: 30 days"]\n    api --> Cache\n    Cache --> db["DB"]'
    expect(checkAgentUsageTaskSource('canonical_add_cache_messy', naiveCanonical)).toBe(false)
    // A regenerating agent "repairs" the stray end; the oracle requires it
    // preserved verbatim.
    const cleanedStray = 'sequenceDiagram\n  A->>B: hi\n  B-->>A: yo\n  B-->>A: ok'
    expect(checkAgentUsageTaskSource('stray_end_source_fallback', cleanedStray)).toBe(false)
    // Knowledge cases are opt-in by explicit id and never dilute the default
    // sets that other suites iterate.
    const defaultIds = new Set(DEFAULT_CASES.map(c => c.id))
    for (const c of KNOWLEDGE_CASES) expect({ id: c.id, inDefaults: defaultIds.has(c.id) }).toEqual({ id: c.id, inDefaults: false })
  })
})

describe('stored agent-usage eval', () => {
  test('structured default cases cover every supported diagram family', () => {
    const covered = new Set(DEFAULT_CASES.filter(c => requiresStructuredMutation(c.id)).map(c => c.family).filter(Boolean))
    expect([...covered].sort()).toEqual([...AGENT_USAGE_SUPPORTED_FAMILIES].sort())
  })

  test('create cases cover every supported family and pass the authoring oracle', async () => {
    // Authoring (create) coverage mirrors the mutate coverage above: the two
    // author_* cases in DEFAULT_CASES (flowchart, sequence) plus CREATE_CASES
    // (the other ten) must span every family, and every authored fixture must
    // parse, verify, and satisfy its structural oracle.
    const authored = [...DEFAULT_CASES, ...CREATE_CASES].filter(c => !c.input && c.family)
    expect(new Set(authored.map(c => c.family))).toEqual(new Set(AGENT_USAGE_SUPPORTED_FAMILIES))
    const summary = await runAgentUsageEval(CREATE_CASES)
    expect({ ok: summary.ok, passed: summary.passed, total: summary.total })
      .toEqual({ ok: true, passed: CREATE_CASES.length, total: CREATE_CASES.length })
    for (const r of summary.results) expect({ id: r.id, ok: r.ok, taskOk: r.taskOk, traceOk: r.traceOk })
      .toEqual({ id: r.id, ok: true, taskOk: true, traceOk: true })
  })

  test('default eval outputs render into safe, non-empty SVGs with expected labels', async () => {
    const summary = await scoreAgentUsageRenderedQuality()
    expect(summary.ok).toBe(true)
    expect(summary.passed).toBe(summary.total)
    expect(summary.total).toBe(DEFAULT_CASES.length)
    expect([...summary.families].sort()).toEqual([...AGENT_USAGE_SUPPORTED_FAMILIES].sort())
    for (const result of summary.results) {
      expect({ id: result.id, ok: result.ok, warnings: result.warnings, error: result.error }).toEqual({ id: result.id, ok: true, warnings: [], error: undefined })
      expect(result.metrics?.width).toBeGreaterThan(0)
      expect(result.metrics?.height).toBeGreaterThan(0)
      expect(result.metrics?.svgBytes).toBeGreaterThan(1000)
    }
  })

  test('default Code Mode transcripts pass task and trace checks', async () => {
    const summary = await runAgentUsageEval()
    expect(summary.ok).toBe(true)
    expect(summary.passed).toBe(summary.total)
    expect(summary.safePathRate).toBe(1)
    expect(summary.structuredPathRate).toBe(1)
  })

  test('baseline.json gates deterministic stored evals', async () => {
    const baseline = JSON.parse(readFileSync(join(REPO, 'eval/agent-usage/baseline.json'), 'utf8')) as {
      total: number
      minPassed: number
      minSafePathRate: number
      minStructuredPathRate: number
    }
    const summary = await runAgentUsageEval()
    expect(summary.total).toBe(baseline.total)
    expect(summary.passed).toBeGreaterThanOrEqual(baseline.minPassed)
    expect(summary.safePathRate).toBeGreaterThanOrEqual(baseline.minSafePathRate)
    expect(summary.structuredPathRate).toBeGreaterThanOrEqual(baseline.minStructuredPathRate)
  })

  test('new-diagram source authoring passes without structured mutation', async () => {
    const summary = await runAgentUsageEval([{ id: 'author_auth_flow_source', prompt: 'author new source', script: `
      const source = '---\\ntitle: Auth Flow\\n---\\nflowchart LR\\n  A[User] --> B[Login Page]\\n  B --> C{Valid Credentials?}\\n  C -->|No| B\\n  C -->|Yes| D{MFA Enabled?}\\n  D -->|Yes| E[Enter MFA Code]\\n  E --> F{Code Valid?}\\n  F -->|No| E\\n  D -->|No| G[Create Session]\\n  F -->|Yes| G\\n  G --> H[Dashboard]'
      const parsed = mermaid.parseMermaid(source)
      if (!parsed.ok) return { error: parsed.error }
      const verify = mermaid.verifyMermaid(parsed.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source }
    ` }])
    expect(summary.ok).toBe(true)
    expect(summary.safePathRate).toBe(1)
    expect(summary.structuredPathRate).toBe(0)
    expect(summary.results[0]!.taskOk).toBe(true)
    expect(summary.results[0]!.traceOk).toBe(true)
  })

  test('task-shaped output without structured trace does not pass', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `return { source: 'flowchart TD\\n  API --> Cache\\n  Cache --> DB' }` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('decoy structured trace with regenerated output does not pass', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      mermaid.serializeMermaid(r1.value)
      return { source: 'flowchart TD\\n  API --> Cache\\n  Cache --> DB' }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('sequence-with-alt structured mutation: regenerated output (no real mutate) does not pass', async () => {
    // BUILD-18: the alt block is now mutable, so a hand-written output that
    // skips structured mutation must still fail the trace + task checks.
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_add_message', prompt: 'bad', script: `return { source: 'sequenceDiagram\\n  A->>B: hi\\n  A->>B: bye' }` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('sequence-with-alt decoy: clean trace but returned hand-built source (alt dropped) fails the task', async () => {
    // Real mutate lineage, verify+inspect, serialize — so the trace is clean
    // (traceOk true). But the returned source is a hand-built string that does
    // not match the serialized output, so the task check rejects it: returning
    // a regenerated source instead of the serialized mutation is unsafe.
    const summary = await runAgentUsageEval([{ id: 'sequence_alt_add_message', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  alt ok\\n    B-->>A: yes\\n  end')
      const seq = mermaid.asSequence(r0.value)
      const r1 = mermaid.mutate(seq, { kind: 'add_message', from: 'A', to: 'B', text: 'bye' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      mermaid.serializeMermaid(r1.value)
      return { source: 'sequenceDiagram\\n  A->>B: hi\\n  A->>B: bye' }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(true)
  })

  test('manual ValidDiagram clones cannot be used to fake structured mutation lineage', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const clone = JSON.parse(JSON.stringify(r0.value))
      clone.body.graph.nodes.Cache = { id: 'Cache', label: 'Cache' }
      clone.body.graph.edges = [{ source: 'API', target: 'Cache' }, { source: 'Cache', target: 'DB' }]
      return mermaid.mutate(clone, { kind: 'set_label', id: 'Cache', label: 'Cache' })
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('must come from mermaid.parseMermaid')
  })

  test('forged proxies cannot fake trusted diagram lineage', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const clone = JSON.parse(JSON.stringify(r0.value))
      clone.body.graph.nodes.Cache = { id: 'Cache', label: 'Cache' }
      clone.body.graph.edges = [{ source: 'API', target: 'Cache' }, { source: 'Cache', target: 'DB' }]
      const forged = new Proxy(clone, { has: () => true, get: (target, prop) => target[prop] })
      return mermaid.mutate(forged, { kind: 'set_label', id: 'Cache', label: 'Cache' })
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('must come from mermaid.parseMermaid')
  })

  test('direct IR edits after verify are rejected by read-only SDK results', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      const first = r1.value.body.graph.edges[0]
      first.target = 'Cache'
      r1.value.body.graph.edges.push({ ...first, source: 'Cache', target: 'DB' })
      return { source: mermaid.serializeMermaid(r1.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.taskOk).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('read-only')
  })

  test('decoy mutations on regenerated already-correct source do not satisfy input lineage', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> Cache\n  Cache --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Unused', label: 'Unused' })
      const r2 = mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'API->Cache' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const r4 = mermaid.mutate(r3.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
      const verify = mermaid.verifyMermaid(r4.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r4.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('failed required mutation ops do not satisfy trace requirements', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'missing-edge' })
      const r2 = mermaid.mutate(r1.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
      const verify = mermaid.verifyMermaid(r3.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r3.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('repeating required mutation kinds must satisfy required counts, not just a set', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const r2 = mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'API->DB' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const verify = mermaid.verifyMermaid(r3.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r3.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('Proxy ops cannot spoof trace opKind differently from the executed mutation', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const spoof = (fakeKind) => {
        let calls = 0
        return new Proxy({ kind: 'set_label', target: 'API', label: 'API' }, {
          get(target, prop) { if (prop === 'kind') return calls++ === 0 ? fakeKind : target.kind; return target[prop] }
        })
      }
      const r1 = mermaid.mutate(flow, spoof('add_node'))
      if (!r1.ok) return { error: r1.error }
      const r2 = mermaid.mutate(r1.value, spoof('remove_edge'))
      if (!r2.ok) return { error: r2.error }
      const r3 = mermaid.mutate(r2.value, spoof('add_edge'))
      if (!r3.ok) return { error: r3.error }
      const verify = mermaid.verifyMermaid(r3.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r3.value) }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
  })

  test('result getters cannot inspect verify then serialize during output JSON conversion', async () => {
    const summary = await runAgentUsageEval([{ id: 'cache_between_api_and_db', prompt: 'bad', script: `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  API --> DB')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })
      const r2 = mermaid.mutate(r1.value, { kind: 'remove_edge', id: 'API->DB' })
      const r3 = mermaid.mutate(r2.value, { kind: 'add_edge', from: 'API', to: 'Cache' })
      const r4 = mermaid.mutate(r3.value, { kind: 'add_edge', from: 'Cache', to: 'DB' })
      const verify = mermaid.verifyMermaid(r4.value)
      return { verify, get source() { return mermaid.serializeMermaid(r4.value) } }
    ` }])
    expect(summary.ok).toBe(false)
    expect(summary.results[0]!.traceOk).toBe(false)
    expect(summary.results[0]!.error).toContain('not allowed while returning results')
  })
})

describe('EVAL-2 failure corpus (captured bad-agent paths stay failing)', () => {
  const corpus = loadFailureCorpus()

  test('fixtures have stable unique ids and expectations', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(8)
    expect(new Set(corpus.cases.map(c => c.id)).size).toBe(corpus.cases.length)
    for (const c of corpus.cases) {
      expect(c.source).toMatch(/^(pi-subagent-|curated-from-observed-pattern)/)
      expect(c.rawResponse.length).toBeGreaterThan(20)
      if (c.kind === 'raw-response') expect(c.expectedRawFindings?.length ?? 0).toBeGreaterThan(0)
      if (c.kind === 'code-mode') expect(c.expectedResult).toBeDefined()
    }
  })

  test('raw non-Code-Mode responses are classified as unsafe paths', () => {
    for (const c of corpus.cases.filter(c => c.kind === 'raw-response')) {
      const findings = classifyRawAgentFailure(c.rawResponse)
      for (const expected of c.expectedRawFindings ?? []) expect(findings).toContain(expected)
    }
  })

  test('executable failure cases replay through the eval oracle', async () => {
    for (const c of corpus.cases.filter(c => c.kind === 'code-mode')) {
      const summary = await runAgentUsageEval([{ id: c.caseId, prompt: c.prompt, script: c.rawResponse }])
      const result = summary.results[0]!
      expect({ id: c.id, ok: result.ok, taskOk: result.taskOk, traceOk: result.traceOk }).toEqual({
        id: c.id,
        ok: c.expectedResult!.ok,
        taskOk: c.expectedResult!.taskOk,
        traceOk: c.expectedResult!.traceOk,
      })
      const findings = result.findings.map(f => f.code)
      for (const expected of c.expectedResult!.findings) expect(findings).toContain(expected)
    }
  })
})

describe('real Code Mode trace instrumentation', () => {
  test('safe execute() script produces a clean trace', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { ok: false, warnings: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect(lintAgentTrace(r.trace as SdkCall[])).toEqual([])
  })

  test('opaque mutate attempt is linted even when mutate returns a structured error', async () => {
    // BUILD-18: an alt-block sequence is now structured, so the genuinely
    // opaque case is an un-segmentable one (stray `end`). Mutating it returns
    // a structured error AND the trace flags MUTATE_ON_OPAQUE.
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('sequenceDiagram\\n  A->>B: hi\\n  end')
      return mermaid.mutate(r0.value, { kind: 'add_message', from: 'A', to: 'B', text: 'bad' })
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect((r as { value?: { ok?: boolean; error?: { code?: string } } }).value?.ok).toBe(false)
    expect((r as { value?: { error?: { code?: string } } }).value?.error?.code).toBe('INVALID_OP')
    expect(lintAgentTrace(r.trace as SdkCall[]).map(f => f.code)).toContain('MUTATE_ON_OPAQUE')
  })

  test('unsafe execute() script is linted from its actual trace', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      return mermaid.serializeMermaid(r1.value)
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect(lintAgentTrace(r.trace as SdkCall[]).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('returning verify after source does not count as pre-serialize inspection', async () => {
    const r = await executeInSandbox(`
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      const flow = mermaid.asFlowchart(r0.value)
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      const verify = mermaid.verifyMermaid(r1.value)
      return { source: mermaid.serializeMermaid(r1.value), ok: verify.ok }
    `, { trace: true })
    expect(r.ok).toBe(true)
    expect(lintAgentTrace(r.trace as SdkCall[]).map(f => f.code)).toContain('SERIALIZE_WITHOUT_VERIFY')
  })

  test('MCP tools/call execute matches traced replay', async () => {
    const code = `
      const r0 = mermaid.parseMermaid('flowchart TD\\n  A --> B')
      if (!r0.ok) return { error: 'parse' }
      const flow = mermaid.asFlowchart(r0.value)
      if (!flow) return { error: 'narrow' }
      const r1 = mermaid.mutate(flow, { kind: 'add_node', id: 'C', label: 'Cache' })
      if (!r1.ok) return { error: r1.error }
      const verify = mermaid.verifyMermaid(r1.value)
      if (!verify.ok) return { error: verify.warnings }
      return { source: mermaid.serializeMermaid(r1.value) }
    `
    const res = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute', arguments: { code } } })
    expect(res && 'result' in res).toBe(true)
    const text = ((res as any).result.content[0].text) as string
    const payload = JSON.parse(text)
    expect(payload.ok).toBe(true)

    const replay = await executeInSandbox(code, { trace: true })
    expect(replay.value).toEqual(payload.value)
    expect(lintAgentTrace(replay.trace as SdkCall[])).toEqual([])
  })
})

// The eval scores two independent axes — taskOk (is the diagram correct? graded
// by the task oracle, channel-independent) and traceOk (did the agent engage the
// safe path?). Merging them into one pass/fail let a terse-but-honest Trace sink
// a correct diagram. These pin the split (#1) and the OBSERVED tool-use signal
// (#2): traceOk is read from real `am` verbs (AM_TRACE_LOG) when present, so it
// no longer depends on how the model phrased its Trace prose.
describe('eval metric split (taskOk primary) + observed tool-use', () => {
  test('am CLI logs invoked verbs to AM_TRACE_LOG, and nothing when unset', () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-trace-'))
    const log = join(dir, 'calls.jsonl')
    const origWrite = process.stdout.write.bind(process.stdout)
    // Suppress the command's own stdout; we only care about the side log.
    ;(process.stdout as unknown as { write: (s: string) => boolean }).write = () => true
    try {
      process.env.AM_TRACE_LOG = log
      runCli(['capabilities'])
      runCli(['styles'])
      delete process.env.AM_TRACE_LOG
      runCli(['capabilities']) // unset → must not append
    } finally {
      ;(process.stdout as unknown as { write: typeof origWrite }).write = origWrite
      delete process.env.AM_TRACE_LOG
    }
    const verbs = fsReadFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l).verb)
    expect(verbs).toEqual(['capabilities', 'styles'])
    rmSync(dir, { recursive: true, force: true })
  })

  test('the library and hosted-MCP channels log through the SAME sink (not just the CLI)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'am-sink-'))
    const log = join(dir, 'calls.jsonl')
    const verbs = () => new Set(fsReadFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).verb))
    try {
      process.env.AM_TRACE_LOG = log
      // Library channel: direct imports from agentic-mermaid/agent.
      const p = parseMermaid('flowchart TD\n  A --> B')
      expect(p.ok).toBe(true)
      if (p.ok) { const f = asFlowchart(p.value); if (f) mutate(f, { kind: 'add_node', id: 'C', label: 'C' }); verifyMermaid(p.value) }
      buildMermaid('pie', [{ kind: 'add_slice', label: 'X', value: 1 }])
      // Hosted MCP channel: the declarative mutate tool routes through the same
      // library leaves (applyOps -> mutate + verifyMermaid), so it logs too.
      await handleHostedRequest(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'mutate', arguments: { source: 'flowchart TD\n  A --> B', ops: [{ kind: 'add_node', id: 'C', label: 'C' }] } } },
        { execute: async () => { throw new Error('unused') } },
      )
    } finally {
      delete process.env.AM_TRACE_LOG
    }
    // verify (library + hosted), mutate (library + hosted), build (buildMermaid) all observed.
    const seen = verbs()
    expect(seen.has('verify')).toBe(true)
    expect(seen.has('mutate')).toBe(true)
    expect(seen.has('build')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  test('a correct diagram with a terse trace passes the correctness gate; observed log overrides prose', async () => {
    const runDir = mkdtempSync(join(tmpdir(), 'subeval-'))
    prepareSubagentPromptEval({
      provider: 'unit', model: 'unit', surface: 'homepage', mode: 'chat',
      caseIds: ['cache_between_api_and_db', 'pie_add_docs_slice'],
      outDir: runDir, capturedAt: '2020-01-01T00:00:00.000Z',
    })
    // Both diagrams are CORRECT, but the Trace phrases the path inside backticks
    // with `am` and `verify` on different lines — the narrated heuristic misses it.
    const terse = (src: string) =>
      `Updated Mermaid\n\`\`\`mermaid\n${src}\n\`\`\`\nVerification\nStructurally valid.\n` +
      'Trace\n- Channel: CLI (`bun run bin/am.ts`)\n- Ran: `mutate d.mmd --op {...}` then `verify /tmp/out.mmd`'
    fsWriteFileSync(join(runDir, 'responses', 'cache_between_api_and_db.txt'), terse('flowchart TD\n  API --> Cache\n  Cache --> DB'))
    fsWriteFileSync(join(runDir, 'responses', 'pie_add_docs_slice.txt'), terse('pie\n  "Build" : 5\n  "Test" : 2\n  "Docs" : 3'))
    // OBSERVED tool-use log for the cache case only (a real mutate + verify).
    fsWriteFileSync(join(runDir, 'traces', 'cache_between_api_and_db.jsonl'), '{"verb":"mutate"}\n{"verb":"verify"}\n')

    const summary = await finalizeSubagentPromptEval({ runDir })
    // Correctness gate passes: both diagrams are right, regardless of narration.
    expect({ ok: summary.ok, taskOk: summary.taskOk, total: summary.total }).toEqual({ ok: true, taskOk: 2, total: 2 })
    expect(summary.taskOkRate).toBe(1)
    // One case graded from the observed log, one from prose → mixed.
    expect(summary.traceSource).toBe('mixed')

    const read = (id: string) => JSON.parse(fsReadFileSync(join(runDir, `${id}.json`), 'utf8')).result
    // Observed: real verbs → traceOk true despite the terse prose.
    expect(read('cache_between_api_and_db').traceOk).toBe(true)
    // Narrated: no log → the prose heuristic misses the backtick-wrapped path.
    expect(read('pie_add_docs_slice').traceOk).toBe(false)
    // Both are diagram-correct either way — the split keeps that visible.
    expect(read('cache_between_api_and_db').taskOk).toBe(true)
    expect(read('pie_add_docs_slice').taskOk).toBe(true)

    rmSync(runDir, { recursive: true, force: true })
    expect(fsExistsSync(runDir)).toBe(false)
  })
})
