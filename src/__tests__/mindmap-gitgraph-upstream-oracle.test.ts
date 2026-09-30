// Mermaid's own Mindmap/GitGraph parser tests, pinned and classified in
// eval/mermaid-upstream-suite-bench, executed against our parsers: portable and
// error cases must match upstream, and each documented divergence must hold.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GitGraphDuplicateCommitError, GitGraphParseError, MindmapParseError, parseGitGraph, parseMindmap, serializeGitGraph, serializeMindmap } from '../index.ts'
import type { GitGraphDiagram } from '../gitgraph/types.ts'
import type { MindmapNode } from '../mindmap/types.ts'

type A = Record<string, any>
interface Block { id:string; family:'mindmap'|'gitgraph'; upstream:{file:string;block:string;index:number}; classification:'portable'|'error'|'not-portable'|'divergence'; source?:string; variants?:Array<{source:string;assertions:A}>; reason?:string; summary?:string; assertions?:A }
interface Oracle { schemaVersion:number; upstream:{repository:string;commit:string;license:string;files:Array<{family:string;path:string;testBlocks:number;sha256:string}>}; accounting:Record<'mindmap'|'gitgraph',{consideredBlocks:number;importedCases:number;importedBlocks:number;excludedBlocks:number;deferredBlocks:number}>; blocks:Block[]; intentionalDivergences:Array<A> }
const BENCH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-upstream-suite-bench')
const path = join(BENCH, 'mindmap-gitgraph-f3dea583.json')
const oracle = JSON.parse(readFileSync(path, 'utf8')) as Oracle

function flatten(n:MindmapNode, parentId?:string):A[] {
  return [{ id:n.id, label:n.label, shape:n.shape, ...(parentId?{parentId}:{}), ...(n.icon?{icon:n.icon}:{}), ...(n.className?{className:n.className}:{}) }, ...n.children.flatMap(c=>flatten(c,n.id))]
}
function current(d:GitGraphDiagram):string { let value=d.mainBranchName; for(const s of d.statements) if(s.kind==='branch') value=s.name; else if(s.kind==='checkout') value=s.branch; return value }
function actual(d:GitGraphDiagram, wanted:A):A {
  const ids=new Map(d.commits.map((c,i)=>[c.id,i])); const a:A={}
  if('commits'in wanted)a.commits=d.commits.length
  if('branches'in wanted)a.branches=d.branches.length
  if('direction'in wanted)a.direction=d.direction
  if('currentBranch'in wanted)a.currentBranch=current(d)
  if('parentsByCommit'in wanted)a.parentsByCommit=d.commits.map(c=>c.parents.map(p=>ids.get(p)))
  if('branchesByCommit'in wanted)a.branchesByCommit=d.commits.map(c=>c.branch)
  if('tagsByCommit'in wanted)a.tagsByCommit=d.commits.map(c=>c.tags)
  if('typesByCommit'in wanted)a.typesByCommit=d.commits.map(c=>({type:c.type,...(c.customType?{customType:c.customType}:{})}))
  if('messagesByCommit'in wanted)a.messagesByCommit=d.commits.map(c=>c.message??'')
  if('customIds'in wanted)a.customIds=d.commits.map((c,i)=>c.customId?{index:i,id:c.id}:null).filter(Boolean)
  if('orderedBranches'in wanted)a.orderedBranches=[...d.branches].sort((x,y)=>x.order-y.order).map(x=>x.name)
  if('accessibilityTitle'in wanted)a.accessibilityTitle=d.accessibilityTitle
  if('accessibilityDescription'in wanted)a.accessibilityDescription=d.accessibilityDescription
  return a
}
function runGit(source:string, assertions:A):void {
  if(assertions.parseError){expect(()=>parseGitGraph(source)).toThrow(GitGraphParseError);return}
  const d=parseGitGraph(source); expect(actual(d,assertions)).toEqual(assertions)
  const canonical=serializeGitGraph(d); expect(serializeGitGraph(parseGitGraph(canonical))).toBe(canonical)
}

describe('pinned Mermaid Mindmap/GitGraph upstream oracle',()=>{
  for(const b of oracle.blocks.filter(b=>b.classification==='portable'||b.classification==='error')) test(`${b.id} — ${b.upstream.block}`,()=>{
    if(b.family==='mindmap'){
      if(b.assertions!.parseError){expect(()=>parseMindmap(b.source!)).toThrow(MindmapParseError);return}
      const d=parseMindmap(b.source!); expect(flatten(d.root)).toEqual(b.assertions!.nodes)
      const canonical=serializeMindmap(d); expect(serializeMindmap(parseMindmap(canonical))).toBe(canonical)
    } else if(b.variants) for(const v of b.variants) runGit(v.source,v.assertions)
    else runGit(b.source!,b.assertions!)
  })

  test('executes every documented GitGraph divergence',()=>{
    const divergences=oracle.blocks.filter(x=>x.classification==='divergence')
    expect(divergences.map(block=>block.reason)).toEqual(['reachable-cherry-pick-policy','duplicate-id-policy'])
    for(const b of divergences){
      if(b.reason==='duplicate-id-policy'){
        expect(()=>parseGitGraph(b.source!)).toThrow(GitGraphDuplicateCommitError)
        try{parseGitGraph(b.source!)}catch(error){expect((error as GitGraphDuplicateCommitError).code).toBe(b.assertions!.errorCode)}
      }else expect(()=>parseGitGraph(b.source!)).toThrow(b.assertions!.errorMessage)
    }
  })
})
