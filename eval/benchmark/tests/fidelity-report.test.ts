import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFidelityComparison } from '../fidelity/report.ts'

test('matching case names cannot compose evidence from changed expectations or observers', () => {
  const root=mkdtempSync(join(tmpdir(),'fidelity-report-'))
  try {
    const core=join(root,'core.json'), community=join(root,'community.json')
    writeFileSync(core,JSON.stringify({cases:[{id:'same-authored-name'}],criteriaProtocol:{producers:['actual-committed-observer-A']}}))
    writeFileSync(community,JSON.stringify({selectedCaseIds:['same-authored-name'],criteriaProtocol:{producers:['actual-committed-observer-B']}}))
    expect(()=>writeFidelityComparison({core,community,out:join(root,'report')})).toThrow('matching case names alone cannot qualify composition')
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('report restores jointly omitted criteria and an entirely omitted admitted project', () => {
  const root=mkdtempSync(join(tmpdir(),'fidelity-report-'))
  try {
    const core=join(root,'core.json')
    writeFileSync(core,JSON.stringify({
      criteriaProtocol:{producers:['recorded-authored-contract']},
      cases:[{id:'single-node',family:'flowchart',required:true,source:'flowchart TD\nA[Alpha]',features:[],provenance:'authored control',expected:{labels:['Alpha'],nodes:[{id:'A',label:'Alpha'}],edges:[]}}],
      targets:[{project:'mermaid-js/mermaid'},{project:'peer/renderer'}],
      toolVersions:[{tool:'mermaid-js/mermaid',version:'12.2.0',source:'reference-manifest'},{tool:'peer/renderer',version:'1.0.0',source:'peer-manifest'}],
      observations:[{suite:'mermaid-fidelity',surface:'native-public-api',runtime:'fixture',family:'flowchart',caseId:'single-node:native-admission',operation:'native-admission',format:'structured',mode:'independent-authored-criteria',status:'passed',metrics:{implementation:'mermaid-js/mermaid',authoredCase:'single-node',criterion:'native-admission'}}]
    }))
    const result=writeFidelityComparison({core,out:join(root,'report')})
    expect(result.comparison.reviewRequired.some(value=>value.caseId==='single-node'&&value.criterion==='browser-owned-ink:unclipped-authored-labels')).toBe(true)
    expect(result.comparison.results.find(value=>value.project==='peer/renderer')).toMatchObject({passed:0,unavailable:1,calibratedPopulation:1})
    expect(result.rows.find(value=>value.project==='peer/renderer')?.declaredCases).toBe(1)
  } finally {rmSync(root,{recursive:true,force:true})}
})
