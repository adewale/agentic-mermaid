// Regenerate the registry-driven parts of the site, so a new diagram family (or
// a capability change) shows up everywhere without hand-editing a page.
//
//   bun run mockups/site-gen.ts
//
// Sources of truth (no duplication here):
//   - src/agent/families.ts        BUILTIN_FAMILY_METADATA  (which families exist)
//   - editor/js/examples.js        EDITOR_EXAMPLES          (canonical example + blurb per family)
//   - bin/am.ts capabilities/llms-txt/--agent-instructions  (the agent surfaces)
//
// Outputs: the gallery grid (inline themeable SVGs) in gallery.html, the
// families table in families.html, and the agent files in mockups/.

import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'
import { handleRequest } from '../src/mcp/server.ts'
import { renderMermaidSVG } from '../src/index.ts'

const ROOT = import.meta.dir + '/../'
const M = import.meta.dir + '/'

// canonical examples: id -> { source, description, label }. examples.js also
// contains the editor's DOM code, so pull out just the EDITOR_EXAMPLES literal
// (bracket-matched, string/template/comment aware) rather than executing it.
const exSrc = await Bun.file(ROOT + 'editor/js/examples.js').text()
function extractArrayLiteral(src: string, marker: string): string {
  const lb = src.indexOf('[', src.indexOf(marker))
  let depth = 0, q: string | null = null
  for (let i = lb; i < src.length; i++) {
    const c = src[i]
    if (q) { if (c === '\\') { i++; continue } if (c === q) q = null; continue }
    if (c === "'" || c === '"' || c === '`') { q = c; continue }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = nl < 0 ? src.length : nl; continue }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue }
    if (c === '[') depth++
    else if (c === ']' && --depth === 0) return src.slice(lb, i + 1)
  }
  throw new Error('could not extract ' + marker)
}
// examples reference EDITOR_SEMANTIC_STYLE for editor rendering; we only read
// id/label/description/source, so a stub for that identifier is enough.
const EDITOR_EXAMPLES: any[] = new Function('EDITOR_SEMANTIC_STYLE', 'return (' + extractArrayLiteral(exSrc, 'EDITOR_EXAMPLES =') + ');')({})
const exById = new Map<string, any>(EDITOR_EXAMPLES.map((e) => [e.id, e]))

function am(args: string[], stdin?: string): string {
  const p = Bun.spawnSync(['bun', 'run', ROOT + 'bin/am.ts', ...args],
    stdin != null ? { stdin: Buffer.from(stdin) } : {})
  if (p.exitCode !== 0) throw new Error('am ' + args.join(' ') + ': ' + p.stderr.toString())
  return p.stdout.toString()
}
const stripFont = (svg: string) => svg.split('\n').filter((l) => !l.includes('fonts.googleapis.com')).join('\n')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// `--check` (CI gate): don't write — compare each generated file to what's on
// disk and collect drift, so a stale committed mockup fails the build instead
// of silently shipping. Mirrors hero:check. Generation is idempotent, so an
// in-sync tree produces byte-identical output here.
const CHECK = process.argv.includes('--check')
const stale: string[] = []
async function emit(path: string, content: string) {
  if (!CHECK) { await Bun.write(path, content); return }
  const f = Bun.file(path)
  const cur = (await f.exists()) ? await f.text() : null
  if (cur !== content) stale.push(path.replace(M, 'mockups/'))
}

// 1 · one tile per family, rendered from its canonical example
const tiles: { id: string; label: string; desc: string; svg: string }[] = []
for (const fam of BUILTIN_FAMILY_METADATA) {
  const ex = exById.get(fam.editorExampleId)
  if (!ex) { console.warn('!! no example for', fam.id, '(' + fam.editorExampleId + ')'); continue }
  // themeable inline SVG; idPrefix namespaces marker ids so 12 SVGs coexist on one page
  const svg = stripFont(renderMermaidSVG(ex.source, { bg: 'var(--bg)', fg: 'var(--fg)', accent: 'var(--accent)', transparent: true, idPrefix: fam.id + '-' })
    .replace('--bg:var(--bg);--fg:var(--fg);--accent:var(--accent);', ''))
  tiles.push({ id: fam.id, label: fam.label, desc: (ex.description || fam.label).trim(), svg })
  if (!CHECK) console.log('  themed', fam.id)
}

// 2 · inject the gallery grid + families table (registry order)
const figures = tiles.map((t) =>
  `    <figure>\n      <div class="plate" role="img" aria-label="${esc(t.label)} diagram">${t.svg}</div>\n      <figcaption><b>${esc(t.label)}</b> — ${esc(t.desc)}</figcaption>\n    </figure>`
).join('\n')
let gallery = await Bun.file(M + 'gallery.html').text()
gallery = gallery.replace(/<div class="gallery">[\s\S]*?<\/div>(\s*<p class="muted">)/,
  `<div class="gallery">\n${figures}\n  </div>$1`)
await emit(M + 'gallery.html', gallery)

const rows = tiles.map((t) => `      <tr><td><strong>${esc(t.label)}</strong></td><td>${esc(t.desc)}</td></tr>`).join('\n')
let families = await Bun.file(M + 'families.html').text()
families = families.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>\n${rows}\n    </tbody>`)
await emit(M + 'families.html', families)

// 2b · the home page's "Unicode text" block, from the real renderer
const uni = am(['render', M + 'diagrams/workflow.mmd', '--format', 'unicode'])
  .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '')
let home = await Bun.file(M + 'home.html').text()
home = home.replace(/(The same diagram as Unicode text:<\/p>\s*<pre><code>)[\s\S]*?(<\/code><\/pre>)/,
  '$1' + esc(uni) + '$2')
await emit(M + 'home.html', home)

// 2c · the edit-loop figure as ONE themeable inline SVG. Rendered with the
// engine's documented live-theming mode (bg/fg/accent as CSS vars, transparent),
// then the cyclic self-refs on the root are stripped so it inherits the page's
// --bg/--fg/--accent — the diagram recolours with every theme via the engine's
// own color-mix(), instead of being two fixed light/dark renders.
const wfThemeable = renderMermaidSVG(await Bun.file(M + 'diagrams/workflow.mmd').text(),
  { bg: 'var(--bg)', fg: 'var(--fg)', accent: 'var(--accent)', transparent: true })
  .replace('--bg:var(--bg);--fg:var(--fg);--accent:var(--accent);', '')
  .split('\n').filter((l) => !l.includes('fonts.googleapis.com')).join('\n')
await emit(M + 'diagrams/workflow-themeable.svg', wfThemeable)
for (const page of ['home.html', 'agents.html', 'editor.html', 'docs-article.html']) {
  const h = await Bun.file(M + page).text()
  // Idempotent: match the already-injected dia-plate form OR the original
  // hand-authored plate>dia-wrap form, so re-runs pick up token changes too.
  const out = h.replace(/<div class="plate dia-plate">[\s\S]*?<\/div>|<div class="plate"><div class="dia-wrap">[\s\S]*?<\/div><\/div>/,
    `<div class="plate dia-plate">\n      ${wfThemeable}\n    </div>`)
  await emit(M + page, out)
}

// 3 · the agent surfaces, straight from the CLI + MCP server
const capJson = am(['capabilities', '--json'])
await emit(M + 'capabilities.json', capJson)
await emit(M + 'llms.txt', am(['llms-txt']))
await emit(M + 'agent-instructions.md', am(['--agent-instructions']))

// real tool contracts (schemas/) from the MCP server's own tools/list
const toolsList: any = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } as any)
const tools: any[] = toolsList?.result?.tools ?? []
for (const t of tools) {
  await emit(M + 'schemas/' + t.name + '.json',
    JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }, null, 2) + '\n')
}
await emit(M + 'schemas/index.json',
  JSON.stringify({ server: 'agentic-mermaid-mcp', tools: tools.map((t) => ({ name: t.name, schema: 'schemas/' + t.name + '.json' })) }, null, 2) + '\n')

const cap = JSON.parse(capJson)
const server = { command: 'npx', args: ['-y', '--package', 'agentic-mermaid', 'agentic-mermaid-mcp'], transport: 'stdio' }
const manifest = {
  name: 'agentic-mermaid',
  version: cap.sdkVersion,
  description: 'Agent-native Mermaid runtime: parse, verify, mutate, and render diagrams through a typed surface. Deterministic SVG, PNG, ASCII, Unicode, and JSON.',
  outputFormats: cap.outputFormats,
  families: cap.families.map((f: any) => f.id),
  mcpTools: tools.map((t) => t.name),                  // the MCP server's actual tools
  narrowers: BUILTIN_FAMILY_METADATA.map((f) => f.narrower), // typed narrower per family
  mcp: server,
  context: { llms: '/llms.txt', instructions: '/agent-instructions.md', capabilities: '/capabilities.json', harnesses: '/harnesses.json', schemas: '/schemas/index.json' },
}
await emit(M + 'agent-manifest.json', JSON.stringify(manifest, null, 2) + '\n')

const harnesses = {
  default: 'stdio', recommended: 'self-hosted', server,
  clients: [
    { id: 'claude-code', name: 'Claude Code', register: 'claude mcp add agentic-mermaid -- npx agentic-mermaid-mcp' },
    { id: 'cursor', name: 'Cursor', config: '~/.cursor/mcp.json' },
    { id: 'codex', name: 'Codex', config: 'config.toml [mcp_servers]' },
    { id: 'gemini-cli', name: 'Gemini CLI', register: 'gemini mcp add agentic-mermaid npx agentic-mermaid-mcp' },
    { id: 'github-copilot', name: 'GitHub Copilot', config: '.vscode/mcp.json' },
    { id: 'pi-opencode', name: 'Pi · OpenCode', config: 'stdio mcp entry' },
    { id: 'generic', name: 'Generic MCP', register: 'npx agentic-mermaid-mcp' },
  ],
}
await emit(M + 'harnesses.json', JSON.stringify(harnesses, null, 2) + '\n')

if (CHECK) {
  if (stale.length) {
    console.error(`site-gen --check: ${stale.length} generated file(s) are stale relative to the registries:\n  ` +
      stale.join('\n  ') + '\nRegenerate with `bun run mockups/site-gen.ts` and commit.')
    process.exit(1)
  }
  console.log(`site-gen --check: in sync — ${tiles.length} families, ${tools.length} tool schemas.`)
} else {
  console.log(`\ndone — ${tiles.length} families, ${tools.length} tool schemas, agent surfaces regenerated`)
}
