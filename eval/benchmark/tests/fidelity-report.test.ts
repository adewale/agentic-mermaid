import { expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reviewFidelityCapabilities, writeFidelityComparison } from '../fidelity/report.ts'

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
      targets:[{project:'mermaid-js/mermaid'},{project:'Peer/Renderer'}],
      toolVersions:[{tool:'mermaid-js/mermaid',version:'12.2.0',source:'reference-manifest'},{tool:'Peer/Renderer',version:'1.0.0',source:'peer-manifest'}],
      observations:[{suite:'mermaid-fidelity',surface:'native-public-api',runtime:'fixture',family:'flowchart',caseId:'single-node:native-admission',operation:'native-admission',format:'structured',mode:'independent-authored-criteria',status:'passed',metrics:{implementation:'mermaid-js/mermaid',authoredCase:'single-node',criterion:'native-admission'}}]
    }))
    const result=writeFidelityComparison({core,out:join(root,'report')})
    expect(result.comparison.reviewRequired.some(value=>value.caseId==='single-node'&&value.criterion==='browser-owned-ink:unclipped-authored-labels')).toBe(true)
    expect(result.comparison.results.find(value=>value.project==='Peer/Renderer')).toMatchObject({passed:0,unavailable:1,calibratedPopulation:1})
    expect(result.rows.find(value=>value.project==='Peer/Renderer')?.declaredCases).toBe(1)
    expect(result.rows.find(value=>value.project==='Peer/Renderer')?.version).toBe('1.0.0')
    const peerCell=result.rows.find(value=>value.project==='Peer/Renderer')!.cells[2]!
    expect(peerCell.referenceUnqualified).toBeGreaterThanOrEqual(0)
    expect(peerCell.rawRecorded).toBe(0)
    expect(peerCell.rawMissing).toBe(peerCell.rawDenominator)
    expect(result.comparison.results.find(value=>value.project==='Peer/Renderer')?.cases[0]?.recordedCriteria).toBe(0)
  } finally {rmSync(root,{recursive:true,force:true})}
})

// Preserve real output data while withholding an unsupported API claim.
test('a matching default font cannot earn configured font credit from an export name', () => {
  const raw: any = { operation: 'computed-authored-font-size', status: 'passed', caseId: 'font-reset', metrics: { implementation: 'peer/beautiful', authoredCase: 'font-reset', actual: '[14,14]' } }
  const reviewed = reviewFidelityCapabilities([raw], [{ project: 'peer/beautiful', kind: 'beautiful' }])
  expect(raw.status).toBe('passed')
  expect(reviewed.observations[0]).toMatchObject({ status: 'blocked', metrics: { actual: '[14,14]', rawObservedStatus: 'passed' } })
  expect(reviewed.reviews[0]).toMatchObject({ rawStatus: 'passed', status: 'blocked', rawActual: '[14,14]' })
  const core = { ...raw, metrics: { ...raw.metrics, implementation: 'adewale/agentic-mermaid' } }
  expect(reviewFidelityCapabilities([core], [{ project: 'adewale/agentic-mermaid', kind: 'beautiful' }]).observations[0]?.status).toBe('passed')
})
