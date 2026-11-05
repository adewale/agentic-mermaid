import type { MermaidGraph } from '../types.ts'

/** Swimlanes share Flowchart's authored graph grammar. Top-level subgraphs
 * are responsibility lanes; nested subgraphs remain ordinary containers. */
export interface SwimlaneBody {
  kind: 'swimlane'
  graph: MermaidGraph
}
