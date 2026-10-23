"""Local metadata/source projection only. Does not import or execute a renderer."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OLD = Path('/workspace/pr449-frontier/baseline-repeatability-calibration')
BASE = Path('/workspace/pr449-frontier/interval-median-subtraction')
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
load = lambda p: json.loads(Path(p).read_text())
def write(path, value):
    with Path(path).open('x') as f:
        json.dump(value, f, indent=2)
        f.write('\n')

copies = {name: OLD/name for name in ['calibrate.py','assess-calibration.py',
          'calibration-worker.mjs','test-calibration.py','worker-derivation.json','worker-derivation.patch']}
copies.update({'fidelity.mjs':Path('/workspace/pr449-frontier/dirty-bilayer-968-evidence/fidelity.mjs'),
               'capture-baseline.mjs':BASE/'capture-baseline.mjs',
               'enrollment.json':Path('/workspace/pr449-frontier/svg-receipt-cost/enrollment.json'),
               'historical-proposal.json':Path('/workspace/pr449-frontier/c2-t-exact-ec72-cost/repeatability-analysis/baseline-only-calibration.PROPOSAL.json')})
for name, origin in copies.items():
    with (ROOT/'source-assets'/name).open('xb') as f:
        f.write(origin.read_bytes())
old_plan_path = Path('/workspace/pr449-frontier/c2-t-exact-ec72-cost/run-425-20261023/plan.json')
old_plan = load(old_plan_path)
manifest_path = Path('/workspace/pr449-frontier/bounded-crossing-cost/baseline-artifact-manifest.json')
manifest = load(manifest_path)
files = manifest['files']
artifact_root = Path(manifest['root'])
packages = [{'name':p['name'],'version':p['version'],
             'relativeRoot':str(Path(p['copy']).relative_to(artifact_root))}
            for p in manifest['runtimePackages']]
directories = ['.']
import os
for current, ds, _ in os.walk(artifact_root, followlinks=False):
    for name in ds[:]:
        path = Path(current)/name
        if path.is_symlink():
            ds.remove(name)
        else:
            directories.append(str(path.relative_to(artifact_root)))
expected_artifact = {'protocol':'accepted-ec72-exact-artifact-reference@1',
                    'source':old_plan['config']['baseline']['source'],
                    'identity':manifest['identity'],'files':files,'symlinks':manifest['symlinks'],
                    'directories':sorted(directories),'packages':packages,
                    'baselineSourceBinding':old_plan['baselineSourceBinding'],
                    'rootJSFiles':sorted(k for k in files if k.startswith('dist/') and k.endswith('.js') and k.count('/')==1)}
write(ROOT/'expected-artifact.json',expected_artifact)
oracles = {}
for policy in ['off','normal']:
    for role in ['baseline','baseline-elk']:
        path = BASE/'baseline-oracles'/f'{policy}-{role}.json'
        data = load(path)
        rows = []
        for r in data['occurrences']:
            row = {k:r[k] for k in ['occurrenceId','sourceSha256','finalSourceSha256',
                                    'independentRequiredChecksPassed','nativeScenePaintStatus','unverifiedLimitations']}
            for key in ['svg','receipt','layout','layoutReceipt','fullValues']:
                row[key] = {k:r[key][k] for k in ['sha256','bytes']}
            rows.append(row)
        oracles[f'{policy}-{role}'] = {'historicalOracleSHA256':sha(path),'source':data['source'],
                                      'layoutMode':data['layoutMode'],'artifactIdentity':data['artifactIdentity'],
                                      'occurrences':rows}
write(ROOT/'expected-oracles.json',oracles)
enrollment = load(ROOT/'source-assets/enrollment.json')
assert enrollment['inputs']==old_plan['inputs']
write(ROOT/'HISTORICAL-METHOD.json',{
    'protocol':'fresh-host-baseline-only-calibration-origin@1',
    'status':'LOCAL_PREPARATION_ONLY_NO_REMOTE_WRITE_OR_CAPTURE',
    'source':expected_artifact['source'],
    'oldCandidateCostPlanSHA256':sha(old_plan_path),
    'oldBaselineCalibrationPlanSHA256':sha(OLD/'run-ec72-20261023/plan.json'),
    'originalWorkerSHA256':sha(OLD/'calibration-worker.mjs'),
    'unchanged':{'inputs':75,'warmupPasses':2,'timedPasses':4,'callsPerWorker':450,
                 'rounds':3,'roles':['baseline-A','baseline-B'],
                 'roundRoleOrder':[['baseline-A','baseline-B'],['baseline-B','baseline-A'],['baseline-A','baseline-B']],
                 'engines':['native','elk'],'policies':['off','normal'],'workers':24,
                 'workerSeconds':120,'eachEnginePolicySeconds':480,
                 'targets':{'allRoundWholeAndStrataAA':1.02,'allInputMedianAA':1.05,'allTailRoundAA':1.05}},
    'newProtocolDifferences':['Independent hosted runner, fixed source fresh build accepted only if all737/13 artifact bytes/topology match.',
                              'Four new untimed full75 baseline oracle captures require original fullV8/fourUTF8 hashes and success/paint metadata exactly.',
                              'Structured metadata path relocation and derived controller globals/oracle root before declaration; unchanged worker and statistic formulas.',
                              'Preparation and measurement in separate hosted jobs; immutable artifact transport reverified before timing.'],
    'noCandidateNoNormalizationNoHistoricalRescue':True,
    'sourceOrigins':{name:{'path':str(path),'sha256':sha(path)} for name,path in copies.items()},
    'baselineManifestOrigin':{'path':str(manifest_path),'sha256':sha(manifest_path)},
})
print(json.dumps({'sources':len(copies),'artifactFiles':len(files),'runtimeLinks':len(manifest['symlinks']),
                  'originalOracleRows':sum(len(x['occurrences'])for x in oracles.values()),'rendererImports':0}))
