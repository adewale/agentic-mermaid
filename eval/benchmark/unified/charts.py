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
from datetime import datetime
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evidence import read_document
from tool_versions import assert_tool_versions
from statistics import median
from textwrap import fill


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load(path, default=None):
    return read_document(path) if path and (path.is_file() or Path(str(path) + '.gz').is_file()) else default


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


def cli_resource_overlay(supplemental,result,directory):
    fresh=load(directory/'community-cli-result.json');ranks=load(directory/'ranks.json')
    if not supplemental or not result or not fresh or not ranks or fresh.get('resourceOnly')is not True or fresh.get('resourcePasses')!=1 or fresh.get('latencyMeasured')is not False or fresh.get('evidence',{}).get('resourceOnly')is not True or not fresh.get('finishedAt')or fresh.get('observations')!=[]or fresh.get('ranks')!=[]or fresh.get('latencyFinishedAt')is not None or fresh.get('resourceRanks')!=ranks.get('resourceRanks')or fresh.get('evidence')!=ranks.get('evidence'):raise ValueError('CLI resource overlay requires completed one-pass resource-only evidence; no new/reused latency ranks')
    evidence=fresh['evidence'];base=evidence.get('baselineCli',{})
    if Path(base.get('directory','')).resolve()!=Path(supplemental['reportingDirectory']).resolve()or any(base.get(field)!=result.get(field)for field in ('startedAt','finishedAt','latencyFinishedAt')):raise ValueError('Resource-only evidence binds another baseline CLI latency window')
    for field in ('target','cohort','variants'):
        if evidence.get(field)!=result.get('evidence',{}).get(field):raise ValueError('Resource-only evidence changes fixed-work CLI bindings/cohort/target: '+field)
    if Path(evidence.get('sourceRun','')).resolve()!=Path(result['evidence']['sourceRun']).resolve():raise ValueError('Resource-only evidence uses another parent community qualification')
    observer=evidence.get('resourceObserver',{});provenance=observer.get('provenance',{})
    if not observer.get('version')or 'gnu time'not in observer['version'].lower()or not provenance.get('file')or load(Path(provenance['file']))!=provenance.get('value'):raise ValueError('Resource observer lacks actual GNU time version and admitted acquisition provenance')
    verify_file_proofs([observer])
    expected_keys=Counter(canonical([rank['implementation'],'cli:end-to-end',case,'resource-diagnostic',rank['output'],'instrumented-resource-only'])for rank in result.get('resourceRanks',[])for case in rank.get('requiredCaseIds',[]))
    fresh_keys=Counter(canonical([tool(row),row.get('surface'),row.get('caseId'),row.get('operation'),row.get('format'),row.get('mode')])for row in fresh.get('diagnostics',[]))
    if expected_keys!=fresh_keys or any(row.get('samplesMs')for row in fresh.get('diagnostics',[])):raise ValueError('Resource-only overlay changes declared fixed per-case diagnostic keys or contains latency samples')
    old_rows=result.get('diagnostics',[])
    observer_rows=[row for row in old_rows if row.get('caseId')=='resource-observer'];old_slots=[row for row in old_rows if row.get('caseId')!='resource-observer']
    if any(row.get('status')!='blocked'or 'GNU /usr/bin/time is unavailable'not in str(row.get('detail',''))for row in observer_rows):raise ValueError('Unkeyed original resource metadata is not the known unavailable-observer capability row')
    if not old_slots:
        if len(observer_rows)not in (1,sum(expected_keys.values())):raise ValueError('Original unavailable-observer capability count differs from declared fixed-work slots')
    elif Counter(canonical([tool(row),row.get('surface'),row.get('caseId'),row.get('operation'),row.get('format'),row.get('mode')])for row in old_slots)!=fresh_keys:raise ValueError('Resource-only overlay changes previously observed resource keys')
    metadata=dict(directory=str(directory.resolve()),startedAt=fresh['startedAt'],finishedAt=fresh['finishedAt'],resourcePasses=1,latencyMeasured=False,baselineLatencyRounds=result['rounds'],originalFinishedAt=result['finishedAt'],originalResourceRows=len(result.get('diagnostics',[])),originalQualifiedResourceRanks=sum(row.get('qualified')is True for row in result.get('resourceRanks',[])),freshQualifiedResourceRanks=sum(row.get('qualified')is True for row in fresh.get('resourceRanks',[])),observer=observer,policy='Explicit later one-pass fixed-work GNU-time resource-only observation. The rounds3 field identifies earlier latency, not repeated resource passes. Original missing-observer diagnostics remain immutable; every existing CLI latency observation/rank/window is preserved. RSS/CPU are scoped diagnostics, not a latency rerun or allocation rank.')
    combined=dict(result,diagnostics=fresh['diagnostics'],resourceRanks=fresh['resourceRanks'],evidence=dict(result['evidence'],resourceObserver=observer),resourceDisplayCorrection=metadata)
    display=dict(supplemental,resourceRanks=fresh['resourceRanks'],evidence=combined['evidence'],resourceDisplayCorrection=metadata)
    return display,combined,metadata


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


def additional_supplement(original, directory, expected_target,baseline_target=None):
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
        artifacts=[Path(path)if Path(path).is_absolute()else directory/path for path in result.get('artifacts',[])]
        qualification=next((load(path)for path in artifacts if path.name=='qualification-status.json'),None)
        gates=next((load(path)for path in artifacts if path.name=='gates.json'),None)
        effective=qualification.get('status',suite.get('status'))if qualification else suite.get('status')
        rows.append(dict(id=suite['id'],status=effective,recordedStatus=suite.get('status'),elapsedMs=suite.get('elapsedMs'),source=str(source),sourceRevision=metadata['targetRevision'],sourceGitBlob=blob,log=str(directory/suite['log'])if suite.get('log')else None,artifacts=result.get('artifacts',[]),prerequisites=suite.get('prerequisites',[]),gaps=result.get('gaps',[]),observations=evidence,qualification=qualification,gates=gates))
    configuration=load(directory/'invocation.json',{});baseline_file=configuration.get('baselineTarball');baseline_sha=configuration.get('baselineSha256')
    if not baseline_file or not baseline_sha or hashlib.sha256(Path(baseline_file).read_bytes()).hexdigest()!=baseline_sha:raise ValueError('Additional diagnostic comparison lacks actual frozen baseline archive identity')
    with tarfile.open(baseline_file,'r:*')as archive:baseline_package=json.load(archive.extractfile('package/package.json'))
    if baseline_target and baseline_target.get('candidateSha256')!=baseline_sha:raise ValueError('Additional actual baseline differs from selected prior-main evidence')
    for row in rows:
        qualification=row.get('qualification')
        if qualification and (qualification.get('candidateSha')!=metadata['candidateSha256']or qualification.get('baselineSha')!=baseline_sha):raise ValueError('Additional owning qualification uses different candidate/baseline archives')
    metadata.update(baseline=dict(tarball=baseline_file,sha256=baseline_sha,version=baseline_package.get('version'),revision=(baseline_target or{}).get('targetRevision')),historicalBudgetApplicable=False,qualificationStatus='uncalibrated'if any(row['status']=='uncalibrated'for row in rows)else ledger.get('status'),qualificationPolicy='Diagnostic actual candidate versus the explicitly supplied previous-main baseline. Historical-anchor constants do not identify this baseline. Historical published-release budget qualification is not established; completed uncalibrated gates are not performance-qualified.')
    metadata.update(policy='Additional maintained target-owned suite ledger; source Git objects and actual target archive verified. No community/PR ranks or original suite statuses are replaced.',suites=rows)
    return metadata


def invocation_attempt_census(directory,result,inputs,package):
    """Executed attempts, separately from success and public-function witnesses."""
    rows=result.get('observations',[]);ids={row['id']for row in inputs['workloads']};gaps=[];imports=[];unknown=[]
    def entry(value):
        if isinstance(value,str):return value
        return entry(value.get('import',value.get('default')))if isinstance(value,dict)else None
    exports={name:entry(value)for name,value in load(package/'package.json',{}).get('exports',{}).items()if entry(value)and not entry(value).endswith('.json')and not name.startswith('./browser')}
    jobs={}
    for path in (directory/'invocation/library').glob('*.job.json'):
        job=load(path,{});runtime=path.name.split('-',1)[0];key=(job.get('exportName'),runtime,job.get('round'))
        if key in jobs:raise ValueError('Duplicate actual invocation library job slot')
        jobs[key]=(path,job)
    for name,file in exports.items():
        for runtime in ('node','node22','bun'):
            for round in (1,2,3):
                key=(name,runtime,round);slot=jobs.get(key);observed=[]
                if slot:
                    path,job=slot;raw=load(Path(job.get('out','')),{});observed=raw.get('rows',[])
                    if job.get('workloads')!=inputs['workloads']or Path(job.get('entry','')).resolve()!=(package/file).resolve()or job.get('full')is not True:raise ValueError('Library job changes frozen representative inputs/entry/full protocol')
                    expected='bun:'if runtime=='bun'else 'node:22.'if runtime=='node22'else 'node:24.'
                    imported=[row for row in observed if row.get('operation')=='import'and row.get('caseId')=='package-import'and row.get('metrics',{}).get('round')==round and str(row.get('runtime','')).startswith(expected)]
                    completed=any(row.get('operation')=='memory-checkpoint'and row.get('metrics',{}).get('round')==round for row in observed)
                    if len(imported)!=1 or not completed:gaps.append('Library '+str(key)+' lacks one actual runtime import and end-of-portfolio checkpoint')
                    if not raw.get('publicFunctionExports')and raw.get('publicFunctionExports')!=[]:gaps.append('Library '+str(key)+' lacks actual public function export census')
                    operations={str(row.get('operation','')).split(':',1)[0]for row in observed}
                    missing=[function for function in raw.get('publicFunctionExports',[])if function not in operations]
                    if missing:unknown.append(dict(export=name,runtime=runtime,round=round,functions=missing,scope='No direct operation witness; helper/preparation calls may occur. Owning functionality suites remain separate.'))
                    representative={row.get('caseId')for row in observed if row.get('caseId')in ids}
                    if representative and representative!=ids:gaps.append('Library '+str(key)+' omitted representative family attempt slots')
                    # A finished sidecar alone cannot substitute for the actual enrolled rows.
                    actual=[row for row in rows if row.get('surface')=='library:'+name and row.get('metrics',{}).get('round')==round and str(row.get('runtime','')).startswith(expected)]
                    if Counter(map(canonical,actual))!=Counter(map(canonical,observed)):raise ValueError('Library worker sidecar differs from enrolled actual observations')
                else:gaps.append('Library missing actual job '+str(key))
                imports.append(dict(export=name,runtime=runtime,round=round,actualJob=bool(slot),observations=len(observed)))
    surfaces=('mcp:stdio','mcp:http-sse','mcp:hosted-streamable','mcp:hosted-modern','browser:global','browser:lazy','browser:worker','browser:editor')
    cells=[]
    for surface in surfaces:
        for round in (1,2,3):
            attempted={row.get('caseId')for row in rows if row.get('surface')==surface and row.get('metrics',{}).get('round')==round and row.get('caseId')in ids}
            if attempted!=ids:gaps.append(surface+' round'+str(round)+' lacks '+str(len(ids-attempted))+' representative family attempts')
            cells.append(dict(surface=surface,round=round,attemptedFamilies=len(attempted),expectedFamilies=len(ids)))
    manifests=list((directory/'invocation/cli').glob('**/cli-program.json'))
    if len(manifests)!=2:gaps.append('Installed and native CLI program execution manifests are not both present')
    cli_cells=[]
    for path in manifests:
        manifest=load(path,{});native=path.parent.name=='native';prefix='cli:native-binary'if native else 'cli'
        if manifest.get('rounds')!=3 or manifest.get('helperVerbRounds')!=1:raise ValueError('CLI execution manifest misstates repeated versus single functional calls')
        if not manifest.get('formats')or set(manifest.get('inputModes',[]))!={'stdin','file'}:gaps.append('CLI full-profile render format/input-mode inventory is missing')
        for case in sorted(ids):
            for verb in ('parse','verify','describe','format','preview'):
                if len([row for row in rows if row.get('surface')==prefix+':stdin'and row.get('caseId')==case and row.get('operation')==verb])!=1:gaps.append('CLI missing/duplicate single-call helper '+str((prefix,case,verb)))
            for surface,operation,format in [(prefix+':'+mode,'render',format)for mode in manifest.get('inputModes',[])for format in manifest.get('formats',[])]+[(prefix+':watch','render','svg')]:
                matches=[row for row in rows if row.get('surface')==surface and row.get('caseId')==case and row.get('operation')==operation and row.get('format')==format]
                if len(matches)!=1:gaps.append('CLI missing/duplicate actual '+str((surface,case,format)));continue
                row=matches[0];metrics=row.get('metrics',{});evidence=load(Path(metrics.get('roundEvidenceFile','')),[])
                if len(evidence)!=3 or {attempt.get('round')for attempt in evidence}!={1,2,3}or metrics.get('attemptedRounds')!=3:gaps.append('CLI does not establish all three actual attempts '+str((surface,case,format)))
                cli_cells.append(dict(surface=surface,caseId=case,format=format,attempts=len(evidence),qualifiedRounds=metrics.get('qualifiedRounds'),status=row.get('status')))
    return dict(completeAttempts=not gaps,completeness='complete declared attempt census'if not gaps else 'incomplete declared attempt census',gaps=gaps,libraryImportCohort=imports,transportFamilyCohort=cells,cliRenderWatchCohort=cli_cells,publicFunctionsWithoutDirectWitness=unknown,scope='Complete attempts never means all passed or every public function exercised. Render/watch rounds are sidecar-observed; common CLI helper verbs intentionally run once. Nonrenderer exports retain import/discovery and explicit unmeasured function witnesses.')


def current_invocation_supplement(original,directory,original_directory,assets_file,dave_directory=None):
    ledger,metadata=current_target_ledger(original,directory,required_suites=('invocation','dave','pinned-reference-score'))
    configuration=load(directory/'invocation.json',{})
    selected=[suite for suite in ledger.get('suites',[])if suite.get('selected')and suite.get('status')!='skipped']
    if {suite['id']for suite in selected}!={'invocation','dave','pinned-reference-score'}:raise ValueError('Latest invocation/Dave/reference supplement must retain its three independently selected suites')
    result=next(suite['result']for suite in selected if suite['id']=='invocation');inputs=load(directory/'invocation/invocation-inputs.json');baseline=load(original_directory/'invocation/invocation-inputs.json')
    if not result.get('finishedAt')or load(directory/'invocation/invocation.json')!=result or not inputs or not baseline or inputs.get('workloads')!=baseline.get('workloads')or inputs.get('provenance')!=baseline.get('provenance'):raise ValueError('Current invocation supplement changes literal representative inputs/reference or lacks complete raw result')
    if configuration.get('profile')!='full'or configuration.get('rounds')!=3:raise ValueError('Current invocation supplement must explicitly record full/three-round execution')
    package=Path(metadata['packageRoot']);tarball=metadata['candidateTarball'];admitted=0
    with tarfile.open(tarball,'r:*')as archive:
        for member in archive.getmembers():
            if member.isfile()and member.name.startswith('package/'):
                file=package/member.name[len('package/'):]
                if '..'in Path(member.name).parts or not file.is_file():raise ValueError('Current invocation packed file is absent or escapes archive root')
                if archive.extractfile(member).read()!=file.read_bytes():raise ValueError('Current invocation installed package differs from actual admitted archive bytes')
                admitted+=1
    if not admitted:raise ValueError('Current invocation archive has no actual installed files')
    dependencies=load(directory/'invocation/library/qualification-dependencies.json',{})
    if not dependencies:
        candidates=list((directory/'invocation').glob('**/qualification-dependencies.json'))
        if len(candidates)==1:dependencies=load(candidates[0],{})
    parser=dependencies.get('nodeXmlParser',{})
    if parser.get('name')!='saxes'or not parser.get('version')or load(Path(parser.get('packageJson','')),{}).get('version')!=parser['version']:raise ValueError('Current invocation requires the actual repaired library qualifier dependency provenance')
    verify_file_proofs([dependencies.get('bundle',{}),dependencies.get('worker',{})])
    if not assets_file:raise ValueError('Latest complete invocation requires explicit --current-invocation-assets native/site clean-build proof')
    assets=load(assets_file,{})
    if Path(assets.get('root','')).resolve()!=Path(ledger.get('targetRoot','')).resolve()or Path(assets.get('packageRoot','')).resolve()!=Path(metadata['packageRoot']).resolve()or assets.get('candidateSha256')!=metadata['candidateSha256']or assets.get('sourceUnchanged')is not True or assets.get('sourceBefore')!=assets.get('sourceAfter')or assets.get('sourceBefore',{}).get('revision')!=metadata['targetRevision']or assets.get('sourceBefore',{}).get('status')!='':raise ValueError('Latest invocation native/site build proof differs from actual frozen clean-source target')
    for path,blob in assets.get('sourceBefore',{}).get('objects',{}).items():
        actual=subprocess.check_output(['git','-C',assets['root'],'rev-parse',metadata['targetRevision']+':'+path],text=True).strip()
        if actual!=blob:raise ValueError('Latest native/site build source Git object changed: '+path)
    steps=assets.get('steps',[])
    if any(not any(step.get('command')==['bun','run',command]and step.get('exitCode')==0 and step.get('cwd')==assets['root']and step.get('startedAt')and step.get('finishedAt')for step in steps)for command in ('build:binary','website')):raise ValueError('Latest invocation lacks actual successful public native/site build steps')
    native=assets.get('native',{});website=assets.get('website',{})
    if Path(native.get('path','')).resolve()!=(Path(assets['root'])/'dist/am').resolve():raise ValueError('Latest invocation native executable is outside the actual target build path')
    actual_site=configuration.get('site')or str(Path(assets['root'])/'website/public')
    if Path(website.get('root','')).resolve()!=Path(actual_site).resolve()or not website.get('files'):raise ValueError('Latest invocation browser site differs from admitted built assets')
    verify_file_proofs([native]);verify_file_proofs(website['files'])
    census=invocation_attempt_census(directory,result,inputs,package)
    dave_source=dave_directory or directory
    correction=None
    if dave_directory:
        dave_ledger,dave_target=current_target_ledger(original,dave_directory,required_suites=('dave',))
        if any(dave_target.get(key)!=metadata.get(key)for key in ('targetRevision','packageRoot','candidateSha256')):raise ValueError('Explicit latest Dave display correction uses another actual target/archive')
        old=next(suite for suite in selected if suite['id']=='dave')
        correction=dict(originalDirectory=str(directory),originalStatus=old.get('status'),originalResult=old.get('result'),replacementDirectory=str(dave_directory),replacementStatus=dave_ledger.get('status'),policy='Explicit Dave-only display correction after premeasurement npm-cache acquisition failure. Original failed ledger remains immutable; actual fresh clocks and artifact identity come only from this new completed Dave run.')
    dave,dave_metadata=current_dave(original_directory,dave_source,metadata)
    proxy=dict(original,targetRevision=ledger['targetRevision'],targetRoot=ledger['targetRoot'],packageRoot=ledger['packageRoot'])
    reference_path=directory/'pinned-reference-score/reference-score-result.json'
    reference,reference_metadata=reference_correction(proxy,reference_path,original_directory,target_run=directory)
    if next(suite['result']for suite in selected if suite['id']=='pinned-reference-score')!=reference:raise ValueError('Latest reference result differs from its actual suite ledger')
    counts=Counter(row.get('status')for row in result.get('observations',[]))
    metadata.update(resultFile=str(directory/'invocation/invocation.json'),resultStatus=result.get('status'),attemptCensus=census,counts=dict(counts),observations=len(result.get('observations',[])),representativeCases=len(inputs['workloads']),reference=inputs.get('provenance'),admittedPackageFiles=admitted,qualificationDependencies=dependencies,assetsProof=dict(file=str(assets_file.resolve()),native=native,websiteRoot=website['root'],websiteFiles=len(website['files']),sourceRevision=metadata['targetRevision']),dave=dave_metadata,daveFile=str(dave_source/'dave/browser-report.json'),daveDisplayCorrection=correction,referenceScore=dict(resultFile=str(reference_path),protocol=reference['protocol'],status=reference['status'],evidence=reference['evidence']),policy='Independent latest-target invocation plus Dave/pinned-reference campaign. Actual attempt census distinguishes completion from success; raw observations and statuses retained. Does not replace the older complete run, style correction, DCE community or older Dave/parser results. Representative-family routing is not exhaustive syntax/functionality proof.')
    return result,metadata


def owning_supplement(directory):
    ledger=load(directory/'report.json');configuration=load(directory/'invocation.json',{})
    if not ledger or not ledger.get('finishedAt')or not ledger.get('driverRoot')or not ledger.get('driverRevision'):raise ValueError('Owning supplement requires its complete source-identified report ledger')
    root=Path(ledger['driverRoot']);revision=ledger['driverRevision'];selected=[suite for suite in ledger.get('suites',[])if suite.get('selected')and suite.get('status')!='skipped']
    if not selected:raise ValueError('Owning supplement did not attempt a selected suite')
    suites=[]
    for suite in selected:
        result=suite.get('result')or{}
        if not result.get('finishedAt'):raise ValueError('Owning supplement lacks a completed result envelope')
        proofs=[]
        for item in suite.get('source','').split(', '):
            path=Path(item);path=path if path.is_absolute()else root/path
            owner=root;owner_revision=revision
            try:relative=path.resolve().relative_to(owner.resolve()).as_posix()
            except ValueError:
                owner=Path(ledger.get('targetRoot',''));owner_revision=ledger.get('targetRevision','')
                try:relative=path.resolve().relative_to(owner.resolve()).as_posix()
                except ValueError as error:raise ValueError('Owning suite source is outside its actual driver/target')from error
            blob=subprocess.check_output(['git','-C',str(owner),'rev-parse',owner_revision+':'+relative],text=True).strip()
            if subprocess.run(['git','-C',str(owner),'diff','--quiet',owner_revision,'--',relative],capture_output=True).returncode!=0:raise ValueError('Owning suite source changed since its recorded run: '+relative)
            proofs.append(dict(path=relative,root=str(owner),gitBlob=blob,revision=owner_revision))
        test_rows=[row for row in result.get('observations',[])if row.get('operation')=='owning-tests']
        suites.append(dict(id=suite['id'],status=suite.get('status'),elapsedMs=suite.get('elapsedMs'),source=suite.get('source'),sourceProofs=proofs,workingDirectory=suite.get('workingDirectory'),owningTests=[row.get('metrics')for row in test_rows],observations=len(result.get('observations',[])),gaps=result.get('gaps',[]),artifacts=result.get('artifacts',[]),log=suite.get('log')))
    ownership=configuration.get('ownershipSite');fixture=None
    if ownership:
        pages=[dict(path=str(Path(ownership)/name),sha256=hashlib.sha256((Path(ownership)/name).read_bytes()).hexdigest())for name in ('original.html','candidate.html')]
        fixture=dict(directory=ownership,pages=pages,scope='Historical external frozen original/candidate page pair; fixture-specific ownership proof, not current target performance')
    return dict(directory=str(directory.resolve()),status=ledger.get('status'),profile=ledger.get('profile'),rounds=ledger.get('rounds'),startedAt=ledger.get('startedAt'),finishedAt=ledger.get('finishedAt'),driverRevision=revision,driverDirty=ledger.get('driverDirty'),targetRevision=ledger.get('targetRevision'),packageRoot=ledger.get('packageRoot'),suites=suites,fixture=fixture,policy='Independent owning/environment correction ledger. Actual driver-source Git objects, statuses and process walls remain separate from target archive speed ranks and original suite ledger.')


def harness_blocked(row):
    return 'Strict SVG XML qualification requires the saxes benchmark dependency'in str(row.get('detail',''))


def family_correction(path,campaign):
    manifest=load(path,{})
    if manifest.get('protocol')!='family-empty-svg-eligibility-v1'or not manifest.get('createdAt')or not campaign:raise ValueError('Family correction requires explicit reviewed protocol and selected latest PR campaign')
    targets={row['id']:row for row in campaign.get('targets',[])};corrected=[]
    key=lambda row:{**{field:row.get(field)for field in ('suite','surface','runtime','family','caseId','operation','format','mode')},**({'round':row['metrics']['round']}if 'round'in row.get('metrics',{})else{})}
    for target in manifest.get('targets',[]):
        owner=targets.get(target['id']);coverage=[row for row in campaign.get('coverage',[])if row.get('target')==target['id']and row.get('suite')=='family']
        if not owner or owner.get('revision')!=target.get('targetRevision')or owner.get('tarballSha256')!=target.get('candidateSha256')or len(coverage)!=1 or Path(coverage[0]['resultPath']).resolve()!=Path(target['originalResultPath']).resolve():raise ValueError('Family correction differs from actual frozen target/archive/original coverage path')
        old=load(Path(target['originalResultPath']));fresh=load(Path(target['freshResultPath']));new=load(Path(target['correctedResultPath']))
        if any(not result or result.get('id')!='families'or not result.get('finishedAt')for result in (old,fresh,new)):raise ValueError('Family correction requires complete original/fresh/composed family envelopes')
        old_rows={canonical(key(row)):row for row in old['observations']};fresh_rows={canonical(key(row)):row for row in fresh['observations']};new_rows={canonical(key(row)):row for row in new['observations']}
        if any(len(mapping)!=len(result['observations'])for mapping,result in ((old_rows,old),(fresh_rows,fresh),(new_rows,new)))or set(new_rows)!=set(old_rows):raise ValueError('Family correction changes or duplicates observation keys')
        replacements=target.get('replacements',[]);selected={canonical(item['key'])for item in replacements}
        if selected!={canonical(item)for item in target.get('replacedKeys',[])}or len(selected)!=len(replacements):raise ValueError('Family correction selected key proof differs from replacement records')
        for identity,row in old_rows.items():
            if identity not in selected:
                if new_rows[identity]!=row:raise ValueError('Family correction modifies an unselected observation')
                continue
            if identity not in fresh_rows or new_rows[identity]!=fresh_rows[identity]or row.get('operation')!='render-svg'or row.get('status')!='failed'or row.get('findings')!=['SVG has no positive finite viewBox or explicit canvas']or new_rows[identity].get('status')!='not-applicable':raise ValueError('Family correction must replace only sole-positive-canvas failed empty SVG rows with exact fresh N/A evidence')
        for replacement in replacements:
            if any(not finite(replacement.get('independentAssertions',{}).get(field))or replacement['independentAssertions'][field]!=0 for field in ('nodeCount','edgeCount','groupCount'))or replacement.get('expectedLabels')!=[]or set(replacement.get('observedLayout',{}))!={'nodes','edges','groups'}or any(not finite(value)or value!=0 for value in replacement.get('observedLayout',{}).values()):raise ValueError('Family empty-SVG correction does not establish independently empty expected/actual work')
            selected_row=new_rows[canonical(replacement['key'])];metrics=selected_row.get('metrics',{});canvas=replacement.get('zeroCanvas',{})
            layout=[row for row in fresh['observations']if row.get('caseId')==selected_row.get('caseId')and row.get('family')==selected_row.get('family')and row.get('operation')=='layout-and-finite-geometry']
            if len(layout)!=1 or any(not finite(layout[0].get('metrics',{}).get(field))or layout[0]['metrics'][field]!=0 for field in ('nodes','edges','groups')):raise ValueError('Family empty-SVG correction does not bind observed layout counts to actual fresh geometry evidence')
            if any(not finite(metrics.get(field))or metrics[field]!=0 for field in ('emptyCanvasWidth','emptyCanvasHeight'))or any(not finite(canvas.get(field))or canvas[field]!=0 for field in ('width','height'))or metrics.get('emptyCanvasViewBox')!=canvas.get('viewBox'):raise ValueError('Family empty-SVG correction lacks explicit independently observed finite zero canvas')
            source=replacement.get('ownerSource',{});blob=subprocess.check_output(['git','-C',source['root'],'rev-parse',source['revision']+':'+source['path']],text=True).strip()
            if blob!=source.get('blob'):raise ValueError('Family correction independent fixture Git identity changed')
            fixture=json.loads(subprocess.check_output(['git','-C',source['root'],'cat-file','blob',blob],text=True))
            def objects(value):
                if isinstance(value,dict):
                    yield value
                    for item in value.values():yield from objects(item)
                elif isinstance(value,list):
                    for item in value:yield from objects(item)
            matches=[item for item in objects(fixture)if item.get('id')==source.get('fixtureId')and item.get('source')==source.get('source')]
            if len(matches)!=1 or matches[0].get('assertions')!=replacement.get('independentAssertions'):raise ValueError('Family correction source/assertions are not its independently owned fixture')
        corrected.append(dict(id=target['id'],targetRevision=target['targetRevision'],candidateSha256=target['candidateSha256'],originalResultPath=target['originalResultPath'],correctedResultPath=target['correctedResultPath'],freshResultPath=target['freshResultPath'],replacementCount=len(selected),originalWindow={field:old.get(field)for field in ('startedAt','finishedAt')},freshWindow={field:fresh.get(field)for field in ('startedAt','finishedAt')}))
    if not corrected or len({row['id']for row in corrected})!=len(corrected):raise ValueError('Empty/duplicate family correction target manifest')
    return dict(protocol=manifest['protocol'],manifest=str(path.resolve()),createdAt=manifest['createdAt'],policy=manifest.get('policy'),targets=corrected)


def corrected_family_path(path,metadata):
    if metadata:
        match=next((row for row in metadata['targets']if Path(row['originalResultPath']).resolve()==Path(path).resolve()),None)
        if match:return Path(match['correctedResultPath'])
    return Path(path)


def pr_campaign_selection(directory):
    report=load(directory/'pr-ranks.json');complete=load(directory/'complete.json')
    if not report or not complete or not complete.get('completedAt')or not report.get('frozenAt')or complete.get('targets')!=len(report.get('targets',[]))or complete.get('jobs')!=len(report.get('jobs',[])):
        raise ValueError('PR campaign must have a matching completed target/job marker; partial ranks cannot replace a snapshot')
    if not report.get('createdAt')or datetime.fromisoformat(report['createdAt'].replace('Z','+00:00'))>datetime.fromisoformat(complete['completedAt'].replace('Z','+00:00')):raise ValueError('PR completion marker predates refreshed partial report')
    for target in report.get('targets',[]):
        if target.get('buildStatus')!='passed':continue
        for suite in ('family','invocation'):
            rows=[row for row in report.get('coverage',[])if row.get('target')==target['id']and row.get('suite')==suite]
            if len(rows)!=1:raise ValueError('PR completion marker does not bind a complete per-target family/invocation selection ledger')
    configuration=report.get('measurementConfig',{});core=configuration.get('core',{})
    if core.get('profile')!='full'or core.get('rounds')!=3:raise ValueError('Published PR selection requires full three-round paired core measurements')
    metrics=report.get('selectedCoreMetrics')or sorted({metric for rank in report.get('ranks',[])for metric in rank.get('metrics',{})})
    if not metrics or len(metrics)!=len(set(metrics)):raise ValueError('PR campaign lacks unique explicitly selected or actually recorded metrics')
    if report.get('apiOnly'):
        if core.get('metrics')!=metrics or configuration.get('invocation',{}).get('status')!='not-selected':raise ValueError('Focused PR selected metrics/invocation scope differs from actual measurement configuration')
        if any(row.get('suite')=='invocation'and(row.get('status')!='not-selected'or row.get('resultPath'))for row in report.get('coverage',[])):raise ValueError('API-only campaign cannot claim broad invocation observations')
    for rank in report.get('ranks',[]):
        if set(rank.get('metrics',{}))-set(metrics):raise ValueError('PR campaign publishes omitted metric records')
        for record in rank.get('metrics',{}).values():
            for key in ('medianMs','pairedRatio'):
                if record.get(key)is not None and (not finite(record[key])or record[key]<=0):raise ValueError('Invalid PR cost/ratio; unavailable is not zero cost')
    return report,dict(directory=str(directory.resolve()),completedAt=complete['completedAt'],frozenAt=report['frozenAt'],main=report.get('main'),measurementConfig=configuration,selectedCoreMetrics=metrics,apiOnly=bool(report.get('apiOnly')),extraCoreCases=report.get('extraCoreCases',[]),snapshot=report.get('snapshot'),policy='Selected metrics and supplemental cases retain their own paired cohorts. Explicit omitted invocation/metrics are unmeasured; old full campaigns remain historical snapshots.')


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
    return after,dict(corpusInputs=1095,distinctInputs=corpus_after.get('distinctCount'),policy=after['policy'],browser=after['browser'],identities=identities,startedAt=after.get('startedAt'),finishedAt=after['finishedAt'],scope='Pinned Dave SVG artifact boundary. Actual comparator versions belong to the admitted comparison set; historical sets retain their original identities.')


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

    def save(self, figure, name, title, note, rows,footer_inches=None):
        if getattr(self,'latest_phase',False):name='latest-'+name;title='Latest independent target: '+title
        if getattr(self,'historical_prs',False):
            name='historical-'+name;title='Historical PR snapshot: '+title
            note+=' This older frozen campaign is separate from the latest focused PR cohort; merged/stale heads are not current open PRs.'
        latest=getattr(self,'latest_invocation',None)
        if latest and name.startswith('latest-'):
            note+=' Independent complete latest invocation target '+str(latest.get('targetRevision'))+'; '+str(latest.get('startedAt'))+' → '+str(latest.get('finishedAt'))+'. Original invocation and community targets stay separate.'
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
        bottom=max(.09,footer_inches/figure.get_figheight())if footer_inches is not None else .09
        figure.tight_layout(rect=(0, bottom, 1, .95))
        for extension in ('svg', 'png', 'pdf'):
            figure.savefig(self.out / f'{name}.{extension}', bbox_inches='tight')
        self.plt.close(figure)
        self.items.append(dict(name=name, title=title, note=note, rows=rows))

    def coverage(self, observations,name='invocation-coverage',label='Agentic Mermaid: observed family × invocation checks'):
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
        self.save(figure, name, label, 'Counts deduplicate repeated rounds; every observed round must pass. N/A/skipped checks are excluded, missing cells are unmeasured. Blocked/unsupported/failed statuses remain distinct in reduced rows; a low qualified fraction is not a failure count. This is not exhaustive feature or operation coverage.', data)

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
        self.save(figure,'current-dave-score-attempt-cost','Current-target Dave benchmark: acceptance and complete attempt cost','Exact unchanged pinned1095-occurrence corpus and browser policy; three rounds. Attempt cost includes rejected/failed inputs, so fast rejection is not a speed win. Matched-success comparisons use each comparator\'s own explicitly recorded common input IDs. Actual comparator versions are read from admitted identities and must agree throughout the comparison set.',rows)
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
            self.save(figure,'current-dave-matched','Current-target Dave: comparator-specific shared-success work','Each row has its own frozen shared input IDs, never a single common cross-tool rank. Plotted ratio is derived from the recorded three candidate/comparator cost pairs; original owning ratios remain in reduced data. Historical sets retain their own versions; this set requires consistent actual tool versions.',matched)

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
        if any(row.get('suite')=='community'and finite(row.get('metrics',{}).get('peakProcessRssBytes'))for row in observations):
            warning='Community API peakProcessRssBytes from process.resourceUsage().maxRSS is uninterpretable as worker peak: identical inherited parent/fork high-water values recur across independent implementations. Excluded from plots/comparisons; raw values remain unchanged. After-loop endRssBytes is a current process.memoryUsage().rss snapshot including runtime/harness, not peak or allocation.'
            self.gaps.append(warning)
            self.memory_metric_exclusions=[dict(suite='community',metric='peakProcessRssBytes',status='uninterpretable inherited process high-water scope',policy=warning)]
        if any(row.get('suite')=='invocation'and finite(row.get('metrics',{}).get('peakRssBytes'))for row in observations):
            warning='Installed-library invocation peakRssBytes uses the same inherited process.resourceUsage().maxRSS path and is excluded as an attributable worker peak. Actual current rssBytes/heapUsedBytes snapshots remain scoped diagnostics; raw peaks are retained.'
            self.gaps.append(warning)
            self.memory_metric_exclusions=getattr(self,'memory_metric_exclusions',[])+[dict(suite='invocation',metric='peakRssBytes',status='uninterpretable inherited process high-water scope',policy=warning)]
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
                    for metric in ('rssBytes','heapUsedBytes'):
                        admit(row,'Invocation process memory',row.get('runtime','unrecorded'),'invocation:after-all-enrolled-operations',metric,metrics.get(metric),str(metrics.get('scope','After all enrolled operations; includes runtime/harness/qualification; not allocation or leak proof.')))
            if suite=='community':
                for metric in ('endRssBytes',):
                    admit(row,'Community worker resident snapshot',row.get('runtime','unrecorded'),'community:worker-'+str(row.get('format')),metric,metrics.get(metric),'Actual after-loop process.memoryUsage().rss resident snapshot, not a peak. Runtime, qualification and caches included. Every output/worker attempt stays distinct; process scope can contain failed render attempts. Inherited maxRSS is excluded as uninterpretable.')
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
            figure,axes=self.plt.subplots(1,2,figsize=(12,max(6,len(rows)*.45+1.7)),sharey=True)
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
            self.save(figure,'cli-fixed-resource-'+str(output),'Fixed-work fresh CLI resources: '+str(output),note,rows,footer_inches=1.7)
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
                receipt_policy=campaign.get('measurementConfig',{}).get('core',{}).get('receiptValidation','includes-external-receipt-validation (historical worker boundary)')
                self.save(figure,f'prs-cache-{cache}-{offset//4+1}',f'PR paired costs; result-cache flag {cache}','Gray segments are per-candidate observed control decision bands (includes practical floor), not confidence intervals. Orange × = head/own-base exploratory; source-equal rows reuse identified evidence. Other caches retain artifact defaults. Receipt assertion policy: '+receipt_policy+'. Latest focused and historical receipt costs have different assertion boundaries; no direct product trend is implied.',data)

    def pr_extra(self,campaign):
        if not campaign or not campaign.get('extraCore'):return
        groups=defaultdict(list)
        for row in campaign['extraCore']:groups[(row.get('caseId'),row.get('metric'),str(row.get('cache')))].append(row)
        for index,((case,metric,cache),rows)in enumerate(sorted(groups.items())):
            figure,ax=self.plt.subplots(figsize=(10,max(4,len(rows)*.35)))
            for y,row in enumerate(rows):
                ratio=row.get('pairedRatio');band=row.get('decisionBand',{})
                exploratory=row.get('integration')in ('conflicting-head','branch-base')
                if finite(ratio)and ratio>0:
                    if finite(band.get('low'))and finite(band.get('high')):ax.plot([band['low'],band['high']],[y,y],color='#cbd2d8',linewidth=7)
                    ax.scatter(ratio,y,color='#aa5b27'if exploratory else '#147d92',marker='x'if exploratory else 'o')
                else:ax.text(1,y,'unavailable',fontsize=7,va='center')
            ax.set_yticks(range(len(rows)),[str(row.get('target'))+' ['+str(row.get('integration'))+(' ; shared '+str(row.get('sourceEvidence'))if row.get('sourceEvidence')not in (None,row.get('target'))else '')+']'for row in rows],fontsize=7)
            ax.invert_yaxis();ax.axvline(1,color='#555',linestyle='--');ax.set_xlabel('Candidate / fresh paired control; observed bands, not confidence intervals')
            self.save(figure,'pr-extra-'+str(index+1),'Supplemental PR case: '+str(case)+' / '+str(metric)+' / result reuse '+cache,'Separate authored source case outside the six-input portfolio and aggregate rank. Every round must qualify; source-conflicting head/own-base rows stay exploratory. A lower ratio is lower observed cost, not broader diagram functionality or a statistically established win.',rows)

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
        colors={'passed':'#147d92','failed':'#b34742','harness-blocked':'#d18b49','unsupported':'#8a75a6','blocked':'#c29946','not-applicable':'#cbd2d8','skipped':'#a6b4be','unknown':'#e5e7e9'}
        for suite in ('family','invocation'):
            data=[]
            for rank in ranks:
                own=[row for row in records if row.get('target')==rank['id'] and row.get('suite')==suite]
                if not own:
                    data.append(dict(candidate=label(rank),suite=suite,profile=campaign.get('measurementConfig',{}).get(suite,{}).get('profile','unrecorded'),rounds=campaign.get('measurementConfig',{}).get(suite,{}).get('rounds'),status='unmeasured',observations=None,statusCounts=None));continue
                for row in own:
                    result=load(corrected_family_path(row['resultPath'],getattr(self,'family_correction',None)))if row.get('resultPath')else None
                    counts=defaultdict(int)
                    if result and isinstance(result.get('observations'),list):
                        for observation in result['observations']:counts['harness-blocked'if harness_blocked(observation)else observation.get('status','unknown')]+=1
                        total=len(result['observations'])
                    else:
                        total=row.get('total')
                        if finite(row.get('passed')):counts['passed']=row['passed']
                        if finite(total):counts['unknown']=max(0,total-counts['passed'])
                    data.append(dict(candidate=label(rank),suite=suite,profile=row.get('profile','unrecorded'),rounds=row.get('rounds'),requestedRounds=campaign.get('measurementConfig',{}).get('family',{}).get('requestedRounds',row.get('rounds'))if suite=='family'else row.get('rounds'),actualFunctionalityPasses=1 if suite=='family'else None,status=(result or{}).get('status',row.get('status')),originalStatus=row.get('status'),observations=total,statusCounts=dict(counts),resultPath=str(corrected_family_path(row['resultPath'],getattr(self,'family_correction',None)))if row.get('resultPath')else None,originalResultPath=row.get('resultPath')))
            if not data:continue
            figure,ax=self.plt.subplots(figsize=(11,max(4,len(data)*.38)))
            for y,row in enumerate(data):
                total=row['observations'];left=0
                if not finite(total)or total<=0:ax.text(0,y,'no measured observations',va='center',fontsize=7);continue
                for status,color in colors.items():
                    value=(row['statusCounts']or{}).get(status,0)/total*100
                    if value:ax.barh(y,value,left=left,color=color,label=status if y==0 else None)
                    left+=value
            ax.set_yticks(range(len(data)),[row['candidate']+' ['+str(row['profile'])+', '+('one functionality pass; requested '+str(row.get('requestedRounds'))if suite=='family'and finite(row.get('observations'))and row['observations']>0 else 'functionality unmeasured'if suite=='family'else str(row['rounds'])+' rounds')+', '+str(row['status'])+'; n='+str(row['observations'])+']'for row in data],fontsize=7)
            ax.invert_yaxis();ax.set_xlim(0,100);ax.set_xlabel('Observed benchmark rows, %; includes explicit N/A and metadata, not feature completeness')
            from matplotlib.patches import Patch
            ax.legend(handles=[Patch(color=color,label=status)for status,color in colors.items()],fontsize=7,ncol=4,loc='lower right')
            self.save(figure,'pr-observation-coverage-'+suite,'PR '+suite+' observation status; resolved profiles and rounds','These are observation counts, not unique cases or exhaustive operation/fidelity coverage. Compare like profiles/rounds; intentional invocation overrides remain visible. Exact missing-saxes qualifier errors are harness-blocked/unscored, with raw failures preserved; they are not product defects. N/A, unsupported, blocked, failure and missing evidence stay separate. No current-main correctness/merge readiness is inferred from exploratory heads.',data)

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
        reduced=dict(run={k:report.get(k)for k in ('status','startedAt','finishedAt','profile','rounds','driverRevision','targetRevision')},suitePins={suite['id']:suite['pin']for suite in report.get('suites',[])if suite.get('pin')},prCampaign={k:campaign.get(k)for k in ('frozenAt','main','units','protocols','measurementConfig','measurementDriver')}if campaign else None,communityCli={**{k:supplemental.get(k)for k in ('startedAt','latencyFinishedAt','finishedAt','rounds','policy','resourcePolicy','executionOrder')},'resourceObserver':supplemental.get('evidence',{}).get('resourceObserver'),'composition':supplemental.get('composition'),'nativeBinding':supplemental.get('reportingNativeBinding'),'resourceDisplayCorrection':supplemental.get('resourceDisplayCorrection')}if supplemental else None,invocationCorrection=correction,referenceCorrection=reference_overlay,communityReplay=getattr(self,'community_replay',None),currentRun=getattr(self,'current_run',None),additionalRun=getattr(self,'additional_run',None),currentInvocationRun=getattr(self,'latest_invocation',None),suiteRuns=getattr(self,'suite_runs',[]),familyCorrection=getattr(self,'family_correction',None),historicalPrCampaign=getattr(self,'historical_campaign',None),memoryMetricExclusions=getattr(self,'memory_metric_exclusions',[]),figures=self.items,gaps=self.gaps)
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
    parser.add_argument('--historical-prs',type=Path,help='Separate older full PR campaign; never relabeled as current open heads')
    parser.add_argument('--family-correction',type=Path,help='Explicit latest PR empty-fixture SVG eligibility correction; exact selected row partition only')
    parser.add_argument('--current-invocation-run',type=Path,help='Independent latest-target complete invocation suite; retains its own target and does not replace old invocation rows')
    parser.add_argument('--current-dave-run',type=Path,help='Explicit same-target fresh Dave-only display correction; preserves the failed original ledger')
    parser.add_argument('--current-invocation-assets',type=Path,help='Explicit clean-source public native/site build proof for latest full invocation')
    parser.add_argument('--suite-run',type=Path,action='append',default=[],help='Independent completed owning/environment correction ledger; repeatable, no rank or original-status replacement')
    parser.add_argument('--cli-native-proof',type=Path,help='Explicit bit-identical clean-source reproduction proof binding supplemental Agentic native CLI bytes to the frozen target')
    parser.add_argument('--cli-resource-run',type=Path,help='Explicit same-bindings fresh resource-only GNU-time observation; preserves every CLI latency row')
    parser.add_argument('--tool-versions',type=Path,help='Explicit version manifest for one uniform comparison set; default is the current benchmark pins')
    args=parser.parse_args()
    if args.current_dave_run and not args.current_invocation_run:parser.error('--current-dave-run requires --current-invocation-run')
    if args.current_invocation_assets and not args.current_invocation_run:parser.error('--current-invocation-assets requires --current-invocation-run')
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
    campaign=None;historical_campaign=None;campaign_metadata=None;historical_campaign_metadata=None
    try:
        if args.prs:campaign,campaign_metadata=pr_campaign_selection(args.prs)
        if args.historical_prs:historical_campaign,historical_campaign_metadata=pr_campaign_selection(args.historical_prs)
    except (ValueError,OSError,TypeError,KeyError)as error:parser.error(str(error))
    family_metadata=None
    if args.family_correction:
        try:family_metadata=family_correction(args.family_correction,campaign)
        except (ValueError,OSError,TypeError,KeyError,subprocess.SubprocessError)as error:parser.error(str(error))
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
    latest_invocation=None;latest_invocation_metadata=None;suite_metadata=[]
    try:
        if args.current_invocation_run:latest_invocation,latest_invocation_metadata=current_invocation_supplement(report,args.current_invocation_run,args.run,args.current_invocation_assets,args.current_dave_run)
        if latest_invocation_metadata and campaign_metadata and latest_invocation_metadata['targetRevision']!=campaign_metadata['main']:raise ValueError('Latest invocation target differs from latest selected PR main; retain them as separate dated selections')
        suite_metadata=[owning_supplement(directory)for directory in args.suite_run]
    except (ValueError,OSError,TypeError,KeyError,tarfile.TarError,subprocess.SubprocessError)as error:parser.error(str(error))
    additional_metadata=None
    if args.additional_run:
        try:
            expected_target=latest_invocation_metadata or current_metadata or community_metadata
            if not expected_target:raise ValueError('--additional-run requires --current-run or an explicit --community-run current-target selection')
            additional_metadata=additional_supplement(report,args.additional_run,expected_target,current_metadata or community_metadata)
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
    resource_metadata=None
    if args.cli_resource_run:
        try:supplemental,supplemental_result,resource_metadata=cli_resource_overlay(supplemental,supplemental_result,args.cli_resource_run)
        except (ValueError,OSError,TypeError,KeyError)as error:parser.error(str(error))
    ranks=scores.get('ranks',[])
    if supplemental:
        ranks=[rank for rank in ranks if rank.get('surface')!='cli:end-to-end']+supplemental['ranks']
        observations=[row for row in observations if row.get('suite')!='community-cli']+supplemental_result.get('observations',[])+supplemental_result.get('diagnostics',[])
    version_claims=[]
    for row in observations:
        metrics=row.get('metrics',{})
        if metrics.get('implementation') and isinstance(metrics.get('version'),str):
            version_claims.append(dict(tool=metrics.get('variantOf') or metrics['implementation'],version=metrics['version'],source=row.get('suite','observations'),**({'variant':metrics['variant']}if metrics.get('variant')else{})))
    dave_files=[args.run/'dave/browser-report.json']
    if current_dave_result:
        version_claims.extend(dict(tool=row['name'],version=row['version'],source='current Dave',**({'variant':row['label']}if row['name']=='agentic-mermaid'and row['label']!='candidate'else{}))for row in current_dave_result.get('identities',[]))
    if latest_invocation_metadata and latest_invocation_metadata.get('daveFile'):dave_files.append(Path(latest_invocation_metadata['daveFile']))
    for path in dave_files:
        for row in (load(path)or{}).get('identities',[]):
            version_claims.append(dict(tool=row['name'],version=row.get('version'),source=str(path),**({'variant':row['label']}if row['name']=='agentic-mermaid'and row['label']!='candidate'else{})))
    try:assert_tool_versions(version_claims,args.tool_versions)
    except (ValueError,OSError,TypeError,KeyError)as error:parser.error(str(error))
    if args.validate_only:
        cli_metadata=dict(directory=supplemental['reportingDirectory'],familyRanks=supplemental['reportingFamilyRanks'],composition=supplemental_result.get('composition'),target=supplemental['evidence']['target'],nativeBinding=supplemental['reportingNativeBinding'],resourceCorrection=resource_metadata)if supplemental else None
        print(json.dumps(dict(protocol='unified-report-selection-v1',communityDirectory=str((args.community_run or (find(args.run,'community-result.json')or args.run).parent).resolve()),communityReplay=community_metadata,cliSupplement=cli_metadata,invocationCorrection=correction_metadata,referenceCorrection=reference_metadata,currentRun=current_metadata,additionalRun=additional_metadata,currentInvocationRun=latest_invocation_metadata,suiteRuns=suite_metadata,prCampaign=campaign_metadata,historicalPrCampaign=historical_campaign_metadata,familyCorrection=family_metadata),allow_nan=False))
        return
    figures=Figures(args.out)
    figures.family_correction=family_metadata
    figures.latest_invocation=latest_invocation_metadata;figures.suite_runs=suite_metadata
    figures.historical_campaign={k:historical_campaign.get(k)for k in ('frozenAt','main','measurementConfig','measurementDriver')}if historical_campaign else None
    if latest_invocation:
        figures.coverage(latest_invocation['observations'],'latest-invocation-coverage','Latest target: '+latest_invocation_metadata['attemptCensus']['completeness'])
        figures.gaps.extend(latest_invocation_metadata['attemptCensus']['gaps'])
        figures.latest_phase=True
        figures.current_dave(load(Path(latest_invocation_metadata['daveFile'])))
        figures.reference(load(Path(latest_invocation_metadata['referenceScore']['resultFile']))['observations'],'pinned-parser-score','Pinned Mermaid same-case portable parser comparison')
        figures.latest_phase=False
        figures.gaps.append(latest_invocation_metadata['policy']+' Target '+latest_invocation_metadata['targetRevision']+'; '+latest_invocation_metadata['startedAt']+' → '+latest_invocation_metadata['finishedAt']+'.')
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
    figures.diagnostics(observations);figures.cli_resources(supplemental,supplemental_result);figures.prs(campaign);figures.pr_payload(campaign);figures.pr_extra(campaign);figures.pr_coverage(campaign);figures.pr_editor(campaign)
    if historical_campaign:
        figures.historical_prs=True
        figures.prs(historical_campaign);figures.pr_payload(historical_campaign);figures.pr_extra(historical_campaign);figures.pr_coverage(historical_campaign);figures.pr_editor(historical_campaign)
        figures.historical_prs=False
    figures.reference(observations);figures.owning_tests(report);figures.html(report,campaign,supplemental,correction_metadata,reference_metadata)
    print(json.dumps(dict(figures=len(figures.items),out=str(args.out.resolve()),gaps=figures.gaps),indent=2))


if __name__=='__main__':main()
