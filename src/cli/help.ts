import { WARNING_SEVERITY, type WarningSeverity, type WarningCode } from '../agent/types.ts'
import { CLI_RENDER_FORMATS, DEFAULT_CLI_RENDER_FORMAT, cliRenderFormatHelpLines } from '../render-output-metadata.ts'
import { PNG_DEFAULT_SCALE } from '../output-policy-versions.ts'
import { FAMILY_NARROWING_NOTE } from '../shared/agent-workflow.ts'

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
  --preserve-source     For mutate: edit supported source ranges without regenerating opaque syntax
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
  4  uncaught internal failure, or verify errors that are all INTERNAL_ERROR
`

/** Warning codes of one severity, comma-separated and wrapped for help text. */
function codesWithSeverity(severity: WarningSeverity): string {
  const codes = (Object.keys(WARNING_SEVERITY) as WarningCode[]).filter(code => WARNING_SEVERITY[code] === severity)
  const lines: string[] = []
  for (const code of codes) {
    const last = lines.at(-1)
    if (last !== undefined && last.length + code.length + 2 <= 100) lines[lines.length - 1] = `${last}, ${code}`
    else lines.push(code)
  }
  return lines.join(',\n')
}

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
  --graph-layout <elk|agentic> Graph geometry producer (default: elk)
  --graph-layout-fallback <none|elk> Explicit Agentic fallback (default: none)
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
  --min-label-px <PX> PNG only: warn below this effective text size
                    (provisional default 9; 0 disables)
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
  verify: `am verify <file|-> [--markdown] [--suppress A,B] [--label-cap N] [--style NAMES|file]
Always emits JSON: {ok, warnings[], layout}.
With --markdown: verify top-level Mermaid fences and emit {ok,file,blocks[]}.
Nested list/blockquote fences require host extraction; HTML examples are skipped.
Warnings use physical document lines; lineIsBlockStart marks a fallback when
no precise source line is available. Backtick and tilde fences are supported.
  --style <S>       Resolve the same named/file-backed Style used by render so
                    inspect-only Brand constraints evaluate the styled Scene.
Error codes flip ok=false:
${codesWithSeverity('error')}.
RENDER_FAILED: the strict render parser, layout, or theme colors reject the source
or its configuration; origin says which.
INTERNAL_ERROR: an Agentic Mermaid defect, not the source; defaultRender says
whether an ordinary render still produces output. Report it with the source.
BRAND_CONSTRAINT_ERROR: only when a Style constraint explicitly selects action=error.
Warning codes:
${codesWithSeverity('warning')}.
LABEL_OVERFLOW counts characters against --label-cap.
Brand constraints inspect without repainting or relayout; other Tier-3 lint is advisory.
Exit 0 if ok, 3 if verify reports severity='error', 4 if every such error is INTERNAL_ERROR.`,
  parse: `am parse <file|->
Emits ValidDiagram JSON (Maps serialized to objects). Exit 2 on parse error.
Pipe to 'am serialize' to round-trip.`,
  serialize: `am serialize  (reads ValidDiagram JSON on stdin)
Emits canonical Mermaid source. Accepts the JSON shape that 'am parse' emits;
rebuilds the diagram via synthesizeFromGraph without re-parsing source.`,
  mutate: `am mutate <file|-> (--op '<JSON>' | --ops '<JSON array|file.json>') [--preserve-source] [--json]
Applies one or more MutationOps, verifies the final diagram, then emits source.
Registered families with mutationOps have typed mutation; discover the live roster,
narrowers, and op names with 'am capabilities --json'. Opaque-fallback diagrams
(unmodeled syntax) return a structured UNSUPPORTED_FAMILY error (exit 2). Verify failures
exit 3 (4 when every error is INTERNAL_ERROR) and omit source. An INTERNAL_ERROR the
source already had does not block the edit.
${FAMILY_NARROWING_NOTE}`,
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
    warningCodes: [{ code, tier, severity, origins }],
    outputFormats: ${JSON.stringify(CLI_RENDER_FORMATS)} }
editPolicy is "structured-when-narrowed" or "source-level-only". Use this to
introspect what the CLI can do without running every command.`,
  batch: `am batch [--jsonl]  (reads JSONL from stdin; --jsonl names that mode)
Each line: { op: "render"|"verify"|"parse"|"serialize"|"mutate", source: string,
options?: {}, mutation?: MutationOp, mutations?: MutationOp[] }. Emits one JSON
envelope per nonblank line, in order, without waiting for EOF:
{ ok, op, data?, error? }. Malformed JSON or unknown ops surface as ok:false;
the batch continues and exits 0 even if lines errored. Input/output failures
exit nonzero. Slow output consumers apply backpressure.`,
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
