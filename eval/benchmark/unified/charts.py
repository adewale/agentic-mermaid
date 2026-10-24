#!/usr/bin/env python3
"""Render benchmark evidence; no benchmark execution, external assets or scores.

python3 charts.py --run /path/to/unified --prs /path/to/prs --out /tmp/charts
Requires matplotlib and numpy. Raw evidence remains authoritative.
"""
from __future__ import annotations
import argparse
import base64
from collections import defaultdict, Counter
from html import escape
import json
import math
import hashlib
import subprocess
import tarfile
from pathlib import Path
from statistics import median
from textwrap import fill


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load(path, default=None):
    return json.loads(path.read_text()) if path and path.is_file() else default


def find(root, name):
    return next((path for path in (root / name, root / 'community' / name, root / 'suites/community' / name) if path.is_file()), None)


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)


def verify_file_proofs(files):
    for proof in files or []:
        if not proof.get('path')or not proof.get('sha256')or hashlib.sha256(Path(proof['path']).read_bytes()).hexdigest()!=proof['sha256']:
            raise ValueError('Shipped artifact file proof no longer holds: '+str(proof.get('path')))


def verify_source_proofs(artifact):
    """Git objects bind interpreted programs; no hashes of authored source."""
    for proof in (artifact.get('sourceFiles')or[])+(artifact.get('dependencyPatches')or[]):
        root=proof.get('root');revision=proof.get('revision');path=proof.get('gitPath');blob=proof.get('blob')
        if not all((root,revision,path,blob)):raise ValueError('Incomplete interpreted-source Git proof')
        actual=subprocess.check_output(['git','-C',root,'rev-parse',revision+':'+path],text=True).strip()
        tree=subprocess.check_output(['git','-C',root,'ls-tree',revision,'--',path],text=True).strip()
        clean=subprocess.run(['git','-C',root,'diff','--quiet',revision,'--',path],capture_output=True).returncode==0
        if actual!=blob or not tree.startswith(('100644 ','100755 '))or not clean:raise ValueError('Interpreted source/helper differs from its pinned Git proof: '+path)


def community_composition(directory,result,scores,inputs,evidence):
    """Validate mixed-window evidence against both immutable raw ledgers."""
    manifest=load(directory/'community-qualification-composition.json')
    if not manifest or manifest.get('id')!='community-qualification-composition-v3'or manifest!=result.get('composition')or manifest!=scores.get('composition')or manifest!=evidence.get('qualificationComposition')or manifest.get('scope')!=['svg','react-flow']:
        raise ValueError('Community composition has no matching explicit SVG/IR partition proof')
    phases={}
    for phase in ('original','repair'):
        source=Path(manifest.get('sourceCommunity',{}).get(phase,''))
        if source.resolve()==directory.resolve():raise ValueError('Community composition cannot reference itself')
        raw=load(source/'community-result.json');ranks=load(source/'community-ranks.json');proof=load(source/'community-evidence.json');ledger=load(source.parent/'report.json')
        if not raw or not ranks or not proof or not ledger or not raw.get('finishedAt')or raw.get('finishedAt')!=ranks.get('finishedAt')or raw.get('finishedAt')!=proof.get('finishedAt')or proof!=ranks.get('evidence'):
            raise ValueError('Community composition source phase is incomplete: '+phase)
        parents=[suite for suite in ledger.get('suites',[])if suite.get('id')=='community']
        if len(parents)!=1 or parents[0].get('result')!=raw or not ledger.get('finishedAt')or ledger.get('profile')!='full'or ledger.get('rounds')!=3:
            raise ValueError('Community composition source differs from its actual completed parent: '+phase)
        source_inputs=load(source/'community-inputs.json',{})
        literal_envelope=lambda value:{key:item for key,item in value.items()if key!='source'}
        provenance=manifest.get('inputSourceProvenance',{})
        path_key='originalSourcePath'if phase=='original'else 'repairSourcePath'
        if literal_envelope(source_inputs)!=literal_envelope(inputs)or source_inputs.get('source')!=provenance.get(path_key)or not provenance.get('scope')or (phase=='original'and source_inputs!=inputs)or proof.get('target')!=manifest.get('target')or proof.get('currentReference')!=manifest.get('currentReference')or proof.get('catalogIds')!=manifest.get('catalogIds')or proof.get('targetAdvance')!=manifest.get('targetAdvance'):
            raise ValueError('Community composition changed literal inputs, engine target, catalog or reference: '+phase)
        window=manifest.get(phase,{})
        if any(window.get(key)!=raw.get(key)for key in ('startedAt','finishedAt'))or window.get('qualification')!=proof.get('svgQualification'):
            raise ValueError('Community composition misstates source measurement windows: '+phase)
        phases[phase]=(source,raw,ranks,proof)
    old_source,base,old_ranks,old_proof=phases['original'];new_source,repair,new_ranks,new_proof=phases['repair']
    if new_proof.get('outputSelection')!=['svg','react-flow']or new_proof.get('svgQualification',{}).get('protocol')!='svg-xml-namespaced-authored-text-v3':raise ValueError('Repair is not the declared namespaced authored-text SVG/IR protocol')
    for field in ('artifacts','aliases'):
        if old_ranks.get(field)!=new_ranks.get(field)or scores.get(field)!=old_ranks.get(field):
            # Artifact preparation may append verification detail, never change bytes/protocol.
            def no_detail(value):
                if isinstance(value,dict):return {k:no_detail(v)for k,v in value.items()if k!='detail'}
                return [no_detail(v)for v in value]if isinstance(value,list)else value
            if no_detail(old_ranks.get(field))!=no_detail(new_ranks.get(field))or no_detail(scores.get(field))!=no_detail(old_ranks.get(field)):raise ValueError('Community composition changed frozen artifacts or alias proof')
    selected=lambda row:row.get('metrics',{}).get('renderedOutput',row.get('format'))in ('svg','react-flow')
    expected=[row for row in base.get('observations',[])if not selected(row)]+[row for row in repair.get('observations',[])if selected(row)]
    if result.get('observations')!=expected:raise ValueError('Community composition does not preserve exact unaffected rows and fresh selected rows')
    ids={row['id']for row in inputs['workloads']};base_rows=base.get('observations',[])
    missing={index for index,row in enumerate(base_rows)if selected(row)and row.get('caseId')in ids and row.get('suite')=='community-browser'and row.get('metrics',{}).get('round')is None}
    normalized=[row for index,row in enumerate(base_rows)if index not in missing]
    records=load(old_source/'community-browser-rounds.json',[]);used=set();observed=set()
    associations=manifest.get('comparisonSchemaRepair',{}).get('associations',[])
    for association in associations:
        indices=association.get('observationIndices',[]);candidates=association.get('candidates',[])
        if not indices or len(indices)!=len(candidates)or len(set(indices))!=len(indices)or any(index not in missing or index in observed for index in indices):raise ValueError('Invalid committed failure association index set')
        row=base_rows[indices[0]]
        if any(base_rows[index]!=row for index in indices)or association.get('implementation')!=tool(row)or association.get('caseId')!=row.get('caseId'):raise ValueError('Committed failure association combines distinct original outcomes')
        rounds={candidate.get('round')for candidate in candidates}
        if len(rounds)>1 and ('recoveredRound'in association or association.get('association')!='ambiguous-failure-set; no individual old observation round assigned'):raise ValueError('Ambiguous identical failures cannot receive invented individual rounds')
        if len(rounds)==1 and (association.get('recoveredRound')not in rounds or association.get('association')!='unique-committed-round'):raise ValueError('Unique-round association misstates its actual committed round')
        for candidate in candidates:
            ri=candidate['recordIndex'];si=candidate['sampleIndex'];record=records[ri];raw=record['samples'][si]
            if (ri,si)in used or row!=raw or record.get('id')!=tool(row)or row.get('samplesMs')or row.get('status')not in ('failed','blocked','unsupported','not-applicable')or record.get('round')!=candidate.get('round')or record.get('round')not in (1,2,3):raise ValueError('Invalid raw-record cohort slot in failure association')
            used.add((ri,si));normalized.append(dict(raw,metrics=dict(raw.get('metrics',{}),round=record['round'])))
        observed.update(indices)
    if observed!=missing:raise ValueError('Composition missing-round evidence does not cover every original missing-round outcome')
    missing_values={canonical(base_rows[index])for index in missing}
    expected_slots={(ri,si)for ri,record in enumerate(records)for si,row in enumerate(record.get('samples',[]))if canonical(row)in missing_values}
    if used!=expected_slots:raise ValueError('Committed raw round candidates do not retain the complete matching failure multiset')
    feature_ids={row['id']for row in inputs['workloads']if 'core-graph-batch'not in row.get('features',[])}
    mode_policy=manifest.get('comparisonSchemaRepair',{}).get('workloadModeKeyPolicy')
    if not mode_policy:raise ValueError('Composition does not explicitly declare its feature-once comparison-key mode normalization')
    for row in repair.get('observations',[]):
        if selected(row)and row.get('caseId')in feature_ids and row.get('status')!='not-applicable'and (row.get('metrics',{}).get('round')!=1 or row.get('samplesMs')):raise ValueError('Fresh feature qualification must be a single round-one noncalibrated attempt')
    key=lambda row:canonical([row.get(k)for k in ('suite','surface','runtime','family','caseId','operation','format')]+['frozen-feature-once-protocol'if row.get('caseId')in feature_ids else row.get('mode'),row.get('metrics',{}).get('implementation'),row.get('metrics',{}).get('round'),row.get('metrics',{}).get('renderedOutput',row.get('format'))])
    old_keys=[key(row)for row in normalized if selected(row)and row.get('caseId')in ids];new_keys=[key(row)for row in repair.get('observations',[])if selected(row)and row.get('caseId')in ids]
    if len(old_keys)!=len(set(old_keys))or len(new_keys)!=len(set(new_keys))or set(old_keys)!=set(new_keys):raise ValueError('Community repair omits or duplicates selected workload/round/runtime keys')
    for field in ('ranks','familyRanks'):
        wanted=[row for row in old_ranks.get(field,[])if row.get('output')not in ('svg','react-flow')]+[row for row in new_ranks.get(field,[])if row.get('output')in ('svg','react-flow')]
        if Counter(map(canonical,wanted))!=Counter(map(canonical,scores.get(field,[]))):raise ValueError('Community composed rank does not match its selected source-phase rank')
    for helper in manifest.get('helperChanges',[]):verify_file_proofs([helper['original'],helper['repaired']])
    if result.get('finishedAt')!=manifest.get('composedAt'):raise ValueError('Community composition timestamp differs from manifest')
    return manifest


def native_cli_binding(proof_file,artifact,identity,target):
    if not proof_file:raise ValueError('Native Agentic CLI requires explicit --cli-native-proof clean-source reproduction evidence')
    proof=load(proof_file,{})
    if proof.get('sourceRevision')!=target.get('revision')or Path(proof.get('sourceRoot','')).resolve()!=Path(target.get('root','')).resolve()or Path(proof.get('packageRoot','')).resolve()!=Path(target.get('packageRoot','')).resolve()or proof.get('candidateSha256')!=target.get('candidateSha256'):
        raise ValueError('Native CLI reproduction proof uses another frozen target/package/archive')
    executable=identity.get('executable')or{}
    if proof.get('bitIdentical')is not True or proof.get('sourceCleanBefore')is not True or proof.get('sourceCleanAfter')is not True or proof.get('beforeSha256')!=proof.get('afterSha256')or proof.get('afterSha256')!=executable.get('sha256')or proof.get('beforeBytes')!=proof.get('afterBytes')or proof.get('afterBytes')!=executable.get('bytes')or Path(proof.get('file','')).resolve()!=Path(artifact['executable']).resolve()or proof.get('command')!=['bun','run','build:binary']or not proof.get('startedAt')or not proof.get('finishedAt'):
        raise ValueError('Native CLI lacks an identical clean-source rebuild of the actual measured compiled executable')
    verify_file_proofs([dict(path=proof['file'],sha256=proof['afterSha256']),dict(path=proof['retainedBefore'],sha256=proof['beforeSha256'])])
    return dict(proofFile=str(proof_file.resolve()),sourceRevision=proof['sourceRevision'],executableSha256=proof['afterSha256'],bitIdentical=True,startedAt=proof['startedAt'],finishedAt=proof['finishedAt'],policy='Post-latency clean-source rebuild reproduces exactly the earlier measured executable bytes; original raw timing/identity unchanged.')


def completed_cli(root,native_proof=None):
    """Admit only a finished supplemental cohort, never a partial live file."""
    for directory in (root/'community-cli',root/'suites/community-cli',root,root.parent/'community-cli'):
        try:
            ranks=load(directory/'ranks.json');result=load(directory/'community-cli-result.json')
        except (json.JSONDecodeError,OSError):continue
        if not ranks or not result:continue
        if result.get('id')=='community-cli' and isinstance(result.get('finishedAt'),str) and ranks.get('finishedAt')==result['finishedAt'] and ranks.get('rounds')==result.get('rounds') and isinstance(ranks.get('ranks'),list):
            inputs=load(find(root,'community-inputs.json'),{})
            core=[row for row in inputs.get('workloads',[])if 'core-graph-batch'in row.get('features',[])]
            cohort=ranks.get('evidence',{}).get('cohort',[])
            identity=lambda row:(row.get('id'),row.get('family'),row.get('source'),tuple(row.get('expectedLabels',[])))
            if core and len(core)==len(cohort) and sorted(map(identity,core))==sorted(map(identity,cohort)):
                if ranks.get('rounds')!=3 or ranks.get('ranks')!=result.get('ranks')or ranks.get('resourceRanks')!=result.get('resourceRanks')or ranks.get('evidence')!=result.get('evidence'):raise ValueError('CLI supplemental ranks differ from completed three-round raw evidence')
                selected_source=find(root,'community-inputs.json')
                if not selected_source or Path(result.get('evidence',{}).get('sourceRun','')).resolve()!=selected_source.parent.resolve():raise ValueError('Supplemental CLI does not bind the selected actual community source directory')
                community=load(find(root,'community-ranks.json'),{});target=community.get('evidence',{}).get('target',{});actual=result.get('evidence',{}).get('target',{})
                if any(actual.get(k)!=target.get(t)for k,t in (('root','root'),('packageRoot','packageRoot'),('head','revision'))):raise ValueError('CLI supplemental target differs from selected community target')
                if result.get('composition'):validate_cli_composition(result,community)
                artifacts={entry['node']['id']:entry for entry in community.get('artifacts',[])}
                native_binding=None
                for variant in result.get('evidence',{}).get('variants',[]):
                    artifact=variant.get('prepared',{}).get('artifact')or{};identity_proof=variant.get('identity')or{};executable=identity_proof.get('executable');parent=artifacts.get(variant.get('variantOf'),{})
                    if variant.get('error'):continue
                    if not executable or Path(executable['path']).resolve()!=Path(artifact.get('executable','')).resolve():raise ValueError('CLI executable identity is not its actual prepared invocation')
                    verify_file_proofs([executable]);verify_file_proofs(artifact.get('files'));verify_source_proofs(artifact)
                    if variant.get('variant')=='public-cli':
                        omit=lambda value:{key:item for key,item in value.items()if key!='detail'}
                        if omit(artifact)!=omit(parent.get('artifact')or{}):raise ValueError('Supplemental public CLI changed frozen catalog artifact/protocol')
                    elif variant.get('variant')=='node-cli':
                        expected=target.get('compiledArtifacts',{}).get('files',[])
                        files=lambda values:sorted((str(Path(row['path']).resolve()),row['sha256'])for row in values)
                        if files(artifact.get('files',[]))!=files(expected):raise ValueError('Supplemental Node CLI differs from actual frozen installed archive closure')
                    elif variant.get('variant')=='native-cli':
                        if Path(artifact.get('executable','')).resolve()!=(Path(target.get('root',''))/'dist/am').resolve():raise ValueError('Supplemental native CLI invokes another target')
                        native_binding=native_cli_binding(native_proof,artifact,identity_proof,target)
                    else:raise ValueError('Unknown supplemental CLI invocation variant')
                ranks=dict(ranks,reportingFamilyRanks=cli_family_ranks(result,core),reportingDirectory=str(directory.resolve()),reportingNativeBinding=native_binding)
                return ranks,result
    return None,None


def validate_cli_composition(result,community):
    manifest=result['composition'];parent=community.get('composition',{})
    if manifest.get('protocol')!='community-cli-qualification-composition-v1'or manifest.get('communityComposition')!=parent.get('id')or manifest.get('communityTarget')!=parent.get('target')or manifest.get('outputSelection')!=['svg']or result.get('evidence',{}).get('composition')!=manifest:
        raise ValueError('Supplemental CLI has no matching explicit SVG-only composition proof')
    sources={}
    for phase in ('original','repair'):
        window=manifest.get(phase,{});source=Path(window.get('directory',''));raw=load(source/'community-cli-result.json');ranks=load(source/'ranks.json')
        if not raw or not ranks or raw.get('id')!='community-cli'or raw.get('rounds')!=3 or not raw.get('finishedAt')or raw.get('finishedAt')!=ranks.get('finishedAt')or any(raw.get(k)!=window.get(k)for k in ('startedAt','finishedAt')):
            raise ValueError('Supplemental CLI composition references incomplete raw phase')
        for field in ('cohort','target','resourceObserver'):
            if raw.get('evidence',{}).get(field)!=result.get('evidence',{}).get(field):raise ValueError('Supplemental CLI composition changed fixed work or target identity')
        if Path(raw.get('evidence',{}).get('sourceRun','')).resolve()!=Path(parent.get('sourceCommunity',{}).get(phase,'')).resolve():raise ValueError('Supplemental CLI phase does not bind its actual community phase')
        sources[phase]=raw
    selected=lambda row:row.get('metrics',{}).get('renderedOutput',row.get('format'))=='svg'
    for field in ('observations','diagnostics'):
        expected=[row for row in sources['original'].get(field,[])if not selected(row)]+[row for row in sources['repair'].get(field,[])if selected(row)]
        if result.get(field)!=expected:raise ValueError('Supplemental CLI composition replaced an unselected original row or reused old SVG')
    for field in ('ranks','resourceRanks'):
        expected=[row for row in sources['original'].get(field,[])if row.get('output')!='svg']+[row for row in sources['repair'].get(field,[])if row.get('output')=='svg']
        if Counter(map(canonical,expected))!=Counter(map(canonical,result.get(field,[]))):raise ValueError('Supplemental CLI composition rank differs from actual phase result')


def cli_family_ranks(result,core):
    """Conditional fixed-core families only; no invented feature breadth."""
    families=sorted({row['family']for row in core});rows=[]
    for rank in result.get('ranks',[]):
        for family in families:
            ids=[row['id']for row in core if row['family']==family and row['id']in rank.get('requiredCaseIds',[])]
            if not ids:continue
            groups=[[row for row in result.get('observations',[])if tool(row)==rank['implementation']and row.get('format')==rank['output']and row.get('caseId')==case and row.get('metrics',{}).get('round')==round]for round in (1,2,3)for case in ids]
            admitted=not rank.get('error')and all(len(group)==1 and group[0].get('status')=='passed'and len(group[0].get('samplesMs',[]))==1 and finite(group[0]['samplesMs'][0])and group[0]['samplesMs'][0]>0 for group in groups)
            per_round=[sum(group[0]['samplesMs'][0]for group in groups[index*len(ids):(index+1)*len(ids)])for index in range(3)]if admitted else [None]*3
            rows.append(dict(rank,family=family,requiredCaseIds=ids,qualified=admitted,perRoundMs=per_round,medianMs=median(per_round)if admitted else None,featureCoverage=None,featureCoverageStatus='unmeasured: conditional fixed-core cases only'))
    return rows


def community_overlay(report, original_inputs, directory, original_directory, allow_target_change=False):
    """Explicit completed v2 replay, retaining the original suite ledger."""
    result=load(directory/'community-result.json');scores=load(directory/'community-ranks.json');inputs=load(directory/'community-inputs.json')
    ledger=load(directory.parent/'report.json');invocation=load(directory.parent/'invocation.json')
    if not result or not scores or not inputs or not ledger or not invocation:
        raise ValueError('--community-run needs completed community result/ranks/inputs plus its parent report.json and invocation.json')
    if result.get('id')!='community'or not result.get('finishedAt')or not ledger.get('finishedAt')or scores.get('startedAt')!=result.get('startedAt'):
        raise ValueError('Expanded community replay is incomplete or result/ranks identities differ')
    evidence=scores.get('evidence',{})
    if scores.get('protocol')not in ('community-fixed-core-feature-once-v2','community-qualification-composition-v3')or evidence.get('protocol')!=scores['protocol']or load(directory/'community-evidence.json')!=evidence:
        raise ValueError('Expanded community replay has no matching explicit v2 evidence manifest')
    composition=community_composition(directory,result,scores,inputs,evidence)if scores['protocol']=='community-qualification-composition-v3'else None
    svg_qualification=evidence.get('svgQualification',{})
    parser=svg_qualification.get('nodeXmlParser',{})
    if svg_qualification.get('protocol')not in ('svg-xml-namespace-positive-canvas-v2','svg-xml-namespaced-authored-text-v3')or parser.get('name')!='saxes'or not parser.get('version')or not parser.get('module')or svg_qualification.get('browserXmlParser')!='native DOMParser':
        raise ValueError('Expanded community replay lacks actual strict XML/namespace/canvas qualification provenance')
    if scores.get('finishedAt')!=result['finishedAt']or evidence.get('finishedAt')!=result['finishedAt']or evidence.get('profile')!='full'or evidence.get('rounds')!=3 or evidence.get('coverageOnce')is not True:
        raise ValueError('Expanded community evidence protocol/timestamps differ from its actual result')
    if ledger.get('profile')!='full'or ledger.get('rounds')!=3 or scores.get('rounds')!=3 or invocation.get('communityCoverageOnce')is not True:
        raise ValueError('Expanded community replay must record full/three-core-round/feature-once protocol')
    target_changed=any(ledger.get(key)!=report.get(key)for key in ('targetRevision','packageRoot'))
    if target_changed and not allow_target_change:raise ValueError('Expanded community target advanced; require explicit --allow-community-target-change and verified targetAdvance evidence')
    if any(not report.get(key)or not ledger.get(key)for key in ('targetRevision','packageRoot')):raise ValueError('Community comparison is missing original/final target identity')
    if inputs.get('reference')!=original_inputs.get('reference'):
        raise ValueError('Expanded community replay uses a different pinned label/reference provenance')
    identity=lambda row:(row.get('id'),row.get('family'),row.get('source'),tuple(row.get('expectedLabels',[])),tuple(row.get('features',[])))
    before=original_inputs.get('workloads',[]);after=inputs.get('workloads',[])
    if not before or len({row['id']for row in after})!=len(after)or sorted(map(identity,before))!=sorted(map(identity,after)):
        raise ValueError('Expanded community replay does not retain every exact frozen core and feature input/expectation')
    core=[row for row in after if 'core-graph-batch'in row.get('features',[])];features=[row for row in after if 'core-graph-batch'not in row.get('features',[])]
    if len(core)!=6 or len(features)!=957:raise ValueError('Expected frozen six-core/957-feature campaign')
    if evidence.get('coreCaseIds')!=[row['id']for row in core]or evidence.get('featureCaseIds')!=[row['id']for row in features]or evidence.get('currentReference')!=inputs.get('reference'):
        raise ValueError('Expanded community manifest cohorts/reference differ from literal frozen inputs')
    artifacts=scores.get('artifacts',[]);ids=[row.get('node',{}).get('id')for row in artifacts]
    if len(ids)!=84 or len(set(ids))!=84 or scores.get('catalogNodes')!=84:
        raise ValueError('Expanded community replay must enroll all84 unique catalog nodes')
    if evidence.get('catalogIds')!=ids:raise ValueError('Expanded evidence enrollment differs from actual preparation outcomes')
    observations=result.get('observations',[]);statuses={'passed','failed','blocked','not-applicable','skipped','unsupported'}
    for implementation in ids:
        rows=[row for row in observations if tool(row)==implementation]
        if not rows or any(row.get('status')not in statuses for row in rows):raise ValueError('Missing actual outcome for expanded catalog node '+str(implementation))
    feature_ids={row['id']for row in features}
    for row in observations:
        if row.get('caseId')in feature_ids and row.get('status')not in ('not-applicable','blocked','skipped'):
            if row.get('metrics',{}).get('round')!=1 or row.get('samplesMs'):raise ValueError('Feature-once replay contains repeated/timed feature samples')
    rechecks=scores.get('identityRechecks',[])
    if not rechecks:raise ValueError('Expanded replay has no final artifact identity rechecks')
    failed_identities={row.get('implementation')for row in rechecks if row.get('status')!='passed'}
    if any(row.get('qualified')and row.get('implementation')in failed_identities for row in scores.get('ranks',[])+scores.get('familyRanks',[])):
        raise ValueError('Expanded replay ranks an implementation whose artifact identity failed')
    parent_suite=next((row for row in ledger.get('suites',[])if row.get('id')=='community'),None)
    if not parent_suite or parent_suite.get('result')!=result:raise ValueError('Expanded replay result differs from its completed parent ledger')
    # Compare shipped bytes against the original campaign, not merely an asserted
    # version string. The original and replay must use the same admitted tarball.
    original_invocation=load(original_directory/'invocation.json',{})
    for key in ('candidateTarball','candidateSha256'):
        if not original_invocation.get(key)or not invocation.get(key):raise ValueError('Community comparison lacks admitted '+key)
        if not target_changed and invocation[key]!=original_invocation[key]:raise ValueError('Expanded replay differs from original admitted '+key)
        if evidence.get('target',{}).get(key)!=invocation[key]:raise ValueError('Expanded evidence differs from actual target '+key)
    if evidence.get('target',{}).get('revision')!=ledger['targetRevision']or evidence.get('target',{}).get('packageRoot')!=ledger['packageRoot']:
        raise ValueError('Expanded evidence target differs from completed run ledger')
    tarball=Path(invocation['candidateTarball'])
    if hashlib.sha256(tarball.read_bytes()).hexdigest()!=invocation['candidateSha256']:raise ValueError('Frozen target tarball bytes changed')
    advance=None
    if target_changed:
        advance=evidence.get('targetAdvance',{})
        before_target=dict(revision=report['targetRevision'],packageRoot=report['packageRoot'],candidateTarball=original_invocation['candidateTarball'],candidateSha256=original_invocation['candidateSha256'])
        after_target=dict(revision=ledger['targetRevision'],packageRoot=ledger['packageRoot'],candidateTarball=invocation['candidateTarball'],candidateSha256=invocation['candidateSha256'])
        if advance.get('from')!=before_target or advance.get('to')!=after_target:raise ValueError('Explicit community target advance does not match actual original/final target and tarball identities')
        root=evidence.get('target',{}).get('root')
        if not root or subprocess.check_output(['git','-C',root,'rev-parse','HEAD'],text=True).strip()!=ledger['targetRevision']:raise ValueError('Advanced community target Git HEAD differs from declared measured revision')
        if subprocess.run(['git','-C',root,'diff','--quiet','HEAD','--','src','package.json','scripts/build.ts','scripts/build'],capture_output=True).returncode!=0:raise ValueError('Advanced community target has unrecorded tracked product/build changes')
    old_scores=load(find(original_directory,'community-ranks.json'),{})
    for previous in old_scores.get('artifacts',[]):
        if 'self'in previous.get('node',{}).get('roles',[])or not previous.get('artifact'):continue
        following=next((entry for entry in artifacts if entry.get('node',{}).get('id')==previous.get('node',{}).get('id')),None)
        if not following or not following.get('artifact'):raise ValueError('Expanded comparison loses a previously admitted peer artifact')
        for key in ('version','revision','sha256','integrity'):
            if previous['artifact'].get(key)is not None and previous['artifact'][key]!=following['artifact'].get(key):raise ValueError('Expanded comparison changes previously frozen peer '+previous['node']['id']+' '+key)
    old_self=[entry.get('artifact')for entry in old_scores.get('artifacts',[])if 'self'in entry.get('node',{}).get('roles',[])]
    new_self=[entry.get('artifact')for entry in artifacts if 'self'in entry.get('node',{}).get('roles',[])]
    if len(old_self)!=1 or len(new_self)!=1 or not old_self[0]or not new_self[0]:raise ValueError('Expanded replay lacks one actual original/final Agentic artifact identity')
    if not target_changed:
        for key in ('root','module','version','sha256'):
            if old_self[0].get(key)!=new_self[0].get(key):raise ValueError('Expanded replay changes actual Agentic artifact '+key)
    elif Path(new_self[0].get('root','')).resolve()!=Path(ledger['packageRoot']).resolve():raise ValueError('Advanced community Agentic artifact is not the declared new package')
    module=Path(new_self[0]['module']);member='package/'+str(module.relative_to(Path(ledger['packageRoot'])))
    with tarfile.open(tarball,'r:*')as archive:
        compiled=archive.extractfile(member)
        if not compiled or hashlib.sha256(compiled.read()).hexdigest()!=new_self[0]['sha256']or hashlib.sha256(module.read_bytes()).hexdigest()!=new_self[0]['sha256']:
            raise ValueError('Actual Agentic entry no longer matches admitted target tarball bytes')
    metadata=dict(directory=str(directory.resolve()),evidenceFile=str((directory/'community-evidence.json').resolve()),protocol=evidence['protocol'],svgQualification=svg_qualification,originalStatus=report.get('status'),replayStatus=ledger.get('status'),startedAt=result['startedAt'],finishedAt=result['finishedAt'],catalogNodes=84,coreCases=6,featureCases=957,rounds=3,coverageOnce=True,targetRevision=ledger['targetRevision'],packageRoot=ledger['packageRoot'],candidateSha256=invocation['candidateSha256'],agenticEntrySha256=new_self[0]['sha256'],targetAdvance=advance,currentReference=evidence['currentReference'],identityRechecks=rechecks,qualificationChange='Expanded population and strict SVG XML/namespace/canvas plus source-echo/diagnostic qualification safeguards; this is a separately identified community measurement, not a replacement full run or a like-for-like product speed improvement.')
    if composition:
        metadata.update(composition=composition,qualificationChange=composition['policy'])
    return result,scores,inputs,metadata


def current_target_ledger(original, directory, required_suites=('dave','pinned-reference-score')):
    """A separate supplemental current-target run, never an old-ledger overlay."""
    ledger=load(directory/'report.json');invocation=load(directory/'invocation.json',{})
    if not ledger or not ledger.get('finishedAt')or ledger.get('profile')!='full'or ledger.get('rounds')!=3:
        raise ValueError('--current-run must be a completed full/three-round supplemental run')
    for suite_id in required_suites:
        suites=[suite for suite in ledger.get('suites',[])if suite.get('id')==suite_id]
        if len(suites)!=1 or suites[0].get('status')in ('skipped','not-applicable')or not suites[0].get('result'):
            raise ValueError('Current supplemental run did not actually execute '+suite_id)
    root=ledger.get('targetRoot');revision=ledger.get('targetRevision');package=ledger.get('packageRoot')
    if not root or not revision or not package or invocation.get('packageRoot')!=package:
        raise ValueError('Current supplemental run has no actual target/packed-package identity')
    if subprocess.check_output(['git','-C',root,'rev-parse','HEAD'],text=True).strip()!=revision:
        raise ValueError('Current supplemental target Git HEAD differs from its ledger')
    if subprocess.run(['git','-C',root,'diff','--quiet','HEAD','--','src','package.json','scripts/build.ts','scripts/build'],capture_output=True).returncode!=0:
        raise ValueError('Current supplemental checkout has unrecorded product/build changes')
    tarball=invocation.get('candidateTarball');digest=invocation.get('candidateSha256')
    if not tarball or not digest or hashlib.sha256(Path(tarball).read_bytes()).hexdigest()!=digest:
        raise ValueError('Current supplemental run lacks its actual admitted target tarball')
    return ledger,dict(directory=str(directory.resolve()),targetRevision=revision,packageRoot=package,candidateTarball=tarball,candidateSha256=digest,startedAt=ledger['startedAt'],finishedAt=ledger['finishedAt'],status=ledger.get('status'),originalTargetRevision=original.get('targetRevision'),policy='Separate current-target Dave and pinned-reference evidence. Original full ledger and scoped older-target corrections retain their own target and clocks.')


def additional_supplement(original, directory, expected_target):
    ledger,metadata=current_target_ledger(original,directory,required_suites=())
    if any(metadata.get(key)!=expected_target.get(key)for key in ('targetRevision','packageRoot','candidateSha256')):raise ValueError('Additional suite ledger differs from the explicitly selected current target/archive')
    selected=[suite for suite in ledger.get('suites',[])if suite.get('selected')and suite.get('status')!='skipped']
    if not selected:raise ValueError('Additional suite ledger has no selected attempted suite')
    root=Path(ledger['targetRoot']).resolve();rows=[]
    for suite in selected:
        source=Path(suite.get('source',''))
        if not source.is_absolute()or Path(suite.get('workingDirectory','')).resolve()!=root:raise ValueError('Additional target-owned suite must name its actual absolute source and target working directory')
        try:relative=source.resolve().relative_to(root).as_posix()
        except ValueError as error:raise ValueError('Additional owning source is outside the admitted target checkout')from error
        blob=subprocess.check_output(['git','-C',str(root),'rev-parse',metadata['targetRevision']+':'+relative],text=True).strip()
        if subprocess.run(['git','-C',str(root),'diff','--quiet',metadata['targetRevision'],'--',relative],capture_output=True).returncode!=0:raise ValueError('Additional owning benchmark source changed after its admitted Git revision')
        result=suite.get('result')or{}
        evidence=[{key:row.get(key)for key in ('caseId','operation','format','mode','status','metrics','detail')}for row in result.get('observations',[])]
        rows.append(dict(id=suite['id'],status=suite.get('status'),elapsedMs=suite.get('elapsedMs'),source=str(source),sourceRevision=metadata['targetRevision'],sourceGitBlob=blob,log=str(directory/suite['log'])if suite.get('log')else None,artifacts=result.get('artifacts',[]),prerequisites=suite.get('prerequisites',[]),gaps=result.get('gaps',[]),observations=evidence))
    metadata.update(policy='Additional maintained target-owned suite ledger; source Git objects and actual target archive verified. No community/PR ranks or original suite statuses are replaced.',suites=rows)
    return metadata


def current_dave(original_directory, directory, target):
    before=load(original_directory/'dave/browser-report.json');after=load(directory/'dave/browser-report.json')
    corpus_before=load(original_directory/'dave/corpus.json');corpus_after=load(directory/'dave/corpus.json')
    if not before or not after or not corpus_before or not corpus_after or corpus_before!=corpus_after or corpus_after.get('occurrenceCount')!=1095:
        raise ValueError('Current Dave benchmark must retain the exact original1095-occurrence pinned corpus')
    if after.get('status')!='completed'or not after.get('finishedAt')or after.get('policy')!=before.get('policy')or after.get('browser')!=before.get('browser'):
        raise ValueError('Current Dave run is incomplete or changes the browser/clock/cohort policy')
    original_identities=before.get('identities',[]);identities=after.get('identities',[])
    candidate=[row for row in identities if row.get('name')=='agentic-mermaid']
    if len(candidate)!=1 or candidate[0].get('identity',{}).get('tarballSha256')!=target['candidateSha256']:
        raise ValueError('Current Dave candidate does not bind the admitted current-target tarball')
    for previous in original_identities:
        if previous.get('name')=='agentic-mermaid':continue
        following=[row for row in identities if row.get('label')==previous.get('label')and row.get('name')==previous.get('name')]
        if len(following)!=1 or following[0].get('version')!=previous.get('version'):
            raise ValueError('Current Dave changed an original pinned comparator/version')
        for key,value in previous.get('identity',{}).items():
            if value is not None and following[0].get('identity',{}).get(key)!=value:raise ValueError('Current Dave changed pinned comparator identity '+str(previous.get('label'))+' '+key)
    for engine in after.get('engines',[]):
        if engine.get('population')!=1095 or not isinstance(engine.get('accepted'),int)or not 0<=engine['accepted']<=1095:raise ValueError('Current Dave engine has inconsistent acceptance census')
    return after,dict(corpusInputs=1095,distinctInputs=corpus_after.get('distinctCount'),policy=after['policy'],browser=after['browser'],identities=identities,startedAt=after.get('startedAt'),finishedAt=after['finishedAt'],scope='Pinned Dave SVG artifact boundary. Its historical Pele1.6 comparator is separate from the expanded community Pele1.9 API benchmark.')


def invocation_correction(report, path):
    """Consume the explicit mixed-run ledger; never rewrite the raw run status."""
    normalized=load(path);manifest=load(path.parent/'reconciliation.json')
    originals=[suite.get('result')for suite in report.get('suites',[])if suite.get('id')=='invocation' and suite.get('result')]
    if len(originals)!=1 or not normalized or not manifest:
        raise ValueError('Invocation correction needs one original suite plus the normalized envelope and sibling reconciliation.json')
    original=originals[0];surface='library:./svg/styles'
    if manifest.get('id')!='invocation-style-oracle-reconciliation' or manifest.get('scope')!=surface or not str(manifest.get('protocolChange','')).strip():
        raise ValueError('Unknown or unexplained invocation reconciliation scope')
    if Path(manifest.get('normalized',{}).get('path','')).resolve()!=path.resolve():
        raise ValueError('Explicit correction file differs from reconciliation normalized path')
    if original.get('id')!='invocation' or normalized.get('id')!='invocation' or not original.get('finishedAt'):
        raise ValueError('Correction must replace a completed main invocation envelope')
    if manifest.get('profile')!='full' or report.get('profile')!='full':
        raise ValueError('Style reconciliation is admitted only for the full-profile main run')
    for field in ('startedAt','finishedAt','status'):
        if manifest.get('original',{}).get(field)!=original.get(field):
            raise ValueError('Reconciliation original metadata differs from the selected run: '+field)
    target=manifest.get('target',{})
    if report.get('targetRevision') and target.get('revision')!=report['targetRevision']:
        raise ValueError('Reconciliation frozen target revision differs from the selected run')
    if report.get('packageRoot') and Path(target.get('packageRoot','')).resolve()!=Path(report['packageRoot']).resolve():
        raise ValueError('Reconciliation packed target differs from the selected run')
    digest=target.get('sha256','')
    if len(digest)!=64 or any(c not in '0123456789abcdef'for c in digest):
        raise ValueError('Reconciliation has no canonical admitted tarball SHA256 identity')
    before=original.get('observations',[]);after=normalized.get('observations',[])
    old=[row for row in before if row.get('surface')==surface];new=[row for row in after if row.get('surface')==surface]
    if [row for row in before if row.get('surface')!=surface]!=[row for row in after if row.get('surface')!=surface]:
        raise ValueError('Correction changes observations outside the admitted style partition')
    def key(row):
        return tuple(row.get(k)for k in ('suite','surface','runtime','family','caseId','operation','format','mode'))+(row.get('metrics',{}).get('round'),)
    old_keys=[key(row)for row in old];new_keys=[key(row)for row in new]
    if not old or len(set(old_keys))!=len(old_keys)or len(set(new_keys))!=len(new_keys)or set(old_keys)!=set(new_keys):
        raise ValueError('Correction style runtime/round/case/operation keys do not exactly match')
    if any(row.get('status')!='passed'or any(not finite(v)or v<=0 for v in row.get('samplesMs',[]))for row in new):
        raise ValueError('Corrected style rows must pass with valid clocks where measured')
    if sorted({row.get('runtime')for row in new})!=sorted(manifest.get('runtimes',[])) or sorted({row.get('metrics',{}).get('round')for row in new})!=manifest.get('rounds'):
        raise ValueError('Correction runtime/version and round evidence differs from its manifest')
    if len(manifest.get('runtimes',[]))!=3 or manifest.get('rounds')!=[1,2,3]:
        raise ValueError('Reconciliation requires all three original runtimes and three rounds')
    expected_status='failed'if any(row.get('status')=='failed'for row in after)else 'blocked'if any(row.get('status')=='blocked'for row in after)else 'passed'
    if normalized.get('status')!=expected_status or manifest.get('normalized',{}).get('status')!=expected_status:
        raise ValueError('Normalized invocation status disagrees with actual observations or reconciliation')
    if manifest.get('correction',{}).get('status')!='passed' or not manifest.get('createdAt')or not manifest.get('correction',{}).get('finishedAt'):
        raise ValueError('Scoped correction is not a completed passing rerun')
    counts=manifest.get('counts',{})
    if counts.get('original')!=len(before)or counts.get('corrected')!=len(after)or counts.get('replaced')!=len(new)or counts.get('retainedOriginal')!=len(before)-len(old):
        raise ValueError('Correction counts differ from the admitted observation partitions')
    for field in ('startedAt','finishedAt'):
        if normalized.get(field)!=original.get(field):
            raise ValueError('Normalized ledger must preserve original run timestamps; scoped rerun timestamps belong in provenance')
    metadata=dict(manifest)
    metadata['explicitCorrectionFile']=str(path.resolve())
    metadata['originalAggregateStatus']=report.get('status')
    metadata['originalInvocationStatus']=original.get('status')
    metadata['normalizedInvocationStatus']=normalized.get('status')
    return normalized,metadata


def reference_correction(report, path, run, campaign=None, target_run=None):
    """Admit reviewed eligibility repair without outcome-dependent filtering."""
    result=load(path)
    suites=[suite for suite in report.get('suites',[])if suite.get('id')=='pinned-reference-score'and suite.get('result')]
    if len(suites)!=1 or not result or result.get('id')!='pinned-reference-score'or result.get('protocol')!='public-positive-eligibility-v2'or not result.get('finishedAt'):
        raise ValueError('Reference correction requires one original completed suite and an explicit public-positive-eligibility-v2 result')
    original=suites[0]['result'];evidence=result.get('evidence')or{}
    eligibility_path=path.parent/'reference-score-eligibility.json';diagnostic_path=path.parent/'reference-score-diagnostics.json';corrected_raw_path=path.parent/'reference-score-raw.json'
    eligibility_manifest=load(eligibility_path);diagnostic_manifest=load(diagnostic_path);corrected_raw=load(corrected_raw_path)
    for name,artifact in (('eligibility',eligibility_manifest),('diagnostics',diagnostic_manifest),('raw',corrected_raw)):
        if not artifact or artifact.get('protocol')!=result['protocol']or artifact.get('evidence')!=evidence:
            raise ValueError('Corrected reference '+name+' companion differs from the explicit result evidence')
    if report.get('profile')!='full'or evidence.get('rounds')!=3 or report.get('rounds')!=3:
        raise ValueError('Reviewed reference correction requires the complete full/three-round protocol')
    raw_path=run/'pinned-reference-score/reference-score-raw.json'
    old_raw=load(raw_path)
    if not old_raw or not original.get('finishedAt'):
        raise ValueError('Original completed reference raw provenance must remain available')
    pin=evidence.get('currentReference')or{};old_pin=old_raw.get('currentReference')or{}
    if any(pin.get(key)!=old_pin.get(key)or not pin.get(key)for key in ('version','commit')):
        raise ValueError('Corrected current Mermaid pin differs from the original run')
    if any(pin.get(key)!=old_pin.get(key)for key in ('parserVersion','domVersion')):
        raise ValueError('Corrected independent parser/DOM dependency versions differ from the original run')
    if evidence.get('historicalFixtureProvenance')!=old_raw.get('historicalFixtureProvenance'):
        raise ValueError('Historical source-harvest provenance changed during eligibility repair')
    eligibility=evidence.get('reviewedEligibility')or{};reviewed_pin=eligibility.get('reviewedReference')or{}
    if any(reviewed_pin.get(key)!=pin.get(key)for key in ('version','commit')):
        raise ValueError('Eligibility decisions were reviewed against a different current reference pin')
    target=evidence.get('target')or{}
    if target.get('revision')!=report.get('targetRevision')or Path(target.get('packageRoot','')).resolve()!=Path(report.get('packageRoot','')).resolve():
        raise ValueError('Corrected parser uses a different frozen candidate revision/package')
    fixture=evidence.get('frozenFixture')or{};driver=report.get('driverRoot');revision=report.get('driverRevision')
    if not fixture.get('path')or not fixture.get('gitBlob')or not driver or not revision:
        raise ValueError('Correction requires original and corrected fixture Git object provenance')
    try:
        original_blob=subprocess.run(['git','-C',driver,'rev-parse',str(revision)+':'+fixture['path']],check=True,capture_output=True,text=True,timeout=5).stdout.strip()
    except (OSError,subprocess.SubprocessError)as error:raise ValueError('Cannot verify original fixture Git object: '+str(error))from error
    try:
        corrected_blob=subprocess.run(['git','-C',driver,'rev-parse',str(fixture.get('driverRevision'))+':'+fixture['path']],check=True,capture_output=True,text=True,timeout=5).stdout.strip()
    except (OSError,subprocess.SubprocessError)as error:raise ValueError('Cannot verify corrected fixture Git object: '+str(error))from error
    if original_blob!=fixture['gitBlob']or corrected_blob!=fixture['gitBlob']:
        raise ValueError('Eligibility repair changes the frozen source fixture Git object')
    fixture_cases=json.loads(subprocess.check_output(['git','-C',driver,'cat-file','blob',fixture['gitBlob']],text=True))
    literal_cases={row['id']:row for row in fixture_cases}
    config=load((target_run or run)/'invocation.json',{})
    tarball=config.get('candidateTarball');archive_digest=config.get('candidateSha256')
    if (not tarball or not archive_digest)and campaign:
        candidates=[rank for rank in campaign.get('ranks',[])if rank.get('id')=='main']
        if len(candidates)==1:tarball=candidates[0].get('artifact',{}).get('tarball');archive_digest=candidates[0].get('artifact',{}).get('sha256')
    if not tarball or not archive_digest or not Path(tarball).is_file()or hashlib.sha256(Path(tarball).read_bytes()).hexdigest()!=archive_digest:
        raise ValueError('Original frozen candidate tarball identity is unavailable or mismatched')
    compiled=target.get('compiledArtifacts')or[]
    if not compiled:raise ValueError('Corrected public parser has no shipped-artifact byte identity')
    package=Path(target['packageRoot']).resolve()
    with tarfile.open(tarball,'r:gz')as archive:
        for artifact in compiled:
            try:relative=Path(artifact['path']).resolve().relative_to(package)
            except (KeyError,ValueError)as error:raise ValueError('Corrected parser artifact is outside the frozen package')from error
            member=archive.extractfile('package/'+relative.as_posix())
            if member is None or hashlib.sha256(member.read()).hexdigest()!=artifact.get('sha256'):
                raise ValueError('Corrected parser artifact differs from original admitted npm bytes')
            if hashlib.sha256(Path(artifact['path']).read_bytes()).hexdigest()!=artifact.get('sha256'):
                raise ValueError('Measured parser artifact no longer matches its recorded shipped bytes')
    old_rows=original.get('observations',[]);rows=result.get('observations',[])
    old_ids={row.get('caseId')for row in old_rows};eligible=evidence.get('eligibleCaseIds')or[];diagnostics=eligibility.get('diagnostics')or[];diagnostic_ids=[row.get('caseId')for row in diagnostics]
    if not eligible or len(set(eligible))!=len(eligible)or len(set(diagnostic_ids))!=len(diagnostic_ids)or set(eligible)&set(diagnostic_ids)or set(eligible)|set(diagnostic_ids)!=old_ids:
        raise ValueError('Eligibility partition is not an exact reviewed split of original raw fixture IDs')
    if evidence.get('rawInputCount')!=len(old_ids)or evidence.get('eligibleInputCount')!=len(eligible)or evidence.get('diagnosticInputCount')!=len(diagnostics):
        raise ValueError('Reference eligibility census differs from the retained raw fixture universe')
    if any(not row.get('scope')or not row.get('reason')or not row.get('source')or not row.get('upstream')for row in diagnostics):
        raise ValueError('Diagnostic eligibility assignments require independent scope/reason/source provenance')
    if set(evidence.get('diagnosticCaseIds',[]))!=set(diagnostic_ids)or len(evidence.get('diagnosticCaseIds',[]))!=len(diagnostic_ids):
        raise ValueError('Reviewed diagnostic census differs from declared diagnostic IDs')
    assignments=evidence.get('assignments')or[]
    if len(assignments)!=len(old_ids)or {row.get('caseId')for row in assignments}!=old_ids or any(row.get('eligible')is not (row.get('caseId')in eligible)for row in assignments):
        raise ValueError('Eligibility assignments do not cover the frozen raw cohort before scoring')
    engines={'agentic','mermaid'}
    def keys(observations):return [(tool(row),row.get('metrics',{}).get('round'),row.get('caseId'))for row in observations]
    diagnostic_rows=diagnostic_manifest.get('diagnosticObservations')or[]
    diagnostic_keys=keys(diagnostic_rows)
    if len(diagnostic_keys)!=len(set(diagnostic_keys))or set(diagnostic_keys)!={(engine,round,case)for engine in engines for round in (1,2,3)for case in diagnostic_ids}or any('criteria'in row.get('metrics',{})or 'passed'in row.get('metrics',{})for row in diagnostic_rows):
        raise ValueError('Diagnostic attempts must be retained for both engines and all rounds without positive scores')
    raw_rows=corrected_raw.get('raw')or[]
    raw_keys=[(row.get('round'),row.get('caseId'))for row in raw_rows]
    if len(raw_keys)!=len(set(raw_keys))or set(raw_keys)!={(round,case)for round in (1,2,3)for case in old_ids}or set(corrected_raw.get('selectedInputs',[]))!=old_ids:
        raise ValueError('Corrected raw evidence drops retained source attempts')
    original_cases={(row.get('round'),row.get('caseId')):row for row in old_raw.get('raw',[])}
    for row in raw_rows:
        previous=original_cases.get((row.get('round'),row.get('caseId')), {})
        frozen=literal_cases.get(row.get('caseId'),{})
        fields=('criteria','unscoredCriteria')if row.get('caseId')in eligible else ()
        if any(row.get(key)!=frozen.get(key)for key in ('source','family'))or any(row.get(key)!=previous.get(key)for key in fields):
            raise ValueError('Parser replay changes literal frozen sources or independently expected assertions')
    expected={(engine,round,case)for engine in engines for round in (1,2,3)for case in eligible};actual=keys(rows)
    if len(actual)!=len(set(actual))or set(actual)!=expected:
        raise ValueError('Eligible score needs exactly every frozen positive case × both engines × three fresh rounds')
    old_expected={(engine,round,case)for engine in engines for round in (1,2,3)for case in old_ids};old_keys=keys(old_rows)
    if len(old_keys)!=len(set(old_keys))or set(old_keys)!=old_expected:
        raise ValueError('Original raw parser score lacks the complete comparable attempt universe')
    old_criteria=defaultdict(set)
    for row in old_rows:old_criteria[row.get('caseId')].add(row.get('metrics',{}).get('criteria'))
    for row in rows:
        metrics=row.get('metrics')or{};criteria=metrics.get('criteria');passed=metrics.get('passed')
        if old_criteria[row.get('caseId')]!={criteria}or metrics.get('referenceVersion')!=pin.get('version'):
            raise ValueError('Eligibility-only repair changes retained portable criteria or reference version')
        if row.get('suite')!='pinned-reference-score'or row.get('operation')!='parse-and-score'or not finite(criteria)or not finite(passed)or not 0<=passed<=criteria or criteria<=0:
            raise ValueError('Eligible parser observation has invalid portable criterion counts')
    expected_status='failed'if any(row.get('status')=='failed'for row in rows)else 'passed'
    if result.get('status')!=expected_status:raise ValueError('Corrected reference status disagrees with its eligible observations')
    metadata=dict(protocol=result['protocol'],explicitCorrectionFile=str(path.resolve()),originalRawFile=str(raw_path),originalAggregateStatus=report.get('status'),originalSuiteStatus=original.get('status'),originalStartedAt=original.get('startedAt'),originalFinishedAt=original.get('finishedAt'),correctedSuiteStatus=result.get('status'),correctedStartedAt=result.get('startedAt'),correctedFinishedAt=result.get('finishedAt'),evidence=evidence,eligibilityArtifact=str(eligibility_path),diagnosticArtifact=str(diagnostic_path),correctedRawArtifact=str(corrected_raw_path),diagnosticObservations=diagnostic_rows,policy='Reviewed source-eligibility repair before either parser; retained original raw attempts and classified diagnostics. This is a fresh scoped baseline-protocol correction, not product improvement or a replacement full run.')
    return result,metadata


def current_supplement(original, original_directory, directory, baseline_reference=None):
    if baseline_reference is None:raise ValueError('--current-run requires --reference-correction to admit the independently reviewed original580-positive baseline')
    ledger,metadata=current_target_ledger(original,directory)
    dave,dave_metadata=current_dave(original_directory,directory,metadata)
    # Reuse the same fixture/eligibility/pin and shipped-byte admission, selecting
    # the explicitly separate current target rather than rewriting the old run.
    proxy=dict(original,targetRevision=ledger['targetRevision'],targetRoot=ledger['targetRoot'],packageRoot=ledger['packageRoot'])
    reference_path=directory/'pinned-reference-score/reference-score-result.json'
    reference,reference_metadata=reference_correction(proxy,reference_path,original_directory,target_run=directory)
    if (reference['evidence'].get('rawInputCount'),reference['evidence'].get('eligibleInputCount'),reference['evidence'].get('diagnosticInputCount'))!=(586,580,6):raise ValueError('Current parser supplement changes the frozen586-raw/580-positive/6-diagnostic census')
    if baseline_reference:
        before=baseline_reference['evidence'];after=reference['evidence']
        for key in ('rawInputCount','eligibleInputCount','diagnosticInputCount','eligibleCaseIds','diagnosticCaseIds','rounds','currentReference','historicalFixtureProvenance','reviewedEligibility','assignments'):
            if before.get(key)!=after.get(key):raise ValueError('Current parser supplement differs from reviewed baseline eligibility/cohort: '+key)
    current_suite=next(suite for suite in ledger['suites']if suite['id']=='pinned-reference-score')
    if current_suite.get('result')!=reference:raise ValueError('Current parser result differs from completed supplemental ledger')
    metadata.update(dave=dave_metadata,reference=dict(resultFile=str(reference_path.resolve()),protocol=reference['protocol'],status=reference['status'],rawInputCount=reference['evidence']['rawInputCount'],eligibleInputCount=reference['evidence']['eligibleInputCount'],diagnosticInputCount=reference['evidence']['diagnosticInputCount'],currentReference=reference['evidence']['currentReference'],frozenFixture=reference['evidence']['frozenFixture'],eligibilityArtifact=reference_metadata['eligibilityArtifact'],diagnosticArtifact=reference_metadata['diagnosticArtifact'],compiledArtifacts=reference['evidence']['target']['compiledArtifacts']))
    return ledger,dave,reference,metadata


def tool(row):
    return str(row.get('metrics', {}).get('implementation', 'agentic-mermaid'))


def aggregate(rows):
    """Repeated rounds are one observed check, passed only when every row passes."""
    checks = defaultdict(list)
    for row in rows:
        if row.get('status') in ('not-applicable','skipped'):
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
        current=getattr(self,'current_run',None)
        if current and name.startswith('current-'):note+=' Separate current-target evidence '+str(current.get('targetRevision'))[:12]+'; '+str(current.get('startedAt'))+' → '+str(current.get('finishedAt'))+'. Original suite ledger and older-target corrections retain their original identities.'
        replay=getattr(self,'community_replay',None)
        if replay and (name.startswith(('community-','svg-cost-coverage-','cli-'))or any(str(row.get('scope','')).startswith('community:')for row in rows)):
            note+=' Explicit expanded community replay '+str(replay.get('finishedAt'))+'; changed population/qualification protocol, not a product improvement or a replacement full run.'
            if replay.get('targetAdvance'):note+=' Community-only Agentic target '+str(replay.get('targetRevision'))[:12]+'. Original invocation/reference/owning suites retain their original target.'
        correction=getattr(self,'invocation_correction',None)
        if correction and (name=='invocation-coverage'or any(row.get('surface')==correction.get('scope')for row in rows)):
            note+=' Explicit style-oracle correction: '+str(correction.get('correction',{}).get('finishedAt'))+'. Original invocation status remains '+str(correction.get('originalInvocationStatus'))+'; mixed-run reporting, not a new full run.'
        reference_overlay=getattr(self,'reference_correction',None)
        if reference_overlay and name=='pinned-parser-score':
            census=reference_overlay.get('evidence',{})
            note+=' Explicit baseline protocol repair: '+str(census.get('eligibleInputCount'))+' eligible positives from '+str(census.get('rawInputCount'))+' retained raw inputs; '+str(census.get('diagnosticInputCount'))+' reviewed diagnostic inputs remain separate. Fresh scoped rerun, not product improvement or a new full run.'
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
                selected=[r for r in rows if r['family'] == family and r['surface'] == surface and r.get('runtime', 'unrecorded') == runtime]
                passed, total = aggregate(selected)
                if total: matrix[y, x] = passed / total
                data.append(dict(family=family, surface=surface, runtime=runtime, passed=passed, observedChecks=total,statusObservations={status:sum(row.get('status')==status for row in selected)for status in ('passed','failed','blocked','unsupported','not-applicable','skipped')}))
        figure, ax = self.plt.subplots(figsize=(max(8, len(surfaces) * .7), max(5, len(families) * .3)))
        image = ax.imshow(matrix, vmin=0, vmax=1, aspect='auto', cmap='YlGnBu')
        ax.set_xticks(range(len(surfaces)), [surface+'\n'+runtime for surface,runtime in surfaces], rotation=45, ha='right')
        ax.set_yticks(range(len(families)), families)
        for cell in data:
            x, y = surfaces.index((cell['surface'],cell['runtime'])), families.index(cell['family'])
            ax.text(x, y, f"{cell['passed']}/{cell['observedChecks']}" if cell['observedChecks'] else '—', ha='center', va='center', fontsize=7, color='white' if matrix[y,x] > .7 else 'black')
        figure.colorbar(image, ax=ax, label='Qualified / observed checks')
        self.save(figure, 'invocation-coverage', 'Agentic Mermaid: observed family × invocation checks', 'Counts deduplicate repeated rounds; every observed round must pass. N/A/skipped checks are excluded, missing cells are unmeasured. Blocked/unsupported/failed statuses remain distinct in reduced rows; a low qualified fraction is not a failure count. This is not exhaustive feature or operation coverage.', data)

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
            ax.set_yticks(list(ys), [r['implementation']+(' [shared evidence]'if r.get('independentMeasurement')is False else '') for r in valid]); ax.invert_yaxis()
            ax.set_xscale('log'); ax.set_xlabel('Matched fixed-core portfolio, ms (log scale; lower is faster)')
            self.save(figure, f'community-rank-{index+1}', f'Community same-core: {surface} / {output}', 'Only every-case/every-round qualified results. Whiskers are observed round ranges, not confidence intervals. API, browser, native and CLI boundaries are separate. Supplemental CLI variants retain variantOf identity and have no inferred broad coverage.', group)

    def family_ranks(self, ranks):
        """Conditional comparisons of the already measured core, not new tests."""
        groups=defaultdict(list)
        for row in ranks:
            if row.get('family'):groups[(row['family'],row.get('surface'),row.get('output'))].append(row)
        for index,((family,surface,output),group)in enumerate(sorted(groups.items())):
            valid=sorted([row for row in group if row.get('qualified')and finite(row.get('medianMs'))and row['medianMs']>0],key=lambda row:row['medianMs'])
            if not valid:continue
            figure,ax=self.plt.subplots(figsize=(9,max(3.4,len(valid)*.3)))
            ax.barh(range(len(valid)),[row['medianMs']for row in valid],color=['#147d92'if 'agentic'in row['implementation']else '#718ca1'for row in valid])
            ax.set_yticks(range(len(valid)),[row['implementation']+(' [shared evidence]'if row.get('independentMeasurement')is False else '')for row in valid],fontsize=7)
            ax.invert_yaxis();ax.set_xscale('log');ax.set_xlabel('Existing family-scoped core portfolio, ms; log scale')
            self.save(figure,f'community-family-{index+1}',f'Community conditional rank: {family} / {surface} / {output}','Only this family\'s existing fixed inputs: flowchart has two, other SVG/parser families one; terminal has flowchart two or sequence one. Every case must qualify across all rounds. This admits narrow tools without claiming complete family functionality or overall superiority. Search the HTML by family to select a scope.',group)

    def current_dave(self, result):
        if not result:return
        rows=[]
        for engine in sorted(result.get('engines',[]),key=lambda row:row['label']):
            attempts=engine['attemptMs']
            identity=next((row for row in result.get('identities',[])if row.get('label')==engine['label']),{})
            measured=len(attempts)==3 and all(finite(value)and value>0 for value in attempts)
            rows.append(dict(implementation=engine['label'],version=identity.get('version'),accepted=engine.get('accepted'),population=engine.get('population'),attemptPortfolioMs=median(attempts)if measured else None,perRoundMs=attempts,complete=engine.get('complete'),failures=engine.get('failures')))
        figure,axes=self.plt.subplots(1,2,figsize=(12,max(4,len(rows)*.45)),sharey=True)
        labels=[row['implementation']+' '+str(row.get('version',''))for row in rows]
        for index,row in enumerate(rows):
            axes[0].barh(index,100*row['accepted']/row['population'],color='#147d92');axes[0].text(1,index,f"{row['accepted']}/{row['population']}",va='center',fontsize=7)
            if row['attemptPortfolioMs']is not None:axes[1].barh(index,row['attemptPortfolioMs']/1000,color='#718ca1')
            else:axes[1].text(0,index,'N/A: incomplete clocks',va='center',fontsize=7)
        axes[0].set_yticks(range(len(rows)),labels);axes[0].invert_yaxis();axes[0].set_xlim(0,100);axes[0].set_xlabel('Dave artifact acceptance, %; lower is not better')
        axes[1].set_xlabel('All1095 attempts, seconds; includes failures, not an efficiency rank')
        self.save(figure,'current-dave-score-attempt-cost','Current-target Dave benchmark: acceptance and complete attempt cost','Exact unchanged pinned1095-occurrence corpus and browser policy; three rounds. Attempt cost includes rejected/failed inputs, so fast rejection is not a speed win. Matched-success comparisons use each comparator\'s own explicitly recorded common input IDs. Dave Pele1.6 and community Pele1.9 are separate versions and boundaries.',rows)
        matched=[]
        for row in result.get('matched',[]):
            own=row.get('candidateMs',[]);peer=row.get('comparatorMs',[])
            ratio=median([a/b for a,b in zip(own,peer)])if len(own)==len(peer)==3 and all(finite(value)and value>0 for value in own+peer)else None
            matched.append(dict(comparator=row.get('comparator'),sharedInputCount=len(row.get('inputIds',[])),inputIds=row.get('inputIds'),candidateMs=own,comparatorMs=peer,ratios=row.get('ratios'),medianRatio=row.get('medianRatio'),candidateOverComparator=ratio))
        if matched:
            figure,ax=self.plt.subplots(figsize=(9,max(3,len(matched)*.5)))
            for index,row in enumerate(matched):
                if finite(row['candidateOverComparator']):ax.scatter(row['candidateOverComparator'],index,color='#147d92')
            ax.axvline(1,color='#718ca1',linestyle='--');ax.set_xscale('log');ax.set_yticks(range(len(matched)),[str(row['comparator'])+' ('+str(row['sharedInputCount'])+' shared)'for row in matched]);ax.invert_yaxis();ax.set_xlabel('Agentic / comparator cost; <1 faster, >1 slower (log scale)')
            self.save(figure,'current-dave-matched','Current-target Dave: comparator-specific shared-success work','Each row has its own frozen shared input IDs, never a single common cross-tool rank. Plotted ratio is derived from the recorded three candidate/comparator cost pairs; original owning ratios remain in reduced data. Historical Pele1.6 remains distinct from community Pele1.9.',matched)

    def svg_scatter(self, ranks, observations, enrolled_cases):
        enrolled=len({row['family'] for row in enrolled_cases})
        enrolled_ids={row['id'] for row in enrolled_cases}
        if not enrolled_ids:
            self.gaps.append('SVG breadth: enrolled feature inputs are unavailable; no breadth plot manufactured.');return
        groups = defaultdict(list)
        for rank in ranks:
            if rank.get('featureCoverageStatus','').startswith('unmeasured'):
                if rank.get('output')=='svg':self.gaps.append(rank['implementation']+': supplemental CLI feature breadth is unmeasured; omitted from cost/breadth scatter, not plotted as zero.')
                continue
            if rank.get('output') == 'svg' and rank.get('qualified') and finite(rank.get('medianMs')) and rank['medianMs'] > 0:
                groups[rank['surface']].append(rank)
        for index, (surface, group) in enumerate(sorted(groups.items())):
            figure, ax = self.plt.subplots(figsize=(9,5))
            data=[]
            for rank in group:
                name=rank['implementation']
                attempts=[r for r in observations if tool(r)==name and r.get('surface')==surface and r.get('format')=='svg' and r.get('caseId') in enrolled_ids and r.get('family')!='*']
                families={r['family'] for r in attempts if r.get('status')=='passed'}
                deliveries=[r.get('metrics',{}).get('gzipBytes') for r in observations if tool(r)==name and r.get('surface')==surface and r.get('operation')=='delivery' and r.get('status')=='passed' and r.get('metrics',{}).get('round')==1] if surface.startswith('browser:') else []
                gzip=median([v for v in deliveries if finite(v)]) if any(finite(v) for v in deliveries) else None
                size=35 if gzip is None else 35+min(300, math.log2(1+gzip/1024)*20)
                ax.scatter(rank['medianMs'],len(families),s=size,alpha=.7,color='#147d92' if 'agentic' in name else '#718ca1')
                ax.annotate(name,(rank['medianMs'],len(families)),xytext=(4,4),textcoords='offset points',fontsize=7)
                data.append(dict(implementation=name,corePortfolioMs=rank['medianMs'],familiesWithQualifiedFeatureAttempt=len(families),enrolledFamilies=enrolled,observedGzipBytes=gzip,deliveryScope='round-one-through-full-attempted-portfolio'if gzip is not None else None))
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
            if row.get('suite')in ('community','community-browser'):
                scope+=':format='+str(row.get('format'))+':cases='+str(metrics.get('portfolioCaseCount','unrecorded'))+':features='+str(metrics.get('featureCases','unrecorded'))+':output='+str(metrics.get('renderedOutput',row.get('format')))
            identity=(tool(row),row.get('surface'),row.get('format'),metrics.get('round'),metrics.get('workerAttempt'))
            entry=dict(implementation=tool(row),surface=row.get('surface'),runtime=runtime,scope=scope,metric=metric,round=metrics.get('round'),workerAttempt=metrics.get('workerAttempt'),portfolioCaseCount=metrics.get('portfolioCaseCount'),featureCases=metrics.get('featureCases'),renderedOutput=metrics.get('renderedOutput',row.get('format')),valueBytes=value,MiB=value/1024/1024,detail=detail,sourceStatus=row.get('status'),requests=metrics.get('requests')if scope!='invocation:initial-navigation'else None,completePortfolioRequests=metrics.get('requests'),driverRuntime=row.get('runtime'))
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

    def cli_resources(self, supplemental, result):
        if not supplemental:return
        resource_rows=supplemental.get('resourceRanks',[])
        if not resource_rows:
            self.gaps.append('Completed CLI cohort has no separately instrumented fixed-work resource evidence.')
        if resource_rows!=result.get('resourceRanks',[]):
            self.gaps.append('CLI resource rank/result ledgers disagree; no resource panels admitted.');resource_rows=[]
        outputs=sorted({row.get('output')for row in resource_rows})
        for output in outputs:
            rows=sorted([dict(row)for row in resource_rows if row.get('output')==output],key=lambda row:row['implementation'])
            figure,axes=self.plt.subplots(1,2,figsize=(12,max(4,len(rows)*.45)),sharey=True)
            labels=[row['implementation']+' ['+str(row.get('runtime','unrecorded'))+']'for row in rows]
            for y,row in enumerate(rows):
                row['caseResources']=[diagnostic for diagnostic in result.get('diagnostics',[])if tool(diagnostic)==row['implementation']and diagnostic.get('format')==output]
                valid=row.get('qualified') and finite(row.get('peakRssBytes')) and row['peakRssBytes']>0 and all(finite(row.get(key))and row[key]>=0 for key in ('userCpuMs','systemCpuMs','totalCpuMs'))
                row['resourcePanelStatus']='qualified fixed cohort'if valid else 'N/A: fixed cohort did not qualify'
                if not valid:
                    for ax in axes:ax.text(0,y,'N/A',va='center',fontsize=7)
                    continue
                axes[0].barh(y,row['peakRssBytes']/1024/1024,color='#718ca1')
                lower=row.get('totalCpuLowerBoundMs');upper=row.get('totalCpuUpperBoundMs')
                bounded=finite(lower)and finite(upper)and 0<=lower<=row['totalCpuMs']<=upper
                if not bounded:
                    axes[1].text(0,y,'N/A: precision bounds unavailable',va='center',fontsize=7)
                    row['cpuPanelStatus']='N/A: reporting-grain bounds unavailable';continue
                if row.get('cpuBelowResolution')is True or row['totalCpuMs']==0:
                    axes[1].errorbar((lower+upper)/2,y,xerr=(upper-lower)/2,fmt='none',color='#283641',capsize=3)
                    axes[1].annotate(f'< {upper:g} ms (censored)',(upper,y),xytext=(4,0),textcoords='offset points',va='center',fontsize=7)
                    row['cpuPanelStatus']='censored below reporting resolution'
                else:
                    axes[1].barh(y,row['userCpuMs'],color='#147d92')
                    axes[1].barh(y,row['systemCpuMs'],left=row['userCpuMs'],color='#92b7c1')
                    axes[1].errorbar(row['totalCpuMs'],y,xerr=[[row['totalCpuMs']-lower],[upper-row['totalCpuMs']]],fmt='none',color='#283641',capsize=3)
                    row['cpuPanelStatus']='reported user/system CPU with conservative grain allowance'
            for ax in axes:ax.set_yticks(range(len(rows)),labels,fontsize=7)
            axes[0].invert_yaxis();axes[0].set_xlabel('Maximum per-case child peak RSS, MiB; never summed')
            axes[1].set_xlabel('Sum of fresh per-case user + system CPU, ms')
            from matplotlib.patches import Patch
            axes[1].legend(handles=[Patch(color='#147d92',label='user CPU'),Patch(color='#92b7c1',label='system CPU')],fontsize=7)
            note='Separate GNU time pass after all plain CLI latency rounds, same qualified fixed-source/label cohort. Peak RSS = maximum case high-water mark; CPU = sum across cases. Each per-case user/system field has10ms reporting grain. CPU intervals use conservative20ms × case-count allowance, not confidence intervals; reported zero is censored < upper bound, never free CPU or zero-latency. Runtime/shared code included; not PSS, allocation, leak proof or a process-tree sum. Do not pool with varying-portfolio Node worker RSS or V8 heaps.'
            self.save(figure,'cli-fixed-resource-'+str(output),'Fixed-work fresh CLI resources: '+str(output),note,rows)
        # File bytes have a delivery identity independent from resource success.
        # Interpreters are external runtimes, never compiled tool payloads.
        footprints=[]
        for variant in supplemental.get('evidence',{}).get('variants',[]):
            identity=variant.get('identity')or{};delivery=identity.get('delivery')or{};prepared=variant.get('prepared',{});artifact=prepared.get('artifact')or{}
            runtime=artifact.get('runtime','unrecorded');value=delivery.get('executableBytes')
            interpreted=bool(artifact.get('sourceFiles'))and any(str(arg).endswith(('.py','.ts','.js','.mjs'))for arg in artifact.get('args',[]))
            kind='external-node-runtime'if runtime.startswith('node:')else 'external-interpreter-runtime'if interpreted or runtime.lower().startswith(('python','bun:','bun '))else 'compiled-cli-file'
            scope='External interpreter executable only; authored program and dependency delivery are separate/unmeasured'if kind=='external-interpreter-runtime'else delivery.get('scope','unrecorded executable scope')
            footprints.append(dict(implementation=prepared.get('node',{}).get('id','unrecorded'),variantOf=variant.get('variantOf'),variant=variant.get('variant'),runtime=runtime,scope=scope,recordedScope=delivery.get('scope'),scopeCorrection='Interpreted program invocation is not a compiled CLI payload'if kind=='external-interpreter-runtime'else None,footprintKind=kind,executableBytes=value if finite(value)and not variant.get('error')else None,recordedExecutableBytes=value,executableIdentity=identity.get('executable'),sourceFiles=artifact.get('sourceFiles',[]),dependencyPatches=artifact.get('dependencyPatches',[]),admissionError=variant.get('error')))
        if footprints:
            figure,axes=self.plt.subplots(1,3,figsize=(15,max(4,len(footprints)*.4)))
            for ax,kind,title in zip(axes,('compiled-cli-file','external-node-runtime','external-interpreter-runtime'),('Compiled CLI executable file','External Node runtime; not npm delivery','External interpreter; not tool payload')):
                rows=sorted([row for row in footprints if row['footprintKind']==kind],key=lambda row:row['implementation'])
                for y,row in enumerate(rows):
                    if finite(row['executableBytes']):ax.barh(y,row['executableBytes']/1024/1024,color='#718ca1')
                    else:ax.text(0,y,'N/A',va='center',fontsize=7)
                ax.set_yticks(range(len(rows)),[row['implementation']for row in rows],fontsize=7);ax.invert_yaxis();ax.set_title(title,fontsize=9);ax.set_xlabel('MiB; admitted executable file bytes')
                if not rows:ax.text(.5,.5,'unmeasured',ha='center',va='center',transform=ax.transAxes)
            self.save(figure,'cli-executable-footprints','CLI file footprints; explicit delivery scopes','Compiled native/Bun executable bytes exclude dynamic libraries and other external resources. Node and interpreted-program panels measure external runtime binaries, not package/program/dependency delivery. Raw earlier compiled-file scope for interpreted Python is retained as recordedScope and explicitly corrected; clocks/resources are unchanged. Never sum these into browser delivery or a universal tool-size rank. variantOf preserves catalog identity.',footprints)

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

    def pr_payload(self, campaign):
        if not campaign:return
        ranks=campaign.get('ranks',[])
        if not ranks:return
        data=[]
        for rank in ranks:
            tags=[rank.get('integration','unknown')]
            if rank.get('draft'):tags.append('draft')
            if rank.get('sourceEvidence')not in (None,rank['id']):tags.append('source = '+rank['sourceEvidence'])
            data.append(dict(candidate=rank.get('label',rank['id']),id=rank['id'],integration=rank.get('integration'),draft=bool(rank.get('draft')),sourceEvidence=rank.get('sourceEvidence'),state=', '.join(tags),packageTarballBytes=rank.get('packageGzipBytes'),browserIifeGzipBytes=rank.get('browserBundleGzipBytes'),artifact=rank.get('artifact')))
        figure,axes=self.plt.subplots(1,2,figsize=(12,max(4,len(data)*.37)),sharey=True)
        for ax,field,title in zip(axes,('packageTarballBytes','browserIifeGzipBytes'),('Actual npm tarball','Shipped browser IIFE, gzip level9')):
            for y,row in enumerate(data):
                value=row[field]
                if finite(value):ax.barh(y,value/1024,color='#718ca1')
                else:ax.text(0,y,'unavailable',va='center',fontsize=7)
            ax.set_yticks(range(len(data)),[row['candidate']+' ['+row['state']+']'for row in data],fontsize=7)
            ax.set_title(title,fontsize=10);ax.set_xlabel('KiB; actual candidate artifact, alphabetical/campaign order')
        axes[0].invert_yaxis()
        self.save(figure,'pr-artifact-payloads','PR artifact payloads; separate distribution boundaries','Tarball = actual compressed npm archive bytes. IIFE = gzip of complete shipped JS only; excludes separately loaded fonts/WASM/assets. Source-equal renderer timings never substitute package bytes. Missing artifacts are unavailable, not zero. Conflicts remain exploratory.',data)

    def pr_coverage(self, campaign):
        if not campaign:return
        def label(rank):
            tags=[rank.get('integration','unknown')]
            if rank.get('draft'):tags.append('draft')
            if rank.get('sourceEvidence')not in (None,rank['id']):tags.append('source = '+rank['sourceEvidence'])
            return rank.get('label',rank['id'])+' ['+', '.join(tags)+']'
        ranks=campaign.get('ranks',[]);records=campaign.get('coverage')or[row for rank in ranks for row in rank.get('coverage',[])]
        if not records:
            self.gaps.append('PR broad family/invocation observation evidence is unavailable.');return
        colors={'passed':'#147d92','failed':'#b34742','unsupported':'#8a75a6','blocked':'#c29946','not-applicable':'#cbd2d8','skipped':'#a6b4be','unknown':'#e5e7e9'}
        for suite in ('family','invocation'):
            data=[]
            for rank in ranks:
                own=[row for row in records if row.get('target')==rank['id'] and row.get('suite')==suite]
                if not own:
                    data.append(dict(candidate=label(rank),suite=suite,profile=campaign.get('measurementConfig',{}).get(suite,{}).get('profile','unrecorded'),rounds=campaign.get('measurementConfig',{}).get(suite,{}).get('rounds'),status='unmeasured',observations=None,statusCounts=None));continue
                for row in own:
                    result=load(Path(row['resultPath']))if row.get('resultPath')else None
                    counts=defaultdict(int)
                    if result and isinstance(result.get('observations'),list):
                        for observation in result['observations']:counts[observation.get('status','unknown')]+=1
                        total=len(result['observations'])
                    else:
                        total=row.get('total')
                        if finite(row.get('passed')):counts['passed']=row['passed']
                        if finite(total):counts['unknown']=max(0,total-counts['passed'])
                    data.append(dict(candidate=label(rank),suite=suite,profile=row.get('profile','unrecorded'),rounds=row.get('rounds'),status=row.get('status'),observations=total,statusCounts=dict(counts),resultPath=row.get('resultPath')))
            if not data:continue
            figure,ax=self.plt.subplots(figsize=(11,max(4,len(data)*.38)))
            for y,row in enumerate(data):
                total=row['observations'];left=0
                if not finite(total)or total<=0:ax.text(0,y,'no measured observations',va='center',fontsize=7);continue
                for status,color in colors.items():
                    value=(row['statusCounts']or{}).get(status,0)/total*100
                    if value:ax.barh(y,value,left=left,color=color,label=status if y==0 else None)
                    left+=value
            ax.set_yticks(range(len(data)),[f"{row['candidate']} [{row['profile']}, {row['rounds']} rounds, {row['status']}; n={row['observations']}]"for row in data],fontsize=7)
            ax.invert_yaxis();ax.set_xlim(0,100);ax.set_xlabel('Observed benchmark rows, %; includes explicit N/A and metadata, not feature completeness')
            from matplotlib.patches import Patch
            ax.legend(handles=[Patch(color=color,label=status)for status,color in colors.items()],fontsize=7,ncol=4,loc='lower right')
            self.save(figure,'pr-observation-coverage-'+suite,'PR '+suite+' observation status; resolved profiles and rounds','These are observation counts, not unique cases or exhaustive operation/fidelity coverage. Compare like profiles/rounds; intentional invocation overrides remain visible. N/A, unsupported, blocked, failure and missing evidence stay separate. No current-main correctness/merge readiness is inferred from exploratory heads.',data)

    def pr_editor(self, campaign):
        if not campaign:return
        ranks=campaign.get('ranks',[]);records=campaign.get('coverage')or[row for rank in ranks for row in rank.get('coverage',[])]
        def evidence(rank):
            own=[row for row in records if row.get('target')==rank['id']and row.get('suite')=='invocation']
            if len(own)!=1:return None
            record=own[0];path=Path(record['resultPath'])if record.get('resultPath')else None
            result=load(path);job=load(path.parent/'job.json')if path else None;inputs=load(path.parent/'invocation-inputs.json')if path else None
            return dict(record=record,result=result,job=job,inputs=inputs,path=str(path)if path else None)
        main_rank=next((rank for rank in ranks if rank.get('id')=='main'),None)
        main=evidence(main_rank)if main_rank else None
        def cohort(item):
            rows=(item.get('inputs')or{}).get('workloads',[])if item else []
            return [(row.get('id'),row.get('family'),row.get('source'),tuple(row.get('expectedLabels',[])))for row in rows]
        expected=cohort(main);expected_ids=[row[0]for row in expected]
        expected_families={row[1]for row in expected}
        expected_keys=sorted((row[0],row[1])for row in expected)
        main_preview=[row for row in (main.get('result')or{}).get('observations',[])if row.get('surface')=='browser:editor'and row.get('operation')=='input-preview']if main else []
        main_runtimes={row.get('runtime')for row in main_preview}
        def qualified_preview(row):
            samples=row.get('samplesMs')or[];metrics=row.get('metrics',{})
            return row.get('status')=='passed'and row.get('mode')=='changed-input-to-verified-DOM'and row.get('format')=='svg'and metrics.get('round')==1 and metrics.get('receiptAuthority')is True and metrics.get('staleAuthority')is False and len(samples)==1 and finite(samples[0])and samples[0]>0
        main_record=(main or{}).get('record',{});main_job=(main or{}).get('job')or{}
        main_complete=bool(expected)and bool(((main or{}).get('result')or{}).get('finishedAt'))and len(main_preview)==len(expected_ids)and sorted((row.get('caseId'),row.get('family'))for row in main_preview)==expected_keys and len(main_runtimes)==1 and all(qualified_preview(row)for row in main_preview)and main_record.get('profile')=='smoke'and main_record.get('rounds')==1 and main_job.get('profile')=='smoke'and main_job.get('rounds')==1
        data=[]
        for rank in ranks:
            item=evidence(rank);record=(item or{}).get('record',{});result=(item or{}).get('result')or{};job=(item or{}).get('job')or{}
            rows=[row for row in result.get('observations',[])if row.get('surface')=='browser:editor']
            previews=[row for row in rows if row.get('operation')=='input-preview']
            deliveries=[row for row in rows if row.get('operation')=='download-closure'and row.get('status')=='passed'and finite(row.get('metrics',{}).get('initialGzipBytes'))and finite(row.get('metrics',{}).get('gzipBytes'))and 0<=row['metrics']['initialGzipBytes']<=row['metrics']['gzipBytes']]
            profile=record.get('profile',campaign.get('measurementConfig',{}).get('invocation',{}).get('profile','unrecorded'))
            rounds=record.get('rounds',campaign.get('measurementConfig',{}).get('invocation',{}).get('rounds'))
            reasons=[]
            if profile!='smoke'or rounds!=1 or job.get('profile')!='smoke'or job.get('rounds')!=1:reasons.append('Requires the explicitly recorded single-changed-input smoke/1 protocol')
            if not expected or len(set(expected_ids))!=len(expected_ids)or len(expected_families)!=len(expected_ids):reasons.append('Frozen main one-case-per-family invocation cohort unavailable')
            if not item or cohort(item)!=expected:reasons.append('Exact ordered source/family/label cohort differs from frozen main or is unavailable')
            if not result.get('finishedAt'):reasons.append('Invocation envelope is not complete')
            if not main_complete:reasons.append('Frozen-main editor smoke/1 reference did not completely qualify')
            if len(previews)!=len(expected_ids)or sorted((row.get('caseId'),row.get('family'))for row in previews)!=expected_keys:reasons.append('Complete common editor case keys are unavailable')
            if len(main_runtimes)!=1 or {row.get('runtime')for row in previews}!=main_runtimes:reasons.append('Actual browser runtime differs from main or is unavailable')
            if any(not qualified_preview(row)for row in previews):reasons.append('Every common changed-DOM preview must qualify with one valid public interaction clock')
            latency=sum(row['samplesMs'][0]for row in previews)if not reasons else None
            tags=[rank.get('integration','unknown')]
            if rank.get('draft'):tags.append('draft')
            if rank.get('sourceEvidence')not in (None,rank['id']):tags.append('core source = '+rank['sourceEvidence'])
            data.append(dict(candidate=rank.get('label',rank['id']),id=rank['id'],state=', '.join(tags),integration=rank.get('integration'),sourceEvidence=rank.get('sourceEvidence'),draft=bool(rank.get('draft')),profile=profile,rounds=rounds,resultPath=(item or{}).get('path'),startedAt=result.get('startedAt'),finishedAt=result.get('finishedAt'),initialEditorGzipBytes=median([row['metrics']['initialGzipBytes']for row in deliveries])if deliveries else None,throughAttemptedFamilyGzipBytes=median([row['metrics']['gzipBytes']for row in deliveries])if deliveries else None,observedDeliveryRows=len(deliveries),deliveryRequests=[row['metrics'].get('requests')for row in deliveries],deliveredCaseCount=len(previews),qualifiedPreviewCount=sum(row.get('status')=='passed'for row in previews),matchedFamilyCount=len(expected_ids)if expected else None,commonCaseIds=expected_ids if not reasons else None,actualBrowserRuntimes=sorted({str(row.get('runtime'))for row in previews}),matchedChangedDomPortfolioMs=latency,latencyStatus='qualified observed matched portfolio'if latency is not None else 'N/A: '+'; '.join(reasons),editorPreviewEvidence=[{key:row.get(key)for key in ('caseId','family','runtime','mode','status','samplesMs','metrics')}for row in previews]))
        if not data:return
        figure,axes=self.plt.subplots(1,3,figsize=(16,max(4,len(data)*.43)),sharey=True)
        fields=('initialEditorGzipBytes','throughAttemptedFamilyGzipBytes','matchedChangedDomPortfolioMs')
        for ax,field,title,unit in zip(axes,fields,('Editor initial request closure','Editor through attempted family portfolio',f'Matched {len(expected_ids)if expected else "unknown"}-family changed-input DOM portfolio'),('KiB, observed candidate bytes','KiB, observed candidate bytes','ms, single observed interaction per case')):
            for y,row in enumerate(data):
                value=row[field];exploratory=row['integration']in ('conflicting-head','branch-base')
                if finite(value):ax.barh(y,value/1024 if field!='matchedChangedDomPortfolioMs'else value,color='#aa5b27'if exploratory else '#718ca1')
                else:ax.text(0,y,'N/A',va='center',fontsize=7)
            ax.set_yticks(range(len(data)),[f"{row['candidate']} [{row['state']}; {row['profile']}/{row['rounds']}r]"for row in data],fontsize=7)
            ax.set_title(title,fontsize=9);ax.set_xlabel(unit,fontsize=8)
        axes[0].invert_yaxis()
        self.save(figure,'pr-editor-delivery-and-dom','PR editor delivery and observed matched interactions','Actual target website assets, not static IIFE/package size. Closure includes initial assets and all attempted representative-family edits; exact observed bytes remain useful when preview qualification is incomplete. DOM latency requires every identical ordered case, matching actual browser and explicit smoke/1 changed-input protocol; it includes current SVG/authority and two animation frames, not pixel/geometry fidelity. Unpaired single observations, no calibrated ratios/CIs; never mixed with full-main eight-edit bursts. Core source aliases do not reuse editor measurements. Orange heads/own bases remain exploratory.',data)

    def reference(self, observations, name='pinned-parser-score', title='Pinned Mermaid same-case portable parser comparison'):
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
            data.append(dict(parser=engine,referenceVersions=sorted({str(r.get('metrics',{}).get('referenceVersion'))for r in own}),rounds=rounds,passedPortableCriteria=passed,evaluatedPortableCriteria=total,criterionCountScope='sum across recorded rounds, not unique criteria',sharedCases=len(shared),sharedSuccessPortfolioMs=median(portfolios)if portfolios else None,observedPortfolioMs=portfolios,unscoredCriteria=sum(r.get('metrics',{}).get('unscoredCriteria',0)for r in own)))
        figure,axes=self.plt.subplots(1,2,figsize=(10,4))
        for index,d in enumerate(data):
            if d['evaluatedPortableCriteria']:
                axes[0].bar(index,100*d['passedPortableCriteria']/d['evaluatedPortableCriteria'],color='#147d92')
                axes[0].text(index,1,f"{d['passedPortableCriteria']}/{d['evaluatedPortableCriteria']}",ha='center',va='bottom',rotation=90,color='white')
            if d['sharedSuccessPortfolioMs']is not None:axes[1].bar(index,d['sharedSuccessPortfolioMs'],color='#718ca1')
        for ax in axes:ax.set_xticks(range(len(engines)),engines)
        axes[0].set_ylim(0,100);axes[0].set_ylabel('Passed / evaluated portable criteria, %')
        axes[1].set_ylabel(f'Public parse portfolio, ms; {len(shared)} shared-qualified cases')
        self.save(figure,name,title,'Same independently expected criteria; displayed criterion counts sum recorded rounds, not unique criteria. Generated layout counts and other nonportable criteria are explicitly unscored. Shared-success cost requires every parser and every round to pass. Historical imported tests and native-operation suites remain separate.',data)

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

    def html(self, report, campaign, supplemental=None, correction=None, reference_overlay=None):
        reduced=dict(run={k:report.get(k)for k in ('status','startedAt','finishedAt','profile','rounds','driverRevision','targetRevision')},suitePins={suite['id']:suite['pin']for suite in report.get('suites',[])if suite.get('pin')},prCampaign={k:campaign.get(k)for k in ('frozenAt','main','units','protocols','measurementConfig','measurementDriver')}if campaign else None,communityCli={**{k:supplemental.get(k)for k in ('startedAt','latencyFinishedAt','finishedAt','rounds','policy','resourcePolicy','executionOrder')},'resourceObserver':supplemental.get('evidence',{}).get('resourceObserver'),'composition':supplemental.get('composition'),'nativeBinding':supplemental.get('reportingNativeBinding')}if supplemental else None,invocationCorrection=correction,referenceCorrection=reference_overlay,communityReplay=getattr(self,'community_replay',None),currentRun=getattr(self,'current_run',None),additionalRun=getattr(self,'additional_run',None),figures=self.items,gaps=self.gaps)
        (self.out/'chart-data.json').write_text(json.dumps(reduced,indent=2,allow_nan=False)+'\n')
        cards=[]
        for item in self.items:
            svg=(self.out/(item['name']+'.svg')).read_bytes()
            src='data:image/svg+xml;base64,'+base64.b64encode(svg).decode()
            rows=item['rows'];keys=list(dict.fromkeys(key for row in rows for key in row))
            table='<table><thead><tr>'+''.join('<th>'+escape(str(key))+'</th>'for key in keys)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+escape(json.dumps(row.get(key),ensure_ascii=False) if isinstance(row.get(key),(dict,list))else str(row.get(key,'')))+'</td>'for key in keys)+'</tr>'for row in rows)+'</tbody></table>'
            cards.append('<section><h2>'+escape(item['title'])+'</h2><p>'+escape(item['note'])+'</p><img alt="'+escape(item['title'])+'" src="'+src+'"><p>'+ ' · '.join('<a href="'+item['name']+'.'+extension+'">'+extension.upper()+'</a>'for extension in ('svg','png','pdf'))+'</p><details><summary>Reduced evidence rows</summary>'+table+'</details></section>')
        if reduced['additionalRun']:
            evidence=reduced['additionalRun']
            cards.append('<section><h2>Additional maintained suite ledger</h2><p>'+escape(evidence['policy'])+'</p><p>Target '+escape(evidence['targetRevision'])+'; '+escape(evidence['startedAt'])+' → '+escape(evidence['finishedAt'])+'</p>'+''.join('<h3>'+escape(row['id'])+' — '+escape(row['status'])+'</h3><details><summary>Actual gates, completion, source and artifacts</summary><pre>'+escape(json.dumps(row,indent=2))+'</pre></details>'for row in evidence['suites'])+'</section>')
        metadata=escape(json.dumps(dict(run=reduced['run'],invocationCorrection=correction,referenceCorrection=reference_overlay,communityReplay=reduced['communityReplay'],currentRun=reduced['currentRun'],additionalRun=reduced['additionalRun']),indent=2))
        gaps=''.join('<li>'+escape(gap)+'</li>'for gap in self.gaps)
        embedded=json.dumps(reduced,allow_nan=False).replace('<','\\u003c')
        html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agentic Mermaid benchmark evidence</title><style>body{font:15px system-ui;max-width:1200px;margin:auto;padding:24px;color:#20313e;background:#f4f7f8}section{background:white;padding:20px;margin:24px 0;border-radius:10px}img{max-width:100%;height:auto}table{border-collapse:collapse;font-size:12px;display:block;overflow:auto}td,th{padding:7px;border:1px solid #ddd;text-align:left;max-width:400px;overflow-wrap:anywhere}input{padding:9px;width:90%}pre{white-space:pre-wrap}a{color:#126c85}</style><h1>Benchmark evidence</h1><p>Separate work, clocks and qualification scopes. Missing and failed capabilities are never free wins. No weighted overall score or radar ranking is invented.</p><details><summary>Run identity</summary><pre>'''+metadata+'''</pre></details><label>Filter charts and evidence <input id="filter" type="search" placeholder="e.g. browser, parser, PR, memory"></label>'''+''.join(cards)+'<h2>Missing evidence</h2><ul>'+gaps+'</ul><script type="application/json" id="benchmark-data">'+embedded+'''</script><script>document.querySelector('#filter').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('section').forEach(s=>s.hidden=!s.textContent.toLowerCase().includes(q))});</script></html>'''
        (self.out/'index.html').write_text(html)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',type=Path,required=True);parser.add_argument('--prs',type=Path);parser.add_argument('--out',type=Path)
    parser.add_argument('--validate-only',action='store_true',help='Validate explicit evidence selection and emit provenance JSON; stdlib only, no plots or file writes')
    parser.add_argument('--invocation-correction',type=Path,help='Explicit invocation-corrected.json with sibling reconciliation.json; reporting overlay for main invocation only')
    parser.add_argument('--reference-correction',type=Path,help='Explicit public-positive-eligibility-v2 reference-score-result.json with reviewed eligibility/raw/diagnostic companions')
    parser.add_argument('--community-run',type=Path,help='Explicit completed all84 community directory; replaces only community evidence, preserving original run ledger')
    parser.add_argument('--allow-community-target-change',action='store_true',help='Admit an explicitly proven newer community-only target; all other original suites retain their original target')
    parser.add_argument('--current-run',type=Path,help='Separate completed current-target Dave and same-fixture pinned-reference supplemental run; never replaces original suite evidence')
    parser.add_argument('--additional-run',type=Path,help='Separate completed maintained target-owned suite ledger; requires the explicit current target selection and never merges ranks')
    parser.add_argument('--cli-native-proof',type=Path,help='Explicit bit-identical clean-source reproduction proof binding supplemental Agentic native CLI bytes to the frozen target')
    args=parser.parse_args()
    if args.allow_community_target_change and not args.community_run:parser.error('--allow-community-target-change requires --community-run')
    if not args.validate_only and args.out is None:parser.error('--out is required unless --validate-only is selected')
    report=load(args.run/'report.json')
    if not report:parser.error('--run must contain report.json')
    scores=load(find(args.run,'community-ranks.json'),{})
    community=load(find(args.run,'community-result.json'),{})
    inputs=load(find(args.run,'community-inputs.json'),{})
    community_metadata=None
    if args.community_run:
        try:community,scores,inputs,community_metadata=community_overlay(report,inputs,args.community_run,args.run,args.allow_community_target_change)
        except (ValueError,OSError,TypeError,KeyError,tarfile.TarError,subprocess.SubprocessError)as error:parser.error(str(error))
    campaign=load(args.prs/'pr-ranks.json')if args.prs else None
    correction_result=None;correction_metadata=None
    if args.invocation_correction:
        try:correction_result,correction_metadata=invocation_correction(report,args.invocation_correction)
        except (ValueError,OSError,TypeError,KeyError)as error:parser.error(str(error))
    reference_result=None;reference_metadata=None
    if args.reference_correction:
        try:reference_result,reference_metadata=reference_correction(report,args.reference_correction,args.run,campaign)
        except (ValueError,OSError,TypeError,KeyError,tarfile.TarError)as error:parser.error(str(error))
    current_ledger=None;current_dave_result=None;current_reference_result=None;current_metadata=None
    if args.current_run:
        try:
            current_ledger,current_dave_result,current_reference_result,current_metadata=current_supplement(report,args.run,args.current_run,reference_metadata)
            if community_metadata and any(current_metadata[key]!=community_metadata[key]for key in ('targetRevision','packageRoot','candidateSha256')):raise ValueError('Explicit current and expanded-community measurements use different current targets')
        except (ValueError,OSError,TypeError,KeyError,tarfile.TarError,subprocess.SubprocessError)as error:parser.error(str(error))
    additional_metadata=None
    if args.additional_run:
        try:
            expected_target=current_metadata or community_metadata
            if not expected_target:raise ValueError('--additional-run requires --current-run or an explicit --community-run current-target selection')
            additional_metadata=additional_supplement(report,args.additional_run,expected_target)
        except (ValueError,OSError,TypeError,KeyError,tarfile.TarError,subprocess.SubprocessError)as error:parser.error(str(error))
    observations=[]
    for suite in report.get('suites',[]):
        result=correction_result if suite.get('id')=='invocation'and correction_result else reference_result if suite.get('id')=='pinned-reference-score'and reference_result else suite.get('result')
        observations.extend((result or{}).get('observations',[]))
    if community.get('observations'):
        replaced=('community','community-browser','community-cli')if community_metadata else ('community','community-browser')
        observations=[row for row in observations if row.get('suite')not in replaced]+community['observations']
    enrolled=[row for row in inputs.get('workloads',[])if 'core-graph-batch'not in row.get('features',[])]
    supplemental,supplemental_result=completed_cli(args.community_run or args.run,args.cli_native_proof)
    ranks=scores.get('ranks',[])
    if supplemental:
        ranks=[rank for rank in ranks if rank.get('surface')!='cli:end-to-end']+supplemental['ranks']
        observations=[row for row in observations if row.get('suite')!='community-cli']+supplemental_result.get('observations',[])+supplemental_result.get('diagnostics',[])
    if args.validate_only:
        cli_metadata=dict(directory=supplemental['reportingDirectory'],familyRanks=supplemental['reportingFamilyRanks'],composition=supplemental_result.get('composition'),target=supplemental['evidence']['target'],nativeBinding=supplemental['reportingNativeBinding'])if supplemental else None
        print(json.dumps(dict(protocol='unified-report-selection-v1',communityDirectory=str((args.community_run or (find(args.run,'community-result.json')or args.run).parent).resolve()),communityReplay=community_metadata,cliSupplement=cli_metadata,invocationCorrection=correction_metadata,referenceCorrection=reference_metadata,currentRun=current_metadata,additionalRun=additional_metadata),allow_nan=False))
        return
    figures=Figures(args.out)
    if additional_metadata:figures.additional_run=additional_metadata
    if current_metadata:
        figures.current_run=current_metadata
        figures.gaps.append('Separate current-target supplemental run '+current_metadata['targetRevision']+' measured '+current_metadata['startedAt']+' → '+current_metadata['finishedAt']+'. Dave and parser panels are separate; original full-ledger and old-target corrections are not relabeled current.')
        figures.current_dave(current_dave_result)
        figures.reference(current_reference_result['observations'],'current-pinned-parser-score','Current target: pinned Mermaid same-case portable parser comparison')
    if community_metadata:
        figures.community_replay=community_metadata
        figures.gaps.append('Explicit all84 community replay '+str(community_metadata['startedAt'])+' → '+str(community_metadata['finishedAt'])+': '+community_metadata['qualificationChange']+' Original full-run aggregate status '+str(report.get('status'))+' and raw community ledger remain unchanged; only community plots use the replay.')
    if correction_metadata:
        figures.invocation_correction=correction_metadata
        figures.gaps.append('Explicit invocation reporting correction: '+correction_metadata['protocolChange']+' Original aggregate '+str(report.get('status'))+' and original invocation '+str(correction_metadata['originalInvocationStatus'])+' remain unchanged. Scoped rerun '+str(correction_metadata.get('correction',{}).get('startedAt'))+' → '+str(correction_metadata.get('correction',{}).get('finishedAt'))+'; reconciliation '+str(correction_metadata.get('createdAt'))+'. Only exact styles partition rows are replaced; this is mixed-run protocol evidence, not a new full run or broader product fidelity.')
    if reference_metadata:
        figures.reference_correction=reference_metadata
        census=reference_metadata['evidence']
        figures.gaps.append('Explicit pinned-reference baseline protocol repair: '+str(census['eligibleInputCount'])+' eligible positives / '+str(census['rawInputCount'])+' retained raw sources; '+str(census['diagnosticInputCount'])+' independently reviewed diagnostic inputs remain available. Original aggregate '+str(report.get('status'))+' and original reference '+str(reference_metadata['originalSuiteStatus'])+' statuses are unchanged. Fresh scoped rerun '+str(reference_metadata.get('correctedStartedAt'))+' → '+str(reference_metadata.get('correctedFinishedAt'))+'; not product improvement or a new full run.')
    if not supplemental:figures.gaps.append('Completed supplemental CLI cohort unavailable; original CLI ranks remain labeled by their original evidence.')
    family_ranks=scores.get('familyRanks',[])
    if supplemental:family_ranks=[rank for rank in family_ranks if rank.get('surface')!='cli:end-to-end']+supplemental['reportingFamilyRanks']
    figures.coverage(observations);figures.rank_bars(ranks);figures.family_ranks(family_ranks);figures.svg_scatter(ranks,observations,enrolled)
    figures.diagnostics(observations);figures.cli_resources(supplemental,supplemental_result);figures.prs(campaign);figures.pr_payload(campaign);figures.pr_coverage(campaign);figures.pr_editor(campaign);figures.reference(observations);figures.owning_tests(report);figures.html(report,campaign,supplemental,correction_metadata,reference_metadata)
    print(json.dumps(dict(figures=len(figures.items),out=str(args.out.resolve()),gaps=figures.gaps),indent=2))


if __name__=='__main__':main()
