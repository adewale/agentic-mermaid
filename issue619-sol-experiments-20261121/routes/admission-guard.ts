import {countParallelRouteOverlaps} from '/workspace/elk-layered-port/src/layout-rubric.ts'
import {opposingRoutePartners} from '/workspace/elk-layered-port/src/shared/edge-overlaps.ts'
import {routeCandidateMarkerBlocker} from '/workspace/elk-layered-port/src/layout/route-marker-clearance.ts'
import {measureLabelConflicts} from '/workspace/elk-layered-port/src/layout/label-conflicts.ts'
import {opposingRoutesMislead} from './shared-policy.ts'
import type {PositionedGraph} from '/workspace/elk-layered-port/src/types.ts'
import type {ResolvedRenderStyle} from '/workspace/elk-layered-port/src/styles.ts'
export function alternativeAdmission(first:PositionedGraph,other:PositionedGraph,style:ResolvedRenderStyle){
 const fail=(reason:string,pair?:unknown)=>{(globalThis as any).__admissionGuard?.push({reason,pair});return false}
 const before=new Map(first.edges.map(e=>[e.edgeIndex,e]));if(before.size!==first.edges.length||other.edges.length!==first.edges.length)return fail('identity')
 for(let i=0;i<other.edges.length;i++){
  const edge=other.edges[i]!,old=before.get(edge.edgeIndex);if(!old||old.source!==edge.source||old.target!==edge.target)return fail('identity')
  if(routeCandidateMarkerBlocker(old,edge.points,other.edges,style,edge))return fail('marker',edge.edgeIndex)
  const oldPartners=new Set(opposingRoutePartners(old,first.edges.filter(e=>e!==old)).map(e=>e.edgeIndex))
  for(const peer of opposingRoutePartners(edge,other.edges.filter(e=>e!==edge)))if(!oldPartners.has(peer.edgeIndex)&&opposingRoutesMislead(edge,peer,other.edges))return fail('opposing',[edge.edgeIndex,peer.edgeIndex])
  // Existing legitimate fan/terminal bundles have different authored endpoint
  // pairs; same-pair duplicates still need a private visible shaft each.
  for(let j=0;j<i;j++){const peer=other.edges[j]!,oldPeer=before.get(peer.edgeIndex);if(!oldPeer)return fail('identity');if(countParallelRouteOverlaps([edge,peer])>countParallelRouteOverlaps([old,oldPeer]))return fail('parallel',[edge.edgeIndex,peer.edgeIndex])}
  // Preserve every authored pill's incident conflicts independently, so an
  // unrelated clean caption cannot pay for a newly obscured occurrence.
  const oldIndex=first.edges.indexOf(old)
  if(measureLabelConflicts(other,style,new Set([i])).total>measureLabelConflicts(first,style,new Set([oldIndex])).total)return fail('label',edge.edgeIndex)
 }
 ;(globalThis as any).__admissionGuard?.push({reason:'passed'});return true
}
