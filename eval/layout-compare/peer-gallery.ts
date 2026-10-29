// Render a portable local HTML index of peer-bench's retained SVG files.
// SVGs remain external image resources; peer markup is never inserted as HTML.
// bun run eval/layout-compare/peer-gallery.ts --report /tmp/layout-community/results.json \
//   --svg-dir /tmp/layout-community/svg --out /tmp/layout-community/gallery.html
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

interface Report {
  protocol: string
  createdAt: string
  revision: string
  config: { workloads: { svg: string[] }; peers: Array<{ peer: string; output: string }> }
  population: Record<string, { source: string }>
  pins: Array<{ peer: string; label: string; svg: string }>
  processes: Array<{ peer: string; output: string; round: number }>
  summary: { svg: Record<string, Record<string, { status: string; medianMs?: number; detail?: string }>> }
}
const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]!, value = process.argv[i + 1]
  if (!['--report', '--svg-dir', '--out'].includes(key) || !value) throw new Error('Required: --report PATH --svg-dir PATH --out PATH')
  args.set(key, value)
}
if (args.size !== 3) throw new Error('Required: --report PATH --svg-dir PATH --out PATH')
const out = args.get('--out')!, svgDirectory = args.get('--svg-dir')!
const report = JSON.parse(readFileSync(args.get('--report')!, 'utf8')) as Report
if (report.protocol !== 'legacy-peer@1' || !Array.isArray(report.processes) || !report.summary?.svg) throw new Error('Gallery requires a legacy peer report with retained SVG captures; consumed semantic tracks use a different report contract')
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const url = (path: string) => escape(relative(dirname(out), path).split('/').map(encodeURIComponent).join('/'))
const peers = report.config.peers.filter(entry => entry.output === 'svg').map(entry => entry.peer)
const panels = report.config.workloads.svg.map((id, index) => {
  const population = report.population[id]
  const cards = peers.map(peer => {
    const result = report.summary.svg[peer]?.[id]
    const pin = report.pins.find(entry => entry.peer === peer)
    const files = report.processes.filter(entry => entry.peer === peer && entry.output === 'svg').map(entry => join(svgDirectory, peer, `round-${entry.round}`, `${encodeURIComponent(id)}.svg`))
    const file = files.find(existsSync)
    const timing = result?.medianMs === undefined ? '' : `; ${result.medianMs.toPrecision(4)} ms warm median`
    return `<article><h3>${escape(peer)}</h3><p class="status">${escape(result?.status ?? 'missing')}${escape(timing)}</p><p>${escape(result?.detail ?? '')}</p>${file ? `<a href="${url(file)}"><img loading="lazy" alt="${escape(id)} rendered by ${escape(peer)}" src="${url(file)}"></a><p><a href="${url(file)}">Open original SVG</a></p>` : '<p>No SVG captured; the failure remains in the report.</p>'}<details><summary>Artifact and API</summary><p>${escape(pin?.label)}</p><code>${escape(pin?.svg)}</code></details></article>`
  }).join('\n')
  return `<section data-panel="${index}" ${index ? 'hidden' : ''}><h2>${escape(id)}</h2><details><summary>Identical authored source</summary><pre>${escape(population?.source)}</pre></details><div class="cards">${cards}</div></section>`
}).join('\n')
writeFileSync(out, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mermaid community comparison</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:24px;background:#f5f6f8;color:#18202b}header{max-width:1000px}h1{font-size:28px}h2{font-size:22px}h3{margin:0;font-size:18px}a{color:#074aac}select{font:inherit;padding:8px;max-width:100%}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr));gap:16px;margin-top:20px}article{border:1px solid #bdc7d3;border-radius:8px;background:white;padding:16px;min-width:0}article img{display:block;width:100%;height:340px;object-fit:contain;background:white}pre,code{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}.status{font-weight:600;margin:6px 0}details p{overflow-wrap:anywhere}[hidden]{display:none!important}
</style><header><h1>Mermaid community: the same authored inputs</h1><p>Captured ${escape(report.createdAt)}. Protocol: ${escape(report.protocol)}. Harness: ${escape(report.revision)}.</p><p>Previews show the first captured round; timing medians cover all rounds. These are each renderer's actual SVGs, with its own default style and geometry, scaled to fit a preview. Open an original to inspect dense routes. A readable thumbnail and retained labels do not prove topology, port or paint fidelity.</p><p>Agentic-native is strict owned layout. Agentic and agentic-aa are our default ELK controls. Zombie-simple handles Flowchart and marker-free State; Class, ER and Architecture can use automatically discovered ELK. Sequence and C4 are unchanged controls. These legacy timing medians do not include complete SVG/receipt consumption. Use the benchmark semantic tracks for consumed-output measurements. This gallery does not establish a browser-paint or equal-fidelity performance result.</p><p><a href="${url(args.get('--report')!)}">Complete machine-readable evidence</a></p><label for="workload">Input: </label><select id="workload">${report.config.workloads.svg.map((id, index) => `<option value="${index}">${escape(id)}</option>`).join('')}</select></header>${panels}<script>document.getElementById('workload').addEventListener('change',event=>{for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==event.target.value})</script></html>\n`)
