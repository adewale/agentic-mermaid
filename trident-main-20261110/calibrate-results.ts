// Reporting only. Use the pinned Trident statistics, without invoking a renderer.
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {summarize,calibrate} from '/tmp/pr449-week-comparison-20261101/trident-elk-research-20261107/trident/portable/statistics.ts'
const out=import.meta.dir
const completion=JSON.parse(readFileSync(join(out,'PERFORMANCE-COMPLETED.json'),'utf8'))
if(completion.completed!==5952||completion.errors)throw Error('Retain and review incomplete workers before reducing')
const rows=readFileSync(join(out,'performance/results.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s))
const groups=new Map<string,any[]>()
for(const row of rows){if(!['warm','cold'].includes(row.result.mode))continue;const key=JSON.stringify([row.target,row.backend,row.cache,row.result.caseId,row.result.mode]);if(!groups.has(key))groups.set(key,[]);groups.get(key)!.push(row.result)}
const result=[]
for(const [key,group]of groups){const [target,backend,cache,id,mode]=JSON.parse(key);const tracks=[...new Set(group.flatMap(r=>Object.keys(r.tracks??{})))]
 for(const track of tracks){const replicas=Object.fromEntries(group.map(r=>[r.replica,r.tracks[track]??[]]));result.push({target,backend,cache,id,mode,track,outcomes:group.map(r=>({replica:r.replica,status:r.status,actualAccepted:r.qualification?.accepted??null,error:r.error??null})),summary:summarize(Object.values(replicas).flat() as number[]),scope:mode==='warm'?'Pooled adaptive batch means; p95 is not single-call tail latency':'Three independent first-use API calls; import excluded',replicas,calibration:calibrate([{round:1,A0:replicas.A0??[],A1:replicas.A1??[],B:replicas.B??[]}],mode==='warm'?31:20)})}}
writeFileSync(join(out,'CALIBRATION.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({cells:result.length,status:'exploratory; original Trident calibration limitations retained'}))
