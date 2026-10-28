import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('product browser baseline measures reviewed selections and retains other requested project boundaries', () => {
  const directory = mkdtempSync(join(tmpdir(), 'baseline-selection-'))
  try {
    const file = join(directory, 'consumer.ts')
    const backend = import.meta.resolve('trident/unified/baseline-browser.ts')
    const adapter = new URL('../unified/mermaid-baseline.ts', import.meta.url).href
    writeFileSync(file, `
      import { mock } from 'bun:test';
      const reviewed = ['mermaid-js/mermaid','adewale/agentic-mermaid','obsidianmd/pele'];
      const requested = Object.freeze([...reviewed,'orestesgaolin/mermaid','AlexanderGrooff/mermaid-ascii','lukilabs/beautiful-mermaid','dfadler/zombie-mermaid','Dicklesworthstone/frankenmermaid']);
      let calls = [];
      mock.module(${JSON.stringify(backend)}, () => ({runBaselineBrowserSuite: async options => {
        if (options.projects.some(project => !reviewed.includes(project))) throw Error('Unreviewed selection reached the bounded measurement API');
        calls.push(options.projects);
        return {id:'fixture',status:'passed',startedAt:'2026-10-27T00:00:00Z',finishedAt:'2026-10-27T00:00:01Z',observations:[],gaps:[],identities:options.projects.map(tool=>({tool,version:tool==='mermaid-js/mermaid'?'12.2.0':tool==='obsidianmd/pele'?'1.9.0':'0.4.2',entry:'fixture-public-entry'}))};
      }}));
      const {runMermaidBrowserBaseline} = await import(${JSON.stringify(adapter)});
      const options={root:'/unused',out:'/unused',rounds:5,profile:'full',communityProjects:requested};
      const mixed=await runMermaidBrowserBaseline(options);
      const unsupported=await runMermaidBrowserBaseline({...options,communityProjects:['Dicklesworthstone/frankenmermaid']});
      console.log(JSON.stringify({calls,requested,mixed,unsupported}));
    `)
    const child = spawnSync(process.execPath, ['run', file], { encoding: 'utf8' })
    if (child.status !== 0) throw Error(child.stderr)
    expect(child.status).toBe(0)
    const value = JSON.parse(child.stdout)
    expect(value.calls).toEqual([['mermaid-js/mermaid', 'adewale/agentic-mermaid', 'obsidianmd/pele']])
    expect(value.requested).toHaveLength(8)
    expect(value.mixed.observations).toHaveLength(5)
    expect(value.mixed.observations.every((row: any) => row.status === 'unsupported' && row.metrics.runtimeExecuted === false && row.samplesMs === undefined)).toBe(true)
    expect(value.mixed.toolVersions).toHaveLength(3)
    expect(value.unsupported.status).toBe('unsupported')
    expect(value.unsupported.observations[0].metrics.project).toBe('Dicklesworthstone/frankenmermaid')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
