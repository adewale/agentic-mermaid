// ============================================================================
// am — agentic-mermaid CLI (v4).
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG, renderMermaidASCII, layoutMermaid } from '../agent/index.ts'
import { describeMermaidSource } from '../agent/describe.ts'
import { collectBatched } from '../shared/batched.ts'
import { asFlowchart, asSequence } from '../agent/types.ts'
import type { ValidDiagram, WarningCode, FlowchartMutationOp, SequenceMutationOp, AnyMutationOp, MutationError, Result, FlowchartValidDiagram, SequenceValidDiagram } from '../agent/types.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'
import { knownFamilies, getFamily } from '../agent/families.ts'
import '../agent/families-builtin.ts'
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'
import { EXIT_OK, EXIT_ARG_ERROR, EXIT_VERIFY_FAILED, EXIT_INTERNAL } from './exit-codes.ts'
import type { ParseError } from '../agent/types.ts'

/**
 * Loop 12 M1: build a structured CLI error envelope. Keeps `message` a short
 * human string (the first error's message) and carries the full structured
 * ParseError[] in `details` — so an agent reads `error.details` instead of
 * re-parsing a JSON string buried in `error.message`.
 */
function parseErrorEnvelope(errors: ParseError[]): { ok: false; error: { code: string; message: string; details: ParseError[] } } {
  const first = errors[0]
  const message = first ? `${first.code}: ${first.message}` : 'parse error'
  return { ok: false, error: { code: 'PARSE_FAILED', message, details: errors } }
}

interface ParsedArgs { command?: string; positional: string[]; flags: Record<string, string | boolean> }

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {} }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) out.flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      else {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) out.flags[arg.slice(2)] = true
        else { out.flags[arg.slice(2)] = next; i++ }
      }
    } else if (!out.command) out.command = arg
    else out.positional.push(arg)
    i++
  }
  return out
}

function readSourceArg(arg: string | undefined): string {
  if (!arg || arg === '-') {
    // Loop 9 M5: TTY-stdin guard. When stdin is an interactive TTY (no
    // pipe), the read blocks forever waiting for the user to paste + Ctrl-D
    // — confusing UX. Fail fast with a clear hint.
    if (process.stdin.isTTY) throw new Error('needs a file argument or piped stdin')
    try { return readFileSync(0).toString('utf8') } catch { return '' }
  }
  if (!existsSync(arg)) throw new Error(`File not found: ${arg}`)
  return readFileSync(arg, 'utf8')
}

function replacer(_k: string, v: unknown): unknown { return v instanceof Map ? Object.fromEntries(v) : v }

const GLOBAL_USAGE = `Usage: am <command> [options] [file|-]

Commands:
  render <file|->        Render to SVG (or ASCII with --ascii)
  verify <file|->        Verify; emits structured JSON warnings
  parse <file|->         Parse; emits ValidDiagram JSON
  serialize              Read ValidDiagram JSON from stdin; emit canonical source
  mutate <file|-> --op '<JSON>'  Apply one MutationOp; emit new source
  format <file|->        Idempotent reformat
  capabilities           Emit JSON describing supported families + warning codes
  batch                  Read JSONL ops from stdin; emit one JSON envelope per line

Flags:
  --json                 Structured JSON output
  --ascii                For render: ASCII instead of SVG
  --op <JSON>            For mutate: the MutationOp
  --suppress <CODES>     For verify: comma-separated WarningCodes to suppress
  --label-cap <N>        For verify: LABEL_OVERFLOW char cap (default 40)
  --agent-instructions   Print the canonical agent-use guide
  --help                 Show this message (or per-command help: am <cmd> --help)

Exit codes:
  0  ok
  2  arg / parse error (bad flag, missing file, malformed JSON)
  3  verify reported errors (severity 'error')
  4  uncaught internal failure
`

const COMMAND_HELP: Record<string, string> = {
  render: `am render <file|-> [--format svg|ascii|unicode|json|png] [--ascii] [--json]
Render a diagram. Default is SVG.
  --format svg      SVG markup (default)
  --format ascii    7-bit ASCII art (also via --ascii)
  --format unicode  Unicode box-drawing ASCII art
  --format json     Layout JSON (nodes, edges, groups, bounds)
  --format png      PNG bytes; requires -o <file.png>
With --json, the svg/ascii/unicode forms wrap output as {"<format>": "..."}.`,
  verify: `am verify <file|-> [--suppress A,B] [--label-cap N]
Always emits JSON: {ok, warnings[], layout}. Tier-1 error codes flip ok=false:
EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS, GROUP_BREACH. Warnings:
UNKNOWN_SHAPE, LABEL_OVERFLOW (char-cap), NODE_OVERLAP, ROUTE_SELF_CROSS.
Exit 0 if ok, 2 if not ok.`,
  parse: `am parse <file|->
Emits ValidDiagram JSON (Maps serialized to objects). Exit 2 on parse error.
Pipe to 'am serialize' to round-trip.`,
  serialize: `am serialize  (reads ValidDiagram JSON on stdin)
Emits canonical Mermaid source. Accepts the JSON shape that 'am parse' emits;
rebuilds the diagram via synthesizeFromGraph without re-parsing source.`,
  mutate: `am mutate <file|-> --op '<JSON>' [--json]
Applies one MutationOp and emits new source. Flowchart/state accept
FlowchartMutationOp; sequence accepts SequenceMutationOp; other families
return a structured UNSUPPORTED_FAMILY error (exit 2).`,
  format: `am format <file|->
Parse then re-serialize to canonical form. Idempotent.`,
  capabilities: `am capabilities [--json]
Emits a single JSON object describing the SDK's capability surface:
  { sdkVersion, families: [{ id, hasParse, hasSerialize, hasMutate,
    hasVerify, hasExtractLabels }],
    warningCodes: [{ code, tier, severity }],
    outputFormats: ["svg", "ascii", "png"] }
Use this to introspect what the CLI can do without running every command.`,
  batch: `am batch  (reads JSONL from stdin)
Each line: { op: "render"|"verify"|"parse"|"serialize", source: string,
options?: {} }. Emits one JSON envelope per line: { ok, op, data?, error? }.
Malformed JSON or unknown ops surface as ok:false with an error code; the
batch continues. Process exit code is 0 even if individual lines errored.`,
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv)
  if (args.flags['agent-instructions']) { process.stdout.write(AGENT_INSTRUCTIONS); return EXIT_OK }
  if (!args.command) { process.stdout.write(GLOBAL_USAGE); return EXIT_ARG_ERROR }
  if (args.flags.help) {
    process.stdout.write((COMMAND_HELP[args.command] ?? GLOBAL_USAGE) + '\n')
    return EXIT_OK
  }
  const json = Boolean(args.flags.json)
  try {
    switch (args.command) {
      case 'render': return cmdRender(args, json)
      case 'verify': return cmdVerify(args)
      case 'parse': return cmdParse(args)
      case 'serialize': return cmdSerialize()
      case 'mutate': return cmdMutate(args, json)
      case 'format': return cmdFormat(args)
      case 'capabilities': return cmdCapabilities()
      case 'llms-txt': return cmdLlmsTxt()
      case 'batch': return cmdBatch()
      case 'render-markdown': return cmdRenderMarkdown(args)
      default:
        process.stderr.write(`Unknown command: ${args.command}\n${GLOBAL_USAGE}`)
        return EXIT_ARG_ERROR
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Loop 9 M5: argument-shape errors (missing file, TTY stdin, etc.) get
    // exit 2 per the documented contract. Heuristic: messages thrown from
    // readSourceArg / arg parsing are advisory rather than internal bugs.
    const isArgError = /^needs a file argument|^File not found:/.test(msg)
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code: isArgError ? 'ARG' : 'INTERNAL', message: msg } }) + '\n')
    else process.stderr.write(`Error: ${msg}\n`)
    return isArgError ? EXIT_ARG_ERROR : EXIT_INTERNAL
  }
}

function cmdRender(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const format = typeof args.flags.format === 'string' ? args.flags.format : (args.flags.ascii ? 'ascii' : 'svg')

  if (format === 'png') {
    const outFile = typeof args.flags.o === 'string' ? args.flags.o : (typeof args.flags.output === 'string' ? args.flags.output : '')
    if (!outFile) {
      process.stderr.write('am render --format png requires -o <file.png> (PNG bytes corrupt terminals if piped to stdout)\n')
      return EXIT_ARG_ERROR
    }
    const scale = typeof args.flags.scale === 'string' ? Number(args.flags.scale) : 2
    const background = typeof args.flags.bg === 'string' ? args.flags.bg : 'white'
    // PNG render is async — emit synchronously via a top-level await shim.
    // The renderMermaidPNG export is dynamic-import inside, but the caller
    // returns void; we use a synchronous wrapper that buffers.
    return renderPngSync(source, { scale, background }, outFile, json)
  }
  if (format === 'json') {
    // Loop 9 M3 — structured layout JSON. parseMermaid → layoutMermaid →
    // emit nodes/edges/groups/bounds with stable key ordering.
    const parsed = parseMermaid(source)
    if (!parsed.ok) {
      process.stdout.write(JSON.stringify(parseErrorEnvelope(parsed.error)) + '\n')
      return EXIT_ARG_ERROR
    }
    const layout = layoutMermaid(parsed.value)
    process.stdout.write(JSON.stringify(layout) + '\n')
    return EXIT_OK
  }
  if (format === 'ascii' || format === 'unicode') {
    // Loop 9 M4 — `unicode` is the default ASCII renderer (Unicode box
    // drawing). `ascii` flips the useAscii bit for pure 7-bit output.
    const ascii = renderMermaidASCII(source, { useAscii: format === 'ascii' })
    process.stdout.write(json ? JSON.stringify({ [format]: ascii }) + '\n' : (ascii.endsWith('\n') ? ascii : ascii + '\n'))
    return EXIT_OK
  }
  // #7645/#7695: `--security strict` → no external-fetch refs in the SVG.
  const security = args.flags.security === 'strict' ? 'strict' as const : 'default' as const
  const svg = renderMermaidSVG(source, { security })
  process.stdout.write(json ? JSON.stringify({ svg }) + '\n' : (svg.endsWith('\n') ? svg : svg + '\n'))
  return EXIT_OK
}

function renderPngSync(source: string, opts: { scale: number; background: string }, outFile: string, json: boolean): number {
  const { renderMermaidPNG } = require('../agent/png.ts') as typeof import('../agent/png.ts')
  const { writeFileSync } = require('node:fs') as typeof import('node:fs')
  try {
    const png = renderMermaidPNG(source, opts)
    writeFileSync(outFile, png)
    if (json) process.stdout.write(JSON.stringify({ ok: true, path: outFile, bytes: png.length }) + '\n')
    return EXIT_OK
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    process.stderr.write(`am render --format png: ${msg}\n`)
    return EXIT_INTERNAL
  }
}

function cmdVerify(args: ParsedArgs): number {
  const source = readSourceArg(args.positional[0])
  const suppressRaw = typeof args.flags.suppress === 'string' ? args.flags.suppress : ''
  const suppress = suppressRaw ? (suppressRaw.split(',').map(s => s.trim()).filter(Boolean) as WarningCode[]) : undefined
  const labelCharCap = typeof args.flags['label-cap'] === 'string' ? parseInt(args.flags['label-cap'], 10) : undefined
  const r = verifyMermaid(source, { suppress, labelCharCap })
  process.stdout.write(JSON.stringify(r, replacer) + '\n')
  return r.ok ? EXIT_OK : EXIT_VERIFY_FAILED
}

function cmdParse(args: ParsedArgs): number {
  const r = parseMermaid(readSourceArg(args.positional[0]))
  if (!r.ok) {
    // Error envelope matches the documented batch shape (cli/index.ts:107).
    // Success emits the bare ValidDiagram payload — pipeable into `am serialize`
    // without unwrapping, which preserves existing consumer contracts.
    process.stdout.write(JSON.stringify(parseErrorEnvelope(r.error)) + '\n')
    return EXIT_ARG_ERROR
  }
  process.stdout.write(JSON.stringify(toJsonSafe(r.value), replacer) + '\n')
  return EXIT_OK
}

function cmdSerialize(): number {
  const stdin = readSourceArg('-')
  let payload: unknown
  try { payload = JSON.parse(stdin) } catch (e) { process.stderr.write(`serialize: invalid JSON: ${(e as Error).message}\n`); return EXIT_ARG_ERROR }
  const r = synthesizeFromGraph(payload as Parameters<typeof synthesizeFromGraph>[0])
  if (!r.ok) { process.stderr.write(`serialize: ${JSON.stringify(r.error)}\n`); return EXIT_ARG_ERROR }
  process.stdout.write(serializeMermaid(r.value))
  return EXIT_OK
}

function cmdMutate(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const opStr = typeof args.flags.op === 'string' ? args.flags.op : ''
  if (!opStr) { process.stderr.write('mutate: --op <JSON> is required\n'); return EXIT_ARG_ERROR }
  let op: AnyMutationOp
  try { op = JSON.parse(opStr) as AnyMutationOp } catch (e) { process.stderr.write(`mutate: invalid --op JSON: ${(e as Error).message}\n`); return EXIT_ARG_ERROR }
  const r0 = parseMermaid(source)
  if (!r0.ok) {
    process.stdout.write(JSON.stringify(parseErrorEnvelope(r0.error)) + '\n')
    return EXIT_ARG_ERROR
  }

  const flow = asFlowchart(r0.value)
  if (flow) return emit(mutate(flow, op as FlowchartMutationOp), json)
  const seq = asSequence(r0.value)
  if (seq) return emit(mutate(seq, op as SequenceMutationOp), json)

  process.stdout.write(JSON.stringify({
    ok: false,
    error: { code: 'UNSUPPORTED_FAMILY', message: `mutate supports flowchart, state, and simple sequence diagrams; got ${r0.value.kind}${r0.value.body.kind === 'opaque' ? ' (opaque — likely contains constructs not modeled for structured editing)' : ''}` },
  }) + '\n')
  return EXIT_ARG_ERROR
}

function emit(r: Result<FlowchartValidDiagram | SequenceValidDiagram, MutationError>, json: boolean): number {
  if (!r.ok) { process.stdout.write(JSON.stringify({ ok: false, error: r.error }) + '\n'); return EXIT_ARG_ERROR }
  const out = serializeMermaid(r.value)
  process.stdout.write(json ? JSON.stringify({ ok: true, source: out }) + '\n' : out)
  return EXIT_OK
}

function cmdFormat(args: ParsedArgs): number {
  const r = parseMermaid(readSourceArg(args.positional[0]))
  if (!r.ok) { process.stderr.write(`format: parse failed: ${JSON.stringify(r.error)}\n`); return EXIT_ARG_ERROR }
  process.stdout.write(serializeMermaid(r.value))
  return EXIT_OK
}

// ---- Loop 7 / A3.1: capabilities ------------------------------------------

interface FamilyCapability {
  id: string
  hasParse: boolean
  hasSerialize: boolean
  hasMutate: boolean
  hasVerify: boolean
  hasExtractLabels: boolean
}

interface WarningCodeCapability {
  code: WarningCode
  tier: string
  severity: string
}

interface CapabilitiesEnvelope {
  sdkVersion: string
  families: FamilyCapability[]
  warningCodes: WarningCodeCapability[]
  outputFormats: string[]
}

export function buildCapabilities(): CapabilitiesEnvelope {
  const sdkVersion = (() => {
    try {
      const pkg = require('../../package.json') as { version: string }
      return pkg.version
    } catch {
      return 'unknown'
    }
  })()
  const families: FamilyCapability[] = knownFamilies().map((id) => {
    const p = getFamily(id)!
    return {
      id,
      hasParse: Boolean(p.parse),
      hasSerialize: Boolean(p.serialize),
      hasMutate: Boolean(p.mutate),
      hasVerify: Boolean(p.verify),
      hasExtractLabels: Boolean(p.extractLabels),
    }
  })
  const warningCodes: WarningCodeCapability[] = (Object.keys(WARNING_SEVERITY) as WarningCode[]).map(code => ({
    code,
    tier: WARNING_TIER[code],
    severity: WARNING_SEVERITY[code],
  }))
  return { sdkVersion, families, warningCodes, outputFormats: ['svg', 'ascii', 'png'] }
}

function cmdCapabilities(): number {
  process.stdout.write(JSON.stringify(buildCapabilities()) + '\n')
  return EXIT_OK
}

// ---- Loop 11 / M4 (#6430): llms.txt agent-discovery digest ----------------

/**
 * Build an llms.txt digest (https://llmstxt.org) for agent discovery.
 * Derived from buildCapabilities() so the family list, warning codes, and
 * output formats stay in sync with the actual SDK surface.
 */
export function buildLlmsTxt(): string {
  const cap = buildCapabilities()
  const families = cap.families.map(f => f.id).join(', ')
  const structured = cap.families.filter(f => f.hasMutate || f.hasParse).map(f => f.id)
  const formats = cap.outputFormats.join(', ')
  const codes = cap.warningCodes.map(w => `${w.code} (${w.tier}/${w.severity})`).join(', ')
  return `# agentic-mermaid

> Agent-native Mermaid runtime: parse, verify, mutate, and round-trip
> Mermaid diagrams with a typed IR. Deterministic SVG / ASCII / PNG. No
> browser required. CLI + MCP + library.

Version: ${cap.sdkVersion}

## What it does

A typed editing surface over Mermaid for AI agents. Parse a diagram to a
ValidDiagram, mutate it with typed ops, verify structurally (no pixels),
serialize back to canonical source. Layout is deterministic (verified
cross-process and cross-runtime on x86_64).

## The agent loop

parse → (narrow per family) → mutate → verify → serialize. Run verify at
every commit point. Never serialize a diagram whose verify result you
haven't inspected.

## CLI verbs (\`am <verb>\`)

- render --format ${formats}|unicode [--security strict] [--output file] — render a diagram
- parse — diagram → ValidDiagram JSON
- verify — structural validation (exit 3 if invalid)
- mutate --op '<json>' — apply a typed mutation
- format — normalize / canonicalize source
- describe [--format text|json] — natural-language or AX-tree summary
- capabilities --json — machine-readable capability envelope
- batch --jsonl — bulk ops, one JSON envelope per line
- llms-txt — this document

Exit codes: 0 ok, 2 arg error, 3 verify-failed, 4 internal.

## MCP tools

Code Mode \`execute(code)\` (typed mermaid.* SDK in a node:vm sandbox) plus
typed tools: query, xref, render_png, describe. render_png is offline.

## Output formats

${formats}. SVG strict mode (security: 'strict') emits zero external-fetch
references — safe for untrusted/agent-generated diagrams. See SECURITY.md.

## Diagram families

All families parse, verify, render, round-trip: ${families}.
Structured mutation: ${structured.join(', ')}. Others round-trip losslessly
via an opaque body (never silently dropped).

## Warning codes

${codes}

## Library

\`import { parseMermaid, mutate, verifyMermaid, serializeMermaid,
renderMermaidSVG, renderMermaidPNG, renderMermaidASCII,
renderMermaidASCIIWithMeta, describeMermaid, asciiToMermaid,
verifyNoExternalRefs } from 'beautiful-mermaid/agent'\`

## Docs

- AGENTS.md — canonical agent-use guide
- AGENT_NATIVE.md — the spec
- QUALITY.md — determinism + "good looking" rubric
- SECURITY.md — threat model + strict-mode guarantee
- ROADMAP.md — three-pillar status
`
}

function cmdLlmsTxt(): number {
  process.stdout.write(buildLlmsTxt())
  return EXIT_OK
}

// ---- Loop 12 M5 (#543): render-markdown — convert fenced blocks ------------

export interface MarkdownBlockResult {
  index: number
  ok: boolean
  format?: string
  output?: string
  error?: { code: string; message: string }
}

/**
 * Extract ```mermaid fenced blocks from markdown and render each. A bad
 * diagram yields an { ok:false } entry and does NOT abort the rest (#543:
 * "skip invalid diagrams instead of failing the whole conversion").
 */
export function renderMarkdownBlocks(md: string, format: 'svg' | 'ascii' = 'svg'): MarkdownBlockResult[] {
  const FENCE = /```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```/g
  const blocks: string[] = []
  for (const m of md.matchAll(FENCE)) blocks.push(m[1]!)
  return collectBatched(blocks, (src, i): MarkdownBlockResult => {
    try {
      const output = format === 'ascii' ? renderMermaidASCII(src) : renderMermaidSVG(src)
      return { index: i, ok: true, format, output }
    } catch (e) {
      return { index: i, ok: false, error: { code: 'RENDER_FAILED', message: (e as Error).message } }
    }
  }, 'MARKDOWN_BLOCK_ERROR').map((r, i) => r.ok ? r.value : { index: i, ok: false, error: r.error })
}

function cmdRenderMarkdown(args: ParsedArgs): number {
  const md = readSourceArg(args.positional[0])
  const format = args.flags.ascii ? 'ascii' as const : 'svg' as const
  const results = renderMarkdownBlocks(md, format)
  process.stdout.write(JSON.stringify({ ok: true, blocks: results }) + '\n')
  // Per-block failures don't fail the command (#543) — exit OK.
  return EXIT_OK
}

// ---- Loop 7 / A3.2: batch -------------------------------------------------

interface BatchLine {
  op: 'render' | 'verify' | 'parse' | 'serialize'
  source: string
  options?: Record<string, unknown>
}

interface BatchOutput {
  ok: boolean
  op?: string
  data?: unknown
  error?: { code: string; message: string }
}

/**
 * Execute a single batch line. Exported for tests; the CLI just shuttles
 * lines into and out of this function.
 */
export function runBatchLine(rawLine: string, lineIndex = 0): BatchOutput {
  let parsed: BatchLine
  try {
    parsed = JSON.parse(rawLine) as BatchLine
  } catch (e) {
    return { ok: false, error: { code: 'INVALID_JSON', message: (e as Error).message } }
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.op !== 'string') {
    return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'missing op string' } }
  }
  const op = parsed.op
  try {
    switch (op) {
      case 'render': {
        const options = parsed.options ?? {}
        const asAscii = Boolean((options as { ascii?: boolean }).ascii)
        // #7540: auto-namespace SVG ids per batch line so the rendered
        // diagrams can coexist on one HTML page without def-id collisions.
        const out = asAscii
          ? renderMermaidASCII(parsed.source)
          : renderMermaidSVG(parsed.source, { idPrefix: `d${lineIndex}-` })
        return { ok: true, op, data: asAscii ? { ascii: out } : { svg: out } }
      }
      case 'verify': {
        const options = parsed.options as { suppress?: WarningCode[]; labelCharCap?: number } | undefined
        const r = verifyMermaid(parsed.source, options ?? {})
        return { ok: true, op, data: JSON.parse(JSON.stringify(r, replacer)) }
      }
      case 'parse': {
        const r = parseMermaid(parsed.source)
        if (!r.ok) { const env = parseErrorEnvelope(r.error); return { ok: false, op, error: env.error } }
        return { ok: true, op, data: JSON.parse(JSON.stringify(toJsonSafe(r.value), replacer)) }
      }
      case 'serialize': {
        // For batch, the line's `source` field is a JSON-stringified ValidDiagram
        // (same shape as `am parse` emits). We re-hydrate it via synthesizeFromGraph.
        let payload: unknown
        try {
          payload = JSON.parse(parsed.source)
        } catch (e) {
          return { ok: false, op, error: { code: 'INVALID_JSON', message: (e as Error).message } }
        }
        const r = synthesizeFromGraph(payload as Parameters<typeof synthesizeFromGraph>[0])
        if (!r.ok) return { ok: false, op, error: { code: 'SYNTHESIZE_FAILED', message: JSON.stringify(r.error) } }
        return { ok: true, op, data: { source: serializeMermaid(r.value) } }
      }
      default:
        return { ok: false, op, error: { code: 'UNKNOWN_OP', message: `unknown op: ${op}` } }
    }
  } catch (e) {
    return { ok: false, op, error: { code: 'INTERNAL', message: (e as Error).message } }
  }
}

function cmdBatch(): number {
  const stdin = readSourceArg('-')
  const lines = stdin.split('\n').filter(l => l.trim() !== '')
  // Loop 9 M8: shared per-item iteration via collectBatched. Same scaffold
  // as runWithJudge — see src/shared/batched.ts.
  const results = collectBatched(lines, (line, i) => runBatchLine(line, i), 'BATCH_HANDLER_ERROR')
  for (const r of results) {
    if (r.ok) process.stdout.write(JSON.stringify(r.value) + '\n')
    else process.stdout.write(JSON.stringify({ ok: false, error: r.error }) + '\n')
  }
  // Per-line errors don't abort the batch; the process always exits OK.
  return EXIT_OK
}

function toJsonSafe(d: ValidDiagram): unknown {
  if (d.body.kind === 'flowchart') {
    const g = d.body.graph
    return {
      kind: d.kind, meta: d.meta,
      body: { kind: 'flowchart', graph: {
        direction: g.direction,
        nodes: Object.fromEntries(g.nodes),
        edges: g.edges,
        subgraphs: g.subgraphs,
        // Preserve styling so `am parse | am serialize` is lossless.
        classDefs: Object.fromEntries(g.classDefs),
        classAssignments: Object.fromEntries(g.classAssignments),
        nodeStyles: Object.fromEntries(g.nodeStyles),
        linkStyles: Object.fromEntries([...g.linkStyles].map(([k, v]) => [String(k), v])),
      } },
      canonicalSource: d.canonicalSource,
    }
  }
  return { kind: d.kind, meta: d.meta, body: d.body, canonicalSource: d.canonicalSource }
}

if (import.meta.main) process.exit(runCli(process.argv.slice(2)))
