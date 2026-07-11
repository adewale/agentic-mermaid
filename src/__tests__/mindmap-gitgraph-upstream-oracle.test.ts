import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { GitGraphDuplicateCommitError, parseGitGraph, parseMindmap, serializeGitGraph, serializeMindmap } from '../index.ts'
import type { GitGraphDiagram } from '../gitgraph/types.ts'
import type { MindmapNode } from '../mindmap/types.ts'

type A = Record<string, any>
interface Block { id:string; family:'mindmap'|'gitgraph'; upstream:{file:string;block:string;index:number}; classification:'portable'|'error'|'not-portable'|'divergence'; source?:string; variants?:Array<{source:string;assertions:A}>; reason?:string; summary?:string; assertions?:A }
interface Oracle { schemaVersion:number; upstream:{repository:string;commit:string;license:string;files:Array<{family:string;path:string;testBlocks:number;sha256:string}>}; accounting:Record<'mindmap'|'gitgraph',{consideredBlocks:number;importedCases:number;importedBlocks:number;excludedBlocks:number;deferredBlocks:number}>; blocks:Block[]; intentionalDivergences:Array<A> }
const BENCH = join(import.meta.dir, '..', '..', 'eval', 'mermaid-upstream-suite-bench')
const path = join(BENCH, 'mindmap-gitgraph-f3dea583.json')
const oracle = JSON.parse(readFileSync(path, 'utf8')) as Oracle

type Bindings = ReadonlyMap<string, string>
interface ExtractedBlock { name: string; source?: string; variants?: string[] }
function staticString(node: ts.Expression, bindings: Bindings = new Map()): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return bindings.get(node.text)
  if (ts.isParenthesizedExpression(node)) return staticString(node.expression, bindings)
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text
    for (const span of node.templateSpans) {
      const expression = staticString(span.expression, bindings)
      if (expression === undefined) return undefined
      value += expression + span.literal.text
    }
    return value
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left, bindings), right = staticString(node.right, bindings)
    return left === undefined || right === undefined ? undefined : left + right
  }
  return undefined
}
function enclosingConstantLoop(node: ts.Node): { variable: string; values: string[] } | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (!ts.isForOfStatement(current) || !ts.isVariableDeclarationList(current.initializer)) continue
    const declaration = current.initializer.declarations[0]
    if (!declaration || !ts.isIdentifier(declaration.name) || !ts.isArrayLiteralExpression(current.expression)) return undefined
    const values = current.expression.elements.map(element => staticString(element as ts.Expression))
    if (values.some(value => value === undefined)) return undefined
    return { variable: declaration.name.text, values: values as string[] }
  }
  return undefined
}
function sourceFrom(callback: ts.Node, bindings: Bindings): string | undefined {
  let source: string | undefined
  const findSource = (child: ts.Node): void => {
    if (source !== undefined) return
    if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.name.text === 'str' && child.initializer) {
      source = staticString(child.initializer, bindings)
    }
    if (source === undefined && ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression) && child.expression.name.text === 'parse' && child.arguments[0]) {
      source = staticString(child.arguments[0]!, bindings)
    }
    ts.forEachChild(child, findSource)
  }
  findSource(callback)
  return source
}
function extractUpstreamBlocks(file: string): ExtractedBlock[] {
  const text = readFileSync(file, 'utf8')
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const blocks: ExtractedBlock[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'it') {
      const nameArg = node.arguments[0]
      const callback = node.arguments[1]
      if (!nameArg || !callback) throw new Error(`Malformed upstream test block in ${file}`)
      const name = staticString(nameArg) ?? nameArg.getText(tree)
      const loop = enclosingConstantLoop(node)
      if (loop) {
        const variants = loop.values.map(value => sourceFrom(callback, new Map([[loop.variable, value]])))
        if (variants.some(source => source === undefined)) throw new Error(`Could not expand upstream loop source for ${name}`)
        blocks.push({ name, variants: variants as string[] })
      } else {
        const source = sourceFrom(callback, new Map())
        blocks.push({ name, ...(source === undefined ? {} : { source }) })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return blocks
}

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
  if(assertions.parseError){expect(()=>parseGitGraph(source)).toThrow();return}
  const d=parseGitGraph(source); expect(actual(d,assertions)).toEqual(assertions)
  const canonical=serializeGitGraph(d); expect(serializeGitGraph(parseGitGraph(canonical))).toBe(canonical)
}

describe('pinned Mermaid Mindmap/GitGraph upstream oracle',()=>{
  test('binds every classification to the vendored pinned upstream title, order, source, and SHA-256', () => {
    const vendored = new Map([
      ['mindmap', join(BENCH, 'upstream-f3dea583', 'mindmap.spec.ts')],
      ['gitgraph', join(BENCH, 'upstream-f3dea583', 'gitGraph.spec.ts')],
    ])
    for (const family of ['mindmap', 'gitgraph'] as const) {
      const file = vendored.get(family)!
      const metadata = oracle.upstream.files.find(entry => entry.family === family)!
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(metadata.sha256)
      const extracted = extractUpstreamBlocks(file)
      const classified = oracle.blocks.filter(block => block.family === family)
      expect(extracted).toHaveLength(metadata.testBlocks)
      expect(classified).toHaveLength(metadata.testBlocks)
      extracted.forEach((block, index) => {
        expect(classified[index]!.upstream).toMatchObject({ block: block.name, index: index + 1, file: metadata.path })
        if (block.source !== undefined) expect(classified[index]!.source).toBe(block.source)
        if (block.variants !== undefined) expect(classified[index]!.variants?.map(variant => variant.source)).toEqual(block.variants)
      })
    }
    expect(readFileSync(join(BENCH, 'upstream-f3dea583', 'LICENSE.mermaid.txt'), 'utf8')).toContain('Copyright (c) 2014 - 2022 Knut Sveidqvist')
  })

  test('accounts for every direct upstream test block exactly once',()=>{
    expect(oracle.schemaVersion).toBe(2)
    expect(oracle.upstream).toMatchObject({repository:'https://github.com/mermaid-js/mermaid',commit:'f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc',license:'MIT'})
    expect(new Set(oracle.blocks.map(b=>b.id)).size).toBe(95)
    for(const family of ['mindmap','gitgraph'] as const){
      const blocks=oracle.blocks.filter(b=>b.family===family), row=oracle.accounting[family]
      expect(blocks.map(b=>b.upstream.index)).toEqual(Array.from({length:row.consideredBlocks},(_,i)=>i+1))
      const imported=blocks.filter(b=>b.classification==='portable'||b.classification==='error')
      expect({consideredBlocks:blocks.length,importedCases:imported.length,importedBlocks:imported.length,excludedBlocks:blocks.length-imported.length,deferredBlocks:0}).toEqual(row)
      expect(oracle.upstream.files.find(f=>f.family===family)).toMatchObject({testBlocks:blocks.length,sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
    }
    expect(oracle.accounting).toEqual({mindmap:{consideredBlocks:26,importedCases:26,importedBlocks:26,excludedBlocks:0,deferredBlocks:0},gitgraph:{consideredBlocks:69,importedCases:63,importedBlocks:63,excludedBlocks:6,deferredBlocks:0}})
  })

  for(const b of oracle.blocks.filter(b=>b.classification==='portable'||b.classification==='error')) test(`${b.id} — ${b.upstream.block}`,()=>{
    if(b.family==='mindmap'){
      if(b.assertions!.parseError){expect(()=>parseMindmap(b.source!)).toThrow();return}
      const d=parseMindmap(b.source!); expect(flatten(d.root)).toEqual(b.assertions!.nodes)
      const canonical=serializeMindmap(d); expect(serializeMindmap(parseMindmap(canonical))).toBe(canonical)
    } else if(b.variants) for(const v of b.variants) runGit(v.source,v.assertions)
    else runGit(b.source!,b.assertions!)
  })

  test('executes the documented duplicate-id divergence',()=>{
    const b=oracle.blocks.find(x=>x.classification==='divergence')!
    expect(()=>parseGitGraph(b.source!)).toThrow(GitGraphDuplicateCommitError)
    try{parseGitGraph(b.source!)}catch(error){expect((error as GitGraphDuplicateCommitError).code).toBe(b.assertions!.errorCode)}
  })
  test('limits non-portable exclusions to source-inexpressible config accessors',()=>{
    const excluded=oracle.blocks.filter(b=>b.classification==='not-portable')
    expect(excluded).toHaveLength(5)
    for(const b of excluded){expect(b.reason).toBe('api-internal');expect(b.summary!.length).toBeGreaterThan(40);expect(b.source).toBeUndefined()}
    expect(oracle.intentionalDivergences.map(d=>d.topic)).toEqual(['generated commit identity','duplicate node identity','duplicate custom commit identity'])
  })
})
