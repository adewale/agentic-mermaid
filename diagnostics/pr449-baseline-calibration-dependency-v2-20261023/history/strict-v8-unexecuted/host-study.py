"""NEW portable baseline-only protocol. No renderer import during preparation.

Existing worker/statistical formulas are copied byte-for-byte. Explicitly
recorded controller path substitutions happen before the new declaration.
"""
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
NODE_SHA = 'bc17c508ffeed0ec622934f9b7fa72f8e78da65350e63c3eceb56fa688aa5e12'
SOURCE = 'ec72a06dcf57d1e429fab9672a9acbf794e22d9f'
assert not sys.flags.optimize, 'Unoptimized Python required'
load = lambda p: json.loads(Path(p).read_text())
def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for b in iter(lambda: stream.read(1024*1024), b''):
            h.update(b)
    return h.hexdigest()
def save(path, value, exclusive=False):
    path = Path(path)
    if exclusive:
        with path.open('x') as f:
            json.dump(value, f, indent=2)
            f.write('\n')
    else:
        temporary = path.with_name(path.name+'.pending')
        temporary.write_text(json.dumps(value,indent=2)+'\n')
        temporary.replace(path)
def verify_sources():
    freeze = load(ROOT/'SOURCE-FREEZE.json')
    for relative, digest in freeze['files'].items():
        if sha(ROOT/relative)!=digest:
            raise ValueError('Protocol source drift: '+relative)
    return freeze
def census(root):
    files, links, directories = {}, {}, ['.']
    root = Path(root)
    for current, ds, fs in os.walk(root,followlinks=False):
        for name in ds[:]:
            p = Path(current)/name
            if p.is_symlink():
                links[str(p.relative_to(root))] = os.readlink(p)
                ds.remove(name)
            else:
                directories.append(str(p.relative_to(root)))
        for name in fs:
            p=Path(current)/name
            if p.is_symlink():
                links[str(p.relative_to(root))]=os.readlink(p)
            else:
                files[str(p.relative_to(root))]=sha(p)
    for relative in links:
        if not (root/relative).resolve().is_relative_to(root.resolve()):
            raise ValueError('Artifact link escapes: '+relative)
    return files,links,sorted(directories)
def physical(root):
    expected = load(Path(root).parent/'artifact.json')
    files, links, dirs = census(root)
    if (files,links,dirs)!=(expected['files'],expected['symlinks'],expected['directories']):
        raise ValueError('Frozen NEW hosted artifact physical population mismatch')
    return expected
def environment():
    env = dict(os.environ)
    env.pop('AGENTIC_MERMAID_SCENE_ASSERTIONS',None)
    env['NODE_OPTIONS']=''
    return env
def check_node(node):
    if sha(node)!=NODE_SHA:
        raise ValueError('Exact Node24.19 Linux-x64 binary differs')
def output_size(root):
    return sum(p.stat().st_size for p in Path(root).rglob('*') if p.is_file() and not p.is_symlink())

def prepare(baseline,node,out):
    verify_sources()
    check_node(node)
    baseline=Path(baseline).resolve();out=Path(out).resolve()
    out.mkdir(parents=True,exist_ok=False)
    status={'protocol':'fresh-host-baseline-preparation@1','qualified':False,'errors':[],
            'source':SOURCE,'runtimeSHA256':NODE_SHA,'candidate':False,
            'sourceFreezeSHA256':sha(ROOT/'SOURCE-FREEZE.json')}
    save(out/'preparation.json',status,True)
    try:
        head=subprocess.run(['git','-C',str(baseline),'rev-parse','HEAD'],capture_output=True,text=True,timeout=5,check=True).stdout.strip()
        if head!=SOURCE:
            raise ValueError('Wrong source checkout')
        dirty=subprocess.run(['git','-C',str(baseline),'status','--porcelain','--untracked-files=normal'],
                             capture_output=True,text=True,timeout=5,check=True).stdout
        if dirty:
            raise ValueError('Fixed source checkout changed during build: '+dirty)
        bun=shutil.which('bun')
        if not bun or subprocess.run([bun,'--version'],capture_output=True,text=True,timeout=5,check=True).stdout.strip()!='1.4.2':
            raise ValueError('Pinned Bun1.4.2 required')
        status['tools']={'node':node,'nodeSHA256':sha(node),'bun':bun,'bunSHA256':sha(Path(bun).resolve()),
                         'bunVersion':'1.4.2','python':sys.executable,'pythonSHA256':sha(sys.executable)}
        expected=load(ROOT/'expected-artifact.json');artifact=out/'artifact';artifact.mkdir()
        for directory in expected['directories']:
            (artifact/directory).mkdir(parents=True,exist_ok=True)
        packages=expected['packages'];differences=[]
        for package in packages:
            metadata=load(baseline/'node_modules'/package['name']/'package.json')
            if (metadata['name'],metadata['version'])!=(package['name'],package['version']):
                raise ValueError('Runtime dependency version mismatch: '+package['name'])
        # Exact source/lock/dependency bytes. Generated dist is a NEW artifact:
        # every byte/path difference is retained, never normalized away.
        for relative,digest in expected['files'].items():
            if relative.startswith('dist/'):
                continue
            origin=baseline/relative
            for package in packages:
                prefix=package['relativeRoot']+'/'
                if relative.startswith(prefix):
                    origin=baseline/'node_modules'/package['name']/relative[len(prefix):]
                    break
            actual=sha(origin) if origin.is_file() else None
            if actual!=digest:
                differences.append({'relative':relative,'expected':digest,'actual':actual})
                continue
            target=artifact/relative;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(origin,target)
        if differences:
            save(out/'fresh-build-byte-comparison.json',{'immutableSourceOrDependencyDifferences':differences},True)
            raise ValueError('Source/package/lock/runtime dependency bytes differ')
        dist_files={str(p.relative_to(baseline)):sha(p) for p in (baseline/'dist').rglob('*') if p.is_file() and not p.is_symlink()}
        if any(p.is_symlink() for p in (baseline/'dist').rglob('*')):
            raise ValueError('Unexpected generated distribution symlink')
        old_dist={k:v for k,v in expected['files'].items() if k.startswith('dist/')}
        fixed_entries=[k for k in expected['rootJSFiles'] if not Path(k).name.startswith('chunk-')]
        if len(dist_files)!=len(old_dist) or sum(k.count('/')==1 and k.endswith('.js')for k in dist_files)!=len(expected['rootJSFiles']) or any(k not in dist_files for k in fixed_entries):
            raise ValueError('Canonical distribution population/entry admission unavailable')
        for relative in dist_files:
            target=artifact/relative;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(baseline/relative,target)
        save(out/'fresh-build-byte-comparison.json',{
            'protocol':'NEW-hosted-generated-artifact-all-byte-path-differences@1',
            'immutableSourceOrDependencyDifferences':[],
            'oldDistribution':old_dist,'newDistribution':dist_files,
            'addedPaths':sorted(set(dist_files)-set(old_dist)),
            'removedPaths':sorted(set(old_dist)-set(dist_files)),
            'changedSamePaths':[{'path':k,'localSHA256':old_dist[k],'hostedSHA256':dist_files[k]}
                                for k in sorted(set(dist_files)&set(old_dist)) if dist_files[k]!=old_dist[k]],
            'sameBitsClaim':False,'noJSNormalization':True},True)
        for relative,target in expected['symlinks'].items():
            p=artifact/relative;p.parent.mkdir(parents=True,exist_ok=True);p.symlink_to(target)
        files,links,directories=census(artifact)
        if len(files)!=737 or links!=expected['symlinks'] or len(directories)!=89:
            raise ValueError('NEW canonical distribution/dependency physical census unavailable')
        proof=out/'proof-source/src/layout';proof.mkdir(parents=True)
        core=baseline/'src/layout/agentic-layered-core.ts'
        if sha(core)!=expected['baselineSourceBinding']['sha256']:
            raise ValueError('Source core binding differs')
        shutil.copyfile(core,proof/'agentic-layered-core.ts')
        identity=hashlib.sha256(json.dumps(dict(sorted(files.items())),separators=(',',':')).encode()).hexdigest()
        art={'root':str(artifact),'source':SOURCE,'files':files,'directories':directories,
             'symlinks':links,'identity':identity,'baselineSourceBinding':expected['baselineSourceBinding'],
             'newFixedSourceHostedBuild':True,'historicalLocalArtifactIdentity':expected['identity']}
        save(out/'artifact.json',art,True)
        physical(artifact)
        subprocess.run([node,str(ROOT/'static-graph.mjs'),str(artifact),str(out/'hosted-static-module-graph.json')],
                       check=True,timeout=60,env=environment())
        static=load(out/'hosted-static-module-graph.json')
        if len(static['files'])!=99 or any(row['computedEdges']for row in static['files']):
            raise ValueError('Generated lexical module-graph admission unavailable')
        local_static=load(ROOT/'local-static-module-graph.json')
        old_graph={row['path']:row for row in local_static['files']}
        new_graph={row['path']:row for row in static['files']}
        save(out/'module-graph-comparison.json',{
            'protocol':'new-hosted-versus-local-LEXICAL-module-graph-differences@1',
            'localStaticCatalogueSHA256':sha(ROOT/'local-static-module-graph.json'),
            'hostedStaticCatalogueSHA256':sha(out/'hosted-static-module-graph.json'),
            'addedModulePaths':sorted(set(new_graph)-set(old_graph)),
            'removedModulePaths':sorted(set(old_graph)-set(new_graph)),
            'changedSamePathLiteralEdges':[{'path':key,'local':old_graph[key]['literalEdges'],
                                          'hosted':new_graph[key]['literalEdges']}
                                         for key in sorted(set(old_graph)&set(new_graph))
                                         if old_graph[key]['literalEdges']!=new_graph[key]['literalEdges']],
            'localActualLoaderGraph':'UNAVAILABLE_NOT_CAPTURED',
            'actualHostedGraph':'Acquired separately during the four enrolled untimed oracle preflights.',
            'scope':'Complete catalogues retained without JS/path normalization; lexical imports are not a claim about all possible runtime loading.'},True)
        assets=ROOT/'source-assets'
        required={str(ROOT/k):v for k,v in load(ROOT/'SOURCE-FREEZE.json')['files'].items()}
        required[str(ROOT/'SOURCE-FREEZE.json')]=sha(ROOT/'SOURCE-FREEZE.json')
        spec={'protocol':'fresh-host-baseline-untimed-oracle-spec@1','source':SOURCE,
              'artifacts':{'baseline':art},'baseline':{'source':SOURCE,'layoutMode':'agentic'},
              'inputs':{'path':str(assets/'enrollment.json'),'sha256':sha(assets/'enrollment.json')},
              'requiredFiles':required,'fidelity':str(assets/'fidelity.mjs'),
              'output':str(out/'preflight-oracles')}
        save(out/'oracle-spec.json',spec,True)
        jobs=[]
        for policy in ['off','normal']:
            for role in ['baseline','baseline-elk']:
                slot=policy+'-'+role
                jobs.append({'slot':slot,'policy':policy,'role':role,
                    'argv':[node,'--import',str(ROOT/'graph-recorder.mjs'),str(assets/'capture-baseline.mjs'),str(out/'oracle-spec.json'),policy,role],
                    'graph':str(out/'preflight-graphs'/f'{slot}.json'),
                    'result':str(out/'preflight-oracles'/f'{slot}.json'),'log':str(out/f'{slot}.log')})
        save(out/'preflight-plan.json',{'protocol':'fresh-host-baseline-untimed-four-role-plan@1',
            'source':SOURCE,'node':node,'nodeSHA256':NODE_SHA,'jobs':jobs,
            'workerSeconds':120,'sharedSeconds':600,'maximumOutputBytes':2147483648,
            'maximumLogBytes':8388608,'specSHA256':sha(out/'oracle-spec.json'),
            'sourceFreezeSHA256':sha(ROOT/'SOURCE-FREEZE.json'),'candidate':False},True)
        save(out/'timing-intent.json',{'status':'UNLAUNCHED_PENDING_EXACT_PREFLIGHT',
            'jobs':[{'engine':engine,'policy':policy,'round':round_,'role':role,'status':'unlaunched'}
                    for engine in ['native','elk']for policy in ['off','normal']for round_ in [1,2,3]
                    for role in (['baseline-B','baseline-A']if round_==2 else['baseline-A','baseline-B'])]},True)
        status['qualified']=True
    except Exception as e:
        status['errors'].append({'type':type(e).__name__,'message':str(e)})
    save(out/'preparation.json',status)
    if not status['qualified']:
        raise ValueError(status['errors'])

def capture(out):
    """Remote workflow only after review. Never invoked by local preparation."""
    out=Path(out).resolve();plan=load(out/'preflight-plan.json')
    started=time.monotonic();deadline=started+600
    record={'protocol':'fresh-host-baseline-untimed-execution@1','planSHA256':sha(out/'preflight-plan.json'),
            'qualified':False,'jobs':[{**j,'status':'unlaunched','attempts':0}for j in plan['jobs']],
            'errors':[],'elapsedSeconds':None}
    save(out/'preflight-execution.json',record,True)
    for job in record['jobs']:
        if time.monotonic()>=deadline:
            job['reason']='shared600deadline';save(out/'preflight-execution.json',record);continue
        child=None;begin=time.monotonic();job.update(status='running',attempts=1)
        save(out/'preflight-execution.json',record)
        try:
            verify_sources();check_node(plan['node']);physical(out/'artifact')
            if sha(out/'oracle-spec.json')!=plan['specSHA256']:
                raise ValueError('Frozen oracle spec changed')
            with Path(job['log']).open('xb')as log:
                env=environment();env['PR449_GRAPH_OUTPUT']=job['graph'];env['PR449_GRAPH_ARTIFACT_ROOT']=str(out/'artifact')
                env['PR449_GRAPH_PROTOCOL_ROOT']=str(ROOT)
                child=subprocess.Popen(job['argv'],stdout=log,stderr=subprocess.STDOUT,
                                       env=env,start_new_session=True)
                job['pid']=child.pid;save(out/'preflight-execution.json',record)
                while child.poll() is None:
                    if time.monotonic()-begin>=120 or time.monotonic()>=deadline or output_size(out)>2147483648 or Path(job['log']).stat().st_size>8388608:
                        job['stopReason']='deadline-or-output-cap';os.killpg(child.pid,signal.SIGKILL);break
                    time.sleep(.05)
                child.wait(timeout=max(.001,min(120-(time.monotonic()-begin),deadline-time.monotonic())))
            job['exitCode']=child.returncode
            if child.returncode!=0 or job.get('stopReason'):
                raise ValueError('Failed/terminated oracle capture')
            data=load(job['result']);expected=load(ROOT/'expected-oracles.json')[job['slot']]
            if len(data['occurrences'])!=75 or data['source']!=SOURCE or data['artifactIdentity']!=load(out/'artifact.json')['identity']:
                raise ValueError('Oracle source/population/artifact mismatch')
            graph=load(job['graph'])
            if graph['complete']is not True or graph['mappingIssues'] or graph['node']!='v24.19.0' or graph['artifactRoot']!=str(out/'artifact'):
                raise ValueError('Observed module graph mapping unavailable')
            job['graphSHA256']=sha(job['graph'])
            for actual,ref in zip(data['occurrences'],expected['occurrences'],strict=True):
                for key in ['occurrenceId','sourceSha256','finalSourceSha256',
                            'independentRequiredChecksPassed','nativeScenePaintStatus','unverifiedLimitations']:
                    if actual[key]!=ref[key] or not actual['independentRequiredChecksPassed']:
                        raise ValueError('Oracle proof metadata mismatch: '+key)
                for key in ['svg','receipt','layout','layoutReceipt','fullValues']:
                    value=actual[key]
                    if (value['sha256'],value['bytes'])!=(ref[key]['sha256'],ref[key]['bytes']) or sha(value['path'])!=value['sha256']:
                        raise ValueError('Original full payload mismatch: '+actual['occurrenceId']+':'+key)
            verify_sources();physical(out/'artifact')
            if time.monotonic()-begin>120 or time.monotonic()>deadline or output_size(out)>2147483648 or Path(job['log']).stat().st_size>8388608:
                raise ValueError('Terminal oracle deadline/output cap')
            job['resultSHA256']=sha(job['result']);job['status']='complete'
        except Exception as e:
            if child is not None and child.poll() is None:
                os.killpg(child.pid,signal.SIGKILL);child.wait()
            job['status']='failed';job['error']={'type':type(e).__name__,'message':str(e)}
        job['elapsedSeconds']=time.monotonic()-begin
        save(out/'preflight-execution.json',record)
    record['elapsedSeconds']=time.monotonic()-started
    record['qualified']=len(record['jobs'])==4 and all(j['status']=='complete'for j in record['jobs']) and record['elapsedSeconds']<=600 and output_size(out)<=2147483648
    save(out/'preflight-execution.json',record)
    if time.monotonic()>deadline:
        record['qualified']=False;record['elapsedSeconds']=time.monotonic()-started
        save(out/'preflight-execution.json',record)
    if not record['qualified']:
        raise ValueError('Untimed source/output preflight failed; calibration remains unlaunched')

def declare(out,node):
    """Relocate only known metadata fields before the NEW plan is frozen."""
    out=Path(out).resolve();node=str(Path(node).resolve());verify_sources();check_node(node)
    expected=physical(out/'artifact');execution=load(out/'preflight-execution.json')
    if execution['qualified'] is not True or len(execution['jobs'])!=4:
        raise ValueError('No successful original-output preflight')
    originals=out/'preflight-oracles';portable=out/'portable-oracles';portable.mkdir()
    for slot in ['off-baseline','off-baseline-elk','normal-baseline','normal-baseline-elk']:
        original=load(originals/(slot+'.json'))
        for row in original['occurrences']:
            for key in ['svg','receipt','layout','layoutReceipt','fullValues']:
                v=row[key];filename=Path(v['path']).name
                if filename not in [v['sha256'],v['sha256']+'.v8']:
                    raise ValueError('Unexpected CAS filename')
                v['path']=str(originals/'payloads'/filename)
                if sha(v['path'])!=v['sha256']:
                    raise ValueError('Transported oracle payload differs')
        save(portable/(slot+'.json'),original,True)
    core=out/'proof-source/src/layout/agentic-layered-core.ts'
    if sha(core)!=expected['baselineSourceBinding']['sha256']:
        raise ValueError('Transported source binding differs')
    art=load(out/'artifact.json');art['root']=str(out/'artifact')
    art['entry']=str(out/'artifact/dist/agent.js')
    projected={'inputs':load(ROOT/'source-assets/enrollment.json')['inputs'],
        'artifacts':{'baseline':art},'node':node,
        'config':{'baseline':{'source':SOURCE,'sourceRoot':str(out/'proof-source')},
                  'fidelity':str(ROOT/'source-assets/fidelity.mjs')},
        'baselineSourceBinding':expected['baselineSourceBinding']}
    save(out/'portable-origin.json',projected,True)
    runtime=out/'calibration-harness';runtime.mkdir()
    for name in ['assess-calibration.py','calibration-worker.mjs','test-calibration.py',
                 'worker-derivation.json','worker-derivation.patch']:
        shutil.copyfile(ROOT/'source-assets'/name,runtime/name)
    shutil.copyfile(ROOT/'source-assets/historical-proposal.json',runtime/'historical-proposal.json')
    original=(ROOT/'source-assets/calibrate.py').read_text()
    replacements=[
      ("ORIGINAL=Path('/workspace/pr449-frontier/c2-t-exact-ec72-cost/run-425-20261023/plan.json')",f'ORIGINAL=Path({str(out/"portable-origin.json")!r})'),
      ("PLAN_SHA='2f8c6ec70e1b39618867094cd2a27d693c08561779af6dda0898d8eb1b28f136'",f'PLAN_SHA={sha(out/"portable-origin.json")!r}'),
      ("PROPOSAL=Path('/workspace/pr449-frontier/c2-t-exact-ec72-cost/repeatability-analysis/baseline-only-calibration.PROPOSAL.json')",f'PROPOSAL=Path({str(runtime/"historical-proposal.json")!r})'),
      ("Path('/workspace/pr449-frontier/interval-median-subtraction/baseline-oracles')",f'Path({str(portable)!r})'),
      ("'worker-derivation.patch']:","'worker-derivation.patch','portable-admission.json','portable-derivation.json']:")]
    derived=original
    for before,after in replacements:
        if derived.count(before)!=1:
            raise ValueError('Expected unique relocation anchor: '+before)
        derived=derived.replace(before,after)
    (runtime/'calibrate.py').write_text(derived)
    (runtime/'portable-derivation.patch').write_text(''.join(difflib.unified_diff(original.splitlines(True),derived.splitlines(True),fromfile='historical/calibrate.py',tofile='portable/calibrate.py')))
    save(runtime/'portable-derivation.json',{'protocol':'new-fresh-host-calibration-path-relocation@1',
        'historicalControllerSHA256':sha(ROOT/'source-assets/calibrate.py'),
        'derivedControllerSHA256':sha(runtime/'calibrate.py'),
        'workerUnchangedSHA256':sha(runtime/'calibration-worker.mjs'),
        'assessorUnchangedSHA256':sha(runtime/'assess-calibration.py'),
        'replacements':replacements,'unchanged':'run/physical/validate_plan and full worker/statistic bodies; declare only oracle-root/required reporting metadata paths differ.'},True)
    save(runtime/'portable-admission.json',{'protocol':'new-independent-host-baseline-only-admission@1',
        'source':SOURCE,'artifactIdentity':expected['identity'],'nodeSHA256':NODE_SHA,
        'pythonExecutable':sys.executable,'pythonSHA256':sha(sys.executable),
        'originalOutputRows':300,'candidate':False,'historicalFailuresUnchanged':True,
        'protocolSourceFreezeSHA256':sha(ROOT/'SOURCE-FREEZE.json'),
        'preflightExecutionSHA256':sha(out/'preflight-execution.json'),
        'portableOriginSHA256':sha(out/'portable-origin.json')},True)
    subprocess.run([sys.executable,str(runtime/'calibrate.py'),'declare','--out',str(out/'calibration')],check=True,timeout=120,env=environment())
    save(out/'READY-TO-MEASURE.json',{'protocol':'fresh-host-baseline-only-ready@1',
         'source':SOURCE,'planSHA256':sha(out/'calibration/plan.json'),
         'command':[sys.executable,str(runtime/'calibrate.py'),'run','--plan',str(out/'calibration/plan.json')],
         'assess':[sys.executable,str(runtime/'assess-calibration.py'),'--plan',str(out/'calibration/plan.json'),'--out',str(out/'calibration/assessment.initial.json')],
         'candidate':False,'newProtocolNotHistoricalByteIdenticalExecution':True},True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare');p.add_argument('--baseline',required=True);p.add_argument('--node',required=True);p.add_argument('--out',required=True)
    p=sub.add_parser('capture-untimed-preflight');p.add_argument('--out',required=True)
    p=sub.add_parser('declare');p.add_argument('--out',required=True);p.add_argument('--node',required=True)
    args=parser.parse_args()
    if args.command=='prepare':prepare(args.baseline,args.node,args.out)
    elif args.command=='capture-untimed-preflight':capture(args.out)
    else:declare(args.out,args.node)
