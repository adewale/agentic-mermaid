// ============================================================================
// am — agentic-mermaid CLI (v4).
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../agent/index.ts'
import { asFlowchart, asSequence } from '../agent/types.ts'
import type { ValidDiagram, WarningCode, FlowchartMutationOp, SequenceMutationOp, AnyMutationOp, MutationError, Result, FlowchartValidDiagram, SequenceValidDiagram } from '../agent/types.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'
import { knownFamilies, getFamily } from '../agent/families.ts'
import '../agent/families-builtin.ts'
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'
import { EXIT_OK, EXIT_ARG_ERROR, EXIT_VERIFY_FAILED, EXIT_INTERNAL } from './exit-codes.ts'

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
  if (!arg || arg === '-') { try { return readFileSync(0).toString('utf8') } catch { return '' } }
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
  render: `am render <file|-> [--ascii] [--json]
Render a diagram to SVG (default) or ASCII (--ascii). With --json, wraps
output as {"svg": "..."} or {"ascii": "..."}.`,
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
    outputFormats: ["svg", "ascii"] }
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
      case 'batch': return cmdBatch()
      default:
        process.stderr.write(`Unknown command: ${args.command}\n${GLOBAL_USAGE}`)
        return EXIT_ARG_ERROR
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n')
    else process.stderr.write(`Error: ${msg}\n`)
    return EXIT_INTERNAL
  }
}

function cmdRender(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  if (args.flags.ascii) {
    const ascii = renderMermaidASCII(source)
    process.stdout.write(json ? JSON.stringify({ ascii }) + '\n' : (ascii.endsWith('\n') ? ascii : ascii + '\n'))
    return EXIT_OK
  }
  const svg = renderMermaidSVG(source)
  process.stdout.write(json ? JSON.stringify({ svg }) + '\n' : (svg.endsWith('\n') ? svg : svg + '\n'))
  return EXIT_OK
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
  if (!r.ok) { process.stdout.write(JSON.stringify({ ok: false, errors: r.error }) + '\n'); return EXIT_ARG_ERROR }
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
  if (!r0.ok) { process.stdout.write(JSON.stringify({ ok: false, errors: r0.error }) + '\n'); return EXIT_ARG_ERROR }

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
  return { sdkVersion, families, warningCodes, outputFormats: ['svg', 'ascii'] }
}

function cmdCapabilities(): number {
  process.stdout.write(JSON.stringify(buildCapabilities()) + '\n')
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
export function runBatchLine(rawLine: string): BatchOutput {
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
        const out = asAscii ? renderMermaidASCII(parsed.source) : renderMermaidSVG(parsed.source)
        return { ok: true, op, data: asAscii ? { ascii: out } : { svg: out } }
      }
      case 'verify': {
        const options = parsed.options as { suppress?: WarningCode[]; labelCharCap?: number } | undefined
        const r = verifyMermaid(parsed.source, options ?? {})
        return { ok: true, op, data: JSON.parse(JSON.stringify(r, replacer)) }
      }
      case 'parse': {
        const r = parseMermaid(parsed.source)
        if (!r.ok) return { ok: false, op, error: { code: 'PARSE_FAILED', message: JSON.stringify(r.error) } }
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
  const lines = stdin.split('\n')
  for (const line of lines) {
    if (line.trim() === '') continue
    const out = runBatchLine(line)
    process.stdout.write(JSON.stringify(out) + '\n')
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
