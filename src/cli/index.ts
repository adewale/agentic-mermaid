// ============================================================================
// am — the agentic-mermaid CLI.
//
// Subcommands: render, verify, parse, serialize, mutate, format.
// Plus --agent-instructions to print the embedded doc.
// JSON output via --json on every subcommand.
//
// Designed for one-shot operations (CI, shell-only agents, humans). For
// multi-step editing, prefer library import or Code Mode.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG, renderMermaidASCII } from '../agent/index.ts'
import type { MutationOp, ValidDiagram, WarningCode } from '../agent/types.ts'
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
        // Look ahead for a value; if next is a flag or absent, treat as boolean.
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
    // stdin
    const chunks: Uint8Array[] = []
    const stdin = process.stdin
    // Synchronous stdin reader for Node/Bun
    try {
      const buf = readFileSync(0)
      return buf.toString('utf8')
    } catch {
      return ''
    }
  }
  if (!existsSync(arg)) {
    throw new Error(`File not found: ${arg}`)
  }
  return readFileSync(arg, 'utf8')
}

function emit(json: boolean, structured: unknown, plain: string): void {
  if (json) {
    process.stdout.write(JSON.stringify(structured, replacer) + '\n')
  } else {
    process.stdout.write(plain.endsWith('\n') ? plain : plain + '\n')
  }
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
  mutate <file|->        Apply --op '<JSON>' to the source; emit new source
  format <file|->        Idempotent reformat

Flags:
  --json                 Structured JSON output (default for verify/parse)
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
      case 'render':
        return cmdRender(args, json)
      case 'verify':
        return cmdVerify(args, json)
      case 'parse':
        return cmdParse(args, json)
      case 'serialize':
        return cmdSerialize(args, json)
      case 'mutate':
        return cmdMutate(args, json)
      case 'format':
        return cmdFormat(args, json)
      default:
        process.stderr.write(`Unknown command: ${args.command}\n`)
        process.stderr.write(USAGE)
        return 1
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (json) {
      emit(true, { error: msg }, '')
    } else {
      process.stderr.write(`Error: ${msg}\n`)
    }
    return 1
  }
}

function cmdRender(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  if (args.flags.ascii) {
    const ascii = renderMermaidASCII(source)
    emit(json, { ascii }, ascii)
    return 0
  }
  const svg = renderMermaidSVG(source)
  emit(json, { svg }, svg)
  return 0
}

function cmdVerify(args: ParsedArgs, _json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const suppressRaw = typeof args.flags.suppress === 'string' ? args.flags.suppress : ''
  const suppress: WarningCode[] | undefined = suppressRaw
    ? (suppressRaw.split(',').map(s => s.trim()).filter(Boolean) as WarningCode[])
    : undefined
  const r = verifyMermaid(source, suppress ? { suppress } : undefined)
  // verify defaults to JSON output even without --json because the structured
  // warnings are the point of the verb.
  process.stdout.write(JSON.stringify(r, replacer) + '\n')
  return r.ok ? 0 : 2
}

function cmdParse(args: ParsedArgs, _json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const r = parseMermaid(source)
  if (!r.ok) {
    process.stdout.write(JSON.stringify({ ok: false, errors: r.error }) + '\n')
    return 2
  }
  // Strip body.graph Maps so JSON output is friendly.
  process.stdout.write(JSON.stringify(toJsonSafeDiagram(r.value), replacer) + '\n')
  return 0
}

function cmdSerialize(_args: ParsedArgs, _json: boolean): number {
  const stdin = readSourceArg('-')
  let payload: unknown
  try {
    payload = JSON.parse(stdin)
  } catch (e) {
    process.stderr.write(`serialize: invalid JSON on stdin: ${(e as Error).message}\n`)
    return 1
  }
  // Accept the JSON-safe shape we emit from `am parse`.
  const d = fromJsonSafeDiagram(payload)
  const out = serializeMermaid(d)
  process.stdout.write(out)
  return 0
}

function cmdMutate(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const opStr = typeof args.flags.op === 'string' ? args.flags.op : ''
  if (!opStr) {
    process.stderr.write('mutate: --op <JSON> is required\n')
    return 1
  }
  let op: MutationOp
  try {
    op = JSON.parse(opStr) as MutationOp
  } catch (e) {
    process.stderr.write(`mutate: invalid --op JSON: ${(e as Error).message}\n`)
    return 1
  }
  const r0 = parseMermaid(source)
  if (!r0.ok) {
    emit(true, { ok: false, errors: r0.error }, '')
    return 2
  }
  const r1 = mutate(r0.value, op)
  if (!r1.ok) {
    emit(true, { ok: false, error: r1.error }, '')
    return 2
  }
  const out = serializeMermaid(r1.value)
  if (json) {
    emit(true, { ok: true, source: out }, '')
  } else {
    process.stdout.write(out)
  }
  return 0
}

function cmdFormat(args: ParsedArgs, _json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const r = parseMermaid(source)
  if (!r.ok) {
    process.stderr.write(`format: parse failed: ${JSON.stringify(r.error)}\n`)
    return 1
  }
  process.stdout.write(serializeMermaid(r.value))
  return 0
}

// ---- JSON-safe conversion for ValidDiagram ------------------------------

function toJsonSafeDiagram(d: ValidDiagram): unknown {
  return {
    kind: d.kind,
    meta: d.meta,
    body: d.body.kind === 'flowchart'
      ? {
          kind: 'flowchart',
          graph: {
            direction: d.body.graph.direction,
            nodes: Object.fromEntries(d.body.graph.nodes),
            edges: d.body.graph.edges,
            subgraphs: d.body.graph.subgraphs,
          },
        }
      : d.body,
    canonicalSource: d.canonicalSource,
  }
}

function fromJsonSafeDiagram(payload: unknown): ValidDiagram {
  // For the v1 slice we round-trip through the canonical source: re-parse
  // canonicalSource if present, otherwise reject.
  const p = payload as { canonicalSource?: string }
  if (!p?.canonicalSource) {
    throw new Error('serialize: ValidDiagram JSON missing canonicalSource')
  }
  const r = parseMermaid(p.canonicalSource)
  if (!r.ok) throw new Error('serialize: canonicalSource is not parseable')
  return r.value
}

// Entry shim: only run if invoked directly.
if (import.meta.main) {
  process.exit(runCli(process.argv.slice(2)))
}
