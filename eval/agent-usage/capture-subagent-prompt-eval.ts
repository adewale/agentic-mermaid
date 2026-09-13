import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { FULL_EVAL_CASES, KNOWLEDGE_CASES, checkAgentUsageTaskSource, requiresStructuredMutation, runAgentUsageEval, type AgentUsageEvalCase, type AgentUsageEvalResult } from './run.ts'
import { extractCodeModeScript } from './live.ts'
import { SDK_DECLARATION } from '../../src/mcp/sdk-decl.ts'
import { parseRegisteredMermaid as parseMermaid, verifyMermaid } from '../../src/agent/index.ts'
import { HOMEPAGE_PROMPT_VARIANTS, type HomepagePromptVariant } from './homepage-prompt.ts'

const REPO = join(import.meta.dir, '..', '..')
const TRANSCRIPT_ROOT = join(import.meta.dir, 'transcripts')
const MANIFEST_FILE = 'subagent-prompt-eval.json'

type PromptEvalSurface = 'homepage' | 'instructions' | 'skill' | 'none'
type PromptEvalMode = 'code' | 'chat'
type PromptEvalVariant = HomepagePromptVariant

export interface SubagentPromptEvalRequest {
  caseId: string
  requestPath: string
  responsePath: string
  requestDigest?: string
}

export interface SubagentPromptEvalManifest {
  schemaVersion: 1 | 2
  capturedAt: string
  provider: string
  model: string
  surface: PromptEvalSurface
  mode: PromptEvalMode
  promptVariant: PromptEvalVariant
  cases: string[]
  requests: SubagentPromptEvalRequest[]
}

export interface PrepareSubagentPromptEvalOptions {
  outDir?: string
  provider?: string
  model?: string
  surface?: PromptEvalSurface
  mode?: PromptEvalMode
  promptVariant?: PromptEvalVariant
  caseIds?: string[]
  capturedAt?: string
}

export interface FinalizeSubagentPromptEvalOptions {
  runDir: string
}

export interface SubagentPromptEvalSummary {
  schemaVersion: 2
  /** Completeness + correctness gate: every request was captured and every
   *  captured diagram is structurally correct. Formatting and Trace prose do
   *  not affect this gate. */
  ok: boolean
  capturedAt: string
  provider: string
  model: string
  surface: PromptEvalSurface
  mode: PromptEvalMode
  promptVariant: PromptEvalVariant
  /** Requested cases, including capture failures. */
  total: number
  /** Cases with complete model output that reached grading. */
  captured: number
  captureFailed: number
  captureOkRate: number
  captureFailures: Array<{ caseId: string; code: string; message: string }>
  /** PRIMARY metric: diagrams the task oracle accepts. */
  taskOk: number
  taskOkRate: number | null
  /** SECONDARY metric: cases that show safe-path tool engagement. In code mode
   *  and when an AM_TRACE_LOG is present this is OBSERVED (real calls); in chat
   *  mode without a log it is NARRATED (inferred from the Trace prose) and thus
   *  phrasing-sensitive — see traceSource. */
  traceOk: number
  traceOkRate: number | null
  /** How traceOk was determined: 'observed' (replayed sandbox trace or a CLI
   *  AM_TRACE_LOG), 'narrated' (Trace-prose heuristic), or 'mixed'. */
  traceSource: 'observed' | 'narrated' | 'mixed' | 'unavailable'
  /** Strict composite (taskOk && traceOk && responseContractOk) count. */
  passed: number
  responseContractOk: number
  responseContractOkRate: number | null
  safePathRate: number | null
  structuredPathRate: number | null
  breakdown: Record<'create' | 'mutate', SubagentPromptEvalBreakdown>
  transcripts: string[]
}

export interface SubagentPromptEvalBreakdown {
  total: number
  captured: number
  captureFailed: number
  taskOk: number
  taskOkRate: number | null
  traceOk: number
  traceOkRate: number | null
  responseContractOk: number
  responseContractOkRate: number | null
  passed: number
}

export const SUBAGENT_PROMPT_EVAL_PARENT_CONTEXT = `Agentic Mermaid subagent prompt eval.
Use one fresh subagent per request when your harness supports subagents. The request file is the complete parent-visible task. Save the raw response exactly; the finalize step gates it with the deterministic Agentic Mermaid oracle.`

export function subagentPromptEvalCaseInventory() {
  return FULL_EVAL_CASES.map(c => ({
    id: c.id,
    family: c.family,
    kind: c.input === undefined ? 'create' as const : 'mutate' as const,
  }))
}

const CODE_MODE_CONTRACT = `Return ONLY the JavaScript body that will be passed to Agentic Mermaid Code Mode execute(code).
Do not include markdown, code fences, or prose.
The code runs synchronously in a node:vm sandbox with global mermaid.*; top-level return is allowed.
Do not use async/await, Promise jobs, dynamic import, filesystem, network, or template-literal interpolation.
For new diagrams, author Mermaid source directly, then parseRegisteredMermaid and verifyMermaid.
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

function digest(text: string) {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

function selectedCases(caseIds?: string[]): AgentUsageEvalCase[] {
  // Knowledge-proof cases join only by explicit id. A no-id live run exercises
  // the complete create+mutate matrix from the executable registry.
  const pool = [...FULL_EVAL_CASES, ...KNOWLEDGE_CASES]
  const cases = caseIds?.length ? pool.filter(c => caseIds.includes(c.id)) : FULL_EVAL_CASES
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
    return 'The homepage prompt under test is fetch-only. Follow it as a normal user prompt; do not use product guidance except what that prompt tells you to fetch.'
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

function promptForVariant(prompt: string, surface: PromptEvalSurface, variant: PromptEvalVariant): string {
  if (surface === 'homepage' && variant !== 'baseline') {
    throw new Error('--prompt-variant is not compatible with the fetch-only homepage surface; compare start.md variants separately')
  }
  return prompt
}

/**
 * Recover the bare task from an eval prompt. The homepage CTA is fetch-only;
 * task/context/source headers are appended by buildHomepageAgentPromptTask so
 * this split stays stable for the no-docs baseline.
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

export function buildSubagentPromptEvalRequest(c: AgentUsageEvalCase, surface: PromptEvalSurface = 'homepage', mode: PromptEvalMode = 'code', promptVariant: PromptEvalVariant = 'baseline'): string {
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
${promptForVariant(c.prompt, surface, promptVariant)}

Return the human-facing response requested by the prompt.`
  }

  return `${SUBAGENT_PROMPT_EVAL_PARENT_CONTEXT}

Runtime contract for this eval:
${CODE_MODE_CONTRACT}

Agent-facing surface under test (${surface}):
${surfaceContext(surface)}

Task ID: ${c.id}
Task prompt under test:
${promptForVariant(c.prompt, surface, promptVariant)}
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
    '2. Have the orchestrator capture the complete returned message, then use the `record` command to save it. Do not substitute acknowledgements or edit passing or failing responses.',
    '3. Run:',
    '',
    '```sh',
    `bun run eval:agent-subagent -- finalize --run-dir ${rel(outDir)}`,
    '```',
    '',
    manifest.mode === 'code'
      ? 'The finalize step extracts Code Mode JavaScript and replays it through the existing sandbox, trace linter, and task oracle.'
      : 'The finalize step grades diagram correctness, response-contract compliance, and trace evidence independently. Missing or placeholder captures are reported separately and excluded from model-score denominators.',
    '',
    `Provider: ${manifest.provider}`,
    `Model: ${manifest.model}`,
    `Surface: ${manifest.surface}`,
    `Mode: ${manifest.mode}`,
    `Prompt variant: ${manifest.promptVariant}`,
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
  const promptVariant = opts.promptVariant ?? 'baseline'
  const capturedAt = opts.capturedAt ?? new Date().toISOString()
  const outDir = opts.outDir ? abs(opts.outDir) : defaultOutDir(provider, capturedAt)
  const requestsDir = join(outDir, 'requests')
  const responsesDir = join(outDir, 'responses')
  mkdirSync(requestsDir, { recursive: true })
  mkdirSync(responsesDir, { recursive: true })
  // Landing spot for OBSERVED tool-use logs. When a run dispatches each subagent
  // with `AM_TRACE_LOG=<run-dir>/traces/<case>.jsonl` in its env, the `am` CLI
  // appends the verbs it actually ran here, and finalize grades traceOk from
  // those ground-truth calls instead of the Trace prose (see RUNBOOK).
  mkdirSync(join(outDir, 'traces'), { recursive: true })

  const cases = selectedCases(opts.caseIds)
  const requests: SubagentPromptEvalRequest[] = []
  for (const c of cases) {
    const requestPath = join(requestsDir, `${c.id}.md`)
    const responsePath = join(responsesDir, `${c.id}.txt`)
    const request = buildSubagentPromptEvalRequest(c, surface, mode, promptVariant) + '\n'
    writeFileSync(requestPath, request)
    requests.push({ caseId: c.id, requestPath, responsePath, requestDigest: digest(request) })
  }

  const manifest: SubagentPromptEvalManifest = { schemaVersion: 2, capturedAt, provider, model, surface, mode, promptVariant, cases: cases.map(c => c.id), requests }
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
    promptVariant: raw.promptVariant ?? 'baseline',
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
  if (source) return source
  // Response formatting is a separate metric. If the entire response is valid
  // Mermaid, keep grading its semantics instead of turning a wrapper mistake
  // into a diagram-correctness failure.
  const bare = text.trim()
  return bare && parseMermaid(bare).ok ? bare : undefined
}

type CaptureFailureCode = 'MISSING_RESPONSE' | 'EMPTY_RESPONSE' | 'CAPTURE_PLACEHOLDER' | 'REQUEST_DIGEST_MISMATCH'

type CaptureValidation =
  | { ok: true }
  | { ok: false; error: { code: CaptureFailureCode; message: string } }

export function validateCapturedResponse(rawResponse: string | undefined): CaptureValidation {
  if (rawResponse === undefined) {
    return { ok: false, error: { code: 'MISSING_RESPONSE', message: 'No model response was captured. Re-dispatch this case once and record the complete raw response before finalizing.' } }
  }
  const trimmed = rawResponse.trim()
  if (!trimmed) {
    return { ok: false, error: { code: 'EMPTY_RESPONSE', message: 'The captured response is empty. Re-dispatch this case once and record the complete raw response before finalizing.' } }
  }
  if (/^(?:\[(?:codex|agent|subagent) failure\]|(?:done|ok|success)|(?:wrote|saved|recorded)(?:\s+(?:the\s+)?response)?(?:\s+(?:to|at))?\s+\S+)\.?$/i.test(trimmed)) {
    return { ok: false, error: { code: 'CAPTURE_PLACEHOLDER', message: 'The capture contains only an acknowledgement or failure placeholder, not the model output. Re-dispatch this case once and record the complete raw response.' } }
  }
  return { ok: true }
}

function chatResponseContractError(text: string, surface: PromptEvalSurface): AgentUsageEvalResult['responseContractError'] {
  if (surface === 'none') {
    return /```mermaid\s*\n[\s\S]*?```/i.test(text)
      ? undefined
      : { code: 'RESPONSE_CONTRACT_ERROR', message: 'Expected the final diagram in a ```mermaid fence.' }
  }
  const updated = [...text.matchAll(/(?:^|\n)\s*(?:#+\s*)?Updated Mermaid\b/gi)]
  const verification = [...text.matchAll(/(?:^|\n)\s*(?:#+\s*)?Verification\b/gi)]
  const trace = [...text.matchAll(/(?:^|\n)\s*(?:#+\s*)?Trace\b/gi)]
  const startsWithUpdated = /^\s*(?:#+\s*)?Updated Mermaid\b/i.test(text)
  const inOrder = updated[0] && verification[0] && trace[0]
    ? updated[0].index! < verification[0].index! && verification[0].index! < trace[0].index!
    : false
  const updatedSection = text.match(/(?:^|\n)\s*(?:#+\s*)?Updated Mermaid\s*\n([\s\S]*?)(?=\n\s*(?:#+\s*)?Verification\b)/i)?.[1]
  const hasFencedSource = Boolean(updatedSection && /```mermaid\s*\n[\s\S]*?```/i.test(updatedSection))
  if (startsWithUpdated && updated.length === 1 && verification.length === 1 && trace.length === 1 && inOrder && hasFencedSource) return undefined
  return {
    code: 'RESPONSE_CONTRACT_ERROR',
    message: 'Expected exactly one Updated Mermaid, Verification, and Trace section in that order, starting with Updated Mermaid and placing the final source in its ```mermaid fence.',
  }
}

function codeResponseContractError(text: string, extractedScript: string): AgentUsageEvalResult['responseContractError'] {
  return text.trim() === extractedScript.trim()
    ? undefined
    : { code: 'RESPONSE_CONTRACT_ERROR', message: 'Expected only the synchronous Code Mode JavaScript body, without prose, markdown fences, or an arrow-function wrapper.' }
}

function chatTraceOk(id: string, text: string): boolean {
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
    // sufficient: the canonical parser call, a family narrower (`asTimeline()`,
    // `asFlowchart`, …), a `mutate(...)` call or a `mutate`/`mutated`/`mutating`/
    // `mutation` mention, a typed op literal (`{ kind: "add_event", … }` — only
    // obtainable by calling mutate/buildMermaid with a real op), or an explicit
    // `source-level fallback`. A hand-written source ("wrote it directly from the
    // description") carries none of these, so it still fails; a correct structured
    // edit narrated in prose ("Narrowed with asTimeline(), Mutated with
    // { kind: 'add_event' }") now passes rather than being rejected for writing
    // "Parsed"/"Mutated" instead of the exact camelCase identifiers. taskOk remains
    // the independent diagram-correctness signal.
    return /parse(?:Registered)?Mermaid/i.test(text)
      || /\bas(?:Flowchart|Sequence|State|Class|Er|Journey|Timeline|Gantt|Pie|Quadrant|XyChart|Architecture)\b/.test(text)
      || /mutate\s*\(/i.test(text)
      || /\bmutat(?:e|ed|es|ing|ion)\b/i.test(text)
      || /\bkind\b\s*[:=]\s*["'][a-z]+_[a-z]/i.test(text)
      || /source-level fallback/i.test(text)
      || declarativeEdit
  }
  // New diagram: any trusted construction is a safe path — author source then
  // `parseRegisteredMermaid`, the endorsed typed builders `buildMermaid`/`createMermaid`
  // (which construct a ValidDiagram directly, no parse), or a channel that
  // parses the authored source itself (CLI `am verify` or the hosted MCP verify
  // tool). Requiring a parser call here wrongly failed the builder, CLI, and
  // hosted-MCP paths the prompt recommends.
  return /parse(?:Registered)?Mermaid/i.test(text) || /buildMermaid/i.test(text) || /createMermaid/i.test(text) || bundledVerify
}

/** Read the OBSERVED tool-use log for a case (verbs the `am` CLI actually ran),
 *  or null if no log was captured for this run. */
function readObservedVerbs(runDir: string, caseId: string): string[] | null {
  const path = join(abs(runDir), 'traces', `${caseId}.jsonl`)
  if (!existsSync(path)) return null
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw) return null
  const verbs: string[] = []
  for (const line of raw.split('\n')) {
    try { const v = (JSON.parse(line) as { verb?: unknown }).verb; if (typeof v === 'string') verbs.push(v) } catch { /* skip malformed line */ }
  }
  return verbs.length ? verbs : null
}

/** traceOk from OBSERVED CLI verbs — ground truth, no prose. verify/mutate/build
 *  is verification evidence (mutate/build run verify internally); an edit case
 *  additionally needs a structured mutate/build. Mirrors chatTraceOk's channel
 *  semantics on the actual calls. */
function observedTraceOk(id: string, verbs: string[]): boolean {
  const has = (v: string) => verbs.includes(v)
  const bundledVerify = has('verify') || has('mutate') || has('build')
  if (!bundledVerify) return false
  if (requiresStructuredMutation(id)) return has('mutate') || has('build')
  return true
}

function scoreChatResponse(c: AgentUsageEvalCase, rawResponse: string, surface: PromptEvalSurface, observedVerbs?: string[] | null): { result: AgentUsageEvalResult; source?: string; traceObserved: boolean } {
  // traceOk: an OBSERVED CLI log CONFIRMS tool use (phrasing-independent, ground
  // truth), but its ABSENCE cannot refute — the agent may have verified/mutated
  // through the library or hosted MCP, which the `am` log can't see (e.g. it ran
  // `am capabilities` for discovery, then used the library for the edit). So the
  // observed signal is positive-only; when it does not confirm, fall back to the
  // NARRATED prose heuristic. `traceObserved` marks a positive observation.
  const traceObserved = observedVerbs != null && observedTraceOk(c.id, observedVerbs)
  const traceOk = traceObserved || chatTraceOk(c.id, rawResponse)
  const responseContractError = chatResponseContractError(rawResponse, surface)
  const responseContractOk = responseContractError === undefined
  const source = extractUpdatedMermaidSource(rawResponse)
  const common = { id: c.id, captureOk: true, traceOk, responseContractOk, responseContractError, findings: [] }
  if (!source) return { result: { ...common, ok: false, taskOk: false, error: 'DIAGRAM_SOURCE_MISSING: no Mermaid source could be extracted for semantic grading' }, traceObserved }
  const parsed = parseMermaid(source)
  if (!parsed.ok) return { result: { ...common, ok: false, taskOk: false, error: `DIAGRAM_PARSE_ERROR: ${String((parsed.error as { message?: unknown }).message ?? parsed.error)}` }, source, traceObserved }
  const verified = verifyMermaid(parsed.value)
  if (!verified.ok) return { result: { ...common, ok: false, taskOk: false, error: `DIAGRAM_VERIFY_ERROR: ${verified.warnings.map(w => w.code).join(', ')}` }, source, traceObserved }
  const taskOk = checkAgentUsageTaskSource(c.id, source)
  const ok = taskOk && responseContractOk && (traceOk || surface === 'none')
  return { result: { ...common, ok, taskOk, error: taskOk ? undefined : 'TASK_ORACLE_REJECTED: the diagram does not implement the requested structure' }, source, traceObserved }
}

function writeTranscript(runDir: string, manifest: SubagentPromptEvalManifest, req: SubagentPromptEvalRequest, c: AgentUsageEvalCase, rawResponse: string, script: string, result: AgentUsageEvalResult, extractedSource?: string) {
  const tracePath = join(abs(runDir), 'traces', `${c.id}.jsonl`)
  const transcript = {
    schemaVersion: 2,
    capturedAt: manifest.capturedAt,
    provider: manifest.provider,
    model: manifest.model,
    caseId: c.id,
    task: { prompt: c.prompt, input: c.input },
    mode: manifest.mode,
    promptVariant: manifest.promptVariant,
    prompts: {
      system: `${SUBAGENT_PROMPT_EVAL_PARENT_CONTEXT}\nSurface: ${manifest.surface}. Mode: ${manifest.mode}. Prompt variant: ${manifest.promptVariant}. Pi/Claude/Codex hidden subagent system prompts are not exposed here.`,
      user: buildSubagentPromptEvalRequest(c, manifest.surface, manifest.mode, manifest.promptVariant),
    },
    rawResponse,
    script,
    extractedSource,
    capture: {
      ok: result.captureOk ?? true,
      requestDigest: req.requestDigest,
      responseDigest: rawResponse ? digest(rawResponse) : undefined,
      traceDigest: existsSync(tracePath) ? digest(readFileSync(tracePath, 'utf8')) : undefined,
      error: result.captureError,
    },
    result,
  }
  const file = transcriptPath(runDir, c.id)
  writeFileSync(file, JSON.stringify(transcript, null, 2) + '\n')
  return file
}

export async function finalizeSubagentPromptEval(opts: FinalizeSubagentPromptEvalOptions): Promise<SubagentPromptEvalSummary> {
  const runDir = abs(opts.runDir)
  const manifest = loadManifest(runDir)
  const byId = new Map([...FULL_EVAL_CASES, ...KNOWLEDGE_CASES].map(c => [c.id, c]))
  // Code mode observes the real replayed sandbox trace; chat mode observes only
  // when an AM_TRACE_LOG was captured for the case. Track which so the summary
  // can flag whether traceOk is ground truth or a prose heuristic.
  let observedCount = 0
  let narratedCount = 0
  const graded: Array<{ c: AgentUsageEvalCase; result: AgentUsageEvalResult }> = []
  const captureFailures: SubagentPromptEvalSummary['captureFailures'] = []
  const transcriptFiles: string[] = []

  for (const req of manifest.requests) {
    const c = byId.get(req.caseId)
    if (!c) throw new Error(`Unknown case in manifest: ${req.caseId}`)
    const rawResponse = existsSync(req.responsePath) ? readFileSync(req.responsePath, 'utf8') : undefined
    let capture = validateCapturedResponse(rawResponse)
    if (capture.ok && req.requestDigest) {
      const requestMatches = existsSync(req.requestPath) && digest(readFileSync(req.requestPath, 'utf8')) === req.requestDigest
      if (!requestMatches) {
        capture = { ok: false, error: { code: 'REQUEST_DIGEST_MISMATCH', message: 'The request file changed after preparation. Prepare and dispatch this case again so the graded response is bound to the exact prompt.' } }
      }
    }
    if (!capture.ok) {
      const result: AgentUsageEvalResult = {
        id: c.id,
        ok: false,
        taskOk: false,
        traceOk: false,
        captureOk: false,
        captureError: capture.error,
        responseContractOk: false,
        findings: [],
      }
      captureFailures.push({ caseId: c.id, ...capture.error })
      transcriptFiles.push(rel(writeTranscript(runDir, manifest, req, c, rawResponse ?? '', '', result)))
      continue
    }

    const completeResponse = rawResponse!
    const script = manifest.mode === 'code' ? extractCodeModeScript(completeResponse) : ''
    let traceObserved: boolean
    let scored: { result: AgentUsageEvalResult; source?: string }
    if (manifest.mode === 'code') {
      const result = (await runAgentUsageEval([{ ...c, script }])).results[0]!
      const responseContractError = codeResponseContractError(completeResponse, script)
      const responseContractOk = responseContractError === undefined
      scored = {
        result: {
          ...result,
          ok: result.taskOk && result.traceOk && responseContractOk,
          captureOk: true,
          responseContractOk,
          responseContractError,
        },
        source: undefined,
      }
      traceObserved = true // replayed through the sandbox trace linter
    } else {
      const chat = scoreChatResponse(c, completeResponse, manifest.surface, readObservedVerbs(runDir, c.id))
      scored = { result: chat.result, source: chat.source }
      traceObserved = chat.traceObserved
    }
    const result = scored.result
    graded.push({ c, result })
    if (traceObserved) observedCount++; else narratedCount++
    transcriptFiles.push(rel(writeTranscript(runDir, manifest, req, c, completeResponse, script, result, scored.source)))
  }

  const total = manifest.requests.length
  const captured = graded.length
  const count = (predicate: (entry: typeof graded[number]) => boolean) => graded.filter(predicate).length
  const taskPassed = count(({ result }) => result.taskOk)
  const tracePassed = count(({ result }) => result.traceOk)
  const contractPassed = count(({ result }) => result.responseContractOk === true)
  const passed = count(({ result }) => result.ok)
  const structured = graded.filter(({ c }) => requiresStructuredMutation(c.id))
  const structuredPassed = structured.filter(({ result }) => result.traceOk).length
  const rate = (value: number, denominator: number) => denominator === 0 ? null : value / denominator
  const traceSource: SubagentPromptEvalSummary['traceSource'] = captured === 0
    ? 'unavailable'
    : observedCount === 0 ? 'narrated' : narratedCount === 0 ? 'observed' : 'mixed'
  const breakdownFor = (kind: 'create' | 'mutate'): SubagentPromptEvalBreakdown => {
    const isKind = (c: AgentUsageEvalCase) => (c.input === undefined ? 'create' : 'mutate') === kind
    const requested = manifest.requests.filter(req => {
      const c = byId.get(req.caseId)
      return c !== undefined && isKind(c)
    })
    const rows = graded.filter(({ c }) => isKind(c))
    const taskOk = rows.filter(({ result }) => result.taskOk).length
    const traceOk = rows.filter(({ result }) => result.traceOk).length
    const responseContractOk = rows.filter(({ result }) => result.responseContractOk === true).length
    return {
      total: requested.length,
      captured: rows.length,
      captureFailed: requested.length - rows.length,
      taskOk,
      taskOkRate: rate(taskOk, rows.length),
      traceOk,
      traceOkRate: rate(traceOk, rows.length),
      responseContractOk,
      responseContractOkRate: rate(responseContractOk, rows.length),
      passed: rows.filter(({ result }) => result.ok).length,
    }
  }
  const summary: SubagentPromptEvalSummary = {
    schemaVersion: 2,
    // Correctness gate — formatting and narration misses remain separate, while
    // incomplete capture still prevents an apparently green run.
    ok: captureFailures.length === 0 && taskPassed === captured,
    capturedAt: manifest.capturedAt,
    provider: manifest.provider,
    model: manifest.model,
    surface: manifest.surface,
    mode: manifest.mode,
    promptVariant: manifest.promptVariant,
    total,
    captured,
    captureFailed: captureFailures.length,
    captureOkRate: captured / Math.max(1, total),
    captureFailures,
    taskOk: taskPassed,
    taskOkRate: rate(taskPassed, captured),
    traceOk: tracePassed,
    traceOkRate: rate(tracePassed, captured),
    traceSource,
    passed,
    responseContractOk: contractPassed,
    responseContractOkRate: rate(contractPassed, captured),
    safePathRate: rate(tracePassed, captured),
    structuredPathRate: rate(structuredPassed, structured.length),
    breakdown: { create: breakdownFor('create'), mutate: breakdownFor('mutate') },
    transcripts: transcriptFiles,
  }
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  return summary
}

export function recordSubagentPromptEvalResponse(runDir: string, caseId: string, rawResponse: string): string {
  const manifest = loadManifest(runDir)
  const req = manifest.requests.find(r => r.caseId === caseId)
  if (!req) throw new Error(`Case ${caseId} is not in ${rel(runDir)}`)
  const capture = validateCapturedResponse(rawResponse)
  if (!capture.ok) throw new Error(`${capture.error.code}: ${capture.error.message}`)
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

function parsePromptVariant(args: string[]): PromptEvalVariant {
  const value = argValue(args, '--prompt-variant') ?? 'baseline'
  if ((HOMEPAGE_PROMPT_VARIANTS as readonly string[]).includes(value)) return value as PromptEvalVariant
  throw new Error(`Unsupported --prompt-variant ${value}. Use ${HOMEPAGE_PROMPT_VARIANTS.join(', ')}.`)
}

function usage() {
  return `Usage:
  bun run eval:agent-subagent -- list-cases [--format json|csv]
  bun run eval:agent-subagent -- prepare [--provider pi-subagent] [--model delegate] [--surface homepage|instructions|skill|none] [--mode code|chat] [--prompt-variant baseline|no-semantic-readback] [--cases id1,id2] [--out-dir dir]
  bun run eval:agent-subagent -- record --run-dir dir --case id [--response-file file]
  bun run eval:agent-subagent -- finalize --run-dir dir

Prepare defaults to the complete create+mutate registry and writes requests under eval/agent-usage/transcripts/<provider>-<timestamp>/requests/.
Dispatch each request to a fresh subagent in Pi, Claude, Codex, or another harness, save exact raw responses under responses/, then finalize.
Finalize writes one transcript JSON per case plus summary.json and exits nonzero when capture is incomplete or the task oracle rejects a response. Use --mode chat to test the raw public prompt response shape; use --mode code for executable Code Mode transcripts. --surface none is the chat-only no-docs baseline: the bare task with zero product guidance, graded on the task oracle alone. The homepage surface is fetch-only; compare start.md variants separately rather than with --prompt-variant.`
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
    if (command === 'list-cases') {
      const inventory = subagentPromptEvalCaseInventory()
      const format = argValue(rest, '--format') ?? 'json'
      if (format === 'csv') console.log(inventory.map(c => c.id).join(','))
      else if (format === 'json') console.log(JSON.stringify({ total: inventory.length, families: new Set(inventory.map(c => c.family)).size, cases: inventory }, null, 2))
      else throw new Error(`Unsupported --format ${format}. Use json or csv.`)
      process.exit(0)
    }
    if (command === 'prepare') {
      const manifest = prepareSubagentPromptEval({
        provider: argValue(rest, '--provider') ?? 'pi-subagent',
        model: argValue(rest, '--model') ?? 'fresh-subagent',
        surface: parseSurface(rest),
        mode: parseMode(rest),
        promptVariant: parsePromptVariant(rest),
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
