import{b as S}from"./chunk-5BYN55G4.js";import{C as y,P as w,S as b,T as k,W as N}from"./chunk-BYJR4CMX.js";import{a as g}from"./chunk-X4JDR34Z.js";var M={"agent-instructions":{},ascii:{},markdown:{},certificates:{},help:{},json:{},jsonl:{},watch:{},open:{},force:{},"canonical-wrapper":{},"preserve-source":{},"system-fonts":{},version:{},suppress:{arg:"CODES"},"label-cap":{arg:"N"},op:{arg:"JSON"},style:{arg:"NAMES|file"},seed:{arg:"N"},options:{arg:"JSON|file"},"graph-layout":{arg:"elk|agentic"},"graph-layout-fallback":{arg:"none|elk"},ops:{arg:"JSON|file"},output:{arg:"FILE"},format:{arg:"fmt"},security:{arg:"mode"},dir:{arg:"DIR"},"font-dirs":{arg:"DIRS"},"gantt-today":{arg:"DATE"},"target-width":{arg:"CELLS"},scale:{arg:"N"},bg:{arg:"COLOR"},"fit-width":{arg:"PX"},"fit-height":{arg:"PX"},"min-label-px":{arg:"PX"},o:{arg:"FILE"}};var c=M;var f=new Set(Object.keys(c).filter(r=>!c[r].arg));function p(r,e){if(!f.has(e))throw new Error(`--${e} is not a boolean flag`);return Boolean(r.flags[e])}function _(r,e){if(!(e in c)||f.has(e))throw new Error(`--${e} is not a value flag`);const n=r.flags[e];return typeof n==="string"?n:void 0}var L=Object.freeze({scale:Object.freeze(["scale"]),background:Object.freeze(["bg"]),fitTo:Object.freeze(["fit-width","fit-height"]),minLabelPx:Object.freeze(["min-label-px"]),fontDirs:Object.freeze(["font-dirs"]),loadSystemFonts:Object.freeze(["system-fonts"]),onWarning:Object.freeze([])});var P=Object.freeze(Object.values(L).flat());var O={render:["help","json","certificates","watch","style","seed","options","graph-layout","graph-layout-fallback","output","format","security","gantt-today","target-width",...P,"o"],verify:["help","json","suppress","label-cap","style","markdown"],parse:["help","json"],serialize:["help"],mutate:["help","json","op","ops","preserve-source"],preview:["help","json","output","open","security"],format:["help","canonical-wrapper"],describe:["help","json","format"],capabilities:["help","json"],styles:["help","json"],"llms-txt":["help"],"init-agent":["help","json","dir","force"],batch:["help","jsonl"],"render-markdown":["help","ascii"]};var x=Object.freeze({render:{min:0,max:Number.POSITIVE_INFINITY},verify:{min:0,max:1},parse:{min:0,max:1},serialize:{min:0,max:0},mutate:{min:0,max:1},preview:{min:0,max:1},format:{min:0,max:1},describe:{min:0,max:1},capabilities:{min:0,max:0},styles:{min:0,max:0},"llms-txt":{min:0,max:0},"init-agent":{min:0,max:0},batch:{min:0,max:0},"render-markdown":{min:0,max:1}});function A(r){const e={positional:[],flags:{},errors:[]};const n=(t,s)=>{if(Object.prototype.hasOwnProperty.call(e.flags,t)){e.errors.push(`Flag --${t} may be supplied only once.`);return}e.flags[t]=s};let a=0;while(a<r.length){const t=r[a];if(t==="--"){for(const s of r.slice(a+1)){if(!e.command)e.command=s;else e.positional.push(s)}break}if(t.startsWith("--")){const s=t.indexOf("=");const o=t.slice(2,s===-1?void 0:s);if(s!==-1){if(f.has(o))e.errors.push(`Flag --${o} does not accept a value.`);n(o,t.slice(s+1))}else{const l=r[a+1];if(f.has(o)||l===void 0||l.startsWith("--"))n(o,true);else{n(o,l);a++}}}else if(t==="-v")n("version",true);else if(!e.command)e.command=t;else e.positional.push(t);a++}return e}var h=`Usage: am <command> [options] [file|-]

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
  --style <NAMES|file>   Style stack \u2014 comma-separated names and/or .json spec files
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
  --version, -v          Print the package version (with --json: {"ok":true,"version":...})
  --help                 Show this message (or per-command help: am <cmd> --help)

Exit codes:
  0  ok
  2  arg / parse error (bad flag, missing file, malformed JSON), or a render the input refuses
  3  verify reported errors (severity 'error')
  4  internal failure: an INTERNAL_ERROR render, or verify errors that are all INTERNAL_ERROR
`;function E(r){const e=Object.keys(y).filter(a=>y[a]===r);const n=[];for(const a of e){const t=n.at(-1);if(t!==void 0&&t.length+a.length+2<=100)n[n.length-1]=`${t}, ${a}`;else n.push(a)}return n.join(",\n")}var R={render:`am render <file|-> [--format ${b.join("|")}] [--json]
Render a diagram. Default is ${k.toUpperCase()}.
${N()}
  --certificates     With --format layout, include route/family certificates
  --style <S>       Style stack: comma-separated names and/or .json spec files,
                    merged left \u2192 right (e.g. --style hand-drawn,dracula or
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
  --scale <N>       PNG only: output scale multiplier (default ${w})
  --bg <COLOR>      PNG only: override the diagram background (white fallback)
  --fit-width <PX>  PNG only: fit output to this pixel width
  --fit-height <PX> PNG only: fit output to this pixel height (mutually exclusive with --fit-width)
  --min-label-px <PX> PNG only: warn below this effective text size
                    (provisional default 9; 0 disables)
  --watch           Re-render one input file on change (non-PNG only)
Multiple inputs emit a JSON results array for non-PNG formats.
With --json, success prints {"ok":true,...}: textual forms as
{"ok":true,"<format>":"...","receipt":{...},"warnings":[...]}, layout as the
layout JSON plus "ok". With --output FILE the file always holds the plain
artifact; --json then prints {"ok":true,"path","bytes","receipt","warnings"}.`,styles:`am styles [--json]
List every registered style. A style is a partial description of how diagrams
look; a colors-only style is a palette, a full look sets stroke/fill/typography
too. Stack them with render --style (e.g. --style hand-drawn,dracula) and
re-roll ink with --seed. Custom styles are JSON records (docs/style-authoring.md);
pass a .json file path anywhere a name is accepted.
With --json: [{ name, canonicalId, kind: look|palette, isDefault, backend, intent?, blurb }].`,verify:`am verify <file|-> [--markdown] [--suppress A,B] [--label-cap N] [--style NAMES|file]
Always emits JSON: {ok, warnings[], layout}.
With --markdown: verify top-level Mermaid fences and emit {ok,file,blocks[]}.
Nested list/blockquote fences require host extraction; HTML examples are skipped.
Warnings use physical document lines; lineIsBlockStart marks a fallback when
no precise source line is available. Backtick and tilde fences are supported.
  --style <S>       Resolve the same named/file-backed Style used by render so
                    inspect-only Brand constraints evaluate the styled Scene.
Error codes flip ok=false:
${E("error")}.
RENDER_FAILED: the strict render parser, layout, or theme colors reject the source
or its configuration; origin says which.
INTERNAL_ERROR: an Agentic Mermaid defect, not the source; defaultRender says
whether an ordinary render still produces output. Report it with the source.
BRAND_CONSTRAINT_ERROR: only when a Style constraint explicitly selects action=error.
Warning codes:
${E("warning")}.
LABEL_OVERFLOW counts characters against --label-cap.
Brand constraints inspect without repainting or relayout; other Tier-3 lint is advisory.
Exit 0 if ok, 3 if verify reports severity='error', 4 if every such error is INTERNAL_ERROR.`,parse:`am parse <file|->
Emits ValidDiagram JSON (Maps serialized to objects). Exit 2 on parse error.
Pipe to 'am serialize' to round-trip.`,serialize:`am serialize  (reads ValidDiagram JSON on stdin)
Emits canonical Mermaid source. Accepts the JSON shape that 'am parse' emits;
rebuilds the diagram via synthesizeFromGraph without re-parsing source.`,mutate:`am mutate <file|-> (--op '<JSON>' | --ops '<JSON array|file.json>') [--preserve-source] [--json]
Applies one or more MutationOps, verifies the final diagram, then emits source.
Registered families with mutationOps have typed mutation; discover the live roster,
narrowers, and op names with 'am capabilities --json'. Opaque-fallback diagrams
(unmodeled syntax) return a structured UNSUPPORTED_FAMILY error (exit 2). Verify failures
exit 3 (4 when every error is INTERNAL_ERROR) and omit source. An INTERNAL_ERROR the
source already had does not block the edit.
${S}`,preview:`am preview <file|-> [--output preview.html] [--open] [--json] [--security strict]
Writes a standalone HTML preview containing strict-mode rendered SVG. Without
--output, emits HTML to stdout unless --open is set, in which case a temp HTML
file is written and opened. With --json, emits {ok,path,opened,bytes} for file output.`,format:`am format <file|-> [--canonical-wrapper]
Parse then re-serialize. Idempotent. The leading source wrapper (frontmatter,
%%{init}%% directives, comments before the header) is preserved byte-verbatim
by default; --canonical-wrapper instead synthesizes Mermaid's documented shape
(title/displayMode top-level, everything else under config:, directives folded).`,describe:`am describe <file|-> [--format text|json|facts] [--json]
Summarize a Mermaid diagram. Text format emits prose by default; --json wraps
it as {ok,text}. --format json emits the structured AX tree
{kind,nodes,edges,entryPoints,sinks}; with --json it wraps as {ok,tree}.
--format facts emits deterministic semantic fact lines; with --json it wraps as {ok,facts}.`,capabilities:`am capabilities [--json]
Emits a single JSON object describing the SDK's capability surface:
  { sdkVersion, families: [{ id, hasMutate, hasExtractLabels, mutationOps, editPolicy, example }],
    warningCodes: [{ code, tier, severity, origins }],
    outputFormats: ${JSON.stringify(b)} }
editPolicy is "structured-when-narrowed" or "source-level-only". Use this to
introspect what the CLI can do without running every command.`,batch:`am batch [--jsonl]  (reads JSONL from stdin; --jsonl names that mode)
Each line: { op: "render"|"verify"|"parse"|"serialize"|"mutate", source: string,
options?: {}, mutation?: MutationOp, mutations?: MutationOp[] }. Emits one JSON
envelope per nonblank line, in order, without waiting for EOF:
{ ok, op, data?, error? }. Malformed JSON or unknown ops surface as ok:false;
the batch continues and exits 0 even if lines errored. Input/output failures
exit nonzero. Slow output consumers apply backpressure.`,"render-markdown":`am render-markdown <file.md> [--ascii]
Render fenced Mermaid blocks: CommonMark \`\`\` or ~~~ fences whose info string
starts with mermaid (any case), including fences in list items and block quotes.
Emits {ok,blocks:[{index,line,ok,format?,output?,error?}]}; line is the 1-based
line of the opening fence. Bad diagrams yield ok:false entries and do not abort
the rest of the Markdown file.`,"llms-txt":`am llms-txt
Emit the committed agent-discovery digest generated from current capabilities.`,"init-agent":`am init-agent [--dir <path>] [--force] [--json]
Write a repo-local, agent-agnostic drop-in so coding agents discover the
parse \u2192 narrow \u2192 mutate \u2192 verify \u2192 serialize contract automatically. Creates
without clobbering by default:
  - AGENTS.md marked section pointing agents at the workflow + hosted docs
  - skills/agentic-mermaid-diagram-workflow/SKILL.md generic skill bundle
  - .mcp.json sample agentic-mermaid MCP server config
--dir defaults to the current directory. --force overwrites skill/MCP files;
the AGENTS.md section is always appended only once, guarded by a marker.`};var m=0;var v=2;var z=3;var B=4;var I="# Agentic Mermaid \u2014 operating guide\n\nUse this guide to create, edit, verify and render Mermaid diagrams. It is also\nemitted by `am --agent-instructions` and served at\n`https://agentic-mermaid.dev/agent-instructions.md`. `am init-agent` installs a\ncopy with the consumer's skill, so the operating rules remain available offline.\n\n## Choose one channel\n\nDo not assume this repository is checked out. Use the first available channel\nthat fits the task, then stop discovering tools:\n\n| Available environment | Channel | Version-matched reference |\n|---|---|---|\n| JS/TS with the package installed | `agentic-mermaid/agent/core` for portable editing; `/agent` also supplies native PNG | Installed declarations and `am capabilities --json` |\n| Shell | `am \u2026` or `npx agentic-mermaid \u2026` | `am <command> --help` |\n| Connected local MCP | `agentic-mermaid-mcp` | `describe_sdk` and the connected tool list |\n| Network only, with permission to send the source | Hosted MCP at `https://agentic-mermaid.dev/mcp` | Connected tool list and `describe_sdk` |\n\nPrivate source should stay in a local library, CLI or self-hosted MCP. The\nhosted endpoint sends source to another service; package installation also\nmakes network requests. Do not ask the user to perform work that your available\nchannel can complete.\n\nCLI is convenient for one-shot work. In MCP, use the direct `verify`,\n`describe`, render, `mutate` or `build` tool when the connected server advertises\nit. Use `execute` for custom synchronous logic. The hosted and local tool lists\ndiffer: inspect the connected server instead of borrowing another channel's\nnames. Hosted tools are `execute`, `describe_sdk`, `render_svg`, `render_ascii`, `render_png`, `verify`, `describe`, `mutate`, and `build`.\n\nHosted MCP is stateless Streamable HTTP JSON-RPC, with no initialize handshake\nrequired. It has no REST render API. A raw verify request is\n`{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"verify\",\"arguments\":{\"source\":\"flowchart TD\\n  API --> DB\"}}}`.\nUse the published [MCP reference](https://agentic-mermaid.dev/docs/mcp/) for\ntransport and input limits; do not send private material merely to test access.\n\n## Discover the family's actual schema\n\nRun `am capabilities --json` for installed families, headers, examples, edit\npolicies, warning codes and operation fields. In MCP, use\n`describe_sdk({ family, detail: 'fields' })`; `detail: 'signatures'` is a compact\nmenu. These describe the installed or connected version. Online\n`https://agentic-mermaid.dev/capabilities.json` describes production and may be\nnewer than a local installation.\n\nChoose the family from the reader's task. Use its own header, narrower and\noperation vocabulary: state diagrams narrow with `asState`, not `asFlowchart`.\nMutation ops use a `kind` discriminator and family-specific fields; do not\ninvent synonyms or convenience flags. Pass one op to `mutate(d, op)`, not an\narray. Library `applyOps({ source, ops })` and MCP `mutate({ source, ops })`\nprovide atomic batches; Code Mode repeats `mermaid.mutate(d, op)` instead.\nFor painted geometry, discover `describe_sdk({ capability: 'resolved-scene' })`\nand use `renderResolvedScene`; its result limit and typed artwork failures are\npart of that capability's declaration.\n\n## Author or edit, then verify\n\nNew diagrams: author Mermaid source directly, then parse \u2192 verify \u2192 render or return it. `buildMermaid(kind, ops)` / `createMermaid(kind)` build a diagram from typed ops when you are generating one programmatically (for example, from data). Existing structured diagrams: parse \u2192 narrow \u2192 mutate \u2192 verify \u2192 serialize.\n\nNarrowing selects a structured, typed family with an as* helper. It does not select one element or freeze layout coordinates.\n\nFor an existing structured diagram, retain its parsed value and apply the\nsmallest typed edit. Code Mode exposes synchronous `mermaid.*` methods and\nread-only returned diagrams; use mutation operations rather than assigning into\nthe body. It does not support imports, async functions, Promise jobs or local\nfile I/O. Library calls use the same names without the `mermaid.` prefix.\n\nThis existing-diagram example runs in Code Mode:\n\n```ts\nconst parsed = mermaid.parseRegisteredMermaid('flowchart TD\\n  API --> DB')\nif (!parsed.ok) return { phase: 'parse', errors: parsed.error }\nconst flow = mermaid.asFlowchart(parsed.value)\nif (!flow) return { phase: 'narrow', family: parsed.value.kind }\nconst edited = mermaid.mutate(flow, { kind: 'add_node', id: 'Cache', label: 'Cache' })\nif (!edited.ok) return { phase: 'mutate', error: edited.error }\nconst verify = mermaid.verifyMermaid(edited.value)\nif (!verify.ok) return { phase: 'verify', warnings: verify.warnings }\nreturn { source: mermaid.serializeMermaid(edited.value) }\n```\n\nA new diagram needs no mutation step:\n\n```ts\nconst source = 'flowchart LR\\n  API --> DB'\nconst parsed = mermaid.parseRegisteredMermaid(source)\nif (!parsed.ok) return { phase: 'parse', errors: parsed.error }\nconst verify = mermaid.verifyMermaid(parsed.value)\nif (!verify.ok) return { phase: 'verify', warnings: verify.warnings }\nreturn { source }\n```\n\nRun `verifyMermaid` at every commit point: before source is saved, sent or\nshown, and after the last edit before serialization. Inspect `ok`, `warnings`\nand layout evidence. For MCP `mutate` or `build`, require top-level `ok`, the\nintended `family` and `verify.ok`; inspect `verify.warnings`. If an op fails,\nkeep the previous artifact, inspect `opIndex` and the error, then rediscover\nits exact fields before retrying. In a hosted edit request, `source` is the\noriginal pre-edit input, byte-for-byte; express changes only in `ops`.\n\n`verify.ok` means no unsuppressed error was detected, including measured content occlusion and explicit error policies. It is not a visual-quality or semantic-correctness score.\n\nBefore returning, compare the result with the task. Preserve requested labels,\nvalues, prefixes, endpoints and relationships exactly; verification alone will\nnot catch an omitted transition label or visibility marker. Use\n`describeMermaidFacts(d)` / `checkMermaid(d, requiredFacts)` or MCP `describe`\nwith `format: 'facts'` for semantic read-back. For a new diagram, also check the\nintended family and whether its advertised narrower returns a structured body.\nIf it unexpectedly falls back to opaque, inspect the warning and the family's\ncapability example instead of calling a merely renderable result editable.\n\nDo not suppress error-severity findings or truncate authored content to make\nverification pass. For intentionally long labels, set `labelCharCap` or\n`am verify --label-cap N` to the intended policy. For `INTERNAL_ERROR`, report\nthe original source and diagnostic; do not rewrite the diagram to hide a\nrenderer defect. The [warning reference](https://agentic-mermaid.dev/warnings/)\nand [architecture reference](https://github.com/adewale/agentic-mermaid/blob/main/AGENT_NATIVE.md)\nexplain the generated warning catalog and its limits.\n\n## Source-preserved and opaque input\n\nUnmodeled syntax can remain as opaque source or verbatim segments. A null\nnarrower refuses structured mutation; it does not mean the source is empty.\nIf a task explicitly needs a source-level edit, make the smallest edit, say\n`source-level fallback`, then reparse and verify. Preserve comments and bytes\noutside the requested edit. Do not silently regenerate the diagram.\n\nFor bounded opaque Class/Flowchart edits, use\n`mutatePreservingSource(diagram, op)`: Class `add_member`/`remove_member`, or\nFlowchart `set_label`/`rename_node`. Save `value.source` exactly after inspecting\n`verifyMermaid(value.diagram)`. The body remains opaque and its portability\nwarning remains. Ambiguous ownership and unsupported dependencies refuse\natomically. Library `applyOps` and MCP `mutate` select these batches with\n`mode: 'source-preserving'`; CLI uses `--preserve-source`. Read the\n[mutation policy](https://agentic-mermaid.dev/docs/agent-mutation-policy/) for\noperation limits before choosing this path.\n\n## Render and inspect\n\nUse the requested SVG, PNG, ASCII, Unicode or layout output. Choose `style`\nfrom `am styles --json`, an inline data-only spec or a stack; validate untrusted\nspecs with `validateStyleSpec`. `seed` varies styled ink without moving layout.\nUse strict security when output must contain no external-fetch references;\nrender and verify with the same options. PNG sizing and font availability can\nchange readability: inspect the artifact rather than treating a successful\nrender or a `BELOW_READABLE_SIZE` warning as a general quality verdict.\nGantt has no implicit clock read: pass `ganttToday` to draw today's marker.\n\nFlowchart labels containing punctuation should be quoted. In a quoted label,\n`\\n` is a line break and canonical serialization uses `<br>`. A group is\n`subgraph id[\"Title\"] \u2026 end`; labeled and dotted edges use\n`A -- \"label\" --> B`, `A -.-> B` and `A -. \"label\" .-> B`. Use another family's\ncapability example for its syntax. The [API reference](https://agentic-mermaid.dev/docs/api/)\nseparates source objects, Scene parts and resolved painted primitives.\n\n## Ground the task and return the result\n\nRead supplied repositories, files and URLs when available. Every node and edge\nmust follow the supplied context or inspected source. Include each requested\nentity and relationship; do not merge them to simplify the task. Mark uncertain\nconnections or omit them with an explanation. When context leaves the scope or\nabstraction level open, choose the smallest consistent interpretation, keep\none abstraction level and state the assumptions. If the intended audience,\nmedium or improvement is unclear, inspect read-only information and ask for\nthe missing goal before changing the diagram.\n\nIn chat, return `Updated Mermaid` with the final source in a Mermaid fenced\ncode block, `Verification` with\nwhat was actually checked and any limitations, and `Trace` naming the channel\nand calls used. Include `Sources` for inspected files. Return additional\nartifacts when requested. In Code Mode, return `{ source }` after verification\nor an error object. If asked for one final fenced JSON tool request, finish\nall prose before its only fenced block and stop after the block.\n\nIf no Agentic Mermaid channel is available, return the best source and say\n`not verified \u2014 Agentic Mermaid unavailable`, naming what you tried. Label\nsecondary parser checks as secondary; never invent an Agentic Mermaid result.\nDo not modify project files unless the user asked for file changes.\n\nFor task recipes, read the [editing cookbook](https://agentic-mermaid.dev/docs/agent-api-cookbook/).\nUse local package declarations and discovery over newer online examples when\nworking with an older installed version.\n";var C=class extends Error{};function j(r,e){if(e)process.stdout.write(JSON.stringify({ok:false,error:{code:"ARG",message:r}})+"\n");process.stderr.write(`${r}
`);return v}function K(r){const e=A(r);const n=p(e,"json");const a=i=>j(i,n);if(e.errors.length>0)return{exitCode:a(e.errors.join(" "))};if(p(e,"agent-instructions")){process.stdout.write(I);return{exitCode:m}}if(p(e,"version")){process.stdout.write(n?JSON.stringify({ok:true,version:g})+"\n":`${g}
`);return{exitCode:m}}if(p(e,"help")&&!e.command){process.stdout.write(h);return{exitCode:m}}if(!e.command){process.stdout.write(h);return{exitCode:v}}if(p(e,"help")){process.stdout.write((R[e.command]??h)+"\n");return{exitCode:m}}const t=Object.keys(e.flags).filter(i=>!(i in c));if(t.length>0){const i=`Unknown flag${t.length>1?"s":""}: ${t.map(u=>`--${u}`).join(", ")}. Run \`am --help\` or \`am ${e.command} --help\` for the flag list.`;return{exitCode:a(i)}}const s=Object.entries(e.flags).filter(([i,u])=>c[i]?.arg&&(typeof u!=="string"||u.length===0)).map(([i])=>i);if(s.length>0){return{exitCode:a(`Flag${s.length>1?"s":""} ${s.map(i=>`--${i}`).join(", ")} require${s.length===1?"s":""} a value.`)}}const o=new Set(O[e.command]??["help"]);const l=Object.keys(e.flags).filter(i=>!o.has(i));if(l.length>0){return{exitCode:a(`Flag${l.length>1?"s":""} ${l.map(i=>`--${i}`).join(", ")} ${l.length>1?"are":"is"} not valid for am ${e.command}.`)}}const d=x[e.command];if(d&&(e.positional.length<d.min||e.positional.length>d.max)){return{exitCode:a(`am ${e.command} accepts ${d.max===0?"no positional arguments":`at most ${d.max} positional input${d.max===1?"":"s"}`}; received ${e.positional.length}.`)}}return{args:e,json:n}}export{c as a,f as b,p as c,_ as d,L as e,P as f,O as g,x as h,A as i,h as j,R as k,I as l,m,v as n,z as o,B as p,C as q,j as r,K as s};
//# sourceMappingURL=chunk-62RBMITI.js.map