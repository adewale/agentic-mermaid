// ============================================================================
// am — agentic-mermaid CLI (v4).
// ============================================================================

import { readFileSync, existsSync, writeFileSync, mkdtempSync, statSync, watch } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { PACKAGE_VERSION } from '../version.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import { logToolInvocation } from '../agent/trace-log.ts'
import { serializeMermaid, synthesizeFromGraph } from '../agent/serialize.ts'
import { mutateChecked } from '../agent/mutate.ts'
import { configWarningsForMermaid, verifyMermaid } from '../agent/verify.ts'
import {
  renderMermaidSVG, renderMermaidSVGWithReceipt,
  renderMermaidASCII, renderMermaidASCIIWithReceipt,
  renderMermaidPNG, renderMermaidPNGWithReceipt,
  layoutMermaidWithReceipt,
} from '../agent/index.ts'
import type { PngFontWarning } from '../agent/png.ts'
import { describeMermaid } from '../agent/describe.ts'
import { collectBatched } from '../shared/batched.ts'
import type {
  ValidDiagram, ParsedDiagram, WarningCode, AnyMutationOp,
  MutationError, Result, MutableValidDiagram, LayoutWarning,
} from '../agent/types.ts'
import { WARNING_SEVERITY, WARNING_TIER } from '../agent/types.ts'
import { BUILTIN_FAMILY_METADATA, builtinFamilyMetadata, isBuiltinFamilyId, knownFamilies, getFamily, getFamilyConformanceReport } from '../agent/families.ts'
import type { FamilyConformanceReport } from '../agent/families.ts'
import { knownStyleDescriptors, validateStyleSpec, inferBackend, resolveStyleStack } from '../scene/style-registry.ts'
import type { StyleInput, StyleSpec } from '../scene/style-registry.ts'
import type { RenderOptions } from '../types.ts'
import type { PngOptions } from '../agent/png.ts'
import { PNG_DEFAULT_SCALE, type PngOutputOptionField } from '../png-contract.ts'
import {
  CLI_RENDER_FORMATS,
  DEFAULT_CLI_RENDER_FORMAT,
  cliRenderFormatHelpLines,
  isCliRenderFormat,
  renderOutputForCliFormat,
  validateSerializableRenderOptions,
} from '../render-contract.ts'
import type { CliRenderFormat, RenderRequestReceipt } from '../render-contract.ts'
import {
  createSectionACapabilityReport,
  sectionACapabilityDiscoverySummary,
  type SectionACapabilityDiscoverySummary,
} from '../section-a-capability-report.ts'
import type { BuiltinFamilyId } from '../agent/families.ts'
import { AGENT_INSTRUCTIONS } from './agent-instructions.ts'
import { initAgentFiles } from './init-agent.ts'
import { EXIT_OK, EXIT_ARG_ERROR, EXIT_VERIFY_FAILED, EXIT_INTERNAL } from './exit-codes.ts'
import type { ParseError } from '../agent/types.ts'
import {
  familyDetectionDiagnosticFromPreservedBody,
  MermaidFamilyDetectionError,
} from '../family-detection.ts'
import {
  projectRenderErrorDiagnostic,
  type RenderErrorDiagnostic,
} from '../render-error-diagnostic.ts'

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

type CliStructuredFailure = {
  ok: false
  error: { code: string; message: string; details?: unknown }
}

function isCliStructuredFailure(value: unknown): value is CliStructuredFailure {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { ok?: unknown; error?: unknown }
  if (candidate.ok !== false || typeof candidate.error !== 'object' || candidate.error === null) return false
  const error = candidate.error as { code?: unknown; message?: unknown }
  return typeof error.code === 'string' && typeof error.message === 'string'
}

function cliStructuredRenderFailure(error: unknown): CliStructuredFailure {
  if (isCliStructuredFailure(error)) return error
  return { ok: false, error: projectRenderErrorDiagnostic(error) }
}

/** CLI render accepts installed extensions but cannot execute a source-only
 * preserved envelope. Keep that distinction structured instead of converting
 * unknown/future families into either a parse failure or an internal error. */
function preflightCliRenderableSource(source: string): ParsedDiagram {
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw parseErrorEnvelope(parsed.error)
  if (parsed.value.body.kind === 'preserved') {
    throw new MermaidFamilyDetectionError(
      familyDetectionDiagnosticFromPreservedBody(parsed.value.body),
    )
  }
  return parsed.value
}

export interface ParsedArgs { command?: string; positional: string[]; flags: Record<string, string | boolean>; errors: string[] }

// Single source of truth for CLI flags. A flag with no `arg` is a boolean;
// `arg` is the usage placeholder shown in `[--flag <arg>]`. BOOLEAN_FLAGS is
// DERIVED from this, so the parser's boolean classification cannot drift from
// the documented usage.
export const FLAG_SPECS: Record<string, { arg?: string }> = {
  // booleans
  'agent-instructions': {}, 'ascii': {}, 'certificates': {}, 'help': {}, 'json': {},
  'jsonl': {}, 'watch': {}, 'open': {}, 'force': {}, 'canonical-wrapper': {}, 'system-fonts': {},
  // value flags (placeholder = what the usage shows after the flag)
  'suppress': { arg: 'CODES' }, 'label-cap': { arg: 'N' }, 'op': { arg: 'JSON' },
  'style': { arg: 'NAMES|file' }, 'seed': { arg: 'N' }, 'options': { arg: 'JSON|file' },
  'ops': { arg: 'JSON|file' }, 'output': { arg: 'FILE' }, 'format': { arg: 'fmt' },
  'security': { arg: 'mode' }, 'dir': { arg: 'DIR' }, 'font-dirs': { arg: 'DIRS' },
  'gantt-today': { arg: 'DATE' }, 'target-width': { arg: 'CELLS' },
  // PNG raster knobs (read by cmdRender's png path since v4; registered so
  // the unknown-flag gate cannot reject them).
  'scale': { arg: 'N' }, 'bg': { arg: 'COLOR' },
  'fit-width': { arg: 'PX' }, 'fit-height': { arg: 'PX' }, 'o': { arg: 'FILE' },
}

export const BOOLEAN_FLAGS = new Set(Object.keys(FLAG_SPECS).filter(name => !FLAG_SPECS[name]!.arg))

/**
 * Explicit projection from the canonical PNG option authority to CLI syntax.
 * Empty means the field is adapter-owned rather than caller-supplied: the CLI
 * installs `onWarning` itself so warnings can be emitted safely on stderr.
 */
export const PNG_CLI_FLAG_BINDINGS = Object.freeze({
  scale: Object.freeze(['scale']),
  background: Object.freeze(['bg']),
  fitTo: Object.freeze(['fit-width', 'fit-height']),
  fontDirs: Object.freeze(['font-dirs']),
  loadSystemFonts: Object.freeze(['system-fonts']),
  onWarning: Object.freeze([]),
} as const satisfies Readonly<Record<PngOutputOptionField, readonly string[]>>)

const PNG_RENDER_FLAGS = Object.freeze(Object.values(PNG_CLI_FLAG_BINDINGS).flat())

// Command ownership is the second half of the flag contract: recognizing a
// name globally is not permission to ignore it on an unrelated command.
export const COMMAND_FLAGS = {
  render: ['help', 'json', 'certificates', 'watch', 'style', 'seed', 'options', 'output', 'format', 'security', 'gantt-today', 'target-width', ...PNG_RENDER_FLAGS, 'o'],
  verify: ['help', 'json', 'suppress', 'label-cap', 'style'],
  parse: ['help', 'json'],
  serialize: ['help'],
  mutate: ['help', 'json', 'op', 'ops'],
  preview: ['help', 'json', 'output', 'open', 'security'],
  format: ['help', 'canonical-wrapper'],
  describe: ['help', 'json', 'format'],
  capabilities: ['help', 'json'],
  styles: ['help', 'json'],
  'llms-txt': ['help'],
  'init-agent': ['help', 'json', 'dir', 'force'],
  batch: ['help', 'jsonl'],
  'render-markdown': ['help', 'ascii'],
} as const satisfies Record<string, readonly string[]>

/** Closed positional contract. Zero source arguments means piped stdin; only
 * render intentionally accepts multiple files. */
export const COMMAND_POSITIONALS = Object.freeze({
  render: { min: 0, max: Number.POSITIVE_INFINITY },
  verify: { min: 0, max: 1 },
  parse: { min: 0, max: 1 },
  serialize: { min: 0, max: 0 },
  mutate: { min: 0, max: 1 },
  preview: { min: 0, max: 1 },
  format: { min: 0, max: 1 },
  describe: { min: 0, max: 1 },
  capabilities: { min: 0, max: 0 },
  styles: { min: 0, max: 0 },
  'llms-txt': { min: 0, max: 0 },
  'init-agent': { min: 0, max: 0 },
  batch: { min: 0, max: 0 },
  'render-markdown': { min: 0, max: 1 },
} as const satisfies Record<keyof typeof COMMAND_FLAGS, { readonly min: number; readonly max: number }>)

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {}, errors: [] }
  const record = (name: string, value: string | boolean) => {
    if (Object.prototype.hasOwnProperty.call(out.flags, name)) {
      out.errors.push(`Flag --${name} may be supplied only once.`)
      return
    }
    out.flags[name] = value
  }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg === '--') {
      for (const positional of argv.slice(i + 1)) {
        if (!out.command) out.command = positional
        else out.positional.push(positional)
      }
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = arg.slice(2, eq === -1 ? undefined : eq)
      if (eq !== -1) {
        if (BOOLEAN_FLAGS.has(name)) out.errors.push(`Flag --${name} does not accept a value.`)
        record(name, arg.slice(eq + 1))
      } else {
        const next = argv[i + 1]
        if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith('--')) record(name, true)
        else { record(name, next); i++ }
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
  render <file|->        Render through a registered output adapter
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
  --ascii                For render-markdown: ASCII instead of SVG
  --op <JSON>            For mutate: one MutationOp
  --ops <JSON|file>      For mutate: JSON array of MutationOps
  --output <FILE>        Write render/preview output to FILE instead of stdout
  --open                 For preview: open generated HTML in browser
  --force                For init-agent: refresh generated skill/MCP files
  --style <NAMES|file>   Style stack — comma-separated names and/or .json spec files
  --options <JSON|file>  Shared advanced render options across output adapters
  --seed <N>             Re-roll ink wobble of styled looks (never layout)
  --font-dirs <DIRS>     For render png: extra font directories, comma-separated (CJK/emoji coverage)
  --system-fonts         For render png: also load OS fonts (coverage warnings then skipped)
  --suppress <CODES>     For verify: comma-separated WarningCodes to suppress
  --label-cap <N>        For verify: LABEL_OVERFLOW char cap (default 40)
  --certificates         For render --format layout: include route/family certificates
  --gantt-today <DATE>   For render: draw the gantt today marker at DATE (rendering never reads the wall clock)
  --target-width <CELLS> Hard terminal-cell bound for ASCII/Unicode output
  --agent-instructions   Print the canonical agent-use guide
  --help                 Show this message (or per-command help: am <cmd> --help)

Exit codes:
  0  ok
  2  arg / parse error (bad flag, missing file, malformed JSON)
  3  verify reported errors (severity 'error')
  4  uncaught internal failure
`

export const COMMAND_HELP: Record<string, string> = {
  render: `am render <file|-> [--format ${CLI_RENDER_FORMATS.join('|')}] [--json]
Render a diagram. Default is ${DEFAULT_CLI_RENDER_FORMAT.toUpperCase()}.
${cliRenderFormatHelpLines()}
  --certificates     With --format layout, include route/family certificates
  --style <S>       Style stack: comma-separated names and/or .json spec files,
                    merged left → right (e.g. --style hand-drawn,dracula or
                    --style ./brand.json). Applies to graphical and terminal
                    projection. See: am styles
  --options <JSON|file> Shared advanced RenderOptions object; convenience
                    flags override its fields
  --seed <N>        Re-roll ink wobble of styled looks; never moves layout
  --font-dirs <DIRS> PNG only: extra font directories (comma-separated) for
                    scripts the bundled Inter/DejaVu fonts don't cover (CJK,
                    emoji); uncovered characters warn on stderr
  --system-fonts    PNG only: also load OS-installed fonts (trades cross-machine
                    determinism for coverage; skips coverage warnings)
  --security strict Enforce the strict SVG output-security policy
  --gantt-today <DATE> Gantt only: draw the today marker at DATE (in the
                    diagram's dateFormat or ISO YYYY-MM-DD); rendering never
                    reads the wall clock, so without this the marker is absent
  --target-width <CELLS> ASCII/Unicode only: hard output bound in display cells;
                    impossible geometry fails with ASCII_TARGET_WIDTH_IMPOSSIBLE
  --scale <N>       PNG only: output scale multiplier (default ${PNG_DEFAULT_SCALE})
  --bg <COLOR>      PNG only: override the diagram background (white fallback)
  --fit-width <PX>  PNG only: fit output to this pixel width
  --fit-height <PX> PNG only: fit output to this pixel height (mutually exclusive with --fit-width)
  --watch           Re-render one input file on change (non-PNG only)
Multiple inputs emit a JSON results array for non-PNG formats.
With --json, textual forms wrap output as {"<format>": "..."}.`,
  styles: `am styles [--json]
List every registered style. A style is a partial description of how diagrams
look; a colors-only style is a palette, a full look sets stroke/fill/typography
too. Stack them with render --style (e.g. --style hand-drawn,dracula) and
re-roll ink with --seed. Custom styles are JSON records (docs/style-authoring.md);
pass a .json file path anywhere a name is accepted.
With --json: [{ name, canonicalId, kind: look|palette, isDefault, backend, intent?, blurb }].`,
  verify: `am verify <file|-> [--suppress A,B] [--label-cap N] [--style NAMES|file]
Always emits JSON: {ok, warnings[], layout}.
  --style <S>       Resolve the same named/file-backed Style used by render so
                    inspect-only Brand constraints evaluate the styled Scene.
Tier-1 error codes flip ok=false:
EMPTY_DIAGRAM, EDGE_MISANCHORED, OFF_CANVAS, GROUP_BREACH, UNRESOLVABLE_SCHEDULE,
RENDER_FAILED (source verifies structurally but the render parser rejects it), BRAND_CONSTRAINT_ERROR
(only when a Style constraint explicitly selects action=error). Warning codes:
UNKNOWN_SHAPE, LABEL_OVERFLOW (char-cap),
NODE_OVERLAP, ROUTE_SELF_CROSS, ROUTE_HITCH, ROUTE_UNEXPLAINED_BEND, ROUTE_LABEL_ON_SHARED_TRUNK,
ROUTE_SELF_LOOP_OCCUPANCY, ROUTE_CONTAINER_MISANCHOR, ROUTE_SHAPE_MISANCHOR, ROUTE_STALE_AFTER_NODE_MOVE,
DUPLICATE_EDGE, UNREACHABLE_NODE, DECISION_BRANCH_UNLABELED, COMMENT_DROPPED, UNSUPPORTED_SYNTAX,
CONTENT_DROPPED_ON_ROUNDTRIP, INEFFECTIVE_CONFIG, LOW_CONTRAST, BRAND_CONSTRAINT_WARNING.
Brand constraints inspect without repainting or relayout; other Tier-3 lint is advisory.
Exit 0 if ok, 3 if verify reports severity='error'.`,
  parse: `am parse <file|->
Emits ValidDiagram JSON (Maps serialized to objects). Exit 2 on parse error.
Pipe to 'am serialize' to round-trip.`,
  serialize: `am serialize  (reads ValidDiagram JSON on stdin)
Emits canonical Mermaid source. Accepts the JSON shape that 'am parse' emits;
rebuilds the diagram via synthesizeFromGraph without re-parsing source.`,
  mutate: `am mutate <file|-> (--op '<JSON>' | --ops '<JSON array|file.json>') [--json]
Applies one or more MutationOps, verifies the final diagram, then emits source.
Registered families with mutationOps have typed mutation; discover the live roster,
narrowers, and op names with 'am capabilities --json'. Opaque-fallback diagrams
(unmodeled syntax) return a structured UNSUPPORTED_FAMILY error (exit 2). Verify failures
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
  describe: `am describe <file|-> [--format text|json|facts] [--json]
Summarize a Mermaid diagram. Text format emits prose by default; --json wraps
it as {ok,text}. --format json emits the structured AX tree
{kind,nodes,edges,entryPoints,sinks}; with --json it wraps as {ok,tree}.
--format facts emits deterministic semantic fact lines; with --json it wraps as {ok,facts}.`,
  capabilities: `am capabilities [--json]
Emits a single JSON object describing the SDK's capability surface:
  { sdkVersion, families: [{ id, hasMutate, hasExtractLabels, mutationOps, editPolicy, example }],
    warningCodes: [{ code, tier, severity }],
    outputFormats: ${JSON.stringify(CLI_RENDER_FORMATS)},
    sectionA: { reportSchemaVersion, reportDigest, upstreamPin, counts,
      noAbsentSyntaxCapabilities, fullReport } }
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
  const json = Boolean(args.flags.json)
  const argError = (message: string): number => {
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code: 'ARG', message } }) + '\n')
    process.stderr.write(`${message}\n`)
    return EXIT_ARG_ERROR
  }
  if (args.errors.length > 0) return argError(args.errors.join(' '))
  if (args.flags['agent-instructions']) { process.stdout.write(AGENT_INSTRUCTIONS); return EXIT_OK }
  if (args.flags.help && !args.command) { process.stdout.write(GLOBAL_USAGE); return EXIT_OK }
  if (!args.command) { process.stdout.write(GLOBAL_USAGE); return EXIT_ARG_ERROR }
  if (args.flags.help) {
    process.stdout.write((COMMAND_HELP[args.command] ?? GLOBAL_USAGE) + '\n')
    return EXIT_OK
  }
  // Unknown flags are ERRORS, not silently-swallowed no-ops (probe-confirmed
  // bug class: `--gantt-toady 2024-01-05` used to exit 0 with no marker and no
  // complaint). FLAG_SPECS is the single source of truth for what exists.
  const unknownFlags = Object.keys(args.flags).filter(name => !(name in FLAG_SPECS))
  if (unknownFlags.length > 0) {
    const message = `Unknown flag${unknownFlags.length > 1 ? 's' : ''}: ${unknownFlags.map(f => `--${f}`).join(', ')}. Run \`am --help\` or \`am ${args.command} --help\` for the flag list.`
    return argError(message)
  }
  const missingValues = Object.entries(args.flags)
    .filter(([name, value]) => FLAG_SPECS[name]?.arg && (typeof value !== 'string' || value.length === 0))
    .map(([name]) => name)
  if (missingValues.length > 0) {
    return argError(`Flag${missingValues.length > 1 ? 's' : ''} ${missingValues.map(name => `--${name}`).join(', ')} require${missingValues.length === 1 ? 's' : ''} a value.`)
  }
  const allowed = new Set(COMMAND_FLAGS[args.command as keyof typeof COMMAND_FLAGS] ?? ['help'])
  const inapplicable = Object.keys(args.flags).filter(name => !allowed.has(name))
  if (inapplicable.length > 0) {
    return argError(`Flag${inapplicable.length > 1 ? 's' : ''} ${inapplicable.map(name => `--${name}`).join(', ')} ${inapplicable.length > 1 ? 'are' : 'is'} not valid for am ${args.command}.`)
  }
  const positionalContract = COMMAND_POSITIONALS[args.command as keyof typeof COMMAND_POSITIONALS]
  if (positionalContract && (args.positional.length < positionalContract.min || args.positional.length > positionalContract.max)) {
    return argError(`am ${args.command} accepts ${positionalContract.max === 0 ? 'no positional arguments' : `at most ${positionalContract.max} positional input${positionalContract.max === 1 ? '' : 's'}`}; received ${args.positional.length}.`)
  }
  // Opt-in invocation logging: when AM_TRACE_LOG names a file, append one JSON
  // line per real command run. Shares the sink with the library and hosted MCP
  // (src/agent/trace-log.ts) so the agent-usage eval can grade traceOk from
  // observed calls on ANY channel. The library verify/mutate/create the CLI
  // commands call also log, so `am verify`/`am mutate` are covered even here.
  logToolInvocation(args.command)
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
    // Argument and file-shape failures are not renderer failures even when
    // they occur under the render command.
    const isArgError = /^needs a file argument|^File not found:/.test(msg)
    const structured = isArgError
      ? undefined
      : args.command === 'render' || args.command === 'preview' || isCliStructuredFailure(e)
        ? cliStructuredRenderFailure(e)
        : undefined
    if (structured) {
      if (json) process.stdout.write(JSON.stringify(structured) + '\n')
      else process.stderr.write(`Error: ${structured.error.code}: ${structured.error.message}\n`)
      return EXIT_ARG_ERROR
    }
    // Loop 9 M5: argument-shape errors (missing file, TTY stdin, etc.) get
    // exit 2 per the documented contract. Heuristic: messages thrown from
    // readSourceArg / arg parsing are advisory rather than internal bugs.
    if (json) process.stdout.write(JSON.stringify({ ok: false, error: { code: isArgError ? 'ARG' : 'INTERNAL', message: msg } }) + '\n')
    else process.stderr.write(`Error: ${msg}\n`)
    return isArgError ? EXIT_ARG_ERROR : EXIT_INTERNAL
  }
}

function cmdRender(args: ParsedArgs, json: boolean): number {
  const format = typeof args.flags.format === 'string' ? args.flags.format : DEFAULT_CLI_RENDER_FORMAT
  const security = args.flags.security === 'strict' ? 'strict' as const : undefined
  // Explicit gantt clock (rendering never reads wall-clock time).
  const ganttToday = typeof args.flags['gantt-today'] === 'string' ? args.flags['gantt-today'] : undefined
  const targetWidth = typeof args.flags['target-width'] === 'string' ? Number(args.flags['target-width']) : undefined
  if (!isCliRenderFormat(format)) {
    process.stderr.write(`am render: unsupported --format ${format}; expected ${CLI_RENDER_FORMATS.join(', ')}\n`)
    return EXIT_ARG_ERROR
  }
  const output = renderOutputForCliFormat(format)!
  if (args.flags.security !== undefined && args.flags.security !== 'strict') {
    process.stderr.write('am render --security accepts only strict\n')
    return EXIT_ARG_ERROR
  }
  let advancedOptions: RenderOptions = {}
  if (typeof args.flags.options === 'string') {
    try {
      advancedOptions = parseRenderOptionsFlag(args.flags.options)
    } catch (error) {
      process.stderr.write(`am render --options: ${error instanceof Error ? error.message : String(error)}\n`)
      return EXIT_ARG_ERROR
    }
  }
  if (targetWidth !== undefined && (!Number.isInteger(targetWidth) || targetWidth <= 0)) {
    process.stderr.write('am render --target-width expects a positive integer number of terminal cells\n')
    return EXIT_ARG_ERROR
  }
  if (targetWidth !== undefined && output.id !== 'ascii' && output.id !== 'unicode') {
    process.stderr.write('am render --target-width is valid only with --format ascii or unicode\n')
    return EXIT_ARG_ERROR
  }
  const pngOnly = PNG_RENDER_FLAGS.filter(name => args.flags[name] !== undefined)
  if (output.id !== 'png' && pngOnly.length > 0) {
    process.stderr.write(`am render: ${pngOnly.map(name => `--${name}`).join(', ')} ${pngOnly.length > 1 ? 'are' : 'is'} valid only with --format png\n`)
    return EXIT_ARG_ERROR
  }
  if (args.flags.certificates && output.id !== 'layout') {
    process.stderr.write('am render: --certificates is valid only with --format layout\n')
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
  }
  const seed = typeof args.flags.seed === 'string' ? Number(args.flags.seed) : undefined
  if (seed !== undefined && !Number.isFinite(seed)) {
    process.stderr.write('am render --seed expects a finite number\n')
    return EXIT_ARG_ERROR
  }
  const formatOptions: RenderFormatOptions = {
    ...advancedOptions,
    ...(security === undefined ? {} : { security }),
    ...(style === undefined ? {} : { style }),
    ...(seed === undefined ? {} : { seed }),
    ...(ganttToday === undefined ? {} : { ganttToday }),
    certificates: args.flags.certificates === true,
    targetWidth,
  }

  if (args.positional.length > 1 && output.id === 'png') {
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
        const warnings = configWarningsForMermaid(src)
        emitConfigWarnings(warnings, `am render ${file}`)
        const rendered = renderSourceToFormatWithReceipt(src, format, formatOptions)
        return { index, file, ok: true, output: rendered.output, receipt: rendered.receipt, warnings }
      } catch (e) {
        const structured = cliStructuredRenderFailure(e)
        return {
          index,
          file,
          ok: false,
          error: structured?.error ?? { code: 'RENDER_FAILED', message: e instanceof Error ? e.message : String(e) },
        }
      }
    })
    process.stdout.write(JSON.stringify({ ok: true, files: results }) + '\n')
    return EXIT_OK
  }

  // #930: watch mode — re-render on file change.
  if (args.flags.watch && output.id === 'png') {
    process.stderr.write('am render --format png does not support --watch; run non-watch PNG renders with --output <file.png>\n')
    return EXIT_ARG_ERROR
  }
  if (args.flags.watch && typeof args.positional[0] === 'string' && args.positional[0] !== '-') {
    return cmdRenderWatch(args.positional[0], format, args, json, formatOptions)
  }

  const source = readSourceArg(args.positional[0])
  // The render surface is open to installed descriptors while future/unknown
  // source-only envelopes retain their exact capability classification.
  try {
    preflightCliRenderableSource(source)
  } catch (error) {
    const structured = cliStructuredRenderFailure(error)
    if (!structured) throw error
    process.stdout.write(JSON.stringify(structured) + '\n')
    return EXIT_ARG_ERROR
  }

  const configWarnings = configWarningsForMermaid(source)

  if (output.id === 'png') {
    const outFile = typeof args.flags.o === 'string' ? args.flags.o : (typeof args.flags.output === 'string' ? args.flags.output : '')
    if (!outFile) {
      process.stderr.write('am render --format png requires --output <file.png> (PNG bytes corrupt terminals if piped to stdout)\n')
      return EXIT_ARG_ERROR
    }
    const scale = typeof args.flags.scale === 'string' ? Number(args.flags.scale) : PNG_DEFAULT_SCALE
    if (!Number.isFinite(scale) || scale <= 0) {
      process.stderr.write('am render --scale expects a positive finite number\n')
      return EXIT_ARG_ERROR
    }
    const background = typeof args.flags.bg === 'string' ? args.flags.bg : undefined
    const fitWidth = typeof args.flags['fit-width'] === 'string' ? Number(args.flags['fit-width']) : undefined
    const fitHeight = typeof args.flags['fit-height'] === 'string' ? Number(args.flags['fit-height']) : undefined
    if (fitWidth !== undefined && fitHeight !== undefined) {
      process.stderr.write('am render PNG fitting accepts --fit-width or --fit-height, not both\n')
      return EXIT_ARG_ERROR
    }
    if ((fitWidth !== undefined && (!Number.isSafeInteger(fitWidth) || fitWidth <= 0))
      || (fitHeight !== undefined && (!Number.isSafeInteger(fitHeight) || fitHeight <= 0))) {
      process.stderr.write('am render --fit-width/--fit-height expects a positive integer pixel value\n')
      return EXIT_ARG_ERROR
    }
    const fitTo = fitWidth !== undefined
      ? { width: fitWidth }
      : fitHeight !== undefined
        ? { height: fitHeight }
        : undefined
    const fontDirs = typeof args.flags['font-dirs'] === 'string'
      ? args.flags['font-dirs'].split(',').map(s => s.trim()).filter(Boolean)
      : undefined
    const loadSystemFonts = args.flags['system-fonts'] === true
    // PNG render is native-sync via resvg; keep bytes off stdout and write the
    // raster artifact explicitly to the requested output path.
    const { certificates: _certificates, targetWidth: _targetWidth, ...sharedOptions } = formatOptions
    return renderPngSync(source, { ...sharedOptions, scale, background, fitTo, fontDirs, loadSystemFonts }, outFile, json, configWarnings)
  }
  // Loop 9 M3/M4, #7645: layout = layout shape; unicode is the default text
  // renderer; `--security strict` enforces the shared SVG output-security policy.
  emitConfigWarnings(configWarnings, 'am render')
  const rendered = renderPreflightedSourceToFormatWithReceipt(source, format, formatOptions)
  const out = rendered.output
  // --output writes the artifact for every single-shot format, matching the
  // documented `am render --format svg --output diagram.svg` (it was png-only,
  // silently ignored elsewhere — the docs' samples produced no file).
  const outFile = typeof args.flags.o === 'string' ? args.flags.o : (typeof args.flags.output === 'string' ? args.flags.output : '')
  const text = typeof out === 'string'
    ? (json ? JSON.stringify({ [format]: out, receipt: rendered.receipt, warnings: configWarnings }) + '\n' : (out.endsWith('\n') ? out : out + '\n'))
    : JSON.stringify({ ...out, receipt: rendered.receipt, ...(configWarnings.length > 0 ? { warnings: configWarnings } : {}) }) + '\n'
  if (outFile) {
    writeFileSync(outFile, text)
    return EXIT_OK
  }
  process.stdout.write(text)
  return EXIT_OK
}

export interface RenderFormatOptions extends RenderOptions { certificates?: boolean; targetWidth?: number }

/** The ONE format dispatch behind every render path — single-input,
 *  multi-input, and watch differ only in I/O and error envelopes, so they
 *  share this core instead of re-enumerating formats (the style/seed
 *  threading previously had to touch three copies). JSON parse failures
 *  throw the structured envelope; callers decide how to surface it. */
export interface RenderFormatResult {
  output: string | object
  receipt: RenderRequestReceipt
}

export function renderSourceToFormatWithReceipt(source: string, format: string, opts: RenderFormatOptions = {}): RenderFormatResult {
  preflightCliRenderableSource(source)
  return renderPreflightedSourceToFormatWithReceipt(source, format, opts)
}

function renderPreflightedSourceToFormatWithReceipt(source: string, format: string, opts: RenderFormatOptions = {}): RenderFormatResult {
  const { certificates, targetWidth, ...sharedOptions } = opts
  const descriptor = renderOutputForCliFormat(format)
  if (!descriptor) throw new Error(`unsupported render format: ${format}`)
  if (descriptor.id === 'ascii' || descriptor.id === 'unicode') {
    const rendered = renderMermaidASCIIWithReceipt(source, { ...sharedOptions, useAscii: descriptor.id === 'ascii', targetWidth })
    return { output: rendered.text, receipt: rendered.receipt }
  }
  if (descriptor.id === 'layout') {
    // Delegate the original request after the shared preflight so the CLI and library
    // resolve the same source/configuration receipt. Passing the parsed value
    // here re-serialized some families (notably timeline) before hashing.
    const rendered = layoutMermaidWithReceipt(source, {
      ...sharedOptions,
      ...(certificates === true ? { debug: true } : {}),
    })
    return { output: rendered.layout, receipt: rendered.receipt }
  }
  if (descriptor.id === 'svg') {
    const rendered = renderMermaidSVGWithReceipt(source, sharedOptions)
    return { output: rendered.svg, receipt: rendered.receipt }
  }
  throw new Error(`unsupported render format: ${format}`)
}

function renderSourceToFormat(source: string, format: string, opts: RenderFormatOptions = {}): string | object {
  return renderSourceToFormatWithReceipt(source, format, opts).output
}

/**
 * #930: pure re-render step for watch mode — reads the file, renders to the
 * requested format, returns the output string. Extracted so it's unit-testable
 * without fs.watch timing.
 */
export function renderFileOnce(file: string, format: string, opts: RenderFormatOptions = {}): string {
  const src = readFileSync(file, 'utf8')
  try {
    const out = renderSourceToFormat(src, format, opts)
    return typeof out === 'string' ? out : JSON.stringify(out)
  } catch (e) {
    // Watch mode wants a printable line, not a throw: all documented render
    // diagnostics serialize through the same envelope as one-shot rendering;
    // unknown implementation errors still propagate to the watcher boundary.
    const structured = cliStructuredRenderFailure(e)
    if (structured) return JSON.stringify(structured)
    throw e
  }
}

export interface PathWatchHandle { close(): void }

/** Watch the containing directory so rename-over atomic saves keep following
 * the input pathname rather than a stale inode. A metadata poll closes the
 * documented fs.watch event-loss gap; both signals share one coalescer. */
export function watchPathForChanges(
  file: string,
  onChange: () => void,
  debounceMs = 25,
  watchDirectory: typeof watch = watch,
): PathWatchHandle {
  const absolute = resolve(file)
  const watchedName = basename(absolute)
  const fingerprint = (): string => {
    try {
      const stat = statSync(absolute, { bigint: true })
      return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
    } catch {
      return 'missing'
    }
  }
  let lastFingerprint = fingerprint()
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const detectChange = () => {
    if (closed) return
    const next = fingerprint()
    if (next === lastFingerprint) return
    lastFingerprint = next
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      if (!closed) onChange()
    }, debounceMs)
  }
  const watcher = watchDirectory(dirname(absolute), { persistent: true }, (_event, filename) => {
    const changed = filename === null ? undefined : basename(String(filename))
    if (changed === undefined || changed === watchedName) detectChange()
  })
  // fs.watch is explicitly allowed to omit events and filenames. Poll only
  // metadata (not file bytes) as a bounded fallback, retaining pathname and
  // rename identity through dev/inode plus nanosecond timestamps.
  const poll = setInterval(detectChange, Math.max(25, Math.min(250, debounceMs * 4)))
  return Object.freeze({
    close(): void {
      closed = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      clearInterval(poll)
      watcher.close()
    },
  })
}

function cmdRenderWatch(file: string, format: string, args: ParsedArgs, json: boolean, opts: RenderFormatOptions = {}): number {
  const outFile = typeof args.flags.output === 'string' ? args.flags.output : ''
  if (outFile && resolve(outFile) === resolve(file)) {
    process.stderr.write('am render --watch output must differ from the input file\n')
    return EXIT_ARG_ERROR
  }
  const emit = () => {
    try {
      const src = readFileSync(file, 'utf8')
      emitConfigWarnings(configWarningsForMermaid(src), 'am render --watch')
      const out = renderSourceToFormat(src, format, opts)
      const text = typeof out === 'string' ? out : JSON.stringify(out)
      if (outFile) { writeFileSync(outFile, text) ; process.stderr.write(`rendered → ${outFile}\n`) }
      else process.stdout.write(text + (text.endsWith('\n') ? '' : '\n'))
    } catch (e) {
      const structured = cliStructuredRenderFailure(e)
      if (json && structured) process.stderr.write(`${JSON.stringify(structured)}\n`)
      else {
        const error = structured?.error
        const message = error?.message ?? (e instanceof Error ? e.message : String(e))
        process.stderr.write(`render error: ${error ? `${error.code}: ` : ''}${message}\n`)
      }
    }
  }
  emit() // initial render
  process.stderr.write(`watching ${file} (Ctrl-C to stop)…\n`)
  watchPathForChanges(file, emit)
  // Block forever — the watcher keeps the event loop alive.
  return EXIT_OK
}

function emitConfigWarnings(warnings: LayoutWarning[], prefix: string): void {
  for (const warning of warnings) {
    process.stderr.write(`${prefix}: warning ${warning.code}${'field' in warning ? ` (${warning.field})` : ''}: ${'message' in warning ? warning.message : 'configuration has no effect'}\n`)
  }
}

function renderPngSync(source: string, opts: PngOptions, outFile: string, json: boolean, configWarnings: LayoutWarning[] = []): number {
  try {
    // Glyph-coverage warnings (CJK/emoji without a covering font) go to
    // stderr — the PNG itself can't show what silently became tofu — and
    // ride along in the --json envelope for programmatic callers.
    const fontWarnings: PngFontWarning[] = []
    const rendered = renderMermaidPNGWithReceipt(source, { ...opts, onWarning: w => fontWarnings.push(w) })
    const png = rendered.png
    const warnings: Array<PngFontWarning | LayoutWarning> = [...configWarnings, ...fontWarnings]
    writeFileSync(outFile, png)
    for (const w of warnings) process.stderr.write(`am render --format png: warning ${w.code}: ${'message' in w ? w.message : 'configuration has no effect'}\n`)
    if (json) process.stdout.write(JSON.stringify({ ok: true, path: outFile, bytes: png.length, receipt: rendered.receipt, runtime: rendered.runtime, warnings }) + '\n')
    return EXIT_OK
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    process.stderr.write(`am render --format png: ${msg}\n`)
    return EXIT_INTERNAL
  }
}

function cmdVerify(args: ParsedArgs): number {
  const source = readSourceArg(args.positional[0])
  const suppressFlag = args.flags.suppress
  let suppress: WarningCode[] | undefined
  if (suppressFlag !== undefined) {
    if (typeof suppressFlag !== 'string') {
      process.stderr.write('am verify --suppress requires a comma-separated list of warning codes\n')
      return EXIT_ARG_ERROR
    }
    const values = suppressFlag.split(',').map(value => value.trim()).filter(Boolean)
    const known = new Set(Object.keys(WARNING_SEVERITY))
    if (values.length === 0 || values.some(value => !known.has(value))) {
      process.stderr.write('am verify --suppress accepts only known warning codes\n')
      return EXIT_ARG_ERROR
    }
    suppress = values as WarningCode[]
  }
  const labelCapFlag = args.flags['label-cap']
  let labelCharCap: number | undefined
  if (labelCapFlag !== undefined) {
    if (typeof labelCapFlag !== 'string' || !/^[1-9]\d*$/.test(labelCapFlag.trim())) {
      process.stderr.write('am verify --label-cap must be a positive safe integer\n')
      return EXIT_ARG_ERROR
    }
    labelCharCap = Number(labelCapFlag)
    if (!Number.isSafeInteger(labelCharCap)) {
      process.stderr.write('am verify --label-cap must be a positive safe integer\n')
      return EXIT_ARG_ERROR
    }
  }
  let style: StyleInput[] | undefined
  if (typeof args.flags.style === 'string') {
    try {
      style = parseStyleFlag(args.flags.style)
      resolveStyleStack(style)
    } catch (error) {
      process.stderr.write(`am verify --style: ${error instanceof Error ? error.message : String(error)}\n`)
      return EXIT_ARG_ERROR
    }
  }
  const r = verifyMermaid(source, {
    suppress,
    labelCharCap,
    ...(style ? { renderOptions: { style } } : {}),
  })
  process.stdout.write(JSON.stringify(r, replacer) + '\n')
  return r.ok ? EXIT_OK : EXIT_VERIFY_FAILED
}

function cmdParse(args: ParsedArgs): number {
  // CLI parsing is a transport envelope rather than the closed TypeScript
  // ValidDiagram API. Use the registered parser so a trusted host that installs
  // an extension can inspect the same source it can already render and verify.
  // Built-in payloads remain byte-for-byte the existing ValidDiagram shape.
  const r = parseRegisteredMermaid(readSourceArg(args.positional[0]))
  if (!r.ok) {
    // Error envelope matches the documented batch shape (cli/index.ts:107).
    // Success emits the bare ParsedDiagram payload. Built-in results retain the
    // existing ValidDiagram shape and remain pipeable into `am serialize`.
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

function mutateAny(d: ParsedDiagram, op: AnyMutationOp): Result<MutableValidDiagram, CliMutationError> {
  // mutate() dispatches to the family's registered mutator by diagram kind,
  // so the CLI only rules out what the registry cannot handle: opaque bodies
  // (source-preserved syntax has no structured ops) and families without a
  // mutate hook. The per-family narrowing cascade this replaces re-encoded
  // the family list a 13th time.
  const plugin = getFamily(d.kind)
  if (d.body.kind !== 'opaque' && d.body.kind !== 'extension' && d.body.kind !== 'preserved' && plugin?.mutate && plugin.serialize) {
    // `--op`/`--ops` arrive as untyped JSON, so the CLI funnels through the same
    // mutateChecked choke point the MCP paths use: shape is validated (a wrong/
    // missing/mistyped field is a prescriptive INVALID_OP) before the mutator.
    return mutateChecked(d as MutableValidDiagram, op)
  }
  return {
    ok: false,
    error: { code: 'UNSUPPORTED_FAMILY', message: `mutate supports ${knownFamilies().join(', ')} diagrams; got ${d.kind}${d.body.kind === 'opaque' ? ' (source-level/opaque body — structured mutation is not exposed for this family or syntax)' : ''}` },
  }
}

export function mutateSource(source: string, ops: AnyMutationOp[]): MutationRunResult {
  const r0 = parseRegisteredMermaid(source)
  if (!r0.ok) {
    const env = parseErrorEnvelope(r0.error)
    return { ok: false, error: { code: 'PARSE_FAILED', message: env.error.message, details: env.error.details } }
  }
  let current: ParsedDiagram = r0.value
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
  const parsed = parseRegisteredMermaid(source)
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
  const r = parseRegisteredMermaid(readSourceArg(args.positional[0]))
  if (!r.ok) { process.stderr.write(`format: parse failed: ${JSON.stringify(r.error)}\n`); return EXIT_ARG_ERROR }
  const wrapper = args.flags['canonical-wrapper'] ? 'canonical' as const : 'verbatim' as const
  process.stdout.write(serializeMermaid(r.value, { wrapper }))
  return EXIT_OK
}

function cmdDescribe(args: ParsedArgs, json: boolean): number {
  const source = readSourceArg(args.positional[0])
  const rawFormat = args.flags.format
  const format = rawFormat === 'json' || rawFormat === 'facts' || rawFormat === 'text' || rawFormat === undefined
    ? (rawFormat ?? 'text') as 'text' | 'json' | 'facts'
    : undefined
  if (!format) {
    process.stderr.write('am describe --format must be one of: text, json, facts\n')
    return EXIT_ARG_ERROR
  }
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) {
    const env = parseErrorEnvelope(parsed.error)
    if (json || format === 'json') process.stdout.write(JSON.stringify(env) + '\n')
    else process.stderr.write(`describe: parse failed: ${env.error.message}\n`)
    return EXIT_ARG_ERROR
  }
  // Describe is a read surface, but a successful description is still a
  // commit point: it must not certify source that the canonical verifier says
  // cannot render. Keep the failure envelope aligned with the local/hosted MCP
  // describe tools and use the documented verify-failed exit status.
  const verification = verifyMermaid(parsed.value)
  if (!verification.ok) {
    const env = {
      ok: false,
      family: parsed.value.kind,
      warnings: verification.warnings,
    }
    if (json || format === 'json') process.stdout.write(JSON.stringify(env, replacer) + '\n')
    else process.stderr.write(`describe: verify failed: ${verification.warnings.map(warning => warning.code).join(', ')}\n`)
    return EXIT_VERIFY_FAILED
  }
  const described = describeMermaid(parsed.value, { format })
  if (format === 'json') {
    const tree = JSON.parse(described)
    process.stdout.write(JSON.stringify(json ? { ok: true, tree } : tree) + '\n')
    return EXIT_OK
  }
  if (format === 'facts') {
    const facts = described.split('\n').filter(Boolean)
    process.stdout.write(json ? JSON.stringify({ ok: true, facts }) + '\n' : facts.join('\n') + '\n')
    return EXIT_OK
  }
  process.stdout.write(json ? JSON.stringify({ ok: true, text: described }) + '\n' : described + '\n')
  return EXIT_OK
}

// ---- Loop 7 / A3.1: capabilities ------------------------------------------

type FamilyEditPolicy = 'structured-when-narrowed' | 'source-level-only'

interface FamilyCapability {
  id: string
  identity: {
    id: string
    version: string
    compatibility: Readonly<Record<string, string>>
    provenance: Readonly<Record<string, string>>
  }
  /** Bounded discovery projection. Stable witness ids remain available from
   * `getFamilyConformanceReport`; routine discovery retains every field needed
   * for capability negotiation and diagnostics. */
  conformance: FamilyConformanceDiscovery
  hasMutate: boolean
  hasExtractLabels: boolean
  mutationOps: string[]
  /** Full field shapes for each op — { opKind: [{name, required, type}] }, with
   *  enum vocabularies spelled out inline in `type`. Lets a model fill an op
   *  correctly on the first try instead of guessing field names/values and
   *  learning them only from the INVALID_OP error. Absent for source-level-only
   *  families (no structured ops). */
  opFields?: Record<string, OpFieldDoc[]>
  editPolicy: FamilyEditPolicy
  /** The `as*` narrower to call before structured mutation (e.g. `asState`). */
  narrower?: string
  /** Mermaid header keyword(s) that open this family (e.g. `stateDiagram-v2`,
   *  `architecture-beta`) — so a model authoring from blank opens with the right
   *  header instead of inferring it from `example` or defaulting to flowchart. */
  headers?: readonly string[]
  /** Bounded canonical source (header + core syntax) used by executable
   * registration conformance and agent discovery. */
  example: string
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
  outputFormats: CliRenderFormat[]
  /** Bounded projection of the audit-only Section A capability report. */
  sectionA: SectionACapabilityDiscoverySummary
}

// Source of truth now lives in the agent layer (src/agent/mutation-ops.ts) so
// the mutators can name their valid ops in errors; imported and re-exported here
// to keep the capabilities envelope and existing `from '../cli/index.ts'`
// importers working.
import { MUTATION_OPS_BY_FAMILY } from '../agent/mutation-ops.ts'
export { MUTATION_OPS_BY_FAMILY }
import { describeOps, hasOpSchema, type OpFieldDoc } from '../agent/op-schema.ts'

type MutableFamilyId = keyof typeof MUTATION_OPS_BY_FAMILY

function boundedStringRecord(value: object): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

type FamilyConformanceDiscovery = Omit<FamilyConformanceReport, 'capabilities'> & {
  readonly capabilities: readonly Omit<FamilyConformanceReport['capabilities'][number], 'witnessId'>[]
}

/** Keep routine capability negotiation bounded without weakening the full
 * public conformance report. The rest projection deliberately carries future
 * result fields forward; only the audit-oriented witness locator is omitted. */
function familyConformanceDiscovery(report: FamilyConformanceReport): FamilyConformanceDiscovery {
  return {
    ...report,
    capabilities: report.capabilities.map(({ witnessId: _witnessId, ...result }) => result),
  }
}

export function buildCapabilities(): CapabilitiesEnvelope {
  const sdkVersion = PACKAGE_VERSION
  const mutableFamilies = new Set(Object.keys(MUTATION_OPS_BY_FAMILY))
  const families: FamilyCapability[] = knownFamilies().map((id) => {
    const p = getFamily(id)!
    const mutationOps = id in MUTATION_OPS_BY_FAMILY ? [...MUTATION_OPS_BY_FAMILY[id as MutableFamilyId]] : []
    const editPolicy: FamilyEditPolicy = mutationOps.length > 0 ? 'structured-when-narrowed' : 'source-level-only'
    return {
      id,
      identity: {
        id: p.identity.id,
        version: p.identity.version,
        compatibility: boundedStringRecord(p.identity.compatibility),
        provenance: boundedStringRecord(p.identity.provenance),
      },
      conformance: familyConformanceDiscovery(getFamilyConformanceReport(id)!),
      // Capabilities describe the public agent surface, not whether the
      // implementation currently lives in a FamilyDescriptor hook or central
      // dispatch. Every registered family parses, serializes, verifies, and
      // renders — so those constant booleans are omitted (they read as a
      // "probe-me" menu with nothing to branch on). Only what actually varies
      // is emitted: whether structured mutation and label extraction apply.
      hasMutate: mutableFamilies.has(id),
      hasExtractLabels: Boolean(p.extractLabels),
      mutationOps,
      opFields: hasOpSchema(id) ? describeOps(id) : undefined,
      editPolicy,
      narrower: isBuiltinFamilyId(id) ? builtinFamilyMetadata(id)?.narrower : undefined,
      headers: p.headers,
      example: p.example,
    }
  })
  const warningCodes: WarningCodeCapability[] = (Object.keys(WARNING_SEVERITY) as WarningCode[]).map(code => ({
    code,
    tier: WARNING_TIER[code],
    severity: WARNING_SEVERITY[code],
  }))
  return {
    sdkVersion,
    families,
    warningCodes,
    outputFormats: [...CLI_RENDER_FORMATS],
    sectionA: sectionACapabilityDiscoverySummary(createSectionACapabilityReport()),
  }
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

function parseRenderOptionsFlag(value: string): RenderOptions {
  const raw = existsSync(value) ? readFileSync(value, 'utf8') : value
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch (error) {
    throw new Error(`expected JSON object or JSON file: ${error instanceof Error ? error.message : String(error)}`)
  }
  const problems = validateSerializableRenderOptions(parsed)
  if (problems.length > 0) throw new Error(problems.join('; '))
  return parsed as RenderOptions
}

function cmdStyles(json: boolean): number {
  const rows = knownStyleDescriptors().map(descriptor => ({
    name: descriptor.inputName,
    canonicalId: descriptor.identity.id,
    label: descriptor.displayLabel,
    kind: descriptor.kind,
    isDefault: descriptor.isDefault,
    backend: inferBackend(descriptor.spec),
    ...(descriptor.spec.intent ? { intent: descriptor.spec.intent } : {}),
    blurb: descriptor.spec.blurb ?? '',
  }))
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
  const looks = knownStyleDescriptors()
    .filter(descriptor => descriptor.kind === 'look')
    .map(descriptor => `'${descriptor.inputName}'`).join(', ')
  return `# Agentic Mermaid

> Agent-native Mermaid runtime: parse, verify, mutate, and round-trip
> Mermaid diagrams with a typed IR. Deterministic render outputs. No
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

- render --format ${CLI_RENDER_FORMATS.join(', ')} [--security strict] — render a diagram; PNG requires --output and does not support multi-input/watch
- render --style <names|file.json> --seed N — styled graphical/terminal output; comma-separate to stack (--style hand-drawn,dracula)
- styles [--json] — list registered styles (default + full looks + palette-only themes)
- parse — diagram → ValidDiagram JSON
- verify — structural validation (exit 3 if invalid)
- mutate --op '<json>' / --ops '<json array|file>' — apply typed mutation(s), verify, then emit source
- preview [--output file.html] [--open] — standalone strict-mode HTML preview for user inspection
- format — normalize / canonicalize source
- describe [--format text|json|facts] — natural-language, AX-tree, or semantic facts summary
- capabilities --json — machine-readable capability envelope incl. editPolicy + mutationOps
- batch --jsonl — bulk render/verify/parse/serialize/mutate ops, one JSON envelope per line
- render-markdown <file.md> [--ascii] — render fenced mermaid blocks, skip invalid ones
- llms-txt — this document
- init-agent [--dir .] [--force] — write AGENTS.md section, root skills/ bundle, and .mcp.json sample

Exit codes: 0 ok, 2 arg error, 3 verify-failed, 4 internal.

## MCP tools

Local MCP exposes 4 tools: \`execute\`, \`describe_sdk\`, \`render_png\`, and
\`describe\`. Hosted MCP exposes 9 tools: \`execute\`, \`describe_sdk\`, \`render_svg\`,
\`render_ascii\`, \`render_png\`, \`verify\`, \`describe\`, \`mutate\`, and \`build\`.
\`render_png\` is offline on the local server. Hosted successful deterministic
results may be reused by a private server-side compute cache for up to 24 hours;
the HTTP response is always \`cache-control: no-store\` and reports compute reuse
through \`x-agentic-mermaid-compute-cache\`.

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

\`import { parseRegisteredMermaid, mutate, verifyMermaid, analyzeMermaid,
analyzeMermaidSource, serializeMermaid, renderMermaidASCII,
renderMermaidPNG, renderMermaidSVG, renderMermaidASCIIWithMeta,
describeMermaid, asciiToMermaid, verifyNoExternalRefs,
registerStyle, knownStyles, validateStyleSpec } from 'agentic-mermaid/agent'\`

## Styles

Every render call accepts style: a registered look name (${looks}), any palette
name, an inline JSON spec, or a stack
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
- docs/style-authoring.md — styles: the composable Look + Palette system (stack names/specs; author custom styles as data records with the quality rubric)
- docs/quality.md — determinism + "good looking" rubric
- TODO.md — only active backlog
- SECURITY.md — threat model + strict-mode guarantee
- docs/agent-mutation-policy.md — structured-vs-source-level policy
- docs/agent-api-cookbook.md — copy-pasteable library/CLI/MCP recipes
- docs/mcp-code-mode-rationale.md — MCP surface rationale
- docs/agent-workflow-examples.md — runnable MCP/CLI + agent-improvement examples
- skills/ — agent-agnostic SKILL.md bundles for diagram workflow and live-editor development
- skill-evals/ — skill-eval-harness manifest, fixtures, and benchmark instructions
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
  error?: RenderErrorDiagnostic | { code: string; message: string }
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
      const structured = cliStructuredRenderFailure(e)
      return {
        index: i,
        ok: false,
        error: structured?.error ?? {
          code: 'RENDER_FAILED',
          message: e instanceof Error ? e.message : String(e),
        },
      }
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

export interface BatchRenderOptions extends Record<string, unknown> {
  format?: CliRenderFormat
  certificates?: boolean
  targetWidth?: number
}

interface BatchOutput {
  ok: boolean
  op?: string
  data?: unknown
  verify?: unknown
  error?: { code: string; message: string; details?: unknown }
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
  if (['render', 'verify', 'parse', 'serialize', 'mutate'].includes(op) && typeof parsed.source !== 'string') {
    return { ok: false, op, error: { code: 'INVALID_PAYLOAD', message: 'missing source string' } }
  }
  try {
    switch (op) {
      case 'render': {
        const options = parsed.options === undefined ? {} : parsed.options
        if (typeof options !== 'object' || options === null || Array.isArray(options)) {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch render options must be a plain JSON object' } }
        }
        const {
          format: requestedFormat,
          certificates,
          targetWidth,
          ...sharedCandidate
        } = options as BatchRenderOptions
        if (requestedFormat !== undefined && typeof requestedFormat !== 'string') {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch render option "format" must be a string' } }
        }
        const format = requestedFormat ?? DEFAULT_CLI_RENDER_FORMAT
        if (!isCliRenderFormat(format) || renderOutputForCliFormat(format)?.id === 'png') {
          const supported = CLI_RENDER_FORMATS.filter(candidate => renderOutputForCliFormat(candidate)?.id !== 'png')
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: `batch render format must be one of ${supported.join(', ')}` } }
        }
        const output = renderOutputForCliFormat(format)!
        if (certificates !== undefined && typeof certificates !== 'boolean') {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch render option "certificates" must be a boolean' } }
        }
        if (certificates === true && output.id !== 'layout') {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch render option "certificates" is valid only with format "layout"' } }
        }
        if (targetWidth !== undefined && (!Number.isInteger(targetWidth) || targetWidth <= 0)) {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch render option "targetWidth" must be a positive integer' } }
        }
        if (targetWidth !== undefined && output.id !== 'ascii' && output.id !== 'unicode') {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch render option "targetWidth" is valid only with format "ascii" or "unicode"' } }
        }
        const problems = validateSerializableRenderOptions(sharedCandidate)
        if (problems.length > 0) {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: problems.join('; ') } }
        }
        const sharedOptions = sharedCandidate as RenderOptions
        // Classify source admission errors before entering renderer internals;
        // malformed batch input is a documented PARSE_FAILED response, never
        // an INTERNAL failure that can poison an otherwise healthy JSONL run.
        preflightCliRenderableSource(parsed.source)
        // #7540: auto-namespace SVG ids per batch line so the rendered
        // diagrams can coexist on one HTML page without def-id collisions,
        // while retaining a caller-provided suffix.
        const rendered = renderSourceToFormatWithReceipt(parsed.source, format, {
          ...sharedOptions,
          ...(output.id === 'svg' ? { idPrefix: `d${lineIndex}-${sharedOptions.idPrefix ?? ''}` } : {}),
          ...(certificates === undefined ? {} : { certificates }),
          ...(targetWidth === undefined ? {} : { targetWidth }),
        })
        return { ok: true, op, data: { [format]: rendered.output, receipt: rendered.receipt } }
      }
      case 'verify': {
        const options = parsed.options === undefined ? {} : parsed.options
        if (typeof options !== 'object' || options === null || Array.isArray(options)) {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch verify options must be a plain JSON object' } }
        }
        const unknown = Object.keys(options).filter(key => key !== 'suppress' && key !== 'labelCharCap')
        if (unknown.length > 0) {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: `unknown batch verify option: ${unknown.join(', ')}` } }
        }
        const candidate = options as { suppress?: unknown; labelCharCap?: unknown }
        const warningCodes = new Set(Object.keys(WARNING_SEVERITY))
        if (candidate.suppress !== undefined
          && (!Array.isArray(candidate.suppress)
            || candidate.suppress.some(code => typeof code !== 'string' || !warningCodes.has(code)))) {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch verify option "suppress" must be an array of known warning-code strings' } }
        }
        if (candidate.labelCharCap !== undefined
          && (!Number.isSafeInteger(candidate.labelCharCap) || (candidate.labelCharCap as number) <= 0)) {
          return { ok: false, op, error: { code: 'INVALID_OPTIONS', message: 'batch verify option "labelCharCap" must be a positive safe integer' } }
        }
        const r = verifyMermaid(parsed.source, options as { suppress?: WarningCode[]; labelCharCap?: number })
        if (!r.ok) {
          const verify = JSON.parse(JSON.stringify(r, replacer))
          return {
            ok: false,
            op,
            error: {
              code: 'VERIFY_FAILED',
              message: 'diagram failed verify',
              details: verify.warnings,
            },
            verify,
          }
        }
        return { ok: true, op, data: JSON.parse(JSON.stringify(r, replacer)) }
      }
      case 'parse': {
        // Batch is the streaming form of `am parse`; keep both on the open
        // registered-family envelope while preserving built-in result shapes.
        const r = parseRegisteredMermaid(parsed.source)
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
        const hasMutation = Object.hasOwn(parsed, 'mutation')
        const hasMutations = Object.hasOwn(parsed, 'mutations')
        if (hasMutation === hasMutations) {
          return { ok: false, op, error: { code: 'INVALID_OP', message: 'mutate batch line requires exactly one of mutation or mutations[]' } }
        }
        if (hasMutations && !Array.isArray(parsed.mutations)) {
          return { ok: false, op, error: { code: 'INVALID_OP', message: 'mutate batch line mutations must be a non-empty array' } }
        }
        const ops = (hasMutations ? parsed.mutations : [parsed.mutation]) as Parameters<typeof mutateSource>[1]
        if (ops.length === 0) return { ok: false, op, error: { code: 'INVALID_OP', message: 'mutate batch line mutations must be a non-empty array' } }
        const r = mutateSource(parsed.source, ops)
        if (!r.ok) return {
          ok: false,
          op,
          error: {
            code: r.error.code,
            message: r.error.message,
            ...('details' in r.error && r.error.details !== undefined ? { details: r.error.details } : {}),
          },
          ...(r.verify ? { verify: JSON.parse(JSON.stringify(r.verify, replacer)) } : {}),
        }
        return { ok: true, op, data: { source: r.source, verify: JSON.parse(JSON.stringify(r.verify, replacer)) } }
      }
      default:
        return { ok: false, op, error: { code: 'UNKNOWN_OP', message: `unknown op: ${op}` } }
    }
  } catch (e) {
    // Project documented render diagnostics (family-detection UNKNOWN_HEADER/
    // UNSUPPORTED_FAMILY, ASCII_TARGET_WIDTH_IMPOSSIBLE) the same way every other CLI render
    // transport does (cmdRender/preview/render-markdown), instead of collapsing them to a
    // generic internal error. cliStructuredRenderFailure first honours an already-structured
    // throw; any remaining render-path exception is still a bounded RENDER_FAILED response.
    const structured = cliStructuredRenderFailure(e)
    if (structured) return { ok: false, op, error: structured.error }
    return {
      ok: false,
      op,
      error: { code: 'RENDER_FAILED', message: e instanceof Error ? e.message : String(e) },
    }
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

function toJsonSafe(d: ParsedDiagram): unknown {
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
