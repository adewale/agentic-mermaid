// ============================================================================
// am — the agentic-mermaid CLI (v3).
//
// v3 fixes:
//   - am serialize accepts a JSON ValidDiagram with no canonicalSource
//     and synthesizes one via synthesizeFromGraph.
//   - am mutate dispatches by family; sequence diagrams accept sequence ops.
//   - am mutate on the 6 still-opaque families returns a clean
//     UNSUPPORTED_FAMILY error.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../agent/index.ts'
import { asFlowchart, asSequence } from '../agent/types.ts'
import type {
  ValidDiagram,
  WarningCode,
  FlowchartMutationOp,
  SequenceMutationOp,
  AnyMutationOp,
} from '../agent/types.ts'
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'

interface ParsedArgs {
  command?: string
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {} }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        out.flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) {
          out.flags[arg.slice(2)] = true
        } else {
          out.flags[arg.slice(2)] = next
          i++
        }
      }
    } else if (!out.command) {
      out.command = arg
    } else {
      out.positional.push(arg)
    }
    i++
  }
  return out
}

function readSourceArg(arg: string | undefined): string {
  if (!arg || arg === '-') {
    try {
      return readFileSync(0).toString('utf8')
    } catch {
      return ''
    }
  }
  if (!existsSync(arg)) throw new Error(`File not found: ${arg}`)
  return readFileSync(arg, 'utf8')
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value)
  return value
}

const USAGE = `Usage: am <command> [options] [file|-]

Commands:
  render <file|->        Render to SVG (or ASCII with --ascii)
  verify <file|->        Verify; emits structured warnings
  parse <file|->         Parse; emits ValidDiagram structure
  serialize              Read ValidDiagram JSON from stdin; emit canonical source
  mutate <file|-> --op '<JSON>'  Apply one MutationOp; emit new source
  format <file|->        Idempotent reformat

Flags:
  --json                 Structured JSON output
  --ascii                For render: ASCII output instead of SVG
  --op <JSON>            For mutate: the MutationOp to apply
  --suppress <CODES>     For verify: comma-separated WarningCodes to suppress
  --agent-instructions   Print the embedded canonical agent-use guide
  --help                 Show this message
`

export function runCli(argv: string[]): number {
  const args = parseArgs(argv)
  if (args.flags['agent-instructions']) {
    process.stdout.write(AGENT_INSTRUCTIONS)
    return 0
  }
  if (args.flags.help || !args.command) {
    process.stdout.write(USAGE)
    return args.command ? 0 : 1
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
        process.stderr.write(`Unknown command: ${args.command}\n${USAGE}`)
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
    if (json) process.stdout.write(JSON.stringify({ ascii }) + '\n')
    else process.stdout.write(ascii.endsWith('\n') ? ascii : ascii + '\n')
    return 0
  }
  const svg = renderMermaidSVG(source)
  if (json) process.stdout.write(JSON.stringify({ svg }) + '\n')
  else process.stdout.write(svg.endsWith('\n') ? svg : svg + '\n')
  return 0
}

function cmdVerify(args: ParsedArgs): number {
  const source = readSourceArg(args.positional[0])
  const suppressRaw = typeof args.flags.suppress === 'string' ? args.flags.suppress : ''
  const suppress: WarningCode[] | undefined = suppressRaw
    ? (suppressRaw.split(',').map(s => s.trim()).filter(Boolean) as WarningCode[])
    : undefined
  const r = verifyMermaid(source, suppress ? { suppress } : undefined)
  process.stdout.write(JSON.stringify(r, replacer) + '\n')
  return r.ok ? 0 : 2
}

function cmdParse(args: ParsedArgs): number {
  const source = readSourceArg(args.positional[0])
  const r = parseMermaid(source)
  if (!r.ok) {
    process.stdout.write(JSON.stringify({ ok: false, errors: r.error }) + '\n')
    return 2
  }
  process.stdout.write(JSON.stringify(toJsonSafeDiagram(r.value), replacer) + '\n')
  return 0
}

function cmdSerialize(): number {
  const stdin = readSourceArg('-')
  let payload: unknown
  try {
    payload = JSON.parse(stdin)
  } catch (e) {
    process.stderr.write(`serialize: invalid JSON: ${(e as Error).message}\n`)
    return 1
  }
  const r = synthesizeFromGraph(payload as Parameters<typeof synthesizeFromGraph>[0])
  if (!r.ok) {
    process.stderr.write(`serialize: ${JSON.stringify(r.error)}\n`)
    return 1
  }
  process.stdout.write(serializeMermaid(r.value))
  return 0
}

function cmdMutate(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const opStr = typeof args.flags.op === 'string' ? args.flags.op : ''
  if (!opStr) {
    process.stderr.write('mutate: --op <JSON> is required\n')
    return 1
  }
  let op: AnyMutationOp
  try {
    op = JSON.parse(opStr) as AnyMutationOp
  } catch (e) {
    process.stderr.write(`mutate: invalid --op JSON: ${(e as Error).message}\n`)
    return 1
  }
  const r0 = parseMermaid(source)
  if (!r0.ok) {
    process.stdout.write(JSON.stringify({ ok: false, errors: r0.error }) + '\n')
    return 2
  }

  const flow = asFlowchart(r0.value)
  if (flow) {
    const r1 = mutate(flow, op as FlowchartMutationOp)
    if (!r1.ok) {
      process.stdout.write(JSON.stringify({ ok: false, error: r1.error }) + '\n')
      return 2
    }
    return emitMutated(r1.value, json)
  }

  const seq = asSequence(r0.value)
  if (seq) {
    const r1 = mutate(seq, op as SequenceMutationOp)
    if (!r1.ok) {
      process.stdout.write(JSON.stringify({ ok: false, error: r1.error }) + '\n')
      return 2
    }
    return emitMutated(r1.value, json)
  }

  process.stdout.write(JSON.stringify({
    ok: false,
    error: { code: 'UNSUPPORTED_FAMILY', message: `mutate is flowchart, state, and sequence only; got ${r0.value.kind}` },
  }) + '\n')
  return 2
}

function emitMutated(d: ValidDiagram, json: boolean): number {
  const out = serializeMermaid(d)
  if (json) process.stdout.write(JSON.stringify({ ok: true, source: out }) + '\n')
  else process.stdout.write(out)
  return 0
}

function cmdFormat(args: ParsedArgs): number {
  const source = readSourceArg(args.positional[0])
  const r = parseMermaid(source)
  if (!r.ok) {
    process.stderr.write(`format: parse failed: ${JSON.stringify(r.error)}\n`)
    return 1
  }
  process.stdout.write(serializeMermaid(r.value))
  return 0
}

function toJsonSafeDiagram(d: ValidDiagram): unknown {
  if (d.body.kind === 'flowchart') {
    return {
      kind: d.kind,
      meta: d.meta,
      body: {
        kind: 'flowchart',
        graph: {
          direction: d.body.graph.direction,
          nodes: Object.fromEntries(d.body.graph.nodes),
          edges: d.body.graph.edges,
          subgraphs: d.body.graph.subgraphs,
        },
      },
      canonicalSource: d.canonicalSource,
    }
  }
  return {
    kind: d.kind,
    meta: d.meta,
    body: d.body,
    canonicalSource: d.canonicalSource,
  }
}

if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)))
}
