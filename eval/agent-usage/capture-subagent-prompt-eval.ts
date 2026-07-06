import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { DEFAULT_CASES, KNOWLEDGE_CASES, CREATE_CASES, checkAgentUsageTaskSource, requiresStructuredMutation, runAgentUsageEval, type AgentUsageEvalCase, type AgentUsageEvalResult } from './run.ts'
import { extractCodeModeScript } from './live.ts'
import { SDK_DECLARATION } from '../../src/mcp/sdk-decl.ts'
import { parseMermaid, verifyMermaid } from '../../src/agent/index.ts'

const REPO = join(import.meta.dir, '..', '..')
const TRANSCRIPT_ROOT = join(import.meta.dir, 'transcripts')
const MANIFEST_FILE = 'subagent-prompt-eval.json'

type PromptEvalSurface = 'homepage' | 'instructions' | 'skill' | 'none'
type PromptEvalMode = 'code' | 'chat'

export interface SubagentPromptEvalRequest {
  caseId: string
  requestPath: string
  responsePath: string
}

export interface SubagentPromptEvalManifest {
  schemaVersion: 1
  capturedAt: string
  provider: string
  model: string
  surface: PromptEvalSurface
  mode: PromptEvalMode
  cases: string[]
  requests: SubagentPromptEvalRequest[]
}

export interface PrepareSubagentPromptEvalOptions {
  outDir?: string
  provider?: string
  model?: string
  surface?: PromptEvalSurface
  mode?: PromptEvalMode
  caseIds?: string[]
  capturedAt?: string
}

export interface FinalizeSubagentPromptEvalOptions {
  runDir: string
}

export interface SubagentPromptEvalSummary {
  ok: boolean
  capturedAt: string
  provider: string
  model: string
  surface: PromptEvalSurface
  mode: PromptEvalMode
  total: number
  passed: number
  safePathRate: number
  structuredPathRate: number
  transcripts: string[]
}

export const SUBAGENT_PROMPT_EVAL_PARENT_CONTEXT = `Agentic Mermaid subagent prompt eval.
Use one fresh subagent per request when your harness supports subagents. The request file is the complete parent-visible task. Save the raw response exactly; the finalize step gates it with the deterministic Agentic Mermaid oracle.`

const CODE_MODE_CONTRACT = `Return ONLY the JavaScript body that will be passed to Agentic Mermaid Code Mode execute(code).
Do not include markdown, code fences, or prose.
The code runs synchronously in a node:vm sandbox with global mermaid.*; top-level return is allowed.
Do not use async/await, Promise jobs, dynamic import, filesystem, network, or template-literal interpolation.
For new diagrams, author Mermaid source directly, then parseMermaid and verifyMermaid.
For existing modeled diagrams, use family narrowers, mutate, verifyMermaid, inspect verify.ok/warnings, then serializeMermaid.
The Code Mode return value is evaluated by an oracle: on success return an object with { source } equal to the final Mermaid source.
Do not return the public prompt's human-facing “Updated Mermaid / Verification / Trace” sections from inside Code Mode; the parent agent would format those after this code succeeds.
SDK-returned diagrams are read-only; structured edits must use mermaid.mutate.`

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'subagent'
}

function abs(path: string) {
  return isAbsolute(path) ? path : join(REPO, path)
}

function rel(path: string) {
  return relative(REPO, abs(path)).replace(/\\/g, '/')
}

function readRepo(relPath: string) {
  return readFileSync(join(REPO, relPath), 'utf8')
}

function selectedCases(caseIds?: string[]): AgentUsageEvalCase[] {
  // Knowledge-proof cases join only by explicit id: the no-id default stays
  // DEFAULT_CASES so existing prepare invocations keep their case set.
  const pool = [...DEFAULT_CASES, ...KNOWLEDGE_CASES, ...CREATE_CASES]
  const cases = caseIds?.length ? pool.filter(c => caseIds.includes(c.id)) : DEFAULT_CASES
  if (caseIds?.length) {
    const found = new Set(cases.map(c => c.id))
    const missing = caseIds.filter(id => !found.has(id))
    if (missing.length) throw new Error(`Unknown subagent prompt eval case id(s): ${missing.join(', ')}`)
  }
  if (cases.length === 0) throw new Error('Subagent prompt eval selected zero cases')
  return cases
}

function surfaceContext(surface: PromptEvalSurface): string {
  if (surface === 'homepage') {
    return 'The populated homepage prompt appears under “Task prompt under test” below. Do not use any other product guidance.'
  }
  if (surface === 'instructions') {
    return `# Instructions_for_agents.md\n\n${readRepo('Instructions_for_agents.md').trim()}`
  }
  return [
    ['skills/agentic-mermaid-diagram-workflow/SKILL.md', readRepo('skills/agentic-mermaid-diagram-workflow/SKILL.md')],
    ['skills/agentic-mermaid-diagram-workflow/references/code-mode.md', readRepo('skills/agentic-mermaid-diagram-workflow/references/code-mode.md')],
    ['skills/agentic-mermaid-diagram-workflow/references/cli.md', readRepo('skills/agentic-mermaid-diagram-workflow/references/cli.md')],
  ].map(([path, text]) => `# ${path}\n\n${String(text).trim()}`).join('\n\n---\n\n')
}

/**
 * Recover the bare task from a populated homepage prompt. The template
 * headers are pinned by homepagePromptChecklist, so this split is stable.
 * Used by the `none` surface, which must not carry any product guidance.
 */
export function extractBareTask(prompt: string): { task: string; context: string; source?: string } {
  const task = prompt.match(/(?:^|\n)Task:\n([\s\S]*?)\n\nContext:/)?.[1]?.trim()
  const context = prompt.match(/\nContext:\n([\s\S]*?)\n\nMermaid source/)?.[1]?.trim()
  const source = prompt.match(/\nMermaid source[^\n]*\n```mermaid\n([\s\S]*?)```/)?.[1]?.trim()
  if (!task || !context) throw new Error('Prompt does not carry the pinned Task:/Context: template headers')
  return { task, context, source: source || undefined }
}

/**
 * No-docs baseline: the bare task with zero Agentic Mermaid guidance (no
 * product name, no channels, no workflow). The only harness contract is the
 * mermaid fence, without which the grader could not extract an answer at all.
 */
function buildBareTaskRequest(c: AgentUsageEvalCase): string {
  const { task, context, source } = extractBareTask(c.prompt)
  return `Diagram task eval. The request below is your complete task; do not use any product documentation beyond it.

Task ID: ${c.id}
Task:
${task}

Context:
${context}
${source ? `\nExisting Mermaid source to edit:\n\`\`\`mermaid\n${source}\n\`\`\`\n` : ''}
Return your final Mermaid diagram source in a \`\`\`mermaid fence.`
}

export function buildSubagentPromptEvalRequest(c: AgentUsageEvalCase, surface: PromptEvalSurface = 'homepage', mode: PromptEvalMode = 'code'): string {
  if (surface === 'none') {
    if (mode !== 'chat') throw new Error('--surface none is chat-only: Code Mode ships the SDK declaration, which is guidance')
    return buildBareTaskRequest(c)
  }
  if (mode === 'chat') {
    return `${SUBAGENT_PROMPT_EVAL_PARENT_CONTEXT}

Mode: raw chat prompt. Follow the agent-facing surface under test as a normal third-party coding agent would. Do not return Code Mode JavaScript unless the prompt itself requires it.

Agent-facing surface under test (${surface}):
${surfaceContext(surface)}

Task ID: ${c.id}
Task prompt under test:
${c.prompt}

Return the human-facing response requested by the prompt.`
  }

  return `${SUBAGENT_PROMPT_EVAL_PARENT_CONTEXT}

Runtime contract for this eval:
${CODE_MODE_CONTRACT}

Agent-facing surface under test (${surface}):
${surfaceContext(surface)}

Task ID: ${c.id}
Task prompt under test:
${c.prompt}
${c.input ? `\nInput Mermaid source, repeated for exactness:\n\`\`\`mermaid\n${c.input}\n\`\`\`\n` : ''}
SDK declaration available in Code Mode:
${SDK_DECLARATION}

Return only executable synchronous Code Mode JavaScript.`
}

function defaultOutDir(provider: string, capturedAt: string) {
  return join(TRANSCRIPT_ROOT, `${slug(provider)}-${capturedAt.replace(/[:.]/g, '-')}`)
}

function writeRunReadme(outDir: string, manifest: SubagentPromptEvalManifest) {
  const lines = [
    '# Subagent prompt eval capture',
    '',
    'This directory was prepared by `bun run eval:agent-subagent -- prepare`.',
    '',
    'Use from Pi, Claude, Codex, or any other harness with subagents:',
    '',
    '1. For each `requests/*.md` file, dispatch one fresh subagent with that file as the complete task.',
    '2. Save the exact raw subagent response to the matching `responses/<case-id>.txt` file. Do not edit passing or failing responses.',
    '3. Run:',
    '',
    '```sh',
    `bun run eval:agent-subagent -- finalize --run-dir ${rel(outDir)}`,
    '```',
    '',
    manifest.mode === 'code'
      ? 'The finalize step extracts Code Mode JavaScript and replays it through the existing sandbox, trace linter, and task oracle.'
      : 'The finalize step extracts the Updated Mermaid section, verifies it, and checks the task oracle plus response-shape/trace claims.',
    '',
    `Provider: ${manifest.provider}`,
    `Model: ${manifest.model}`,
    `Surface: ${manifest.surface}`,
    `Mode: ${manifest.mode}`,
    '',
    'Requests:',
    ...manifest.requests.map(r => `- ${r.caseId}: ${rel(r.requestPath)} → ${rel(r.responsePath)}`),
    '',
  ]
  writeFileSync(join(outDir, 'README.md'), lines.join('\n'))
}

export function prepareSubagentPromptEval(opts: PrepareSubagentPromptEvalOptions = {}): SubagentPromptEvalManifest {
  const provider = opts.provider ?? 'pi-subagent'
  const model = opts.model ?? 'fresh-subagent'
  const surface = opts.surface ?? 'homepage'
  const mode = opts.mode ?? 'code'
  const capturedAt = opts.capturedAt ?? new Date().toISOString()
  const outDir = opts.outDir ? abs(opts.outDir) : defaultOutDir(provider, capturedAt)
  const requestsDir = join(outDir, 'requests')
  const responsesDir = join(outDir, 'responses')
  mkdirSync(requestsDir, { recursive: true })
  mkdirSync(responsesDir, { recursive: true })

  const cases = selectedCases(opts.caseIds)
  const requests: SubagentPromptEvalRequest[] = []
  for (const c of cases) {
    const requestPath = join(requestsDir, `${c.id}.md`)
    const responsePath = join(responsesDir, `${c.id}.txt`)
    writeFileSync(requestPath, buildSubagentPromptEvalRequest(c, surface, mode) + '\n')
    requests.push({ caseId: c.id, requestPath, responsePath })
  }

  const manifest: SubagentPromptEvalManifest = { schemaVersion: 1, capturedAt, provider, model, surface, mode, cases: cases.map(c => c.id), requests }
  writeFileSync(join(outDir, MANIFEST_FILE), JSON.stringify({ ...manifest, requests: manifest.requests.map(r => ({ ...r, requestPath: rel(r.requestPath), responsePath: rel(r.responsePath) })) }, null, 2) + '\n')
  writeRunReadme(outDir, manifest)
  return manifest
}

function loadManifest(runDir: string): SubagentPromptEvalManifest {
  const dir = abs(runDir)
  const manifestPath = join(dir, MANIFEST_FILE)
  if (!existsSync(manifestPath)) throw new Error(`Missing ${MANIFEST_FILE} in ${rel(dir)}. Run prepare first.`)
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as SubagentPromptEvalManifest
  return {
    ...raw,
    mode: raw.mode ?? 'code',
    requests: raw.requests.map(r => ({ ...r, requestPath: abs(r.requestPath), responsePath: abs(r.responsePath) })),
  }
}

function transcriptPath(runDir: string, caseId: string) {
  return join(abs(runDir), `${caseId}.json`)
}

export function extractUpdatedMermaidSource(text: string): string | undefined {
  const fenced = text.match(/```mermaid\s*\n([\s\S]*?)```/i)
  if (fenced?.[1]?.trim()) return fenced[1].trim()
  const section = text.match(/(?:^|\n)\s*(?:#+\s*)?Updated Mermaid\s*\n([\s\S]*?)(?=\n\s*(?:#+\s*)?(?:Verification|Trace)\b|$)/i)
  const source = section?.[1]?.trim()
  return source || undefined
}

function chatTraceOk(id: string, text: string): boolean {
  if (!/(?:^|\n)\s*(?:#+\s*)?Updated Mermaid\b/i.test(text)) return false
  if (!/(?:^|\n)\s*(?:#+\s*)?Verification\b/i.test(text)) return false
  if (!/(?:^|\n)\s*(?:#+\s*)?Trace\b/i.test(text)) return false
  // The CLI (`am verify`) and the hosted MCP (`/mcp` verify tool or its Code
  // Mode execute) both parse the source themselves, so either is verification
  // evidence and — for a new diagram — construction evidence.
  const cliVerify = /\bam\b[^\n]*\bverify\b/i.test(text) || /bin\/am\.ts[^\n]*\bverify\b/i.test(text)
    // A trace that declares the CLI command path and names a backtick-quoted
    // `verify` op (on its own line, as agents commonly format the op list) is
    // CLI verification evidence too. The backtick guard avoids matching the
    // required `Verification` section header, which is never backtick-quoted.
    || (/bin\/am\.ts/.test(text) && /`verify`/i.test(text))
  const mcpVerify = /"name"\s*:\s*"verify"/.test(text)
    || (/\/mcp\b/i.test(text) && /\bverif(?:y|ied|ication)\b/i.test(text))
    || (/hosted mcp/i.test(text) && /\bverif/i.test(text))
  // The declarative edit path — CLI `am mutate`/`am build`, the hosted MCP
  // `mutate`/`build` tools, and the library `applyOps` — applies a JSON op list
  // and returns `{ ok, family, source, verify }`: it runs verifyMermaid
  // internally (and the CLI emits source only when verify succeeds), so using it
  // is BOTH verification evidence and structured-mutation evidence. The prompt
  // now recommends this path, so a grader that ignored it would penalize the
  // endorsed route.
  const declarativeEdit = /\bam\b[^\n]*\b(?:mutate|build)\b/i.test(text)
    || /bin\/am\.ts[^\n]*\b(?:mutate|build)\b/i.test(text)
    || /"name"\s*:\s*"(?:mutate|build)"/.test(text)
    || /\bapplyOps\s*\(/i.test(text)
  const bundledVerify = cliVerify || mcpVerify || declarativeEdit
  // Verification evidence: any Agentic Mermaid verification channel — library,
  // CLI, or hosted MCP. The harness independently re-parses and re-verifies the
  // returned source, so this only confirms the model engaged the tool rather
  // than hand-writing Mermaid from memory.
  if (!/verifyMermaid/i.test(text) && !bundledVerify) return false
  if (requiresStructuredMutation(id)) {
    // Existing structured diagram: confirm the response drove the typed Agentic
    // Mermaid surface — parse/narrow, mutate, or a declared source-level fallback —
    // rather than hand-writing Mermaid from memory. Any one of these tokens is
    // sufficient: the `parseMermaid` call, a family narrower (`asTimeline()`,
    // `asFlowchart`, …), a `mutate(...)` call or a `mutate`/`mutated`/`mutating`/
    // `mutation` mention, a typed op literal (`{ kind: "add_event", … }` — only
    // obtainable by calling mutate/buildMermaid with a real op), or an explicit
    // `source-level fallback`. A hand-written source ("wrote it directly from the
    // description") carries none of these, so it still fails; a correct structured
    // edit narrated in prose ("Narrowed with asTimeline(), Mutated with
    // { kind: 'add_event' }") now passes rather than being rejected for writing
    // "Parsed"/"Mutated" instead of the exact camelCase identifiers. taskOk remains
    // the independent diagram-correctness signal.
    return /parseMermaid/i.test(text)
      || /\bas(?:Flowchart|Sequence|State|Class|Er|Journey|Timeline|Gantt|Pie|Quadrant|XyChart|Architecture)\b/.test(text)
      || /mutate\s*\(/i.test(text)
      || /\bmutat(?:e|ed|es|ing|ion)\b/i.test(text)
      || /\bkind\b\s*[:=]\s*["'][a-z]+_[a-z]/i.test(text)
      || /source-level fallback/i.test(text)
      || declarativeEdit
  }
  // New diagram: any trusted construction is a safe path — author source then
  // `parseMermaid`, the endorsed typed builders `buildMermaid`/`createMermaid`
  // (which construct a ValidDiagram directly, no parse), or a channel that
  // parses the authored source itself (CLI `am verify` or the hosted MCP verify
  // tool). Requiring parseMermaid here wrongly failed the builder, CLI, and
  // hosted-MCP paths the prompt recommends.
  return /parseMermaid/i.test(text) || /buildMermaid/i.test(text) || /createMermaid/i.test(text) || bundledVerify
}

function scoreChatResponse(c: AgentUsageEvalCase, rawResponse: string, surface: PromptEvalSurface): { result: AgentUsageEvalResult; source?: string } {
  // The no-docs baseline never saw the response-format contract, so grading it
  // on Updated Mermaid/Verification/Trace shape would be meaningless: traceOk
  // is reported for the record but only the task oracle gates ok.
  const shapeRequired = surface !== 'none'
  const source = extractUpdatedMermaidSource(rawResponse)
  if (!source) return { result: { id: c.id, ok: false, taskOk: false, traceOk: false, findings: [], error: 'Updated Mermaid mermaid fence not found' } }
  const parsed = parseMermaid(source)
  if (!parsed.ok) return { result: { id: c.id, ok: false, taskOk: false, traceOk: chatTraceOk(c.id, rawResponse), findings: [], error: `parse failed: ${String((parsed.error as { message?: unknown }).message ?? parsed.error)}` }, source }
  const verified = verifyMermaid(parsed.value)
  if (!verified.ok) return { result: { id: c.id, ok: false, taskOk: false, traceOk: chatTraceOk(c.id, rawResponse), findings: [], error: `verify failed: ${verified.warnings.map(w => w.code).join(', ')}` }, source }
  const taskOk = checkAgentUsageTaskSource(c.id, source)
  const traceOk = chatTraceOk(c.id, rawResponse)
  return { result: { id: c.id, ok: taskOk && (traceOk || !shapeRequired), taskOk, traceOk, findings: [], error: taskOk ? undefined : 'task oracle rejected Updated Mermaid source' }, source }
}

function writeTranscript(runDir: string, manifest: SubagentPromptEvalManifest, c: AgentUsageEvalCase, rawResponse: string, script: string, result: AgentUsageEvalResult, extractedSource?: string) {
  const transcript = {
    schemaVersion: 1,
    capturedAt: manifest.capturedAt,
    provider: manifest.provider,
    model: manifest.model,
    caseId: c.id,
    task: { prompt: c.prompt, input: c.input },
    mode: manifest.mode,
    prompts: {
      system: `${SUBAGENT_PROMPT_EVAL_PARENT_CONTEXT}\nSurface: ${manifest.surface}. Mode: ${manifest.mode}. Pi/Claude/Codex hidden subagent system prompts are not exposed here.`,
      user: buildSubagentPromptEvalRequest(c, manifest.surface, manifest.mode),
    },
    rawResponse,
    script,
    extractedSource,
    result,
  }
  const file = transcriptPath(runDir, c.id)
  writeFileSync(file, JSON.stringify(transcript, null, 2) + '\n')
  return file
}

export async function finalizeSubagentPromptEval(opts: FinalizeSubagentPromptEvalOptions): Promise<SubagentPromptEvalSummary> {
  const runDir = abs(opts.runDir)
  const manifest = loadManifest(runDir)
  const byId = new Map([...DEFAULT_CASES, ...KNOWLEDGE_CASES, ...CREATE_CASES].map(c => [c.id, c]))
  let passed = 0
  let tracePassed = 0
  let structuredCases = 0
  let structuredPassed = 0
  const transcriptFiles: string[] = []

  for (const req of manifest.requests) {
    const c = byId.get(req.caseId)
    if (!c) throw new Error(`Unknown case in manifest: ${req.caseId}`)
    if (!existsSync(req.responsePath)) throw new Error(`Missing raw subagent response for ${req.caseId}: ${rel(req.responsePath)}`)
    const rawResponse = readFileSync(req.responsePath, 'utf8')
    const script = manifest.mode === 'code' ? extractCodeModeScript(rawResponse) : ''
    const scored = manifest.mode === 'code'
      ? { result: (await runAgentUsageEval([{ ...c, script }])).results[0]!, source: undefined }
      : scoreChatResponse(c, rawResponse, manifest.surface)
    const result = scored.result
    if (result.ok) passed++
    if (result.traceOk) tracePassed++
    if (requiresStructuredMutation(c.id)) {
      structuredCases++
      if (result.traceOk) structuredPassed++
    }
    transcriptFiles.push(rel(writeTranscript(runDir, manifest, c, rawResponse, script, result, scored.source)))
  }

  const total = manifest.requests.length
  const summary: SubagentPromptEvalSummary = {
    ok: passed === total,
    capturedAt: manifest.capturedAt,
    provider: manifest.provider,
    model: manifest.model,
    surface: manifest.surface,
    mode: manifest.mode,
    total,
    passed,
    safePathRate: tracePassed / Math.max(1, total),
    structuredPathRate: structuredPassed / Math.max(1, structuredCases),
    transcripts: transcriptFiles,
  }
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

export function recordSubagentPromptEvalResponse(runDir: string, caseId: string, rawResponse: string): string {
  const manifest = loadManifest(runDir)
  const req = manifest.requests.find(r => r.caseId === caseId)
  if (!req) throw new Error(`Case ${caseId} is not in ${rel(runDir)}`)
  mkdirSync(join(abs(runDir), 'responses'), { recursive: true })
  writeFileSync(req.responsePath, rawResponse)
  return req.responsePath
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

function parseCaseIds(args: string[]) {
  return argValue(args, '--cases')?.split(',').map(s => s.trim()).filter(Boolean)
}

function parseSurface(args: string[]): PromptEvalSurface {
  const value = argValue(args, '--surface') ?? 'homepage'
  if (value !== 'homepage' && value !== 'instructions' && value !== 'skill' && value !== 'none') throw new Error(`Unsupported --surface ${value}. Use homepage, instructions, skill, or none (no-docs baseline, chat-only).`)
  return value
}

function parseMode(args: string[]): PromptEvalMode {
  const value = argValue(args, '--mode') ?? 'code'
  if (value !== 'code' && value !== 'chat') throw new Error(`Unsupported --mode ${value}. Use code or chat.`)
  return value
}

function usage() {
  return `Usage:
  bun run eval:agent-subagent -- prepare [--provider pi-subagent] [--model delegate] [--surface homepage|instructions|skill|none] [--mode code|chat] [--cases id1,id2] [--out-dir dir]
  bun run eval:agent-subagent -- record --run-dir dir --case id [--response-file file]
  bun run eval:agent-subagent -- finalize --run-dir dir

Prepare writes requests under eval/agent-usage/transcripts/<provider>-<timestamp>/requests/.
Dispatch each request to a fresh subagent in Pi, Claude, Codex, or another harness, save exact raw responses under responses/, then finalize.
Finalize writes one transcript JSON per case plus summary.json and exits nonzero when the existing oracle rejects any response. Use --mode chat to test the raw public prompt response shape; use --mode code for executable Code Mode transcripts. --surface none is the chat-only no-docs baseline: the bare task with zero product guidance, graded on the task oracle alone.`
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2)
    const command = args[0]?.startsWith('--') ? 'prepare' : (args[0] ?? 'prepare')
    const rest = command === args[0] ? args.slice(1) : args
    if (command === 'help' || hasArg(args, '--help')) {
      console.log(usage())
      process.exit(0)
    }
    if (command === 'prepare') {
      const manifest = prepareSubagentPromptEval({
        provider: argValue(rest, '--provider') ?? 'pi-subagent',
        model: argValue(rest, '--model') ?? 'fresh-subagent',
        surface: parseSurface(rest),
        mode: parseMode(rest),
        caseIds: parseCaseIds(rest),
        outDir: argValue(rest, '--out-dir'),
      })
      console.log(JSON.stringify({ ok: true, runDir: rel(join(manifest.requests[0]!.requestPath, '..', '..')), manifest: rel(join(manifest.requests[0]!.requestPath, '..', '..', MANIFEST_FILE)), requests: manifest.requests.map(r => ({ caseId: r.caseId, request: rel(r.requestPath), response: rel(r.responsePath) })) }, null, 2))
      process.exit(0)
    }
    if (command === 'record') {
      const runDir = argValue(rest, '--run-dir')
      const caseId = argValue(rest, '--case')
      if (!runDir || !caseId) throw new Error('record requires --run-dir and --case')
      const responseFile = argValue(rest, '--response-file')
      const raw = responseFile ? readFileSync(abs(responseFile), 'utf8') : await readStdin()
      const written = recordSubagentPromptEvalResponse(runDir, caseId, raw)
      console.log(JSON.stringify({ ok: true, response: rel(written) }, null, 2))
      process.exit(0)
    }
    if (command === 'finalize') {
      const runDir = argValue(rest, '--run-dir')
      if (!runDir) throw new Error('finalize requires --run-dir')
      const summary = await finalizeSubagentPromptEval({ runDir })
      console.log(JSON.stringify(summary, null, 2))
      process.exit(summary.ok ? 0 : 1)
    }
    throw new Error(`Unknown command: ${command}\n\n${usage()}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(2)
  }
}
