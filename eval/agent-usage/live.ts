import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CASES, requiresStructuredMutation, runAgentUsageEval, type AgentUsageEvalCase, type AgentUsageEvalResult } from './run.ts'
import { SDK_DECLARATION } from '../../src/mcp/sdk-decl.ts'

export type LiveProvider = 'anthropic' | 'openai-compatible'
export type TranscriptProvider = LiveProvider | 'pi-subagent'

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
For new diagrams, author Mermaid source directly, then parseMermaid and verifyMermaid. For existing modeled diagrams, use family narrowers, mutate, verifyMermaid, and serializeMermaid. Inspect verify.ok/warnings before returning or serializing. SDK-returned diagrams are read-only; structured edits must use mermaid.mutate.

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

async function callLiveModel(config: LiveModelConfig, system: string, user: string): Promise<string> {
  if (config.provider === 'anthropic') {
    const res = await fetch(config.baseUrl ?? 'https://api.anthropic.com/v1/messages', {
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
    const json = JSON.parse(body) as { content?: Array<{ type?: string; text?: string }> }
    const text = json.content?.filter(p => p.type === 'text' && typeof p.text === 'string').map(p => p.text).join('\n')
    if (!text) throw new Error('Anthropic API returned no text content')
    return text
  }

  const base = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${body.slice(0, 500)}`)
  const json = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }
  const text = json.choices?.[0]?.message?.content
  if (!text) throw new Error('OpenAI-compatible API returned no message content')
  return text
}

export async function runLiveAgentUsageEval(config: LiveModelConfig, opts: { outDir?: string; caseIds?: string[] } = {}): Promise<LiveRunSummary> {
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
  const system = buildLiveEvalSystemPrompt()
  const transcripts: string[] = []
  let passed = 0
  let safePathPassed = 0
  let structuredPathPassed = 0
  let structuredCases = 0

  for (const c of cases) {
    const user = buildLiveEvalUserPrompt(c)
    const rawResponse = await callLiveModel(config, system, user)
    const script = extractCodeModeScript(rawResponse)
    const summary = await runAgentUsageEval([{ ...c, script }])
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
    }
    const file = join(outDir, `${c.id}.json`)
    writeFileSync(file, JSON.stringify(transcript, null, 2) + '\n')
    transcripts.push(file)
  }

  const summary: LiveRunSummary = { ok: passed === cases.length, capturedAt, provider: config.provider, model: config.model, total: cases.length, passed, safePathRate: safePathPassed / cases.length, structuredPathRate: structuredPathPassed / Math.max(1, structuredCases), transcripts }
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    if (hasArg(args, '--help')) {
      console.log(`Usage: bun run eval/agent-usage/live.ts --provider anthropic|openai-compatible --model <model> [--out-dir dir] [--cases id1,id2]\n\nEnvironment: ANTHROPIC_API_KEY or OPENAI_API_KEY, plus AGENT_USAGE_LIVE_MODEL.`)
      process.exit(0)
    }
    const config = resolveLiveModelConfig(process.env, args)
    const outDir = argValue(args, '--out-dir')
    const caseIds = argValue(args, '--cases')?.split(',').map(s => s.trim()).filter(Boolean)
    const summary = await runLiveAgentUsageEval(config, { outDir, caseIds })
    console.log(JSON.stringify(summary, null, 2))
    process.exit(summary.ok ? 0 : 1)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(2)
  }
}
