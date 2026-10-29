import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CASES, requiresStructuredMutation, runAgentUsageEval, type AgentUsageEvalCase, type AgentUsageEvalResult } from './run.ts'
import { SDK_DECLARATION } from '../../src/mcp/sdk-decl.ts'
import type { DiscoveryObservation } from './capture-subagent-prompt-eval.ts'

export type LiveProvider = 'anthropic' | 'openai-compatible'
export type TranscriptProvider = LiveProvider | 'pi-subagent' | `${string}-subagent`
export type LiveSurface = 'instructions' | 'skill' | 'none'
export type LiveRequest = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface ModelReply {
  text: string
  usage: { inputTokens: number; outputTokens: number } | null
}

export interface LiveModelConfig {
  provider: LiveProvider
  model: string
  apiKey: string
  baseUrl?: string
  maxTokens: number
  temperature: number
}

export interface LiveTranscript {
  schemaVersion: 1
  capturedAt: string
  provider: TranscriptProvider
  model: string
  caseId: string
  task: { prompt: string; input?: string }
  prompts: { system: string; user: string }
  rawResponse: string
  script: string
  result: AgentUsageEvalResult
  surface?: LiveSurface
  metrics?: {
    generationMs: number
    executionMs: number
    totalMs: number
    usage: ModelReply['usage']
    /** Observed one-shot generation followed by sandbox execution, not a tool-loop agent. */
    discovery: DiscoveryObservation | null
  }
}

export interface LiveRunSummary {
  ok: boolean
  capturedAt: string
  provider: TranscriptProvider
  model: string
  total: number
  passed: number
  safePathRate: number
  structuredPathRate: number
  transcripts: string[]
  surface?: LiveSurface
  discoveryObservedCases?: number
}

function argValue(args: string[], name: string): string | undefined {
  const eq = args.find(a => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = args.indexOf(name)
  return idx >= 0 ? args[idx + 1] : undefined
}

function hasArg(args: string[], name: string): boolean {
  return args.includes(name)
}

export function resolveLiveModelConfig(env: NodeJS.ProcessEnv = process.env, args: string[] = process.argv.slice(2)): LiveModelConfig {
  const provider = (argValue(args, '--provider') ?? env.AGENT_USAGE_LIVE_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai-compatible')) as LiveProvider
  if (provider !== 'anthropic' && provider !== 'openai-compatible') throw new Error(`Unsupported API-backed live eval provider: ${provider}`)
  const apiKey = argValue(args, '--api-key')
    ?? (provider === 'anthropic' ? env.ANTHROPIC_API_KEY : (env.OPENAI_API_KEY ?? env.OPENROUTER_API_KEY))
  if (!apiKey) throw new Error(`Missing API key. Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'} or pass --api-key.`)
  const model = argValue(args, '--model')
    ?? env.AGENT_USAGE_LIVE_MODEL
    ?? (provider === 'anthropic' ? env.ANTHROPIC_MODEL : (env.OPENAI_MODEL ?? env.OPENROUTER_MODEL))
  if (!model) throw new Error('Missing model. Set AGENT_USAGE_LIVE_MODEL (or ANTHROPIC_MODEL / OPENAI_MODEL) or pass --model.')
  const baseUrl = argValue(args, '--base-url')
    ?? env.AGENT_USAGE_LIVE_BASE_URL
    ?? (provider === 'openai-compatible' ? (env.OPENAI_BASE_URL ?? (env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')) : undefined)
  const maxTokens = Number(argValue(args, '--max-tokens') ?? env.AGENT_USAGE_LIVE_MAX_TOKENS ?? 4000)
  const temperature = Number(argValue(args, '--temperature') ?? env.AGENT_USAGE_LIVE_TEMPERATURE ?? 0)
  return { provider, model, apiKey, baseUrl, maxTokens, temperature }
}

export function buildLiveEvalSystemPrompt(instructions = readFileSync(join(import.meta.dir, '..', '..', 'Instructions_for_agents.md'), 'utf8')): string {
  return `You are generating JavaScript for agentic-mermaid Code Mode.
Return ONLY the JavaScript body that will be passed to execute(code). Do not include markdown.
The code runs synchronously in a node:vm sandbox with global mermaid.*; do not use async/await, Promise jobs, dynamic import, filesystem, network, or template-literal interpolation.
For new diagrams, author Mermaid source directly, then parseRegisteredMermaid and verifyMermaid. For existing modeled diagrams, use family narrowers, mutate, verifyMermaid, and serializeMermaid. Inspect verify.ok/warnings before returning or serializing. SDK-returned diagrams are read-only; structured edits must use mermaid.mutate.

${instructions}

SDK declaration:
${SDK_DECLARATION}`
}

export function buildLiveEvalUserPrompt(c: AgentUsageEvalCase): string {
  return `Task ID: ${c.id}
Task: ${c.prompt}
${c.input ? `Input Mermaid source:\n${c.input}\n` : ''}
Return only executable synchronous Code Mode JavaScript.`
}

function stripOuterArrowFunction(script: string): string {
  const trimmed = script.trim().replace(/;\s*$/, '')
  const match = trimmed.match(/^(?:async\s*)?\(\s*\)\s*=>\s*\{([\s\S]*)\}$/)
    ?? trimmed.match(/^(?:async\s*)?function\s*\(\s*\)\s*\{([\s\S]*)\}$/)
  return match ? match[1]!.trim() : script.trim()
}

export function extractCodeModeScript(text: string): string {
  const fenced = Array.from(text.matchAll(/```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)```/gi))
  const candidate = fenced.length ? fenced.sort((a, b) => b[1]!.length - a[1]!.length)[0]![1]! : text
  return stripOuterArrowFunction(candidate)
}

function tokenUsage(input: unknown, output: unknown): ModelReply['usage'] {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0
    && typeof output === 'number' && Number.isSafeInteger(output) && output >= 0
    ? { inputTokens: input, outputTokens: output } : null
}

async function callLiveModel(config: LiveModelConfig, system: string, user: string, request: LiveRequest): Promise<ModelReply> {
  if (config.provider === 'anthropic') {
    const res = await request(config.baseUrl ?? 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`)
    const json = JSON.parse(body) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } }
    const text = json.content?.filter(p => p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n')
    if (!text) throw new Error('Anthropic API returned no text content')
    const baseUsage = tokenUsage(json.usage?.input_tokens, json.usage?.output_tokens)
    const cached = [json.usage?.cache_creation_input_tokens, json.usage?.cache_read_input_tokens].map(value => value === undefined ? 0 : typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : NaN)
    return { text, usage: baseUsage ? tokenUsage(baseUsage.inputTokens + cached[0]! + cached[1]!, baseUsage.outputTokens) : null }
  }

  const base = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await request(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${body.slice(0, 500)}`)
  const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
  const text = json.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI-compatible API returned no message content')
  return { text, usage: tokenUsage(json.usage?.prompt_tokens, json.usage?.completion_tokens) }
}

export async function runLiveAgentUsageEval(config: LiveModelConfig, opts: { outDir?: string; caseIds?: string[]; surface?: LiveSurface; request?: LiveRequest } = {}): Promise<LiveRunSummary> {
  const capturedAt = new Date().toISOString()
  const outDir = opts.outDir ?? join(import.meta.dir, 'transcripts', capturedAt.replace(/[:.]/g, '-'))
  const cases = opts.caseIds?.length ? DEFAULT_CASES.filter(c => opts.caseIds!.includes(c.id)) : DEFAULT_CASES
  if (opts.caseIds?.length) {
    const found = new Set(cases.map(c => c.id))
    const missing = opts.caseIds.filter(id => !found.has(id))
    if (missing.length) throw new Error(`Unknown live eval case id(s): ${missing.join(', ')}`)
  }
  if (cases.length === 0) throw new Error('Live eval selected zero cases')
  mkdirSync(outDir, { recursive: true })
  const surface = opts.surface ?? 'instructions'
  const guidance = surface === 'none' ? '' : readFileSync(join(import.meta.dir, '..', '..', surface === 'skill'
    ? 'skills/agentic-mermaid-diagram-workflow/SKILL.md' : 'Instructions_for_agents.md'), 'utf8')
  const system = buildLiveEvalSystemPrompt(guidance)
  const transcripts: string[] = []
  let passed = 0
  let safePathPassed = 0
  let structuredPathPassed = 0
  let structuredCases = 0
  let discoveryObservedCases = 0

  for (const c of cases) {
    const user = buildLiveEvalUserPrompt(c)
    const started = performance.now()
    const reply = await callLiveModel(config, system, user, opts.request ?? fetch)
    const generationMs = performance.now() - started
    const rawResponse = reply.text
    const script = extractCodeModeScript(rawResponse)
    let firstProductiveMs: number | null = null
    const executionStarted = performance.now()
    const summary = await runAgentUsageEval([{ ...c, script }], { onTraceCall: call => {
      // A successful parse/create has a trusted diagram ID. Failed parses
      // and discovery-only calls cannot claim productive engagement.
      if (firstProductiveMs === null && 'diagram' in call && call.diagram !== undefined
        && (call.verb === 'parse' || call.verb === 'create')) firstProductiveMs = performance.now() - started
    } })
    const executionMs = performance.now() - executionStarted
    const discovery: DiscoveryObservation | null = firstProductiveMs !== null && reply.usage ? {
      turnsBeforeFirstProductiveCall: 1,
      inputTokensBeforeFirstProductiveCall: reply.usage.inputTokens,
      outputTokensBeforeFirstProductiveCall: reply.usage.outputTokens,
      elapsedMsToFirstProductiveCall: firstProductiveMs,
    } : null
    if (discovery) discoveryObservedCases++
    const result = summary.results[0]!
    if (result.ok) passed++
    if (result.traceOk) safePathPassed++
    if (requiresStructuredMutation(c.id)) {
      structuredCases++
      if (result.traceOk) structuredPathPassed++
    }
    const transcript: LiveTranscript = {
      schemaVersion: 1,
      capturedAt,
      provider: config.provider,
      model: config.model,
      caseId: c.id,
      task: { prompt: c.prompt, input: c.input },
      prompts: { system, user },
      rawResponse,
      script,
      result,
      surface,
      metrics: { generationMs, executionMs, totalMs: performance.now() - started, usage: reply.usage, discovery },
    }
    const file = join(outDir, `${c.id}.json`)
    writeFileSync(file, JSON.stringify(transcript, null, 2) + '\n')
    transcripts.push(file)
  }

  const summary: LiveRunSummary = { ok: passed === cases.length, capturedAt, provider: config.provider, model: config.model, total: cases.length, passed, safePathRate: safePathPassed / cases.length, structuredPathRate: structuredPathPassed / Math.max(1, structuredCases), transcripts, surface, discoveryObservedCases }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

/** Paired tasks, alternating request order to reduce a fixed ordering bias.
 * Results describe this sample; they do not establish statistical significance. */
export async function runLiveSkillComparison(config: LiveModelConfig, opts: { outDir?: string; caseIds?: string[]; request?: LiveRequest } = {}) {
  const outDir = opts.outDir ?? join(import.meta.dir, 'transcripts', `skill-comparison-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  const caseIds = opts.caseIds ?? DEFAULT_CASES.map(c => c.id)
  if (!caseIds.length || new Set(caseIds).size !== caseIds.length || caseIds.some(id => !DEFAULT_CASES.some(c => c.id === id))) throw new Error('Comparison requires unique, known case IDs')
  const pairs: Array<{ caseId: string; none: LiveTranscript; skill: LiveTranscript }> = []
  for (const [index, caseId] of caseIds.entries()) {
    const pair = {} as Record<'none' | 'skill', LiveTranscript>
    const order: Array<'none' | 'skill'> = index % 2 === 0 ? ['none', 'skill'] : ['skill', 'none']
    for (const surface of order) {
      const run = await runLiveAgentUsageEval(config, { outDir: join(outDir, caseId, surface), caseIds: [caseId], surface, request: opts.request })
      pair[surface] = JSON.parse(readFileSync(run.transcripts[0]!, 'utf8')) as LiveTranscript
    }
    pairs.push({ caseId, ...pair })
  }
  const summary = {
    model: config.model, provider: config.provider, totalPairs: pairs.length,
    noneTaskPassed: pairs.filter(p => p.none.result.taskOk).length,
    skillTaskPassed: pairs.filter(p => p.skill.result.taskOk).length,
    skillOnlyPassed: pairs.filter(p => p.skill.result.taskOk && !p.none.result.taskOk).map(p => p.caseId),
    noneOnlyPassed: pairs.filter(p => p.none.result.taskOk && !p.skill.result.taskOk).map(p => p.caseId),
    pairs,
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'comparison.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    if (hasArg(args, '--help')) {
      console.log(`Usage: bun run eval/agent-usage/live.ts --provider anthropic|openai-compatible --model <model> [--out-dir dir] [--cases id1,id2] [--surface instructions|skill|none] [--compare-skill]\n\nEnvironment: ANTHROPIC_API_KEY or OPENAI_API_KEY, plus AGENT_USAGE_LIVE_MODEL.`)
      process.exit(0)
    }
    const config = resolveLiveModelConfig(process.env, args)
    const outDir = argValue(args, '--out-dir')
    const caseIds = argValue(args, '--cases')?.split(',').map(s => s.trim()).filter(Boolean)
    if (hasArg(args, '--compare-skill')) {
      const comparison = await runLiveSkillComparison(config, { outDir, caseIds })
      console.log(JSON.stringify(comparison, null, 2))
      process.exit(0)
    }
    const surface = argValue(args, '--surface') ?? 'instructions'
    if (!['instructions', 'skill', 'none'].includes(surface)) throw new Error(`Unknown surface: ${surface}`)
    const summary = await runLiveAgentUsageEval(config, { outDir, caseIds, surface: surface as LiveSurface })
    console.log(JSON.stringify(summary, null, 2))
    process.exit(summary.ok ? 0 : 1)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(2)
  }
}
