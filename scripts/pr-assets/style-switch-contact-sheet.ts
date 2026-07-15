#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EDITOR_EXAMPLES } from '../../editor/examples.ts'
import { renderMermaidSVG, verifyNoExternalRefs } from '../../src/index.ts'
import { knownBuiltinFamilies } from '../../src/agent/families.ts'
import { inferBackend, knownStyleDescriptors } from '../../src/scene/style-registry.ts'

const ROOT = join(import.meta.dir, '..', '..')
const OUTPUT = join(ROOT, 'docs', 'design', 'families', 'style-switch-contact-sheet.html')
const SEED = 7

/** Editorial wayfinding only; capability authority remains the family registry. */
const FEATURE_TAGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  flowchart: ['decision', 'labeled branches', 'merge'],
  state: ['initial/final states', 'transitions', 'labels'],
  architecture: ['groups', 'services', 'icons', 'ports'],
  sequence: ['participants', 'sync/async messages', 'response'],
  class: ['members', 'stereotype', 'inheritance', 'composition'],
  er: ['entities', 'attributes', 'keys', 'cardinality'],
  timeline: ['title', 'sections', 'multiple events'],
  journey: ['sections', 'actors', 'scores', 'tasks'],
  xychart: ['axes', 'bar series', 'line series', 'legend'],
  pie: ['title', 'values', 'proportional slices', 'legend'],
  quadrant: ['axes', 'quadrants', 'labeled points'],
  mindmap: ['bilateral tree', 'shapes', 'Markdown', 'Unicode', 'icon'],
  gitgraph: ['branches', 'typed commits', 'tags', 'merge', 'cherry-pick'],
  gantt: ['sections', 'dependencies', 'statuses', 'milestone'],
  radar: ['axes', 'multiple curves', 'polygon graticule', 'legend'],
})

const examples = EDITOR_EXAMPLES.map(example => {
  const id = example.id.replace(/-basic$/, '')
  const featureTags = FEATURE_TAGS[id]
  if (!featureTags) throw new Error(`Missing feature tags for editor example ${example.id}`)
  return {
    id,
    label: example.label,
    description: example.description,
    source: example.source,
    options: example.options ?? {},
    featureTags,
  }
})

const registeredFamilies = knownBuiltinFamilies()
const exampleFamilies = examples.map(example => example.id)
if (
  new Set(exampleFamilies).size !== exampleFamilies.length ||
  registeredFamilies.some(family => !exampleFamilies.includes(family)) ||
  exampleFamilies.some(family => !registeredFamilies.includes(family as typeof registeredFamilies[number]))
) {
  throw new Error(`Editor/contact-sheet families must equal the built-in registry: ${registeredFamilies.join(', ')}`)
}

const descriptors = knownStyleDescriptors()
if (descriptors.length === 0) throw new Error('No built-in Style resources were discovered')
const styles = descriptors.map(descriptor => ({
  id: descriptor.identity.id,
  inputName: descriptor.inputName,
  label: descriptor.displayLabel,
  kind: descriptor.kind,
  isDefault: descriptor.isDefault,
  backend: inferBackend(descriptor.spec),
  blurb: descriptor.spec.blurb ?? '',
  intent: descriptor.spec.intent ?? null,
}))

const svgs: Record<string, Record<string, string>> = {}
for (const style of styles) {
  const familySvgs: Record<string, string> = {}
  for (const example of examples) {
    const svg = renderMermaidSVG(example.source, {
      ...example.options,
      embedFontImport: false,
      style: style.inputName,
      seed: SEED,
      idPrefix: `style-contact-${style.id.replace(/[^a-z0-9]+/gi, '-')}-${example.id}`,
    })
    const security = verifyNoExternalRefs(svg)
    if (!security.ok) throw new Error(`${style.id} × ${example.id}: external SVG reference`)
    familySvgs[example.id] = svg
  }
  svgs[style.id] = familySvgs
}

const jsonForScript = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c')
const data = jsonForScript({ seed: SEED, styles, examples, svgs })
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agentic Mermaid — all-family Style contact sheet</title>
<style>
  :root{color-scheme:light;--ink:#171717;--muted:#626262;--line:#d6d3d1;--paper:#fafaf9;--card:#fff;--accent:#9f1239}
  *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .toolbar{position:sticky;z-index:10;top:0;border-bottom:1px solid var(--line);background:rgba(250,250,249,.96);backdrop-filter:blur(12px)}
  .toolbar-inner{max-width:1680px;margin:auto;padding:16px 24px;display:grid;grid-template-columns:minmax(320px,1fr) minmax(280px,420px);gap:20px;align-items:end}
  h1{font:700 clamp(22px,3vw,34px)/1.1 Georgia,serif;margin:0 0 5px}.lede{margin:0;color:var(--muted)}
  .control{display:grid;gap:5px}.control label{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#44403c}
  select{width:100%;border:1px solid #a8a29e;border-radius:8px;background:white;color:var(--ink);padding:10px 38px 10px 12px;font:600 14px/1.2 inherit}
  .meta{max-width:1680px;margin:auto;padding:12px 24px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid #e7e5e4;color:#44403c}
  .pill,.tag{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;background:#fff;padding:3px 8px;font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace}
  .meta .blurb{font-size:12px;color:var(--muted);flex:1 1 360px}.meta .count{margin-left:auto;font-variant-numeric:tabular-nums}
  main{max-width:1680px;margin:auto;padding:24px}.notice{margin:0 0 20px;border-left:4px solid var(--accent);background:#fff1f2;padding:11px 14px;color:#4c0519}
  .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:start}
  article{min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--card);overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  article header{padding:12px 14px 10px;border-bottom:1px solid #e7e5e4}.family-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
  h2{margin:0;font:700 18px/1.2 Georgia,serif}.family-id{color:#78716c;font:11px ui-monospace,SFMono-Regular,Menlo,monospace}.description{min-height:38px;margin:5px 0 8px;color:var(--muted);font-size:12px}
  .tags{display:flex;flex-wrap:wrap;gap:4px}.tag{background:#f5f5f4;font-family:inherit;font-weight:650;padding:3px 7px}
  .visual{height:360px;padding:12px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff}
  .visual svg{display:block;max-width:100%!important;max-height:336px!important;width:100%!important;height:auto!important}
  details{border-top:1px solid #e7e5e4;background:#fafaf9}summary{cursor:pointer;padding:8px 12px;color:#57534e;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  pre{max-height:260px;overflow:auto;margin:0;padding:0 12px 12px;white-space:pre-wrap;color:#292524;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
  footer{max-width:1680px;margin:auto;padding:0 24px 28px;color:#78716c;font-size:12px}
  @media(max-width:1120px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar-inner{grid-template-columns:1fr 340px}}
  @media(max-width:720px){.toolbar-inner{grid-template-columns:1fr;padding:14px 16px}.meta{padding:10px 16px}.meta .count{margin-left:0}main{padding:16px}.grid{grid-template-columns:1fr}.visual{height:330px}footer{padding:0 16px 24px}}
  @media print{.toolbar{position:static}.control{display:none}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.visual{height:300px}article{break-inside:avoid}.notice{display:none}}
</style>
</head>
<body>
<div class="toolbar">
  <div class="toolbar-inner">
    <div><h1>All-family Style contact sheet</h1><p class="lede">${examples.length} registered diagram families × every registered built-in Look and Palette. Deterministic seed ${SEED}; no external SVG references.</p></div>
    <div class="control"><label for="style-select">Style resource</label><select id="style-select" aria-label="Style resource"></select></div>
  </div>
  <div class="meta" id="style-meta" aria-live="polite"></div>
</div>
<main>
  <p class="notice"><strong>Tufte identity is explicit:</strong> <code>look:tufte</code> and <code>palette:tufte</code> are separate selector entries. The retired ambiguous bare <code>tufte</code> input is rejected.</p>
  <section class="grid" id="grid" aria-label="Diagram family contact sheet"></section>
</main>
<footer>Generated by <code>scripts/pr-assets/style-switch-contact-sheet.ts</code> from the live family/Style registries and canonical editor examples. Feature chips are editorial wayfinding, not a capability authority. A selection applies one Style resource by itself; compose Look + Palette stacks through the normal rendering API.</footer>
<script>const DATA=${data};
const select=document.querySelector('#style-select');
const grid=document.querySelector('#grid');
const meta=document.querySelector('#style-meta');
const groups={look:document.createElement('optgroup'),palette:document.createElement('optgroup')};
groups.look.label='Looks ('+DATA.styles.filter(s=>s.kind==='look').length+')';
groups.palette.label='Palettes ('+DATA.styles.filter(s=>s.kind==='palette').length+')';
for(const style of DATA.styles){const option=document.createElement('option');option.value=style.id;option.textContent=style.label+' — '+(style.kind==='look'?'Look':'Palette')+' ('+style.id+')';groups[style.kind].append(option)}
select.append(groups.look,groups.palette);
const cards=new Map();
for(const example of DATA.examples){const article=document.createElement('article');const header=document.createElement('header');const familyRow=document.createElement('div');familyRow.className='family-row';const title=document.createElement('h2');title.textContent=example.label;const familyId=document.createElement('span');familyId.className='family-id';familyId.textContent=example.id;familyRow.append(title,familyId);const description=document.createElement('p');description.className='description';description.textContent=example.description;const tags=document.createElement('div');tags.className='tags';for(const value of example.featureTags){const tag=document.createElement('span');tag.className='tag';tag.textContent=value;tags.append(tag)}header.append(familyRow,description,tags);const visual=document.createElement('div');visual.className='visual';visual.setAttribute('aria-label',example.label+' rendering');const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='Mermaid source';const pre=document.createElement('pre');pre.textContent=example.source;details.append(summary,pre);article.append(header,visual,details);grid.append(article);cards.set(example.id,visual)}
function render(styleId){const style=DATA.styles.find(item=>item.id===styleId)||DATA.styles.find(item=>item.isDefault)||DATA.styles[0];select.value=style.id;for(const example of DATA.examples)cards.get(example.id).innerHTML=DATA.svgs[style.id][example.id];meta.replaceChildren();for(const value of [style.id,style.kind,'backend: '+style.backend,...(style.intent?['intent: '+style.intent]:[])]){const pill=document.createElement('span');pill.className='pill';pill.textContent=value;meta.append(pill)}const blurb=document.createElement('span');blurb.className='blurb';blurb.textContent=style.blurb;const count=document.createElement('span');count.className='count';count.textContent=DATA.examples.length+' families · '+DATA.styles.length+' selectable Styles';meta.append(blurb,count);try{const url=new URL(location.href);url.searchParams.set('style',style.id);history.replaceState(null,'',url)}catch{}document.title=style.label+' — Agentic Mermaid Style contact sheet'}
select.addEventListener('change',()=>render(select.value));
const requested=new URLSearchParams(location.search).get('style');render(DATA.styles.some(style=>style.id===requested)?requested:(DATA.styles.find(style=>style.isDefault)?.id||DATA.styles[0].id));
window.__styleContactSheet={data:DATA,render};</script>
</body>
</html>
`

if (process.argv.includes('--check')) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== html) {
    process.stderr.write(`${OUTPUT} is stale; run bun run gallery:style-switch\n`)
    process.exit(1)
  }
  console.log(`Style-switch contact sheet is synchronized (${styles.length} Styles × ${examples.length} families)`)
  process.exit(0)
}

writeFileSync(OUTPUT, html)
console.log(`wrote ${OUTPUT} (${styles.length} Styles × ${examples.length} families)`)
