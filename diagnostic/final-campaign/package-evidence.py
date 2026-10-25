"""Evidence-only supplied-archive checks/accounting; never installs or renders."""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
import tarfile

BASELINE = '5d1e3f76c8e9280400652b0b862ad35d01eaf69a'
CANDIDATE = 'eaa29d25a72116a95f273425de773ef00c30ce96'
# Root freezes this exact maintained parent before publishing the evidence child.
HARNESS = '06c3eaa72e153f6c7434278b65ef3d099d1c5863'
PHASES = ['first-use', 'warm-new-source', 'exact-repeat', 'label-edit']
CONSUMERS = ['svg-utf8', 'receipt-json-utf8']

def digest(data):
    return hashlib.sha256(data).hexdigest()

def read(path):
    return json.loads(Path(path).read_text())

def write(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')

def require(value, reason):
    if not value:
        raise ValueError(reason)

def verify_harness_tree():
    allowed = {
        '.github/workflows/final-qualified-campaign.yml',
        '.github/workflows/release-benchmark.yml',
        'diagnostic/final-campaign/package-evidence.py',
        'diagnostic/final-campaign/installed-package-capture.mjs',
        'diagnostic/final-campaign/compare-installed-packages.mjs',
        'diagnostic/final-campaign/README.md',
    }
    changed = subprocess.check_output(['git','diff','--name-only',HARNESS,'--'],text=True).splitlines()
    require(set(changed)<=allowed, 'maintained tree differs outside explicit evidence files: '+str(sorted(set(changed)-allowed)))
    require(not subprocess.check_output(['git','diff','HEAD','--'],text=True), 'tracked harness worktree is dirty')
    untracked = subprocess.check_output(['git','ls-files','--others','--exclude-standard'],text=True).splitlines()
    extra=[name for name in untracked if name not in allowed and not name.startswith(('final-packages/','historical-warm/','historical-cold/'))]
    require(not extra, 'unexpected untracked harness input: '+str(extra))

def design():
    return dict(baselineSource=BASELINE, candidateSource=CANDIDATE,
        maintainedHarness=HARNESS, harnessRevision=os.environ['GITHUB_SHA'],
        runtime=dict(node='24.19.0', bun='1.4.2', npm='11.18.0'),
        schedule='paired-cold-ordinal-v1', reportOrder=['aa-1', 'aa-2', 'candidate'],
        release=dict(inputs=566, official=537, scaling=28, workflow=1,
            rounds=3, reps=5, cache=['off', 'on'], reports=6, reportBudgetMinutes=70,
            outerKillMinutes=75, jobBudgetMinutes=240, consumed='public SVG API return; ASCII correctness'),
        browser=dict(occurrences=1095, rounds=3, cache=['off', 'on'], reports=2,
            warmup='all occurrences before each engine/round', reportKillMinutes=12,
            jobBudgetMinutes=45, setupBudgetMinutes=20, peers=dict(pele='1.9.0', mermaid='12.2.0'),
            status='maintained advisory browser scorecard; AB only, no independent browser AA controls or causal browser gain claim'),
        semantic=dict(scopes=[dict(cache=k, phase=p, consumer=c) for k in ['off', 'on'] for p in PHASES for c in CONSUMERS],
            reports=48, rounds=5, agenticWorkloads=16, enrolledPeerSlots=5,
            warmCallsPerCell=201, coldCallsPerCell=21, allocationProbesPerCell=3,
            diagnosticReplaysPerCell=1, reportBudgetMinutes=90, jobBudgetMinutes=300,
            nominalCapacity=dict(rows=19200, clocks=2995200, allocationProbes=57600,
                diagnosticReplays=19200, freshFirstUseWorkers=120000),
            capacityLimit='Upper requested capacity. Unsupported adapters stop their own worker groups; errors/unsupported rows retain fixed enrollment and are not replaced. Adaptive untimed warmup calls are retained separately.',
            activePele='1.9.0; exact installed version/integrity and rendered endpoint adapter bound by maintained full fingerprint',
            targets=dict(p50=1.05,p95=1.10,allocation=1.05),
            competitiveTargets=dict(p50=1,p95=1,allocation=1),
            maximumControlSpread=dict(p50=1.15,p95=1.25,allocation=1.10), calibrationMargin=1.02),
        controls='Release and semantic: each cache/scope dedicated runner with fresh same-archive AA, AA, AB serially. No cross-host, scheduler-study or bounded-screen control transfer.',
        decision='Maintained scorecards and all16 aggregate unchanged. Missing, failed, unavailable or uncalibrated cells cannot establish full qualification. Budget pass is not measured improvement. Browser advisory status does not override semantic gates.',
        attempts=1, repeats=False, performanceQualified=False,
        priorSemanticRunnerHours=42.0752, totalJobCapRunnerHours=90.25,
        rebaseEvidence='Compare actual M3 versus M2 and B3 versus B2 full archives and all emitted JavaScript members; byte equality is not performance control transfer.')

def archive(side):
    manifest=read(side/'package/package-manifest.json')
    data=(side/'package/package.tgz').read_bytes()
    sha=digest(data)
    require(manifest['schemaVersion']==1 and manifest['filename']=='package.tgz', 'manifest schema/filename mismatch')
    require(sha==manifest['sha256'], 'archive SHA mismatch')
    require(manifest['integrity']=='sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode(), 'archive SRI mismatch')
    require((side/'package/package.sha256').read_text()==sha+'  package.tgz\n', 'archive checksum receipt mismatch')
    provenance=read(side/'provenance.json')
    require(provenance['archiveSha256']==sha, 'provenance/archive mismatch')
    return manifest, provenance

def verify(root):
    verify_harness_tree()
    actual=read(root/'design.json')
    require(actual==design(), 'frozen design/source/harness/runtime/protocol mismatch')
    identities={}
    for side,source in [('baseline', BASELINE),('candidate', CANDIDATE)]:
        folder=root/side
        manifest,provenance=archive(folder)
        require(provenance['sourceRevision']==source, side+' source mismatch')
        require(provenance['harnessRevision']==os.environ['GITHUB_SHA'], side+' harness mismatch')
        closure=folder/'closure'
        require(read(closure/'runtime.json')['node']=='24.19.0', side+' actual build Node mismatch')
        require((closure/'bun-version.txt').read_text().strip()=='1.4.2', side+' build Bun mismatch')
        require((closure/'npm-version.txt').read_text().strip()=='11.18.0', side+' build npm mismatch')
        require(read(closure/'browser-lazy-report-status.json')==dict(exit=0,retried=False), side+' cap did not succeed')
        require(all(read(closure/'consumer-capture.json')['contractChecks'].values()), side+' consumer contract mismatch')
        require(read(closure/'consumer-capture.json')['outputs']==276 and read(closure/'consumer-capture.json')['successes']==276, side+' incomplete successful consumer population')
        for name in ['metafile-esm.json','browser-lazy-budgets.json','browser-lazy-report.json','publint.log','attw.json','installed.json.gz','installation.json']:
            require((closure/name).is_file(), side+' missing closure evidence: '+name)
        identities[side]=dict(source=source,archiveSha256=manifest['sha256'],integrity=manifest['integrity'])
    for name in ['package.json','bun.lock']:
        require((root/'baseline/runtime-source'/name).read_bytes()==(root/'candidate/runtime-source'/name).read_bytes(), 'different frozen runtime policy '+name)
    parity=read(root/'closure-comparison/installed-parity.json')
    require(not parity['failures'] and parity['outputs']==276 and parity['successfulComparisons']==276, 'installed package parity incomplete/failed')
    return dict(ok=True, identities=identities, designSha256=digest((root/'design.json').read_bytes()))

def members(path):
    with tarfile.open(path,'r:gz') as tar:
        result={}
        for member in tar.getmembers():
            if not member.isfile():
                continue
            require(member.name not in result,'duplicate archive member '+member.name)
            data=tar.extractfile(member).read()
            result[member.name]=dict(sha256=digest(data),bytes=len(data))
        return result

def compare_rebase(root,warm,cold):
    comparisons=[]
    for label,new,old,source,sha in [
        ('baseline',root/'baseline',warm/'baseline','cc6fc54a322187c0b0e41408ca1bfe2e0724169b','234fad0aea603fdda43e04c39bdeb5aa2e2b7c6a81940c4f86b15c689a3874f3'),
        ('candidate',root/'candidate',cold/'candidate','762f97f53bfdcbc3e8a619a4e927056731ba415f','e90a2e06d6b9d9d7c88bd470abb1ebe8d90f76f4744216d653b759a0aadb713f')]:
        oldmanifest,oldprov=archive(old)
        require(oldmanifest['sha256']==sha and oldprov['sourceRevision']==source,'historical source/archive mismatch')
        require(oldprov['harnessRevision']=='3217d187829f0dd337e33c6a846f03c8bdb8961b','historical harness mismatch')
        newmanifest,newprov=archive(new)
        a,b=members(old/'package/package.tgz'),members(new/'package/package.tgz')
        changes=[dict(path=name,before=a.get(name),after=b.get(name)) for name in sorted(a.keys()|b.keys()) if a.get(name)!=b.get(name)]
        js=lambda name:name.startswith('package/dist/') and name.endswith(('.js','.mjs','.cjs'))
        emitted=[dict(path=name,before=a.get(name),after=b.get(name),equal=a.get(name)==b.get(name)) for name in sorted(a.keys()|b.keys()) if js(name)]
        comparisons.append(dict(side=label,beforeSource=source,afterSource=newprov['sourceRevision'],beforeArchive=sha,afterArchive=newmanifest['sha256'],
            archiveEqual=sha==newmanifest['sha256'],memberCounts=dict(before=len(a),after=len(b)),changedMembers=changes,
            emittedJavaScript=emitted,emittedJavaScriptEqual=all(row['equal'] for row in emitted)))
    return dict(comparisons=comparisons,scope='Static actual archive/member equality only; no borrowed timing, allocation, semantic or runtime qualification.')

if __name__=='__main__':
    command=sys.argv[1]
    root=Path(sys.argv[2]);root.mkdir(parents=True,exist_ok=True)
    if command=='design':
        verify_harness_tree()
        write(root/'design.json',design())
    else:
        out=root/('input-verification.json' if command=='verify' else 'rebase-comparison.json')
        try:
            value=verify(root) if command=='verify' else compare_rebase(root,Path(sys.argv[3]),Path(sys.argv[4])) if command=='compare-rebase' else (_ for _ in ()).throw(ValueError('unknown command'))
            write(out,value)
        except Exception as error:
            write(out,dict(ok=False,error=str(error)))
            raise
