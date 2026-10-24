#!/usr/bin/env python3
"""Render benchmark evidence; no benchmark execution, external assets or scores.

python3 charts.py --run /path/to/unified --prs /path/to/prs --out /tmp/charts
Requires matplotlib and numpy. Raw evidence remains authoritative.
"""
from __future__ import annotations
import argparse
import base64
from collections import defaultdict
from html import escape
import json
import math
from pathlib import Path
from statistics import median
from textwrap import fill


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load(path, default=None):
    return json.loads(path.read_text()) if path and path.is_file() else default


def find(root, name):
    return next((path for path in (root / name, root / 'community' / name, root / 'suites/community' / name) if path.is_file()), None)


def tool(row):
    return str(row.get('metrics', {}).get('implementation', 'agentic-mermaid'))


def aggregate(rows):
    """Repeated rounds are one observed check, passed only when every row passes."""
    checks = defaultdict(list)
    for row in rows:
        if row.get('status') == 'not-applicable':
            continue
        key = tuple(row.get(k) for k in ('caseId', 'operation', 'format', 'mode'))
        checks[key].append(row)
    return sum(all(row.get('status') == 'passed' for row in group) for group in checks.values()), len(checks)


class Figures:
    def __init__(self, out):
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        self.plt = plt
        plt.rcParams.update({'font.size': 9, 'axes.spines.top': False, 'axes.spines.right': False, 'svg.fonttype': 'none', 'figure.dpi': 120})
        self.out, self.items, self.gaps = out, [], []
        out.mkdir(parents=True, exist_ok=True)

    def save(self, figure, name, title, note, rows):
        figure.suptitle(title, fontsize=13)
        figure.text(.01, .012, fill(note, 145), fontsize=7, va='bottom')
        figure.tight_layout(rect=(0, .09, 1, .95))
        for extension in ('svg', 'png', 'pdf'):
            figure.savefig(self.out / f'{name}.{extension}', bbox_inches='tight')
        self.plt.close(figure)
        self.items.append(dict(name=name, title=title, note=note, rows=rows))

    def coverage(self, observations):
        import numpy as np
        rows = [r for r in observations if r.get('suite') == 'invocation' and r.get('family') not in ('*', None)]
        families = sorted({r['family'] for r in rows})
        surfaces = sorted({(r['surface'], r.get('runtime', 'unrecorded')) for r in rows})
        if not rows:
            self.gaps.append('Invocation heatmap: no family-scoped invocation observations.'); return
        matrix = np.full((len(families), len(surfaces)), np.nan)
        data = []
        for y, family in enumerate(families):
            for x, (surface, runtime) in enumerate(surfaces):
                passed, total = aggregate([r for r in rows if r['family'] == family and r['surface'] == surface and r.get('runtime', 'unrecorded') == runtime])
                if total: matrix[y, x] = passed / total
                data.append(dict(family=family, surface=surface, runtime=runtime, passed=passed, observedChecks=total))
        figure, ax = self.plt.subplots(figsize=(max(8, len(surfaces) * .7), max(5, len(families) * .3)))
        image = ax.imshow(matrix, vmin=0, vmax=1, aspect='auto', cmap='YlGnBu')
        ax.set_xticks(range(len(surfaces)), [surface+'\n'+runtime for surface,runtime in surfaces], rotation=45, ha='right')
        ax.set_yticks(range(len(families)), families)
        for cell in data:
            x, y = surfaces.index((cell['surface'],cell['runtime'])), families.index(cell['family'])
            ax.text(x, y, f"{cell['passed']}/{cell['observedChecks']}" if cell['observedChecks'] else '—', ha='center', va='center', fontsize=7, color='white' if matrix[y,x] > .7 else 'black')
        figure.colorbar(image, ax=ax, label='Qualified / observed checks')
        self.save(figure, 'invocation-coverage', 'Agentic Mermaid: observed family × invocation checks', 'Counts deduplicate repeated rounds; every observed round must pass. Missing cells are unmeasured. This is not exhaustive feature or operation coverage.', data)

    def rank_bars(self, ranks):
        groups = defaultdict(list)
        for row in ranks: groups[(row.get('surface'), row.get('output'))].append(row)
        for index, ((surface, output), group) in enumerate(sorted(groups.items())):
            valid = sorted([r for r in group if r.get('qualified') and finite(r.get('medianMs')) and r['medianMs'] > 0], key=lambda r: r['medianMs'])
            if not valid:
                self.gaps.append(f'{surface}/{output}: no fully qualified same-core rank.'); continue
            figure, ax = self.plt.subplots(figsize=(9, max(3.4, len(valid) * .4)))
            ys = range(len(valid))
            values = [r['medianMs'] for r in valid]
            ranges = [[v for v in r.get('perRoundMs', []) if finite(v)] for r in valid]
            ax.barh(list(ys), values, color=['#147d92' if 'agentic' in r['implementation'] else '#718ca1' for r in valid])
            ax.errorbar(values, list(ys), xerr=[[v-min(rs) if rs else 0 for v,rs in zip(values,ranges)], [max(rs)-v if rs else 0 for v,rs in zip(values,ranges)]], fmt='none', color='#283641', capsize=3)
            ax.set_yticks(list(ys), [r['implementation'] for r in valid]); ax.invert_yaxis()
            ax.set_xscale('log'); ax.set_xlabel('Matched fixed-core portfolio, ms (log scale; lower is faster)')
            self.save(figure, f'community-rank-{index+1}', f'Community same-core: {surface} / {output}', 'Only every-case/every-round qualified results. Whiskers are observed round ranges, not confidence intervals. API, browser, native and CLI boundaries are separate.', group)

    def svg_scatter(self, ranks, observations, enrolled_cases):
        enrolled=len({row['family'] for row in enrolled_cases})
        enrolled_ids={row['id'] for row in enrolled_cases}
        if not enrolled_ids:
            self.gaps.append('SVG breadth: enrolled feature inputs are unavailable; no breadth plot manufactured.');return
        groups = defaultdict(list)
        for rank in ranks:
            if rank.get('output') == 'svg' and rank.get('qualified') and finite(rank.get('medianMs')) and rank['medianMs'] > 0:
                groups[rank['surface']].append(rank)
        for index, (surface, group) in enumerate(sorted(groups.items())):
            figure, ax = self.plt.subplots(figsize=(9,5))
            data=[]
            for rank in group:
                name=rank['implementation']
                attempts=[r for r in observations if tool(r)==name and r.get('surface')==surface and r.get('format')=='svg' and r.get('caseId') in enrolled_ids and r.get('family')!='*']
                families={r['family'] for r in attempts if r.get('status')=='passed'}
                deliveries=[r.get('metrics',{}).get('gzipBytes') for r in observations if tool(r)==name and r.get('operation')=='delivery' and r.get('status')=='passed'] if surface.startswith('browser:') else []
                gzip=median([v for v in deliveries if finite(v)]) if any(finite(v) for v in deliveries) else None
                size=35 if gzip is None else 35+min(300, math.log2(1+gzip/1024)*20)
                ax.scatter(rank['medianMs'],len(families),s=size,alpha=.7,color='#147d92' if 'agentic' in name else '#718ca1')
                ax.annotate(name,(rank['medianMs'],len(families)),xytext=(4,4),textcoords='offset points',fontsize=7)
                data.append(dict(implementation=name,corePortfolioMs=rank['medianMs'],familiesWithQualifiedFeatureAttempt=len(families),enrolledFamilies=enrolled,observedGzipBytes=gzip))
            ax.set_xscale('log');ax.set_xlabel('Same-core qualified SVG portfolio, ms (log scale)')
            ax.set_ylabel('Families with ≥1 qualified feature-corpus attempt');ax.set_ylim(-.5,max(enrolled or 0,*(d['familiesWithQualifiedFeatureAttempt'] for d in data))+1)
            self.save(figure,f'svg-cost-coverage-{index+1}',f'SVG cost and observed breadth: {surface}','Breadth means at least one passing feature attempt, not complete family fidelity. Browser marker area varies with observed gzip payload; unknown payload uses a small marker. No combined score.',data)

    def diagnostics(self, observations):
        # These are diagnostic views, not matched-work efficiency ranks. Name
        # each source scope and runtime before grouping similarly named bytes.
        groups=defaultdict(dict)
        def admit(row, title, runtime, scope, metric, value, detail):
            if not finite(value):return
            metrics=row.get('metrics',{})
            identity=(tool(row),row.get('surface'),row.get('format'),metrics.get('round'),metrics.get('workerAttempt'))
            entry=dict(implementation=tool(row),surface=row.get('surface'),runtime=runtime,scope=scope,metric=metric,round=metrics.get('round'),workerAttempt=metrics.get('workerAttempt'),valueBytes=value,MiB=value/1024/1024,detail=detail,sourceStatus=row.get('status'),requests=metrics.get('requests')if scope!='invocation:initial-navigation'else None,completePortfolioRequests=metrics.get('requests'),driverRuntime=row.get('runtime'))
            prior=groups[(title,runtime,scope,metric)].get(identity)
            if prior is None or value>prior['valueBytes']:groups[(title,runtime,scope,metric)][identity]=entry
        for row in observations:
            metrics=row.get('metrics',{});operation=row.get('operation');suite=row.get('suite')
            if row.get('status')=='passed':
                if suite=='community-browser' and operation=='delivery':
                    admit(row,'Community browser delivery','chromium','community:through-attempted-portfolio','gzipBytes',metrics.get('gzipBytes'),'Observed JS/WASM/font request closure after this attempted community portfolio. Different accepted work may trigger different lazy requests.')
                if suite=='invocation' and operation=='download-closure':
                    admit(row,'Invocation browser initial delivery','chromium','invocation:initial-navigation','initialGzipBytes',metrics.get('initialGzipBytes'),'Initial navigation request closure; worker/API first handshakes and later family-specific requests may occur afterwards.')
                    admit(row,'Invocation browser portfolio delivery','chromium','invocation:through-family-portfolio','gzipBytes',metrics.get('gzipBytes'),'Observed request closure through this invocation family portfolio; includes initial assets. Request counts refer to the complete portfolio closure.')
                if suite=='community-browser' and operation=='memory':
                    admit(row,'Community browser V8 heap','chromium-v8','community:forced-GC-after-attempted-portfolio','jsHeapUsedBytes',metrics.get('jsHeapUsedBytes'),'Fresh realm and forced GC. V8 heap excludes native/WASM/process memory; not a matched-success memory-efficiency rank.')
                if suite=='invocation' and operation=='heap-checkpoint':
                    admit(row,'Invocation browser document V8 heap','chromium-v8','invocation:forced-GC-document-after-portfolio','usedSize',metrics.get('usedSize'),'Main-document V8 heap after forced GC; excludes worker/native/GPU/process memory. This is distinct from the community API portfolio.')
                if suite=='invocation' and operation=='memory-checkpoint':
                    for metric in ('rssBytes','heapUsedBytes','peakRssBytes'):
                        admit(row,'Invocation process memory',row.get('runtime','unrecorded'),'invocation:after-all-enrolled-operations',metric,metrics.get(metric),str(metrics.get('scope','After all enrolled operations; includes runtime/harness/qualification; not allocation or leak proof.')))
            if suite=='community':
                for metric in ('peakProcessRssBytes','endRssBytes'):
                    admit(row,'Community worker process memory',row.get('runtime','unrecorded'),'community:worker-'+str(row.get('format')),metric,metrics.get(metric),'Runtime, qualification and caches included. Every output/worker attempt stays distinct; process scope can contain failed render attempts.')
        for index,((title,runtime,scope,metric),entries) in enumerate(sorted(groups.items())):
            rows=sorted(entries.values(),key=lambda d:(d['implementation'],d['surface'],str(d['round']),str(d['workerAttempt'])))
            if not rows:continue
            figure,ax=self.plt.subplots(figsize=(10,max(3.5,min(24,len(rows)*.23))))
            labels=[f"{d['implementation']} / {d['surface']} / r{d['round']}"+(f" a{d['workerAttempt']}"if d['workerAttempt']is not None else '')for d in rows]
            ax.scatter([d['MiB']for d in rows],range(len(rows)),color='#718ca1')
            ax.set_yticks(range(len(rows)),labels,fontsize=6);ax.invert_yaxis();ax.set_xlabel('MiB; alphabetical scoped diagnostic view, not an efficiency rank')
            note=rows[0]['detail']+' Initial and portfolio payloads, V8 heaps and process RSS are separate scopes. Raw bytes and request counts are retained in evidence rows.'
            self.save(figure,f'diagnostic-{index+1}',f'{title}: {runtime} / {metric}',note,rows)

    def prs(self, campaign):
        if not campaign:
            self.gaps.append('PR comparison: no pr-ranks.json supplied.');return
        ranks=campaign.get('ranks',[])
        metrics=sorted({metric for rank in ranks for metric in rank.get('metrics',{})})
        if not metrics:
            self.gaps.append('PR campaign has no completed metric rows.');return
        for cache in ('1','0'):
            for offset in range(0,len(metrics),4):
                selected=metrics[offset:offset+4]
                figure,axes=self.plt.subplots(len(selected),1,figsize=(10,max(4,len(selected)*max(2.4,len(ranks)*.25))),squeeze=False)
                data=[]
                for ax,metric in zip(axes[:,0],selected):
                    for y,rank in enumerate(ranks):
                        record=rank.get('metricsByCache',{}).get(cache,{}).get(metric) or (rank.get('metrics',{}).get(metric) if cache=='1' else None)
                        if not record:continue
                        label=rank.get('label',rank['id'])
                        integration=rank.get('integration','unknown')
                        exploratory=integration in ('conflicting-head','branch-base')
                        tags=[integration]
                        if rank.get('draft'):tags.append('draft')
                        if rank.get('sourceEvidence') not in (None,rank['id']):tags.append('source = '+rank['sourceEvidence'])
                        ratio=record.get('pairedRatio');band=record.get('decisionBand',{})
                        if finite(ratio):
                            color='#aa5b27' if exploratory else '#147d92'
                            if finite(band.get('low')) and finite(band.get('high')):ax.plot([band['low'],band['high']],[y,y],color='#cbd2d8',linewidth=7,zorder=1)
                            ax.scatter([ratio],[y],color=color,marker='x' if exploratory else 'o',zorder=2)
                        else:ax.text(1,y,'unavailable',va='center',fontsize=7)
                        data.append(dict(candidate=label,metric=metric,cache=cache,integration=integration,draft=bool(rank.get('draft')),sourceEvidence=rank.get('sourceEvidence'),pairedRatio=ratio,decisionBand=band,classification=record.get('classification')))
                    ax.axvline(1,color='#555',linestyle='--',linewidth=.8)
                    labels=[]
                    for rank in ranks:
                        tags=[rank.get('integration','unknown')]
                        if rank.get('draft'):tags.append('draft')
                        if rank.get('sourceEvidence') not in (None,rank['id']):tags.append('source = '+rank['sourceEvidence'])
                        labels.append(rank.get('label',rank['id'])+' ['+', '.join(tags)+']')
                    ax.set_yticks(range(len(ranks)),labels,fontsize=7);ax.invert_yaxis();ax.set_title(metric,loc='left',fontsize=10)
                    ax.set_xlabel('Candidate / geometric mean of fresh before/after control; lower is faster')
                self.save(figure,f'prs-cache-{cache}-{offset//4+1}',f'PR paired costs; result-cache flag {cache}','Gray segments are per-candidate observed control decision bands (includes practical floor), not confidence intervals. Orange × = head/own-base exploratory; source-equal rows reuse identified evidence. Other caches retain artifact defaults.',data)

    def reference(self, observations):
        rows=[r for r in observations if r.get('suite')=='pinned-reference-score' and r.get('operation')=='parse-and-score']
        engines=sorted({tool(r)for r in rows});rounds=sorted({r.get('metrics',{}).get('round')for r in rows})
        if not rows:
            self.gaps.append('Pinned Mermaid portable score: no same-case parser observations.');return
        ids={r['caseId']for r in rows}
        shared={case for case in ids if all(any(r['caseId']==case and tool(r)==engine and r.get('metrics',{}).get('round')==round and r.get('status')=='passed' and r.get('samplesMs') for r in rows)for engine in engines for round in rounds)}
        data=[]
        for engine in engines:
            own=[r for r in rows if tool(r)==engine]
            passed=sum(r.get('metrics',{}).get('passed',0)for r in own);total=sum(r.get('metrics',{}).get('criteria',0)for r in own)
            portfolios=[sum(median(r['samplesMs'])for r in own if r.get('metrics',{}).get('round')==round and r['caseId']in shared)for round in rounds]if shared else []
            data.append(dict(parser=engine,referenceVersions=sorted({str(r.get('metrics',{}).get('referenceVersion'))for r in own}),passedPortableCriteria=passed,evaluatedPortableCriteria=total,sharedCases=len(shared),sharedSuccessPortfolioMs=median(portfolios)if portfolios else None,observedPortfolioMs=portfolios,unscoredCriteria=sum(r.get('metrics',{}).get('unscoredCriteria',0)for r in own)))
        figure,axes=self.plt.subplots(1,2,figsize=(10,4))
        for index,d in enumerate(data):
            if d['evaluatedPortableCriteria']:
                axes[0].bar(index,100*d['passedPortableCriteria']/d['evaluatedPortableCriteria'],color='#147d92')
                axes[0].text(index,1,f"{d['passedPortableCriteria']}/{d['evaluatedPortableCriteria']}",ha='center',va='bottom',rotation=90,color='white')
            if d['sharedSuccessPortfolioMs']is not None:axes[1].bar(index,d['sharedSuccessPortfolioMs'],color='#718ca1')
        for ax in axes:ax.set_xticks(range(len(engines)),engines)
        axes[0].set_ylim(0,100);axes[0].set_ylabel('Passed / evaluated portable criteria, %')
        axes[1].set_ylabel(f'Public parse portfolio, ms; {len(shared)} shared-qualified cases')
        self.save(figure,'pinned-parser-score','Pinned Mermaid same-case portable parser comparison','Same independently expected criteria; generated layout counts and other nonportable criteria are explicitly unscored. Shared-success cost requires every parser and every round to pass. Historical imported tests and native-operation suites remain separate.',data)

    def owning_tests(self, report):
        data=[]
        for suite in report.get('suites',[]):
            score=next((r for r in (suite.get('result')or{}).get('observations',[])if r.get('operation')=='owning-tests'),None)
            if score:
                metrics=score.get('metrics',{})
                data.append(dict(suite=suite['id'],passed=metrics.get('passed'),failed=metrics.get('failed'),skipped=metrics.get('skipped'),wallSeconds=suite.get('elapsedMs',0)/1000,status=suite.get('status'),countsAvailable=any(finite(metrics.get(k))for k in ('passed','failed','skipped'))))
        if not data:
            self.gaps.append('Owning tests: no fresh test score observations.');return
        figure,axes=self.plt.subplots(1,2,figsize=(12,max(4,len(data)*.3)),sharey=True)
        names=[d['suite']for d in data];left=[0]*len(data)
        for status,color in (('passed','#147d92'),('failed','#b34742'),('skipped','#b9bec2')):
            values=[d[status]if finite(d[status])else 0 for d in data];axes[0].barh(names,values,left=left,label=status,color=color);left=[a+b for a,b in zip(left,values)]
        for y,d in enumerate(data):
            if not d['countsAvailable']:axes[0].text(0,y,'counts unavailable',va='center',fontsize=7)
        axes[0].invert_yaxis();axes[0].set_xlabel('Fresh owning test counts');axes[0].legend(fontsize=7)
        axes[1].barh(names,[d['wallSeconds']for d in data],color='#718ca1');axes[1].set_xlabel('Complete process wall time, seconds')
        self.save(figure,'owning-test-score-time','Owning suite counts and process wall time','Groups exercise different behavior and case counts: no cross-suite speed rank. Wall time includes initialization, assertions, reference IPC and instrumentation; it is not parser API latency.',data)

    def html(self, report, campaign):
        reduced=dict(run={k:report.get(k)for k in ('status','startedAt','finishedAt','profile','rounds','driverRevision','targetRevision')},suitePins={suite['id']:suite['pin']for suite in report.get('suites',[])if suite.get('pin')},prCampaign={k:campaign.get(k)for k in ('frozenAt','main','units','protocols')}if campaign else None,figures=self.items,gaps=self.gaps)
        (self.out/'chart-data.json').write_text(json.dumps(reduced,indent=2,allow_nan=False)+'\n')
        cards=[]
        for item in self.items:
            svg=(self.out/(item['name']+'.svg')).read_bytes()
            src='data:image/svg+xml;base64,'+base64.b64encode(svg).decode()
            rows=item['rows'];keys=list(dict.fromkeys(key for row in rows for key in row))
            table='<table><thead><tr>'+''.join('<th>'+escape(str(key))+'</th>'for key in keys)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+escape(json.dumps(row.get(key),ensure_ascii=False) if isinstance(row.get(key),(dict,list))else str(row.get(key,'')))+'</td>'for key in keys)+'</tr>'for row in rows)+'</tbody></table>'
            cards.append('<section><h2>'+escape(item['title'])+'</h2><p>'+escape(item['note'])+'</p><img alt="'+escape(item['title'])+'" src="'+src+'"><p>'+ ' · '.join('<a href="'+item['name']+'.'+extension+'">'+extension.upper()+'</a>'for extension in ('svg','png','pdf'))+'</p><details><summary>Reduced evidence rows</summary>'+table+'</details></section>')
        metadata=escape(json.dumps(reduced['run'],indent=2))
        gaps=''.join('<li>'+escape(gap)+'</li>'for gap in self.gaps)
        embedded=json.dumps(reduced,allow_nan=False).replace('<','\\u003c')
        html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agentic Mermaid benchmark evidence</title><style>body{font:15px system-ui;max-width:1200px;margin:auto;padding:24px;color:#20313e;background:#f4f7f8}section{background:white;padding:20px;margin:24px 0;border-radius:10px}img{max-width:100%;height:auto}table{border-collapse:collapse;font-size:12px;display:block;overflow:auto}td,th{padding:7px;border:1px solid #ddd;text-align:left;max-width:400px;overflow-wrap:anywhere}input{padding:9px;width:90%}pre{white-space:pre-wrap}a{color:#126c85}</style><h1>Benchmark evidence</h1><p>Separate work, clocks and qualification scopes. Missing and failed capabilities are never free wins. No weighted overall score or radar ranking is invented.</p><details><summary>Run identity</summary><pre>'''+metadata+'''</pre></details><label>Filter charts and evidence <input id="filter" type="search" placeholder="e.g. browser, parser, PR, memory"></label>'''+''.join(cards)+'<h2>Missing evidence</h2><ul>'+gaps+'</ul><script type="application/json" id="benchmark-data">'+embedded+'''</script><script>document.querySelector('#filter').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('section').forEach(s=>s.hidden=!s.textContent.toLowerCase().includes(q))});</script></html>'''
        (self.out/'index.html').write_text(html)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',type=Path,required=True);parser.add_argument('--prs',type=Path);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    report=load(args.run/'report.json')
    if not report:parser.error('--run must contain report.json')
    scores=load(find(args.run,'community-ranks.json'),{})
    community=load(find(args.run,'community-result.json'),{})
    campaign=load(args.prs/'pr-ranks.json')if args.prs else None
    observations=[row for suite in report.get('suites',[])for row in (suite.get('result')or{}).get('observations',[])]
    if community.get('observations'):
        observations=[row for row in observations if row.get('suite')not in ('community','community-browser')]+community['observations']
    inputs=load(find(args.run,'community-inputs.json'),{})
    enrolled=[row for row in inputs.get('workloads',[])if 'core-graph-batch'not in row.get('features',[])]
    figures=Figures(args.out)
    figures.coverage(observations);figures.rank_bars(scores.get('ranks',[]));figures.svg_scatter(scores.get('ranks',[]),observations,enrolled)
    figures.diagnostics(observations);figures.prs(campaign);figures.reference(observations);figures.owning_tests(report);figures.html(report,campaign)
    print(json.dumps(dict(figures=len(figures.items),out=str(args.out.resolve()),gaps=figures.gaps),indent=2))


if __name__=='__main__':main()
