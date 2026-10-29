import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{pathToFileURL,fileURLToPath}from'node:url';import{dirname}from'node:path';import{execFileSync}from'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const [root,phase,out]=process.argv.slice(2);mkdirSync(out,{recursive:true});
const{renderMermaidSVGWithReceipt}=await import(pathToFileURL(root+'/dist/index.js'));
const{prepareResvgMarkerOrientation}=await import(pathToFileURL(root+'/src/resvg-marker-orientation.ts'));
const{Resvg}=await import(pathToFileURL(root+'/node_modules/@resvg/resvg-js/index.js'));
const options={embedFontImport:false};
const rows=[];for(const name of ['independent-loops','shared-route-label']){
 const source=readFileSync(here+'/'+name+'.mmd','utf8');
 const {svg,receipt}=renderMermaidSVGWithReceipt(source,options);
 writeFileSync(`${out}/${name}-${phase}.svg`,svg);writeFileSync(`${out}/${name}-${phase}.png`,new Resvg(prepareResvgMarkerOrientation(svg),{background:'#FFFFFF',fitTo:{mode:'zoom',value:2},font:{loadSystemFonts:true}}).render().asPng());
 rows.push({name,receipt,svgBytes:Buffer.byteLength(svg)});writeFileSync(`${out}/${name}.mmd`,source);
}
writeFileSync(`${out}/${phase}-receipts.json`,JSON.stringify({revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),runtime:process.version,phase,options,rows},null,2)+'\n');console.log(rows.map(({name,svgBytes})=>({name,svgBytes})));
