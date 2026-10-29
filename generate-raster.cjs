const fs=require('node:fs');
const root='/workspace/pr582-rebase',out='/workspace/pr582-evidence';
const jiti=require('/workspace/agentic-mermaid/node_modules/jiti')(root+'/package.json');
const {inlineResolvedColors}=jiti(root+'/src/theme.ts');
const {prepareResvgMarkerOrientation}=jiti(root+'/src/resvg-marker-orientation.ts');
const {chromium}=require('/workspace/agentic-mermaid/node_modules/playwright');
let page;
function boundsFor(ids,layouts,extra=[]){
 const boxes=layouts.flatMap(l=>l.nodes.filter(n=>ids.includes(n.id)).map(n=>[n.x,n.y,n.x+n.w,n.y+n.h]));
 boxes.push(...extra);return {x:Math.min(...boxes.map(b=>b[0]))-35,y:Math.min(...boxes.map(b=>b[1]))-35,w:Math.max(...boxes.map(b=>b[2]))-Math.min(...boxes.map(b=>b[0]))+70,h:Math.max(...boxes.map(b=>b[3]))-Math.min(...boxes.map(b=>b[1]))+70};
}
async function raster(stem,crop){
 let svg=fs.readFileSync(out+'/'+stem+'.svg','utf8');
 if(crop)svg=svg.replace(/<svg\b([^>]*)>/,(_,attrs)=>'<svg'+attrs.replace(/\s(?:width|height|viewBox)="[^"]*"/g,'')+` width="${crop.w}" height="${crop.h}" viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}">`);
 const fonts=[['EB Garamond','EBGaramond.ttf'],['Inter','Inter-Regular.ttf'],['JetBrains Mono','JetBrainsMono-Regular.ttf']].filter(([,file])=>fs.existsSync(root+'/assets/fonts/'+file)).map(([family,file])=>`@font-face{font-family:'${family}';src:url(data:font/ttf;base64,${fs.readFileSync(root+'/assets/fonts/'+file).toString('base64')})}`).join('');
 await page.setContent('<style>'+fonts+'body{margin:0;background:white}svg{width:1000px;height:auto;display:block}</style>'+svg);
 await page.evaluate(()=>document.fonts.ready);
 const name=stem+(crop?'-detail':'')+'.png';await page.locator('svg').screenshot({path:out+'/'+name});return {name,crop};
}
const load=stem=>JSON.parse(fs.readFileSync(out+'/'+stem+'.layout.json','utf8'));
const classLayout=load('class-80-publication-after'),edge=classLayout.edges.find(e=>e.from==='C3'&&e.to==='C7');
const xs=edge.path.map(p=>p[0]),ys=edge.path.map(p=>p[1]);
const classCrop=boundsFor(['C3'],[classLayout]);
const cyclicLayouts=['before','after'].map(p=>load('cyclic-labelled-15-chains-'+p));
const cyclicCrop=boundsFor(['n10','n7'],cyclicLayouts,cyclicLayouts.map(l=>{const b=l.edges.find(e=>e.label?.text.includes('edge 32')).label.bounds;return[b.x,b.y,b.x+b.w,b.y+b.h]}));
const multiLayouts=['before','after'].map(p=>load('multigraph-24-publication-'+p));
const changed=multiLayouts[0].nodes.filter((n,i)=>n.x!==multiLayouts[1].nodes[i].x||n.y!==multiLayouts[1].nodes[i].y).map(n=>n.id);
const multiCrop=boundsFor(changed,multiLayouts);
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});page=await browser.newPage({viewport:{width:1200,height:1200}});await page.route('**/*',route=>route.abort());
 const renders=[await raster('class-80-publication-after',classCrop)];
 for(const phase of ['before','after']){renders.push(await raster('cyclic-labelled-15-chains-'+phase,cyclicCrop));renders.push(await raster('multigraph-24-publication-'+phase,multiCrop));}
 fs.writeFileSync(out+'/raster-receipt.json',JSON.stringify({rasterizer:await browser.version(),font:'Bundled EB Garamond and Inter; system fallback where needed',method:'Production SVG, unchanged viewBox crops at 1000px width, embedded local font faces, external network requests blocked',renders},null,2));
 console.log(JSON.stringify(renders));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
