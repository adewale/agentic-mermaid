// ============================================================================
// am — agentic-mermaid CLI (v4).
// ============================================================================

import { readFileSync, existsSync, writeFileSync, mkdtempSync, watch } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { parseMermaid } from '../agent/parse.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutate } from '../agent/mutate.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVG, renderMermaidASCII, renderMermaidPNG, layoutMermaid } from '../agent/index.ts'
import { describeMermaid } from '../agent/describe.ts'
import { collectBatched } from '../shared/batched.ts'
import { asFlowchart, asState, asSequence, asTimeline, asClass, asEr, asJourney, asArchitecture, asXyChart, asPie, asQuadrant, asGantt } from '../agent/types.ts'
import type {
  ValidDiagram, WarningCode,
  FlowchartMutationOp, StateMutationOp, SequenceMutationOp, TimelineMutationOp, ClassMutationOp, ErMutationOp, JourneyMutationOp, ArchitectureMutationOp, XyChartMutationOp, PieMutationOp, QuadrantMutationOp, GanttMutationOp, AnyMutationOp,
  MutationError, Result, MutableValidDiagram,
} from '../agent/types.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'
import { BUILTIN_FAMILY_METADATA, builtinFamilyMetadata, knownFamilies, getFamily } from '../agent/families.ts'
import { knownStyles, getStyle, validateStyleSpec, inferBackend, resolveStyleStack } from '../scene/style-registry.ts'
import type { StyleInput, StyleSpec } from '../scene/style-registry.ts'
import type { BuiltinFamilyId } from '../agent/families.ts'
import '../agent/families-builtin.ts'
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'
import { initAgentFiles } from './init-agent.ts'
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

export interface ParsedArgs { command?: string; positional: string[]; flags: Record<string, string | boolean> }

// Single source of truth for CLI flags. A flag with no `arg` is a boolean;
// `arg` is the usage placeholder shown in `[--flag <arg>]`. BOOLEAN_FLAGS is
// DERIVED from this, so the parser's boolean classification cannot drift from
// the documented usage.
export const FLAG_SPECS: Record<string, { arg?: string }> = {
  // booleans
  'agent-instructions': {}, 'ascii': {}, 'certificates': {}, 'help': {}, 'json': {},
  'watch': {}, 'open': {}, 'force': {}, 'canonical-wrapper': {},
  // value flags (placeholder = what the usage shows after the flag)
  'suppress': { arg: 'CODES' }, 'label-cap': { arg: 'N' }, 'op': { arg: 'JSON' },
  'style': { arg: 'NAMES|file' }, 'seed': { arg: 'N' },
  'ops': { arg: 'JSON|file' }, 'output': { arg: 'FILE' }, 'format': { arg: 'fmt' },
  'security': { arg: 'mode' }, 'dir': { arg: 'DIR' },
}

export const BOOLEAN_FLAGS = new Set(Object.keys(FLAG_SPECS).filter(name => !FLAG_SPECS[name]!.arg))

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {} }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) out.flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      else {
        const name = arg.slice(2)
        const next = argv[i + 1]
        if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith('--')) out.flags[name] = true
        else { out.flags[name] = next; i++ }
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

export const GLOBAL_USAGE = `Usage: am <command> [options] [file|-]

Commands:
  render <file|->        Render to SVG/ASCII/Unicode/layout JSON/PNG
  verify <file|->        Verify; emits structured JSON warnings
  parse <file|->         Parse; emits ValidDiagram JSON
  serialize              Read ValidDiagram JSON from stdin; emit canonical source
  mutate <file|-> --op '<JSON>'  Apply MutationOp(s); verify + emit source
  preview <file|->       Write standalone HTML preview; optionally --open
  format <file|->        Idempotent reformat
  describe <file|->      Prose summary or AX-tree JSON
  capabilities           Emit JSON describing families + warning codes + mutation ops
  batch                  Read JSONL ops from stdin; emit one JSON envelope per line
  render-markdown <file> Render fenced mermaid blocks in Markdown (SVG or --ascii)
  styles                 List registered styles (looks + themes); see also render --style
  llms-txt               Emit the agent discovery digest
  init-agent             Write a repo-local agent drop-in (AGENTS section, skill, MCP config)

Flags:
  --json                 Structured JSON output
  --ascii                For render/render-markdown: ASCII instead of SVG
  --op <JSON>            For mutate: one MutationOp
  --ops <JSON|file>      For mutate: JSON array of MutationOps
  --output <FILE>        For render png / preview output path
  --open                 For preview: open generated HTML in browser
  --force                For init-agent: refresh generated skill/MCP files
  --style <NAMES|file>   For render svg/png: style stack — comma-separated names and/or .json spec files
  --seed <N>             For render svg/png: re-roll ink wobble of styled looks (never layout)
  --suppress <CODES>     For verify: comma-separated WarningCodes to suppress
  --label-cap <N>        For verify: LABEL_OVERFLOW char cap (default 40)
  --certificates         For render --format json: include route/family certificates
  --agent-instructions   Print the canonical agent-use guide
  --help                 Show this message (or per-command help: am <cmd> --help)

Exit codes:
  0  ok
  2  arg / parse error (bad flag, missing file, malformed JSON)
  3  verify reported errors (severity 'error')
  4  uncaught internal failure
`

export const COMMAND_HELP: Record<string, string> = {
  render: `am render <file|-> [--format svg|ascii|unicode|json|png] [--ascii] [--json]
Render a diagram. Default is SVG.
  --format svg      SVG markup (default)
  --format ascii    7-bit ASCII art (also via --ascii)
  --format unicode  Unicode box-drawing ASCII art
  --format json     Layout JSON (nodes, edges, groups, bounds)
  --certificates     With --format json, include route/family certificates
  --format png      PNG bytes; requires --output <file.png>; no watch/multi-input
  --style <S>       Style stack: comma-separated names and/or .json spec files,
                    merged left → right (e.g. --style hand-drawn,dracula or
                    --style ./brand.json). Applies to svg/png. See: am styles
  --seed <N>        Re-roll ink wobble of styled looks; never moves layout
  --security strict Remove external-fetch refs from SVG output
  --watch           Re-render one input file on change (non-PNG only)
Multiple inputs emit a JSON results array for non-PNG formats.
With --json, the svg/ascii/unicode forms wrap output as {"<format>": "..."}.`,
  styles: `am styles [--json]
List every registered style. A style is a partial description of how diagrams
look; a colors-only style is a theme, a full look sets stroke/fill/typography
too. Stack them with render --style (e.g. --style hand-drawn,dracula) and
re-roll ink with --seed. Custom styles are JSON records (docs/style-authoring.md);
pass a .json file path anywhere a name is accepted.
With --json: [{ name, kind: default|look|theme, backend, intent?, blurb }].`,
  verify: `am verify <file|-> [--suppress A,B] [--label-cap N]
Always emits JSON: {ok, warnings[], layout}.
Tier-1 error codes flip ok=false:
EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS, GROUP_BREACH, UNRESOLVABLE_SCHEDULE,
RENDER_FAILED (source verifies structurally but the render parser rejects it). Warning codes:
UNKNOWN_SHAPE, LABEL_OVERFLOW (char-cap),
NODE_OVERLAP, ROUTE_SELF_CROSS, ROUTE_HITCH, ROUTE_UNEXPLAINED_BEND, ROUTE_LABEL_ON_SHARED_TRUNK,
ROUTE_CONTAINER_MISANCHOR, ROUTE_SHAPE_MISANCHOR, ROUTE_STALE_AFTER_NODE_MOVE,
DUPLICATE_EDGE, UNREACHABLE_NODE, DECISION_BRANCH_UNLABELED, COMMENT_DROPPED, UNSUPPORTED_SYNTAX,
CONTENT_DROPPED_ON_ROUNDTRIP. Tier-3 lint is advisory.
Exit 0 if ok, 3 if verify reports severity='error'.`,
  parse: `am parse <file|->
Emits ValidDiagram JSON (Maps serialized to objects). Exit 2 on parse error.
Pipe to 'am serialize' to round-trip.`,
  serialize: `am serialize  (reads ValidDiagram JSON on stdin)
Emits canonical Mermaid source. Accepts the JSON shape that 'am parse' emits;
rebuilds the diagram via synthesizeFromGraph without re-parsing source.`,
  mutate: `am mutate <file|-> (--op '<JSON>' | --ops '<JSON array|file.json>') [--json]
Applies one or more MutationOps, verifies the final diagram, then emits source.
Flowchart/state, sequence, timeline, class, ER, journey, architecture, xychart,
pie, quadrant, and gantt have typed mutation ops; opaque-fallback diagrams (unmodeled
syntax) return a structured UNSUPPORTED_FAMILY error (exit 2). Verify failures
exit 3 and omit source.`,
  preview: `am preview <file|-> [--output preview.html] [--open] [--json] [--security strict]
Writes a standalone HTML preview containing strict-mode rendered SVG. Without
--output, emits HTML to stdout unless --open is set, in which case a temp HTML
file is written and opened. With --json, emits {ok,path,opened,bytes} for file output.`,
  format: `am format <file|-> [--canonical-wrapper]
Parse then re-serialize. Idempotent. The leading source wrapper (frontmatter,
%%{init}%% directives, comments before the header) is preserved byte-verbatim
by default; --canonical-wrapper instead synthesizes Mermaid's documented shape
(title/displayMode top-level, everything else under config:, directives folded).`,
  describe: `am describe <file|-> [--format text|json] [--json]
Summarize a Mermaid diagram. Text format emits prose by default; --json wraps
it as {ok,text}. --format json emits the structured AX tree
{kind,nodes,edges,entryPoints,sinks}; with --json it wraps as {ok,tree}.`,
  capabilities: `am capabilities [--json]
Emits a single JSON object describing the SDK's capability surface:
  { sdkVersion, families: [{ id, hasParse, hasSerialize, hasMutate,
    hasVerify, hasExtractLabels, mutationOps, editPolicy }],
    warningCodes: [{ code, tier, severity }],
    outputFormats: ["svg", "ascii", "unicode", "png", "json"] }
editPolicy is "structured-when-narrowed" or "source-level-only". Use this to
introspect what the CLI can do without running every command.`,
  batch: `am batch  (reads JSONL from stdin)
Each line: { op: "render"|"verify"|"parse"|"serialize"|"mutate", source: string,
options?: {}, mutation?: MutationOp, mutations?: MutationOp[] }. Emits one JSON
envelope per line: { ok, op, data?, error? }. Malformed JSON or unknown ops
surface as ok:false; the batch continues and exits 0 even if lines errored.`,
  'render-markdown': `am render-markdown <file.md> [--ascii]
Render fenced \`\`\`mermaid blocks. Bad diagrams yield ok:false entries and do
not abort the rest of the Markdown file.`,
  'llms-txt': `am llms-txt
Emit the committed agent-discovery digest generated from current capabilities.`,
  'init-agent': `am init-agent [--dir <path>] [--force] [--json]
Write a repo-local, agent-agnostic drop-in so coding agents discover the
parse → narrow → mutate → verify → serialize contract automatically. Creates
without clobbering by default:
  - AGENTS.md marked section pointing agents at the workflow + hosted docs
  - skills/agentic-mermaid-diagram-workflow/SKILL.md generic skill bundle
  - .mcp.json sample agentic-mermaid MCP server config
--dir defaults to the current directory. --force overwrites skill/MCP files;
the AGENTS.md section is always appended only once, guarded by a marker.`,
}

export function runCli(argv: string[]): number {
  const args = parseArgs(argv)
  if (args.flags['agent-instructions']) { process.stdout.write(AGENT_INSTRUCTIONS); return EXIT_OK }
  if (args.flags.help && !args.command) { process.stdout.write(GLOBAL_USAGE); return EXIT_OK }
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
      case 'preview': return cmdPreview(args, json)
      case 'format': return cmdFormat(args)
      case 'describe': return cmdDescribe(args, json)
      case 'capabilities': return cmdCapabilities()
      case 'styles': return cmdStyles(json)
      case 'llms-txt': return cmdLlmsTxt()
      case 'init-agent': return cmdInitAgent(args, json)
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
  const format = typeof args.flags.format === 'string' ? args.flags.format : (args.flags.ascii ? 'ascii' : 'svg')
  const security = args.flags.security === 'strict' ? 'strict' as const : 'default' as const
  if (!['svg', 'ascii', 'unicode', 'json', 'png'].includes(format)) {
    process.stderr.write(`am render: unsupported --format ${format}; expected svg, ascii, unicode, json, or png\n`)
    return EXIT_ARG_ERROR
  }
  if (args.flags.security !== undefined && args.flags.security !== 'strict') {
    process.stderr.write('am render --security accepts only strict\n')
    return EXIT_ARG_ERROR
  }
  if (args.flags.watch && args.positional.length > 1) {
    process.stderr.write('am render --watch accepts exactly one input file\n')
    return EXIT_ARG_ERROR
  }

  // --style: a stack of names and/or .json spec files; fail fast (exit 2) on
  // unknown names or invalid specs instead of surfacing an internal error.
  let style: StyleInput[] | undefined
  if (typeof args.flags.style === 'string') {
    try {
      style = parseStyleFlag(args.flags.style)
      resolveStyleStack(style)
    } catch (e) {
      process.stderr.write(`am render --style: ${e instanceof Error ? e.message : String(e)}\n`)
      return EXIT_ARG_ERROR
    }
    if (format === 'ascii' || format === 'unicode' || format === 'json') {
      process.stderr.write(`am render: --style applies to svg/png output; ignored for --format ${format}\n`)
    }
  }
  const seed = typeof args.flags.seed === 'string' ? Number(args.flags.seed) : undefined
  if (seed !== undefined && !Number.isFinite(seed)) {
    process.stderr.write('am render --seed expects a finite number\n')
    return EXIT_ARG_ERROR
  }

  if (args.positional.length > 1 && format === 'png') {
    process.stderr.write('am render --format png accepts exactly one input; run once per file with a distinct --output path\n')
    return EXIT_ARG_ERROR
  }

  // #959: multi-input — when more than one positional file is given, render
  // each and emit a JSON array of results, skipping bad files (like #543).
  // Single-input keeps the existing single-output behavior. PNG is excluded
  // because it writes bytes to a single --output path.
  if (args.positional.length > 1) {
    const results = args.positional.map((file, index) => {
      try {
        const src = readSourceArg(file)
        const output = renderMultiInputOnce(src, format, { security, certificates: args.flags.certificates === true, style, seed })
        return { index, file, ok: true, output }
      } catch (e) {
        const parseEnvelope = e as { ok?: false; error?: { code?: string; message?: string; details?: unknown } }
        if (parseEnvelope?.ok === false && parseEnvelope.error?.code === 'PARSE_FAILED') {
          return { index, file, ok: false, error: parseEnvelope.error }
        }
        return { index, file, ok: false, error: { code: 'RENDER_FAILED', message: e instanceof Error ? e.message : String(e) } }
      }
    })
    process.stdout.write(JSON.stringify({ ok: true, files: results }) + '\n')
    return EXIT_OK
  }

  // #930: watch mode — re-render on file change.
  if (args.flags.watch && format === 'png') {
    process.stderr.write('am render --format png does not support --watch; run non-watch PNG renders with --output <file.png>\n')
    return EXIT_ARG_ERROR
  }
  if (args.flags.watch && typeof args.positional[0] === 'string' && args.positional[0] !== '-') {
    return cmdRenderWatch(args.positional[0], format, args, json, { security, certificates: args.flags.certificates === true, style, seed })
  }

  const source = readSourceArg(args.positional[0])
  const parsed = parseMermaid(source)
  if (!parsed.ok) {
    process.stdout.write(JSON.stringify(parseErrorEnvelope(parsed.error)) + '\n')
    return EXIT_ARG_ERROR
  }

  if (format === 'png') {
    const outFile = typeof args.flags.o === 'string' ? args.flags.o : (typeof args.flags.output === 'string' ? args.flags.output : '')
    if (!outFile) {
      process.stderr.write('am render --format png requires --output <file.png> (PNG bytes corrupt terminals if piped to stdout)\n')
      return EXIT_ARG_ERROR
    }
    const scale = typeof args.flags.scale === 'string' ? Number(args.flags.scale) : 2
    const background = typeof args.flags.bg === 'string' ? args.flags.bg : 'white'
    // PNG render is native-sync via resvg; keep bytes off stdout and write the
    // raster artifact explicitly to the requested output path.
    return renderPngSync(source, { scale, background, style, seed }, outFile, json)
  }
  if (format === 'json') {
    // Loop 9 M3 — structured layout JSON. parseMermaid → layoutMermaid →
    // emit nodes/edges/groups/bounds with stable key ordering.
    const layout = layoutMermaid(parsed.value, { debug: args.flags.certificates === true })
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
  const svg = renderMermaidSVG(source, { security, style, seed })
  process.stdout.write(json ? JSON.stringify({ svg }) + '\n' : (svg.endsWith('\n') ? svg : svg + '\n'))
  return EXIT_OK
}

function renderMultiInputOnce(source: string, format: string, opts: { security?: 'default' | 'strict'; certificates?: boolean; style?: StyleInput[]; seed?: number } = {}): unknown {
  if (format === 'svg') return renderMermaidSVG(source, { security: opts.security, style: opts.style, seed: opts.seed })
  if (format === 'json') {
    const parsed = parseMermaid(source)
    if (!parsed.ok) throw parseErrorEnvelope(parsed.error)
    return layoutMermaid(parsed.value, { debug: opts.certificates === true })
  }
  return renderMermaidASCII(source, { useAscii: format === 'ascii' })
}

/**
 * #930: pure re-render step for watch mode — reads the file, renders to the
 * requested format, returns the output string. Extracted so it's unit-testable
 * without fs.watch timing.
 */
export function renderFileOnce(file: string, format: string, opts: { security?: 'default' | 'strict'; certificates?: boolean; style?: StyleInput[]; seed?: number } = {}): string {
  const src = readFileSync(file, 'utf8')
  if (format === 'ascii' || format === 'unicode') return renderMermaidASCII(src, { useAscii: format === 'ascii' })
  if (format === 'json') {
    const p = parseMermaid(src)
    return p.ok ? JSON.stringify(layoutMermaid(p.value, { debug: opts.certificates === true })) : JSON.stringify(parseErrorEnvelope(p.error))
  }
  return renderMermaidSVG(src, { security: opts.security, style: opts.style, seed: opts.seed })
}

function cmdRenderWatch(file: string, format: string, args: ParsedArgs, _json: boolean, opts: { security?: 'default' | 'strict'; certificates?: boolean; style?: StyleInput[]; seed?: number } = {}): number {
  const outFile = typeof args.flags.output === 'string' ? args.flags.output : ''
  const emit = () => {
    try {
      const out = renderFileOnce(file, format, opts)
      if (outFile) { writeFileSync(outFile, out) ; process.stderr.write(`rendered → ${outFile}\n`) }
      else process.stdout.write(out + (out.endsWith('\n') ? '' : '\n'))
    } catch (e) { process.stderr.write(`render error: ${(e as Error).message}\n`) }
  }
  emit() // initial render
  process.stderr.write(`watching ${file} (Ctrl-C to stop)…\n`)
  watch(file, { persistent: true }, (event) => { if (event === 'change') emit() })
  // Block forever — the watcher keeps the event loop alive.
  return EXIT_OK
}

function renderPngSync(source: string, opts: { scale: number; background: string; style?: StyleInput[]; seed?: number }, outFile: string, json: boolean): number {
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

type CliMutationError = MutationError | { code: 'UNSUPPORTED_FAMILY' | 'VERIFY_FAILED' | 'PARSE_FAILED' | 'INVALID_OP'; message: string; details?: unknown }

type MutationRunResult =
  | { ok: true; source: string; verify: ReturnType<typeof verifyMermaid> }
  | { ok: false; error: CliMutationError; verify?: ReturnType<typeof verifyMermaid> }

function parseMutationOpsFlag(args: ParsedArgs): Result<AnyMutationOp[], CliMutationError> {
  const opStr = typeof args.flags.op === 'string' ? args.flags.op : ''
  const opsStr = typeof args.flags.ops === 'string' ? args.flags.ops : ''
  if (opStr && opsStr) return { ok: false, error: { code: 'INVALID_OP', message: 'mutate accepts either --op or --ops, not both' } }
  if (!opStr && !opsStr) return { ok: false, error: { code: 'INVALID_OP', message: 'mutate requires --op <JSON> or --ops <JSON array|file.json>' } }
  try {
    if (opStr) return { ok: true, value: [JSON.parse(opStr) as AnyMutationOp] }
    const raw = existsSync(opsStr) ? readFileSync(opsStr, 'utf8') : opsStr
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return { ok: false, error: { code: 'INVALID_OP', message: '--ops must be a JSON array of MutationOps' } }
    if (parsed.length === 0) return { ok: false, error: { code: 'INVALID_OP', message: '--ops must contain at least one MutationOp' } }
    return { ok: true, value: parsed as AnyMutationOp[] }
  } catch (e) {
    return { ok: false, error: { code: 'INVALID_OP', message: `invalid mutation JSON: ${(e as Error).message}` } }
  }
}

function mutateAny(d: ValidDiagram, op: AnyMutationOp): Result<MutableValidDiagram, CliMutationError> {
  const flow = asFlowchart(d)
  if (flow) return mutate(flow, op as FlowchartMutationOp)
  // asState BEFORE the others: state diagrams own a dedicated StateBody and take
  // state-shaped ops (asFlowchart now returns null on them — BUILD-19).
  const state = asState(d)
  if (state) return mutate(state, op as StateMutationOp)
  const seq = asSequence(d)
  if (seq) return mutate(seq, op as SequenceMutationOp)
  const timeline = asTimeline(d)
  if (timeline) return mutate(timeline, op as TimelineMutationOp)
  const klass = asClass(d)
  if (klass) return mutate(klass, op as ClassMutationOp)
  const er = asEr(d)
  if (er) return mutate(er, op as ErMutationOp)
  const journey = asJourney(d)
  if (journey) return mutate(journey, op as JourneyMutationOp)
  const architecture = asArchitecture(d)
  if (architecture) return mutate(architecture, op as ArchitectureMutationOp)
  const xychart = asXyChart(d)
  if (xychart) return mutate(xychart, op as XyChartMutationOp)
  const pie = asPie(d)
  if (pie) return mutate(pie, op as PieMutationOp)
  const quadrant = asQuadrant(d)
  if (quadrant) return mutate(quadrant, op as QuadrantMutationOp)
  const gantt = asGantt(d)
  if (gantt) return mutate(gantt, op as GanttMutationOp)
  return {
    ok: false,
    error: { code: 'UNSUPPORTED_FAMILY', message: `mutate supports flowchart, state, sequence, timeline, class, ER, journey, architecture, xychart, pie, quadrant, and gantt diagrams; got ${d.kind}${d.body.kind === 'opaque' ? ' (source-level/opaque body — structured mutation is not exposed for this family or syntax)' : ''}` },
  }
}

export function mutateSource(source: string, ops: AnyMutationOp[]): MutationRunResult {
  const r0 = parseMermaid(source)
  if (!r0.ok) {
    const env = parseErrorEnvelope(r0.error)
    return { ok: false, error: { code: 'PARSE_FAILED', message: env.error.message, details: env.error.details } }
  }
  let current: ValidDiagram = r0.value
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]!
    const next = mutateAny(current, op)
    if (!next.ok) {
      const details = (next.error as { details?: unknown }).details
      return { ok: false, error: { ...next.error, details: { index, op, ...(typeof details === 'object' && details ? details as Record<string, unknown> : {}) } } }
    }
    current = next.value
  }
  const verify = verifyMermaid(current)
  if (!verify.ok) {
    return {
      ok: false,
      error: { code: 'VERIFY_FAILED', message: 'mutated diagram failed verify; source was not emitted', details: verify.warnings },
      verify,
    }
  }
  return { ok: true, source: serializeMermaid(current), verify }
}

function cmdMutate(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const ops = parseMutationOpsFlag(args)
  if (!ops.ok) { process.stderr.write(`mutate: ${ops.error.message}\n`); return EXIT_ARG_ERROR }
  return emitMutationRun(mutateSource(source, ops.value), json)
}

function emitMutationRun(r: MutationRunResult, json: boolean): number {
  if (!r.ok) {
    process.stdout.write(JSON.stringify({ ok: false, error: r.error, verify: r.verify }, replacer) + '\n')
    return r.error.code === 'VERIFY_FAILED' ? EXIT_VERIFY_FAILED : EXIT_ARG_ERROR
  }
  process.stdout.write(json ? JSON.stringify({ ok: true, source: r.source, verify: r.verify }, replacer) + '\n' : r.source)
  return EXIT_OK
}

export function buildPreviewHtml(source: string, opts: { security?: 'default' | 'strict' } = {}): Result<string, { code: string; message: string; details?: unknown }> {
  const parsed = parseMermaid(source)
  if (!parsed.ok) {
    const env = parseErrorEnvelope(parsed.error)
    return { ok: false, error: env.error }
  }
  const svg = renderMermaidSVG(source, { security: opts.security ?? 'strict' })
  const title = parsed.value.meta.frontmatter?.title ?? 'Mermaid preview'
  const escapedTitle = escapeHtml(String(title))
  const escapedSource = escapeHtml(source)
  return { ok: true, value: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapedTitle}</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; grid-template-rows: auto 1fr; background: #f8fafc; color: #0f172a; font-family: system-ui, sans-serif; }
    header { padding: 12px 16px; border-bottom: 1px solid #e2e8f0; background: white; }
    main { padding: 24px; overflow: auto; }
    .canvas { width: max-content; max-width: 100%; margin: 0 auto; background: white; box-shadow: 0 18px 70px rgba(15,23,42,.12); }
    svg { display: block; max-width: 100%; height: auto; }
    details { margin-top: 16px; }
    pre { white-space: pre-wrap; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; }
  </style>
</head>
<body>
  <header><strong>${escapedTitle}</strong></header>
  <main>
    <div class="canvas">${svg}</div>
    <details><summary>Mermaid source</summary><pre>${escapedSource}</pre></details>
  </main>
</body>
</html>` }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function openPreviewFile(path: string): { ok: true } | { ok: false; error: string } {
  const override = process.env.AM_OPEN_COMMAND
  const command = override || (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open')
  const args = override ? [path] : process.platform === 'win32' ? ['/c', 'start', '', path] : [path]
  const r = spawnSync(command, args, { stdio: 'ignore' })
  if (r.error || r.status !== 0) return { ok: false, error: `open command failed: ${command}` }
  return { ok: true }
}

function cmdPreview(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const security = 'strict' as const
  if (args.flags.security !== undefined && args.flags.security !== 'strict') {
    process.stderr.write('am preview --security accepts only strict\n')
    return EXIT_ARG_ERROR
  }
  const html = buildPreviewHtml(source, { security })
  if (!html.ok) { process.stdout.write(JSON.stringify({ ok: false, error: html.error }) + '\n'); return EXIT_ARG_ERROR }
  let outFile = typeof args.flags.output === 'string' ? args.flags.output : ''
  if (!outFile && args.flags.open) outFile = join(mkdtempSync(join(tmpdir(), 'am-preview-')), 'preview.html')
  if (outFile) {
    const path = resolve(outFile)
    writeFileSync(path, html.value)
    let opened = false
    if (args.flags.open) {
      const openedResult = openPreviewFile(path)
      if (!openedResult.ok) { process.stderr.write(`am preview --open: ${openedResult.error}\n`); return EXIT_INTERNAL }
      opened = true
    }
    if (json) process.stdout.write(JSON.stringify({ ok: true, path, opened, bytes: html.value.length }) + '\n')
    else process.stdout.write(`${path}\n`)
    return EXIT_OK
  }
  process.stdout.write(json ? JSON.stringify({ ok: true, html: html.value }) + '\n' : html.value)
  return EXIT_OK
}

function cmdFormat(args: ParsedArgs): number {
  const r = parseMermaid(readSourceArg(args.positional[0]))
  if (!r.ok) { process.stderr.write(`format: parse failed: ${JSON.stringify(r.error)}\n`); return EXIT_ARG_ERROR }
  const wrapper = args.flags['canonical-wrapper'] ? 'canonical' as const : 'verbatim' as const
  process.stdout.write(serializeMermaid(r.value, { wrapper }))
  return EXIT_OK
}

function cmdDescribe(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const format = args.flags.format === 'json' ? 'json' as const : 'text' as const
  const parsed = parseMermaid(source)
  if (!parsed.ok) {
    const env = parseErrorEnvelope(parsed.error)
    if (json || format === 'json') process.stdout.write(JSON.stringify(env) + '\n')
    else process.stderr.write(`describe: parse failed: ${env.error.message}\n`)
    return EXIT_ARG_ERROR
  }
  const described = describeMermaid(parsed.value, { format })
  if (format === 'json') {
    const tree = JSON.parse(described)
    process.stdout.write(JSON.stringify(json ? { ok: true, tree } : tree) + '\n')
    return EXIT_OK
  }
  process.stdout.write(json ? JSON.stringify({ ok: true, text: described }) + '\n' : described + '\n')
  return EXIT_OK
}

// ---- Loop 7 / A3.1: capabilities ------------------------------------------

type FamilyEditPolicy = 'structured-when-narrowed' | 'source-level-only'

interface FamilyCapability {
  id: string
  hasParse: boolean
  hasSerialize: boolean
  hasMutate: boolean
  hasVerify: boolean
  hasExtractLabels: boolean
  mutationOps: string[]
  editPolicy: FamilyEditPolicy
  /** Minimal canonical source (header + core syntax); absent for
   *  registered non-builtin families that don't declare one. */
  example?: string
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

export const MUTATION_OPS_BY_FAMILY = {
  flowchart: ['add_node', 'remove_node', 'rename_node', 'set_label', 'add_edge', 'remove_edge'],
  state: ['add_state', 'remove_state', 'rename_state', 'set_state_label', 'add_transition', 'remove_transition', 'set_transition_label', 'make_composite'],
  sequence: ['add_participant', 'remove_participant', 'add_message', 'remove_message', 'set_message_text'],
  timeline: ['set_title', 'add_section', 'remove_section', 'set_section_label', 'add_period', 'remove_period', 'set_period_label', 'add_event', 'remove_event', 'set_event_text'],
  class: ['set_title', 'add_class', 'remove_class', 'rename_class', 'add_member', 'remove_member', 'add_relation', 'remove_relation', 'add_note', 'remove_note'],
  er: ['add_entity', 'remove_entity', 'rename_entity', 'add_attribute', 'remove_attribute', 'add_relation', 'remove_relation'],
  journey: ['set_title', 'add_section', 'remove_section', 'set_section_label', 'add_task', 'remove_task', 'set_task_text', 'set_task_score', 'set_task_actors', 'rename_actor'],
  architecture: ['add_service', 'remove_service', 'rename_service', 'set_service_label', 'set_service_icon', 'move_service', 'add_group', 'remove_group', 'add_edge', 'remove_edge'],
  xychart: ['set_title', 'set_x_axis', 'set_y_axis', 'add_series', 'remove_series', 'set_series_values', 'set_series_name', 'reorder_series'],
  pie: ['set_title', 'set_show_data', 'add_slice', 'remove_slice', 'rename_slice', 'set_slice_value', 'reorder_slice'],
  quadrant: ['set_title', 'set_axis_labels', 'set_quadrant_label', 'add_point', 'remove_point', 'move_point', 'rename_point'],
  gantt: ['set_title', 'add_section', 'rename_section', 'remove_section', 'add_task', 'remove_task', 'rename_task', 'set_task_status', 'set_task_dates'],
} as const satisfies Record<BuiltinFamilyId, readonly string[]>

type MutableFamilyId = keyof typeof MUTATION_OPS_BY_FAMILY

export function buildCapabilities(): CapabilitiesEnvelope {
  const sdkVersion = (() => {
    try {
      const pkg = require('../../package.json') as { version: string }
      return pkg.version
    } catch {
      return 'unknown'
    }
  })()
  const mutableFamilies = new Set(Object.keys(MUTATION_OPS_BY_FAMILY))
  const families: FamilyCapability[] = knownFamilies().map((id) => {
    const p = getFamily(id)!
    const mutationOps = id in MUTATION_OPS_BY_FAMILY ? [...MUTATION_OPS_BY_FAMILY[id as MutableFamilyId]] : []
    const editPolicy: FamilyEditPolicy = mutationOps.length > 0 ? 'structured-when-narrowed' : 'source-level-only'
    return {
      id,
      // Capabilities describe the public agent surface, not whether the
      // implementation currently lives in a FamilyPlugin hook or central
      // dispatch. All registered families parse, serialize, verify, render,
      // and round-trip through parseMermaid/serializeMermaid/verifyMermaid.
      hasParse: true,
      hasSerialize: true,
      hasMutate: mutableFamilies.has(id),
      hasVerify: true,
      hasExtractLabels: Boolean(p.extractLabels),
      mutationOps,
      editPolicy,
      example: builtinFamilyMetadata(id)?.example,
    }
  })
  const warningCodes: WarningCodeCapability[] = (Object.keys(WARNING_SEVERITY) as WarningCode[]).map(code => ({
    code,
    tier: WARNING_TIER[code],
    severity: WARNING_SEVERITY[code],
  }))
  return { sdkVersion, families, warningCodes, outputFormats: ['svg', 'ascii', 'unicode', 'png', 'json'] }
}

/** Resolve the --style flag: comma-separated style names and/or .json spec
 *  files forming a stack (merged left → right by resolveStyleStack). JSON
 *  specs are validated before use so bad files are arg errors, not throws. */
function parseStyleFlag(value: string): StyleInput[] {
  return value.split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
    if (entry.endsWith('.json') || existsSync(entry)) {
      if (!existsSync(entry)) throw new Error(`style spec file not found: ${entry}`)
      const spec = JSON.parse(readFileSync(entry, 'utf8')) as unknown
      const problems = validateStyleSpec(spec)
      if (problems.length > 0) throw new Error(`invalid style spec ${entry}: ${problems.join('; ')}`)
      return spec as StyleSpec
    }
    return entry
  })
}

/** A palette-only spec is what people call a theme; anything that also sets
 *  stroke/fill/typography/roles is a full look. */
function styleKind(spec: StyleSpec): 'look' | 'theme' {
  return Object.keys(spec).every(k => k === 'name' || k === 'blurb' || k === 'colors') ? 'theme' : 'look'
}

function cmdStyles(json: boolean): number {
  const rows = knownStyles().map(name => {
    if (name === 'crisp') {
      return { name, kind: 'default' as const, backend: 'default' as const, blurb: 'The byte-identical default renderer (style unset).' }
    }
    const spec = getStyle(name)!
    return {
      name,
      kind: styleKind(spec),
      backend: inferBackend(spec),
      ...(spec.intent ? { intent: spec.intent } : {}),
      blurb: spec.blurb ?? '',
    }
  })
  if (json) {
    process.stdout.write(JSON.stringify(rows) + '\n')
    return EXIT_OK
  }
  const nameWidth = Math.max(...rows.map(r => r.name.length))
  for (const r of rows) {
    process.stdout.write(`${r.name.padEnd(nameWidth)}  ${r.kind.padEnd(7)}  ${r.blurb}\n`)
  }
  process.stdout.write(`\nStack styles with: am render <file> --style <name[,name|file.json...]> [--seed N]\nAuthor your own: docs/style-authoring.md (JSON records; validate with validateStyleSpec).\n`)
  return EXIT_OK
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
  const structured = cap.families.filter(f => f.hasMutate).map(f => f.id)
  const narrowers = BUILTIN_FAMILY_METADATA.map(f => f.narrower).join(', ')
  const formats = cap.outputFormats.join(', ')
  const codes = cap.warningCodes.map(w => `${w.code} (${w.tier}/${w.severity})`).join(', ')
  return `# Agentic Mermaid

> Agent-native Mermaid runtime: parse, verify, mutate, and round-trip
> Mermaid diagrams with a typed IR. Deterministic ASCII / PNG / SVG. No
> browser required. CLI + MCP + library.

Version: ${cap.sdkVersion}

## What it does

A typed editing surface over Mermaid for AI agents. Parse a diagram to a
ValidDiagram, mutate it with typed ops, verify structurally (no pixels),
serialize back to canonical source. Layout is deterministic (verified
cross-process and same-machine cross-runtime on x86_64/ARM64).

## The agent loop

New diagrams: author Mermaid source → parse → verify → render/return.
Existing structured diagrams: parse → narrow → mutate → verify → serialize.
Run verify at every commit point. Never serialize a diagram whose verify result
you haven't inspected.

## CLI verbs (\`am <verb>\`)

- render --format svg, ascii, unicode, json [--security strict] — render a diagram
- render --format png --output file.png — render one input to PNG (no PNG bytes on stdout, no multi-input/watch)
- render --style <names|file.json> --seed N — styled svg/png; comma-separate to stack (--style hand-drawn,dracula)
- styles [--json] — list registered styles (default + full looks + palette-only themes)
- parse — diagram → ValidDiagram JSON
- verify — structural validation (exit 3 if invalid)
- mutate --op '<json>' / --ops '<json array|file>' — apply typed mutation(s), verify, then emit source
- preview [--output file.html] [--open] — standalone strict-mode HTML preview for user inspection
- format — normalize / canonicalize source
- describe [--format text|json] — natural-language or AX-tree summary
- capabilities --json — machine-readable capability envelope incl. editPolicy + mutationOps
- batch --jsonl — bulk render/verify/parse/serialize/mutate ops, one JSON envelope per line
- render-markdown <file.md> [--ascii] — render fenced mermaid blocks, skip invalid ones
- llms-txt — this document
- init-agent [--dir .] [--force] — write AGENTS.md section, root skills/ bundle, and .mcp.json sample

Exit codes: 0 ok, 2 arg error, 3 verify-failed, 4 internal.

## MCP tools

Code Mode \`execute(code)\` (JavaScript in a node:vm sandbox with a typed
mermaid.* SDK declaration) plus narrow helper tools: render_png and describe.
render_png is offline.

## Output formats

Agentic Mermaid outputs SVG, PNG, ASCII, Unicode, and JSON layout. Full capability list: ${formats}. SVG strict mode (security: 'strict') emits zero external-fetch
references — safe for untrusted/agent-generated diagrams. See SECURITY.md.

## Diagram families

All families parse, verify, render, round-trip: ${families}.
Structured mutation (${cap.families.find(f => f.hasMutate)?.editPolicy}): ${structured.join(', ')}.
Narrowers: ${narrowers}.
State diagrams own a dedicated body (BUILD-19): narrow with asState; state-shaped ops apply (asFlowchart returns null on them).
Source-level-only: ${cap.families.filter(f => !f.hasMutate).map(f => f.id).join(', ') || 'none — every renderable family ships structured mutation'}.
Opaque-fallback bodies (unmodeled syntax) round-trip losslessly via preserved source (never silently dropped) and stay source-level only.

## Warning codes

${codes}

## Library

\`import { parseMermaid, mutate, verifyMermaid, analyzeMermaid,
analyzeMermaidSource, serializeMermaid, renderMermaidASCII,
renderMermaidPNG, renderMermaidSVG, renderMermaidASCIIWithMeta,
describeMermaid, asciiToMermaid, verifyNoExternalRefs,
registerStyle, knownStyles, validateStyleSpec } from 'agentic-mermaid/agent'\`

## Styles

Every render call accepts style: a name ('hand-drawn', 'excalidraw',
'pen-and-ink', 'freehand', 'watercolor', 'blueprint', 'tufte', or any theme
name — a theme is a palette-only style), an inline JSON spec, or a stack
merged left → right ({ style: ['hand-drawn', 'dracula'] }). seed re-rolls
ink wobble, never layout — (source, style, seed) reproduces an image
exactly. Custom styles are data: validateStyleSpec(json) checks untrusted
records, registerStyle({ name, … }) makes them addressable by name.
Authoring guide + quality rubric: docs/style-authoring.md.

## Docs

- docs/README.md — documentation index and structure
- Instructions_for_agents.md — canonical agent-use guide
- AGENT_NATIVE.md — architecture/spec rationale
- docs/features.md — current capability inventory
- docs/api.md — library/CLI/MCP API reference, including SVG/PNG/ASCII output
- docs/diagram-families.md — family examples and edit policy
- docs/theming.md — themes, CSS variables, and Shiki compatibility
- docs/style-authoring.md — styles: the composable look system (a theme is a palette-only style; stack names/specs; author custom styles as data records with the quality rubric)
- docs/quality.md — determinism + "good looking" rubric
- TODO.md — only active backlog
- SECURITY.md — threat model + strict-mode guarantee
- docs/agent-mutation-policy.md — structured-vs-source-level policy
- docs/agent-api-cookbook.md — copy-pasteable library/CLI/MCP recipes
- docs/mcp-code-mode-rationale.md — MCP surface rationale
- docs/agent-workflow-examples.md — runnable MCP/CLI + agent-improvement examples
- skills/ — agent-agnostic SKILL.md bundles for diagram workflow and live-editor development
- evals/ — skill-eval-harness manifest, fixtures, and benchmark instructions
`
}

function cmdLlmsTxt(): number {
  process.stdout.write(buildLlmsTxt())
  return EXIT_OK
}

function cmdInitAgent(args: ParsedArgs, json: boolean): number {
  const dir = typeof args.flags.dir === 'string' ? resolve(args.flags.dir) : process.cwd()
  const force = Boolean(args.flags.force)
  const result = initAgentFiles({ dir, force })
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n')
    return EXIT_OK
  }
  const rel = (p: string) => p.startsWith(dir) ? '.' + p.slice(dir.length) : p
  for (const p of result.written) process.stdout.write(`  created  ${rel(p)}\n`)
  for (const p of result.appended) process.stdout.write(`  updated  ${rel(p)}\n`)
  for (const p of result.skipped) process.stdout.write(`  skipped  ${rel(p)} (exists; use --force if applicable)\n`)
  process.stdout.write('\nNext: read AGENTS.md, connect the MCP server in .mcp.json, or run `am --agent-instructions`.\n')
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
      const output = format === 'ascii' ? renderMermaidASCII(src, { useAscii: true }) : renderMermaidSVG(src)
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
  op: 'render' | 'verify' | 'parse' | 'serialize' | 'mutate'
  source: string
  options?: Record<string, unknown>
  mutation?: AnyMutationOp
  mutations?: AnyMutationOp[]
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
      case 'mutate': {
        const ops = Array.isArray(parsed.mutations)
          ? parsed.mutations
          : parsed.mutation
            ? [parsed.mutation]
            : []
        if (ops.length === 0) return { ok: false, op, error: { code: 'INVALID_OP', message: 'mutate batch line requires mutation or mutations[]' } }
        const r = mutateSource(parsed.source, ops)
        if (!r.ok) return { ok: false, op, error: { code: r.error.code, message: r.error.message } }
        return { ok: true, op, data: { source: r.source, verify: JSON.parse(JSON.stringify(r.verify, replacer)) } }
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
