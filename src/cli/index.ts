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
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'

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

Flags:
  --json                 Structured JSON output
  --ascii                For render: ASCII instead of SVG
  --op <JSON>            For mutate: the MutationOp
  --suppress <CODES>     For verify: comma-separated WarningCodes to suppress
  --label-cap <N>        For verify: LABEL_OVERFLOW char cap (default 40)
  --agent-instructions   Print the canonical agent-use guide
  --help                 Show this message (or per-command help: am <cmd> --help)
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
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv)
  if (args.flags['agent-instructions']) { process.stdout.write(AGENT_INSTRUCTIONS); return 0 }
  if (!args.command) { process.stdout.write(GLOBAL_USAGE); return 1 }
  if (args.flags.help) {
    process.stdout.write((COMMAND_HELP[args.command] ?? GLOBAL_USAGE) + '\n')
    return 0
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
      default:
        process.stderr.write(`Unknown command: ${args.command}\n${GLOBAL_USAGE}`)
        return 1
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (json) process.stdout.write(JSON.stringify({ error: msg }) + '\n')
    else process.stderr.write(`Error: ${msg}\n`)
    return 1
  }
}

function cmdRender(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  if (args.flags.ascii) {
    const ascii = renderMermaidASCII(source)
    process.stdout.write(json ? JSON.stringify({ ascii }) + '\n' : (ascii.endsWith('\n') ? ascii : ascii + '\n'))
    return 0
  }
  const svg = renderMermaidSVG(source)
  process.stdout.write(json ? JSON.stringify({ svg }) + '\n' : (svg.endsWith('\n') ? svg : svg + '\n'))
  return 0
}

function cmdVerify(args: ParsedArgs): number {
  const source = readSourceArg(args.positional[0])
  const suppressRaw = typeof args.flags.suppress === 'string' ? args.flags.suppress : ''
  const suppress = suppressRaw ? (suppressRaw.split(',').map(s => s.trim()).filter(Boolean) as WarningCode[]) : undefined
  const labelCharCap = typeof args.flags['label-cap'] === 'string' ? parseInt(args.flags['label-cap'], 10) : undefined
  const r = verifyMermaid(source, { suppress, labelCharCap })
  process.stdout.write(JSON.stringify(r, replacer) + '\n')
  return r.ok ? 0 : 2
}

function cmdParse(args: ParsedArgs): number {
  const r = parseMermaid(readSourceArg(args.positional[0]))
  if (!r.ok) { process.stdout.write(JSON.stringify({ ok: false, errors: r.error }) + '\n'); return 2 }
  process.stdout.write(JSON.stringify(toJsonSafe(r.value), replacer) + '\n')
  return 0
}

function cmdSerialize(): number {
  const stdin = readSourceArg('-')
  let payload: unknown
  try { payload = JSON.parse(stdin) } catch (e) { process.stderr.write(`serialize: invalid JSON: ${(e as Error).message}\n`); return 1 }
  const r = synthesizeFromGraph(payload as Parameters<typeof synthesizeFromGraph>[0])
  if (!r.ok) { process.stderr.write(`serialize: ${JSON.stringify(r.error)}\n`); return 1 }
  process.stdout.write(serializeMermaid(r.value))
  return 0
}

function cmdMutate(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const opStr = typeof args.flags.op === 'string' ? args.flags.op : ''
  if (!opStr) { process.stderr.write('mutate: --op <JSON> is required\n'); return 1 }
  let op: AnyMutationOp
  try { op = JSON.parse(opStr) as AnyMutationOp } catch (e) { process.stderr.write(`mutate: invalid --op JSON: ${(e as Error).message}\n`); return 1 }
  const r0 = parseMermaid(source)
  if (!r0.ok) { process.stdout.write(JSON.stringify({ ok: false, errors: r0.error }) + '\n'); return 2 }

  const flow = asFlowchart(r0.value)
  if (flow) return emit(mutate(flow, op as FlowchartMutationOp), json)
  const seq = asSequence(r0.value)
  if (seq) return emit(mutate(seq, op as SequenceMutationOp), json)

  process.stdout.write(JSON.stringify({
    ok: false,
    error: { code: 'UNSUPPORTED_FAMILY', message: `mutate supports flowchart, state, and simple sequence diagrams; got ${r0.value.kind}${r0.value.body.kind === 'opaque' ? ' (opaque — likely contains constructs not modeled for structured editing)' : ''}` },
  }) + '\n')
  return 2
}

function emit(r: Result<FlowchartValidDiagram | SequenceValidDiagram, MutationError>, json: boolean): number {
  if (!r.ok) { process.stdout.write(JSON.stringify({ ok: false, error: r.error }) + '\n'); return 2 }
  const out = serializeMermaid(r.value)
  process.stdout.write(json ? JSON.stringify({ ok: true, source: out }) + '\n' : out)
  return 0
}

function cmdFormat(args: ParsedArgs): number {
  const r = parseMermaid(readSourceArg(args.positional[0]))
  if (!r.ok) { process.stderr.write(`format: parse failed: ${JSON.stringify(r.error)}\n`); return 1 }
  process.stdout.write(serializeMermaid(r.value))
  return 0
}

function toJsonSafe(d: ValidDiagram): unknown {
  if (d.body.kind === 'flowchart') {
    return {
      kind: d.kind, meta: d.meta,
      body: { kind: 'flowchart', graph: {
        direction: d.body.graph.direction,
        nodes: Object.fromEntries(d.body.graph.nodes),
        edges: d.body.graph.edges,
        subgraphs: d.body.graph.subgraphs,
      } },
      canonicalSource: d.canonicalSource,
    }
  }
  return { kind: d.kind, meta: d.meta, body: d.body, canonicalSource: d.canonicalSource }
}

if (import.meta.main) process.exit(runCli(process.argv.slice(2)))
