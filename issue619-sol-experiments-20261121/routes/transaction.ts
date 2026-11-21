import { countEdgeCrossings, onShapeOutline } from '/workspace/elk-layered-port/src/layout-rubric.ts'
import { countPointPairCrossings } from '/workspace/elk-layered-port/src/shared/edge-crossing-pair.ts'
import { findLabelSlot, routeEntersNodeBox } from '/workspace/elk-layered-port/src/layout/route-lanes.ts'
import { invalidEndpointApproaches, setRoutePoints, simplifyPolyline } from '/workspace/elk-layered-port/src/layout/route-geometry.ts'
import { routeCandidateMarkerBlocker } from '/workspace/elk-layered-port/src/layout/route-marker-clearance.ts'
import { measureLabelConflicts } from '/workspace/elk-layered-port/src/layout/label-conflicts.ts'
import { routeClearOfNodes } from '/workspace/elk-layered-port/src/layout/passes/shared.ts'
import type { LaneContext } from '/workspace/elk-layered-port/src/layout/route-geometry.ts'
import type { PositionedEdge } from '/workspace/elk-layered-port/src/types.ts'
const same=(a:number,b:number)=>Math.abs(a-b)<.01
function span(a:PositionedEdge,b:PositionedEdge){let total=0;for(let i=1;i<a.points.length;i++)for(let j=1;j<b.points.length;j++){const p=a.points[i-1]!,q=a.points[i]!,r=b.points[j-1]!,s=b.points[j]!;for(const [m,c] of [['x','y'],['y','x']] as const)if(same(p[c],q[c])&&same(r[c],s[c])&&same(p[c],r[c]))total+=Math.max(0,Math.min(Math.max(p[m],q[m]),Math.max(r[m],s[m]))-Math.max(Math.min(p[m],q[m]),Math.min(r[m],s[m])))}return total}
export function transaction(ctx:LaneContext){
 const log=(globalThis as any).__routeLog??=[];const mode=process.env.ROUTE_MODE??'channel';if(mode==='baseline')return
 const {main:m,cross:c,sign}=ctx.axis
 const eligible=ctx.edges.filter(e=>ctx.classes?.[e.edgeIndex??-1]==='feedback'&&e.points.length===6&&!e.curve&&e.style!=='invisible').filter(e=>{const p=e.points;return same(p[0]![c],p[1]![c])&&same(p[1]![m],p[2]![m])&&same(p[2]![c],p[3]![c])&&same(p[3]![m],p[4]![m])&&same(p[4]![c],p[5]![c])&&(p[3]![m]-p[2]![m])*sign<-.01})
 for(let i=0;i<eligible.length;i++)for(let j=i+1;j<eligible.length;j++){
  const a=eligible[i]!,b=eligible[j]!;if(a.target!==b.target||a.source===b.source||countPointPairCrossings(a.points,b.points)===0)continue
  const record:any={mode,pair:[a.edgeIndex,b.edgeIndex],ids:[a.source+'->'+a.target,b.source+'->'+b.target],status:'proposed'};log.push(record)
  const swap=(own:PositionedEdge,other:PositionedEdge)=>simplifyPolyline([own.points[0]!,own.points[1]!,{[c]:other.points[2]![c],[m]:own.points[1]![m]} as any,...other.points.slice(3)])
  const map=new Map([[a,swap(a,b)],[b,swap(b,a)]]),involved=new Set([ctx.edges.indexOf(a),ctx.edges.indexOf(b)])
  const staged=ctx.edges.map(e=>map.has(e)?{...e,points:map.get(e)!,labelPosition:undefined}:e)
  const old=countEdgeCrossings(ctx.edges,involved),next=countEdgeCrossings(staged,involved);record.crossings=[old,next]
  if(next>=old){record.status='crossing';continue}
  let bad:string|undefined
  for(const edge of [a,b]){const proposal=staged[ctx.edges.indexOf(edge)]!,source=ctx.nodes.find(n=>n.id===edge.source),target=ctx.nodes.find(n=>n.id===edge.target)
   if(!source||!target||invalidEndpointApproaches(proposal,source,target)>0||!onShapeOutline(source,proposal.points[0]!)||!onShapeOutline(target,proposal.points.at(-1)!)){bad='contact';break}
   if(!routeClearOfNodes(proposal.points,ctx.nodes,new Set([source.id,target.id]))||routeEntersNodeBox(proposal.points.slice(1),source)||routeEntersNodeBox(proposal.points.slice(0,-1),target)){bad='node';break}
   if(routeCandidateMarkerBlocker(edge,proposal.points,staged,ctx.style,proposal)){bad='marker';break}
   for(let k=0;k<ctx.edges.length;k++){const other=ctx.edges[k]!;if(other===edge)continue;if(span(proposal,staged[k]!)>span(edge,other)+.01){bad='new-span';break}}
  }
  if(bad){record.status=bad;continue}
  // Both candidate shafts are live while each pill is seated. Other moving
  // pills are absent until allocated; the completed seat roster is rechecked.
  const stagedCtx={...ctx,edges:staged,finalLabelClearance:true,routeChannelGeometry:undefined,nodeLaneIndexes:undefined}
  for(const edge of [a,b]){if(!edge.label)continue;const proposal=staged[ctx.edges.indexOf(edge)]!;const runs=proposal.points.slice(1).map((p,k)=>[proposal.points[k]!,p] as const).filter(([p,q])=>mode==='all'||same(p[c],q[c])&&(q[m]-p[m])*sign<-.01).sort((p,q)=>Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y)-Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y))
   // Keep identity exclusion and caption metrics while removing only its
   // not-yet-seated label from the staged obstacle roster.
   const ix=ctx.edges.indexOf(edge);const pending=staged.flatMap((e,k)=>k===ix?[]:[map.has(ctx.edges[k]!)&&!e.labelPosition?{...e,label:undefined}:e])
   let seat:any;for(const [p,q] of runs){seat=findLabelSlot(proposal,p,q,{...stagedCtx,edges:[...pending,proposal]});if(seat)break}
   if(!seat||mode==='blocked'){bad='label-seat';break}proposal.labelPosition=seat
  }
  if(!bad&&measureLabelConflicts({nodes:ctx.nodes,edges:staged},ctx.style,involved).total>measureLabelConflicts({nodes:ctx.nodes,edges:ctx.edges},ctx.style,involved).total)bad='label-conflict'
  if(bad){record.status=bad;continue}
  for(const edge of [a,b]){const proposed=staged[ctx.edges.indexOf(edge)]!;setRoutePoints(ctx,edge,proposed.points);edge.labelPosition=proposed.labelPosition}
  record.status='accepted';record.routes=[a.points,b.points];record.labels=[a.labelPosition,b.labelPosition]
 }
}
