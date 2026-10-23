"""One fixed baseline-only A/A calibration. Declare never launches workers."""
import argparse,hashlib,json,os,signal,subprocess,time
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent
ORIGINAL=Path('/workspace/pr449-frontier/c2-t-exact-ec72-cost/run-425-20261023/plan.json')
PLAN_SHA='2f8c6ec70e1b39618867094cd2a27d693c08561779af6dda0898d8eb1b28f136'
PROPOSAL=Path('/workspace/pr449-frontier/c2-t-exact-ec72-cost/repeatability-analysis/baseline-only-calibration.PROPOSAL.json')
PROPOSAL_SHA='e40ada958133bad3311e3c51e2210e19fa50c5dc53ce309d3343b16b8145ff1f'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
def save(p,value,exclusive=False):
    p=Path(p)
    if exclusive:
        with p.open('x')as f:json.dump(value,f,indent=2);f.write('\n')
    else:
        temp=p.with_suffix(p.suffix+'.pending');temp.write_text(json.dumps(value,indent=2)+'\n');temp.replace(p)
def validate_plan(p):
    assert p['protocol']=='baseline-repeatability-calibration-plan@1'
    assert p['reps']==4 and p['warmupPasses']==2 and p['rounds']==3
    assert p['policyBudgetSeconds']==480 and p['workerMaximumSeconds']==120
    assert len(p['jobs'])==24 and len(p['inputs'])==75
    expected=[(engine,policy,round_,role)for engine in ['native','elk']for policy in ['off','normal']for round_ in [1,2,3]for role in (['baseline-B','baseline-A']if round_==2 else ['baseline-A','baseline-B'])]
    assert [(j['engine'],j['policy'],j['round'],j['role'])for j in p['jobs']]==expected
    assert p['targets']=={'allRoundWholeAndStrataAA':1.02,'allInputMedianAA':1.05,'allTailRoundAA':1.05}
    assert sha(ORIGINAL)==PLAN_SHA and sha(PROPOSAL)==PROPOSAL_SHA
    original=load(ORIGINAL)
    assert p['inputs']==original['inputs']and p['artifact']==original['artifacts']['baseline']
    assert p['node']==original['node']and p['worker']==str(ROOT/'calibration-worker.mjs')
    assert p['source']=='ec72a06dcf57d1e429fab9672a9acbf794e22d9f'
    for j in p['jobs']:
        job=j['job'];assert job['protocol']=='baseline-repeatability-calibration-worker@1'
        assert job['role']==j['role']and job['policy']==j['policy']and job['inputs']==p['inputs']
        assert job['reps']==4 and job['warmupPasses']==2 and 'candidateSourceBinding'not in job
        assert job['artifactRoot']==p['artifact']['root']and job['artifactIdentity']==p['artifact']['identity']
        assert job['entry']==str(Path(p['artifact']['root'])/'dist/agent.js')
        assert job['layoutMode']==('agentic'if j['engine']=='native'else'elk')
        assert job['requiredFiles']==p['requiredFiles']
    for path,h in p['requiredFiles'].items():assert sha(path)==h,('required source',path)
def physical(art):
    root=Path(art['root']);files={};links={}
    for current,dirs,names in os.walk(root,followlinks=False):
        for name in dirs[:]+names:
            p=Path(current)/name;rel=str(p.relative_to(root))
            if p.is_symlink():
                links[rel]=os.readlink(p);assert p.resolve().is_relative_to(root.resolve())
                if name in dirs:dirs.remove(name)
            elif p.is_file():files[rel]=sha(p)
    assert files==art['files']and links==art['symlinks'],'physical artifact drift'
def declare(out):
    assert sha(ORIGINAL)==PLAN_SHA and sha(PROPOSAL)==PROPOSAL_SHA
    old=load(ORIGINAL);out=Path(out).resolve();out.mkdir(parents=True,exist_ok=False)
    worker=ROOT/'calibration-worker.mjs';art=old['artifacts']['baseline']
    physical(art)
    src=Path(old['config']['baseline']['sourceRoot'])/'src/layout/agentic-layered-core.ts'
    binding={**old['baselineSourceBinding'],'path':str(src)};assert sha(src)==binding['sha256']
    required={str(ORIGINAL):PLAN_SHA,str(PROPOSAL):PROPOSAL_SHA,str(src):sha(src),str(worker):sha(worker)}
    for p in ['calibrate.py','assess-calibration.py','test-calibration.py','worker-derivation.json','worker-derivation.patch']:
        q=ROOT/p;required[str(q)]=sha(q)
    fidelity=Path(old['config']['fidelity']);required[str(fidelity)]=sha(fidelity)
    inputs=old['inputs'];assert isinstance(inputs,list)and len(inputs)==75
    jobs=[]
    for engine in ['native','elk']:
        for policy in ['off','normal']:
            oracle_role='baseline'if engine=='native'else'baseline-elk'
            oracle=Path('/workspace/pr449-frontier/interval-median-subtraction/baseline-oracles')/f'{policy}-{oracle_role}.json'
            required[str(oracle)]=sha(oracle)
            for round_ in [1,2,3]:
                for role in (['baseline-B','baseline-A']if round_==2 else ['baseline-A','baseline-B']):
                    slot=f'{engine}-{policy}-{round_}-{role}'
                    job={'protocol':'baseline-repeatability-calibration-worker@1','reps':4,'warmupPasses':2,'inputs':inputs,'policy':policy,'role':role,'displayLabel':f'accepted-ec72-{engine}-{role}', 'entry':str(Path(art['root'])/'dist/agent.js'),'artifactIdentity':art['identity'],'artifactRoot':art['root'],'artifactSymlinks':art['symlinks'],'oracle':str(oracle),'oracleSha256':sha(oracle),'fidelity':str(fidelity),'executionEnvironment':{'AGENTIC_MERMAID_SCENE_ASSERTIONS':None,'NODE_OPTIONS':''},'baselineSourceBinding':binding,'layoutMode':'agentic'if engine=='native'else'elk'}
                    jobs.append({'slot':slot,'engine':engine,'policy':policy,'round':round_,'role':role,'job':job,'jobPath':str(out/(slot+'.job.json')),'resultPath':str(out/(slot+'.json'))})
    plan={'protocol':'baseline-repeatability-calibration-plan@1','declaredAtUtc':datetime.now(timezone.utc).isoformat(),'status':'declared-no-workers','out':str(out),'node':old['node'],'nodeSha256':sha(old['node']),'worker':str(worker),'source':'ec72a06dcf57d1e429fab9672a9acbf794e22d9f','artifact':art,'inputs':inputs,'reps':4,'warmupPasses':2,'rounds':3,'policyBudgetSeconds':480,'workerMaximumSeconds':120,'targets':{'allRoundWholeAndStrataAA':1.02,'allInputMedianAA':1.05,'allTailRoundAA':1.05},'proposal':{'path':str(PROPOSAL),'sha256':PROPOSAL_SHA},'requiredFiles':required,'jobs':jobs,'scope':'Baseline-only same-artifact repeatability, no candidate or C2-T repair; each engine/cache campaign separately bounded480seconds, all75 retained.'}
    for j in jobs:
        j['job']['requiredFiles']=required;save(j['jobPath'],j['job'],True);j['jobSha256']=sha(j['jobPath'])
    validate_plan(plan);save(out/'plan.json',plan,True);print(json.dumps({'plan':str(out/'plan.json'),'sha256':sha(out/'plan.json'),'slots':24,'launched':0}))
def run(plan_path):
    p=load(plan_path);validate_plan(p);assert sha(p['node'])==p['nodeSha256'];physical(p['artifact'])
    out=Path(p['out']);ledger=out/'execution.json'
    record={'protocol':'baseline-repeatability-calibration-execution@1','planSha256':sha(plan_path),'status':'running','policies':[],'slots':[{k:j[k]for k in ['slot','engine','policy','round','role','jobPath','jobSha256','resultPath']}|{'status':'unlaunched'}for j in p['jobs']]}
    save(ledger,record,True) # All24 slots durable before the first child; rerun refused.
    for engine in ['native','elk']:
        for policy in ['off','normal']:
            start=time.monotonic();campaign={'engine':engine,'policy':policy,'status':'running','elapsedSeconds':None,'withinBudget':None};record['policies'].append(campaign);save(ledger,record)
            for row,j in [(row,j)for row,j in zip(record['slots'],p['jobs'])if j['engine']==engine and j['policy']==policy]:
                remaining=480-(time.monotonic()-start)
                if remaining<=0:row['reason']='shared480deadline';save(ledger,record);continue
                opened=time.monotonic();row['status']='running';row['timeoutSeconds']=min(120,remaining);save(ledger,record)
                try:
                    validate_plan(p);physical(p['artifact']);assert sha(j['jobPath'])==j['jobSha256']
                    left=min(120-(time.monotonic()-opened),480-(time.monotonic()-start));assert left>0,'prelaunch deadline'
                    env={**os.environ,'NODE_OPTIONS':''};env.pop('AGENTIC_MERMAID_SCENE_ASSERTIONS',None)
                    argv=[p['node'],'--no-warnings',p['worker'],j['jobPath'],j['resultPath']];row['argv']=argv;save(ledger,record)
                    with open(out/(j['slot']+'.stdout'),'xb')as stdout,open(out/(j['slot']+'.stderr'),'xb')as stderr:
                        child=subprocess.Popen(argv,stdout=stdout,stderr=stderr,env=env,start_new_session=True)
                        try:row['exitCode']=child.wait(timeout=max(.001,min(120-(time.monotonic()-opened),480-(time.monotonic()-start))))
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid,signal.SIGKILL);child.wait();raise
                    row['resultSha256']=sha(j['resultPath']);d=load(j['resultPath']);assert row['exitCode']==0 and d['ok']and d['status']=='completed'
                    row['status']='ok'
                except Exception as e:row['status']='failed';row['failure']={'type':type(e).__name__,'message':str(e)}
                row['workerElapsedSeconds']=time.monotonic()-opened;save(ledger,record)
                row['workerElapsedSeconds']=time.monotonic()-opened;row['withinWorkerBudget']=row['workerElapsedSeconds']<=row['timeoutSeconds']
                if not row['withinWorkerBudget']:row['status']='failed';row['deadlineFailure']=True
                save(ledger,record)
                if time.monotonic()-opened>row['timeoutSeconds']:
                    row['status']='failed';row['deadlineFailure']=True;row['withinWorkerBudget']=False;row['workerElapsedSeconds']=time.monotonic()-opened;save(ledger,record)
            try:physical(p['artifact']);campaign['artifactStable']=True
            except Exception as e:campaign['artifactStable']=False;campaign['failure']=str(e)
            campaign['elapsedSeconds']=time.monotonic()-start;campaign['status']='completed';save(ledger,record)
            campaign['elapsedSeconds']=time.monotonic()-start;campaign['withinBudget']=campaign['elapsedSeconds']<=480;save(ledger,record)
            if time.monotonic()-start>480:
                campaign['elapsedSeconds']=time.monotonic()-start;campaign['withinBudget']=False;save(ledger,record)
    record['status']='completed';save(ledger,record);print(json.dumps({'execution':str(ledger),'okSlots':sum(x['status']=='ok'for x in record['slots'])}))
if __name__=='__main__':
    a=argparse.ArgumentParser();s=a.add_subparsers(dest='command',required=True);s.add_parser('declare').add_argument('--out',required=True);s.add_parser('run').add_argument('--plan',required=True);args=a.parse_args();declare(args.out)if args.command=='declare'else run(args.plan)
