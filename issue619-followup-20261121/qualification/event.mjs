import fs from 'node:fs'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {pathToFileURL} from 'node:url'
const root='/tmp/issue619-followup-20261121/qualification-c18f6073', api={before:await import(pathToFileURL('/tmp/issue619-kink-20261120/package/package/dist/agent.js')),after:await import(pathToFileURL('/tmp/issue619-followup-20261121/package-c18f6073/package/dist/agent.js'))}
const cases=[['clear','rf 01 cmd Save\nrf 02 ui Screen\nrf 03 evt Saved ->> 01'],['straight','rf 01 cmd Save\nrf 02 ui Screen\nrf 03 cmd Again ->> 01'],['card-blocked','rf 01 cmd Save\nrf 02 evt Progressed\nrf 03 cmd Retry\nrf 04 evt Saved ->> 01'],['peer-blocked','rf 01 cmd Save\nrf 02 ui Screen\nrf 03 evt Saved ->> 01 ->> 02']]
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'), rows=[];fs.mkdirSync(root+'/event',{recursive:true})
for(const[id,body]of cases){const source='eventmodeling\n'+body, arms={};fs.writeFileSync(root+'/event/'+id+'.mmd',source)
 for(const[arm,a]of Object.entries(api)){const options={embedFontImport:false},render=a.renderMermaidSVGWithReceipt(source,options),layout=a.layoutMermaidWithReceipt(source,{...options,debug:true}).layout
 fs.writeFileSync(root+'/event/'+id+'-'+arm+'.svg',render.svg);fs.writeFileSync(root+'/event/'+id+'-'+arm+'.receipt.json',JSON.stringify(render.receipt,null,2));fs.writeFileSync(root+'/event/'+id+'-'+arm+'.layout.json',JSON.stringify(layout,null,2));
 const route=layout.edges.find(e=>e.from==='01').path;const wire=route.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-route[i][0],p[1]-route[i][1]),0)
 arms[arm]={svg:sha(render.svg),receipt:render.receipt.layoutCertification,verified:a.verifyMermaid(source).ok,points:route.length,bends:route.length-2,wire,layout}
 }
 assert.deepStrictEqual(arms.before.layout.nodes,arms.after.layout.nodes);assert.deepStrictEqual(arms.before.layout.groups,arms.after.layout.groups)
 assert.deepStrictEqual(arms.before.layout.edges.map(e=>[e.id,e.from,e.to,e.path[0],e.path.at(-1)]),arms.after.layout.edges.map(e=>[e.id,e.from,e.to,e.path[0],e.path.at(-1)]))
 for(const v of Object.values(arms)){assert.equal(v.receipt.status,'passed');assert.equal(v.verified,true);delete v.layout}
 if(id.includes('blocked'))assert.equal(arms.before.svg,arms.after.svg)
 rows.push({id,source,sourceSha256:sha(source),...arms})
}
fs.writeFileSync(root+'/event/results.json',JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.map(({id,before,after})=>({id,points:[before.points,after.points],wire:[before.wire,after.wire],sameSvg:before.svg===after.svg,proof:[before.receipt.status,after.receipt.status]}))))
