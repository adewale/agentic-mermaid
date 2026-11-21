// Extraction prototype: this is exactly the existing bundle owner's policy.
import {edgesMayShareTerminal} from '/workspace/elk-layered-port/src/layout/route-marker-clearance.ts'
import type {PositionedEdge} from '/workspace/elk-layered-port/src/types.ts'
export function opposingRoutesMislead(member:PositionedEdge,other:PositionedEdge,edges:readonly PositionedEdge[]):boolean {
 const realEdge=(source:string,target:string,paint:PositionedEdge)=>edges.some(edge=>edge.source===source&&edge.target===target&&edge.style!=='invisible'&&edgesMayShareTerminal(paint,edge)&&edge.hasArrowStart===paint.hasArrowStart&&edge.hasArrowEnd===paint.hasArrowEnd&&(edge.startMarker??'arrow')===(paint.startMarker??'arrow')&&(edge.endMarker??'arrow')===(paint.endMarker??'arrow'))
 return !edgesMayShareTerminal(member,other)||!realEdge(member.source,other.target,member)||!realEdge(other.source,member.target,other)
}
