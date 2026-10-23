"""Independent fixed A/A arithmetic; wall only, full raw records retained."""
import argparse,hashlib,json,math,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
TAILS=['cyclic-labelled-'+x for x in ['11','15','19','9','13','18-cuts']]
def finite(x):return isinstance(x,(int,float))and not isinstance(x,bool)and math.isfinite(x)and x>=0
def healthy(x,bound):return x is not None and finite(x)and 1/bound<=x<=bound
def paired(values):return values[1]/values[0]if values[0]>0 else None
def validate_calls(d,j):
    assert d['protocol']=='baseline-repeatability-calibration-worker@1'and d['status']=='completed'and d['ok']is True
    for k in ['policy','role','artifactIdentity','layoutMode','baselineSourceBinding']:assert d[k]==j[k],k
    assert 'candidateSourceBinding'not in d
    assert d['node']=='v24.19.0'and d['execArgv']==['--no-warnings']
    assert d['executionEnvironment']=={'AGENTIC_MERMAID_SCENE_ASSERTIONS':None,'NODE_OPTIONS':''}
    assert d['runtimeLinksVerified']=={'before':True,'after':True}
    assert d['oracleSha256']==j['oracleSha256']
    assert len(d['warmupCalls'])==150 and len(d['calls'])==300
    expected=[(rep,x)for rep in [-2,-1,0,1,2,3]for x in j['inputs']]
    records=d['warmupCalls']+d['calls']
    for c,(rep,x)in zip(records,expected):
        assert c['rep']==rep and c['stage']==('prewarm'if rep<0 else'timed')
        assert c['occurrenceId']==x['occurrenceId']and c['stratum']==x['stratum']and c['originalId']==x['id']
        assert c['oracleMatches']is True and c['callbackCalls']==1
        for k in ['wallMs','cpuUserMicros','cpuSystemMicros']:assert finite(c[k]),k
    return records
def assess_statistics(data,inputs):
    rows=[];failures=[];input_rows=[]
    for engine in ['native','elk']:
        for policy in ['off','normal']:
            for cohort in ['whole75','H27','D48']:
                for round_ in [1,2,3]:
                    ds=[data.get((engine,policy,round_,role))for role in ['baseline-A','baseline-B']]
                    sums=[sum(c['wallMs']for c in d['calls']if cohort=='whole75'or c['stratum']==cohort)if d else None for d in ds]
                    ratio=paired(sums)if all(x is not None for x in sums)else None
                    row={'engine':engine,'policy':policy,'round':round_,'cohort':cohort,'apiWallSums':sums,'BOverA':ratio,'qualified':healthy(ratio,1.02)};rows.append(row)
                    if not row['qualified']:failures.append({'kind':'whole-or-stratum-control','row':row})
            for x in inputs:
                ratios=[];details=[]
                for round_ in [1,2,3]:
                    ds=[data.get((engine,policy,round_,role))for role in ['baseline-A','baseline-B']]
                    samples=[[c['wallMs']for c in d['calls']if c['occurrenceId']==x['occurrenceId']]if d else None for d in ds]
                    ratio=paired([statistics.mean(s)for s in samples])if all(s is not None and len(s)==4 for s in samples)else None
                    ratios.append(ratio);details.append({'round':round_,'rawWallSamples':samples,'BOverA':ratio})
                median=statistics.median(ratios)if all(v is not None for v in ratios)else None
                is_tail=x['id']in ['flowchart:'+t for t in TAILS]
                row={'engine':engine,'policy':policy,'occurrenceId':x['occurrenceId'],'id':x['id'],'rounds':details,'medianPairedRatio':median,'medianQualified':healthy(median,1.05),'cyclicTail':is_tail,'allTailRoundsQualified':all(healthy(v,1.05)for v in ratios)if is_tail else None};input_rows.append(row)
                if not row['medianQualified']:failures.append({'kind':'input-median-control','engine':engine,'policy':policy,'occurrenceId':x['occurrenceId']})
                if is_tail and not row['allTailRoundsQualified']:failures.append({'kind':'tail-every-round-control','engine':engine,'policy':policy,'occurrenceId':x['occurrenceId']})
    return {'cohorts':rows,'inputs':input_rows,'failures':failures,'controlQualified':not failures}
def assess(plan_path,out):
    import importlib.util
    spec=importlib.util.spec_from_file_location('calibration_controller',ROOT/'calibrate.py');controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
    p=load(plan_path);controller.validate_plan(p);controller.physical(p['artifact']);assert sha(p['node'])==p['nodeSha256']
    execution_path=Path(p['out'])/'execution.json';e=load(execution_path);errors=[];data={};bindings={str(plan_path):sha(plan_path),str(execution_path):sha(execution_path)};payloads=set()
    assert e['protocol']=='baseline-repeatability-calibration-execution@1'and e['planSha256']==sha(plan_path)
    if e['status']!='completed':errors.append({'kind':'execution-incomplete'})
    if len(e['slots'])!=24:errors.append({'kind':'slot-population'})
    for j in p['jobs']:
        rs=[r for r in e['slots']if r['slot']==j['slot']]
        if len(rs)!=1:errors.append({'kind':'slot-binding','slot':j['slot']});continue
        r=rs[0]
        try:
            assert r['status']=='ok'and r['withinWorkerBudget']is True and r['exitCode']==0
            assert finite(r['workerElapsedSeconds'])and r['workerElapsedSeconds']<=r['timeoutSeconds']<=120
            assert sha(j['jobPath'])==j['jobSha256']and r['jobSha256']==j['jobSha256']
            job=load(j['jobPath']);assert job==j['job']
            assert r['argv']==[p['node'],'--no-warnings',p['worker'],j['jobPath'],j['resultPath']]
            assert sha(j['resultPath'])==r['resultSha256'];d=load(j['resultPath']);records=validate_calls(d,job)
            oracle=load(job['oracle']);assert sha(job['oracle'])==job['oracleSha256']and oracle['layoutMode']==job['layoutMode']
            expected={x['occurrenceId']:x for x in oracle['occurrences']}
            for c in records:
                o=expected[c['occurrenceId']];assert c['finalSourceSha256']==o['finalSourceSha256']and o['independentRequiredChecksPassed']is True
                for k in ['svg','receipt']:
                    v=c[k];assert v['sha256']==o[k]['sha256']and v['bytes']==o[k]['bytes']
                    if v['path']not in payloads:assert sha(v['path'])==v['sha256']and Path(v['path']).stat().st_size==v['bytes'];payloads.add(v['path'])
            journal=Path(j['resultPath']+'.calls.jsonl');assert [json.loads(s)for s in journal.read_text().splitlines()]==records
            for path in [j['jobPath'],j['resultPath'],str(journal)]:bindings[path]=sha(path)
            data[j['engine'],j['policy'],j['round'],j['role']]=d
        except Exception as error:errors.append({'kind':'worker-invalid-or-unavailable','slot':j['slot'],'error':str(error),'observedStatus':r.get('status')})
    for engine in ['native','elk']:
        for policy in ['off','normal']:
            c=[r for r in e['policies']if r['engine']==engine and r['policy']==policy]
            if len(c)!=1 or c[0].get('status')!='completed'or c[0].get('withinBudget')is not True or c[0].get('artifactStable')is not True or not finite(c[0].get('elapsedSeconds'))or c[0]['elapsedSeconds']>480:errors.append({'kind':'policy-completion-or-deadline','engine':engine,'policy':policy,'observed':c})
    result=assess_statistics(data,p['inputs']);result.update({'protocol':'baseline-repeatability-calibration-assessment@1','planSha256':sha(plan_path),'verifiedWorkers':len(data),'completionErrors':errors,'retainedSlotOutcomes':e['slots'],'qualified':not errors and result['controlQualified'],'bindings':bindings,'interpretation':'Baseline-only repeatability. Never candidate gain, C2-T rescue, CPU substitution or AA normalization.'})
    with Path(out).open('x')as f:json.dump(result,f,indent=2);f.write('\n')
    print(json.dumps({'qualified':result['qualified'],'workers':len(data),'completionErrors':len(errors),'controlFailures':len(result['failures'])}))
    return result
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--plan',required=True);a.add_argument('--out',required=True);s=a.parse_args();assess(s.plan,s.out)
