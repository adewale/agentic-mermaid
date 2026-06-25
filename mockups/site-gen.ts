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
// Outputs: mockups/diagrams/gallery/<id>.svg, the gallery grid in gallery.html,
// the families table in families.html, and the agent files in mockups/.

import { BUILTIN_FAMILY_METADATA } from '../src/agent/families.ts'

const ROOT = import.meta.dir + '/../'
const M = import.meta.dir + '/'
const GAL = M + 'diagrams/gallery/'

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

// 1 · one tile per family, rendered from its canonical example
const tiles: { id: string; label: string; desc: string }[] = []
for (const fam of BUILTIN_FAMILY_METADATA) {
  const ex = exById.get(fam.editorExampleId)
  if (!ex) { console.warn('!! no example for', fam.id, '(' + fam.editorExampleId + ')'); continue }
  await Bun.write(GAL + fam.id + '.svg', stripFont(am(['render', '-', '--format', 'svg'], ex.source)))
  tiles.push({ id: fam.id, label: fam.label, desc: (ex.description || fam.label).trim() })
  console.log('  rendered', fam.id + '.svg')
}

// 2 · inject the gallery grid + families table (registry order)
const figures = tiles.map((t) =>
  `    <figure>\n      <div class="plate"><img src="diagrams/gallery/${t.id}.svg" alt="${esc(t.label)} diagram"></div>\n      <figcaption><b>${esc(t.label)}</b> — ${esc(t.desc)}</figcaption>\n    </figure>`
).join('\n')
let gallery = await Bun.file(M + 'gallery.html').text()
gallery = gallery.replace(/<div class="gallery">[\s\S]*?<\/div>(\s*<p class="muted">)/,
  `<div class="gallery">\n${figures}\n  </div>$1`)
await Bun.write(M + 'gallery.html', gallery)

const rows = tiles.map((t) => `      <tr><td><strong>${esc(t.label)}</strong></td><td>${esc(t.desc)}</td></tr>`).join('\n')
let families = await Bun.file(M + 'families.html').text()
families = families.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>\n${rows}\n    </tbody>`)
await Bun.write(M + 'families.html', families)

// 3 · the agent surfaces, straight from the CLI
const capJson = am(['capabilities', '--json'])
await Bun.write(M + 'capabilities.json', capJson)
await Bun.write(M + 'llms.txt', am(['llms-txt']))
await Bun.write(M + 'agent-instructions.md', am(['--agent-instructions']))

const cap = JSON.parse(capJson)
const server = { command: 'npx', args: ['-y', '--package', 'agentic-mermaid', 'agentic-mermaid-mcp'], transport: 'stdio' }
const manifest = {
  name: 'agentic-mermaid',
  version: cap.sdkVersion,
  description: 'Agent-native Mermaid runtime: parse, verify, mutate, and render diagrams through a typed surface. Deterministic SVG, PNG, ASCII, Unicode, and JSON.',
  outputFormats: cap.outputFormats,
  families: cap.families.map((f: any) => f.id),
  tools: ['render', 'verify', 'describe', 'parse', 'serialize', 'mutate'],
  mcp: server,
  context: { llms: '/llms.txt', instructions: '/agent-instructions.md', capabilities: '/capabilities.json', harnesses: '/harnesses.json' },
}
await Bun.write(M + 'agent-manifest.json', JSON.stringify(manifest, null, 2) + '\n')

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
await Bun.write(M + 'harnesses.json', JSON.stringify(harnesses, null, 2) + '\n')

console.log(`\ndone — ${tiles.length} families, agent surfaces regenerated from the registry`)
