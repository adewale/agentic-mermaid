#!/usr/bin/env python3
"""Run a bounded built-package layout cost comparison; never builds artifacts.

Uses the existing full-consumption release worker. The input JSON is a nonempty
object keyed by input ID, with source and optional family/sha256/expectedSvgLabels
fields. Known pilot IDs infer their family; other IDs require family. This is a
portability wrapper, not the exact frozen pilot harness unless hashes match.
Execute only without competing work; this is not full release qualification.
"""
import argparse
import hashlib
import json
import math
import pathlib
import statistics
import subprocess
import time

REPO = pathlib.Path(__file__).resolve().parents[2]
ARMS = ['before', 'before-aa', 'after', 'elk']
FAMILIES = {'cyclic15': 'flowchart', 'cyclic18': 'flowchart', 'er40': 'er', 'flow5': 'flowchart', 'seq20': 'sequence'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def artifact_identity(package):
    entry = package / 'dist/index.js'
    if not entry.is_file():
        raise ValueError(f'Missing built artifact: {entry}; this runner does not build')
    files = [package / 'package.json', *sorted((package / 'dist').rglob('*.js'))]
    records = [{'path': str(path.relative_to(package)), 'sha256': sha(path.read_bytes()), 'bytes': path.stat().st_size}
               for path in files if path.is_file()]
    return {'package': str(package), 'entry': str(entry), 'files': records,
            'manifestSha256': sha(json.dumps(records, sort_keys=True).encode())}


def svg_fingerprint(result):
    svg = result.get('svg', {})
    if svg.get('ok') is True and isinstance(svg.get('output'), str):
        encoded = svg['output'].encode('utf8')
        return {'ok': True, 'sha256': sha(encoded), 'bytes': len(encoded)}
    return {'ok': False, 'error': svg.get('error'), 'code': svg.get('code'), 'category': svg.get('category')}


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def summarize(out, manifest):
    results, failures = {}, []
    for row in manifest['observations']:
        if row.get('status') != 'ok':
            failures.append(row)
            continue
        try:
            results[(row['cache'], row['round'], row['arm'], row['mode'])] = json.loads(pathlib.Path(row['resultFile']).read_text())
        except (OSError, ValueError) as error:
            failures.append({**row, 'status': 'result-read-failed', 'error': str(error)})
    summary = {'protocol': 'layout-final-cost-summary@1', 'plan': manifest['plan'], 'workers': len(manifest['observations']),
               'failed': failures, 'inputFailures': [], 'svgComparisons': [], 'receiptComparisons': [],
               'results': {}, 'elapsedSeconds': manifest['elapsedSeconds'],
               'artifactsUnchanged': manifest.get('artifactsUnchanged'),
               'limits': 'Three rounds; the explicitly supplied input population. Partial ratios are labelled incomplete. Receipt version/geometry changes are recorded independently of SVG; no universal ELK or full-release qualification claim.'}
    for cache in ['off', 'normal']:
        summary['results'][cache] = {}
        for case in [item['id'] for item in manifest['plan']['inputs']]:
            cell = {}
            for mode, collection, metric in [('time', 'results', 'ms'), ('memory', 'perInput', 'allocatedBytes')]:
                values = {arm: [] for arm in ARMS}
                for rnd in range(1, 4):
                    found_by_arm = {}
                    for arm in ARMS:
                        result = results.get((cache, rnd, arm, mode), {})
                        found = next((item for item in result.get(collection, []) if item.get('id') == case), None)
                        found_by_arm[arm] = found
                        valid = bool(found) and finite_number(found.get(metric))
                        if mode == 'time' and found:
                            valid = valid and found.get('svg', {}).get('ok') is True and found.get('deterministic') is True and not found.get('missingSvgLabels')
                            if not valid:
                                summary['inputFailures'].append({'cache': cache, 'round': rnd, 'arm': arm, 'id': case,
                                                                 'svg': svg_fingerprint(found), 'deterministic': found.get('deterministic'),
                                                                 'missingSvgLabels': found.get('missingSvgLabels')})
                        values[arm].append(found[metric] if valid else None)
                    if mode == 'time':
                        before = found_by_arm['before']
                        if before:
                            for arm in ['before-aa', 'after', 'elk']:
                                found = found_by_arm[arm]
                                if not found:
                                    continue
                                original, current = svg_fingerprint(before), svg_fingerprint(found)
                                context = {'cache': cache, 'round': rnd, 'arm': arm, 'id': case}
                                summary['svgComparisons'].append({**context, 'equal': original == current, 'before': original, 'current': current})
                                first_layout, layout = before.get('layout', {}), found.get('layout', {})
                                summary['receiptComparisons'].append({**context,
                                    'receiptEqual': first_layout.get('receipt') == layout.get('receipt'),
                                    'beforeReceipt': first_layout.get('receipt'), 'currentReceipt': layout.get('receipt'),
                                    'decisionsEqual': first_layout.get('decisions') == layout.get('decisions'),
                                    'beforeDecisions': first_layout.get('decisions'), 'currentDecisions': layout.get('decisions'),
                                    'certificationEqual': first_layout.get('certification') == layout.get('certification'),
                                    'beforeCertification': first_layout.get('certification'), 'currentCertification': layout.get('certification')})
                ratios = {}
                for label, numerator, denominator in [('aa', 'before-aa', 'before'), ('afterBefore', 'after', 'before'),
                                                        ('beforeElk', 'before', 'elk'), ('afterElk', 'after', 'elk')]:
                    per_round = [a / b if a is not None and b is not None and b > 0 else None
                                 for a, b in zip(values[numerator], values[denominator])]
                    valid = [value for value in per_round if value is not None]
                    ratios[label] = {'rounds': per_round, 'validRounds': len(valid), 'complete': len(valid) == 3,
                                     'median': statistics.median(valid) if valid else None}
                cell[mode] = {'metric': metric, 'values': values, 'ratios': ratios}
            summary['results'][cache][case] = cell
    summary['aaSvgDifferences'] = [row for row in summary['svgComparisons'] if row['arm'] == 'before-aa' and not row['equal']]
    summary['candidateSvgDifferences'] = [row for row in summary['svgComparisons'] if row['arm'] == 'after' and not row['equal']]
    summary['candidateReceiptDifferences'] = [row for row in summary['receiptComparisons'] if row['arm'] == 'after' and not row['receiptEqual']]
    write_json(out / 'summary.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--baseline', type=pathlib.Path, required=True, help='Built package root containing dist/index.js')
    parser.add_argument('--inputs', type=pathlib.Path, required=True, help='JSON object keyed by input ID, each with source and optional family/sha256')
    parser.add_argument('--candidate', type=pathlib.Path, default=REPO, help='Built package root; defaults to this repository')
    parser.add_argument('--node', default='node')
    parser.add_argument('--budget-seconds', type=float, default=600)
    parser.add_argument('--timeout-seconds', type=float, default=180)
    args = parser.parse_args()
    if not finite_number(args.budget_seconds) or not finite_number(args.timeout_seconds) or args.budget_seconds <= 0 or args.timeout_seconds <= 0:
        parser.error('Budget and worker timeout must be positive')
    out, baseline, candidate = args.out.resolve(), args.baseline.resolve(), args.candidate.resolve()
    if out.exists() and any(out.iterdir()):
        parser.error(f'Refusing to overwrite nonempty result directory: {out}')
    identities = {'before': artifact_identity(baseline), 'after': artifact_identity(candidate)}
    input_path = args.inputs.resolve()
    population = json.loads(input_path.read_text())
    if not isinstance(population, dict) or not population:
        parser.error('--inputs must contain a nonempty object keyed by input ID')
    inputs = []
    for case, record in population.items():
        if not isinstance(case, str) or not case or not isinstance(record, dict) or not isinstance(record.get('source'), str):
            parser.error('Each input must have a nonempty ID and an object with a source string')
        family = record.get('family', FAMILIES.get(case))
        if not isinstance(family, str) or not family:
            parser.error(f'Input {case!r} requires an explicit family')
        if 'sha256' in record and record['sha256'] != sha(record['source'].encode('utf8')):
            parser.error(f'Input {case!r} does not match its supplied sha256')
        labels = record.get('expectedSvgLabels')
        if labels is not None and (not isinstance(labels, list) or not all(isinstance(label, str) for label in labels)):
            parser.error(f'Input {case!r} expectedSvgLabels must be an array of strings')
        workflow = record.get('workflow')
        if workflow is not None and workflow != 'edit-flowchart':
            parser.error(f'Input {case!r} has an unsupported workflow')
        item = {'id': case, 'family': family, 'source': record['source']}
        if labels is not None:
            item['expectedSvgLabels'] = labels
        if workflow is not None:
            item['workflow'] = workflow
        inputs.append(item)
    worker = REPO / 'eval/benchmark/release-bench-worker.ts'
    fidelity = REPO / 'eval/benchmark/release-bench-fidelity.ts'
    plan = {'protocol': 'layout-final-cost@1', 'baseline': str(baseline), 'candidate': str(candidate), 'artifacts': identities,
            'worker': {'path': str(worker), 'sha256': sha(worker.read_bytes()), 'fidelitySha256': sha(fidelity.read_bytes())},
            'runner': {'path': str(pathlib.Path(__file__).resolve()), 'sha256': sha(pathlib.Path(__file__).read_bytes()), 'scope': 'portable wrapper'},
            'inputFile': {'path': str(input_path), 'sha256': sha(input_path.read_bytes())},
            'inputs': inputs, 'inputSha256': {item['id']: sha(item['source'].encode()) for item in inputs},
            'rounds': 3, 'reps': 15, 'arms': ARMS, 'policies': ['off', 'normal'], 'modes': ['time', 'memory'],
            'budgetMs': args.budget_seconds * 1000, 'workerTimeoutMs': args.timeout_seconds * 1000,
            'armOrder': 'left rotation by round-1; identical case order in every arm within a round',
            'inputOrder': 'supplied input insertion order, left rotation by round-1', 'elkArtifact': 'frozen baseline',
            'consumption': 'Existing release worker: complete SVG UTF8 + receipt JSON inside API timing; complete SHA256 fingerprints outside timing. Independent fresh GC memory workers.',
            'receiptPolicy': 'Implementation changes can intentionally alter receipts. Compare SVG separately; retain exact receipt, decision and certification differences without normalizing them away.',
            'cachePolicy': 'Existing layout-reference startup environment: off=text-spans + ELK_CACHE=0; normal=text-spans,position-cache + ELK_CACHE=1. indexed-layout intentionally excluded in both.',
            'limits': 'Bounded supplied-input experiment, not full release qualification. Memory workers measure one post-warmup render/input and one corpus pass; reps15 applies to timing samples only.'}
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / 'plan.json', plan)
    started = time.monotonic()
    manifest = {'plan': plan, 'status': 'running', 'elapsedSeconds': 0, 'observations': []}
    write_json(out / 'manifest.json', manifest)
    try:
        for cache in plan['policies']:
            for rnd in range(1, 4):
                arms = ARMS[rnd - 1:] + ARMS[:rnd - 1]
                offset = (rnd - 1) % len(inputs)
                round_inputs = inputs[offset:] + inputs[:offset]
                for arm in arms:
                    for mode in plan['modes']:
                        prefix = out / f'{cache}-{rnd}-{arm}-{mode}'
                        package = candidate if arm == 'after' else baseline
                        job = {'entry': str(package / 'dist/index.js'), 'mode': mode, 'inputs': round_inputs, 'reps': 15,
                               'layoutMode': 'elk' if arm == 'elk' else 'agentic', 'layoutCache': cache, 'consumeReceipt': True}
                        path, result_path = prefix.with_suffix('.job.json'), prefix.with_suffix('.json')
                        write_json(path, job)
                        row = {'cache': cache, 'round': rnd, 'arm': arm, 'mode': mode, 'jobFile': str(path), 'resultFile': str(result_path)}
                        left = args.budget_seconds - (time.monotonic() - started)
                        if left <= 0:
                            row.update(status='budget-exhausted', error='Shared campaign budget exhausted before worker launch')
                        else:
                            launched = time.monotonic()
                            command = [args.node, '--expose-gc', '--no-warnings', str(worker), str(path), str(result_path)]
                            row['command'] = command
                            try:
                                completed = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=min(left, args.timeout_seconds))
                                row.update(exitCode=completed.returncode, stdout=completed.stdout, stderr=completed.stderr,
                                           status='ok' if completed.returncode == 0 else 'worker-failed')
                                if row['status'] == 'ok':
                                    try:
                                        parsed = json.loads(result_path.read_text())
                                        expected = {item['id'] for item in inputs}
                                        collection = parsed.get('results' if mode == 'time' else 'perInput', [])
                                        if len(collection) != len(expected) or {item.get('id') for item in collection} != expected:
                                            raise ValueError('Result missing expected input identities')
                                    except (OSError, ValueError, TypeError) as error:
                                        row.update(status='result-invalid', error=str(error))
                            except subprocess.TimeoutExpired as error:
                                row.update(status='timeout', error=str(error), timeoutSeconds=min(left, args.timeout_seconds),
                                           stdout=error.stdout.decode(errors='replace') if isinstance(error.stdout, bytes) else error.stdout,
                                           stderr=error.stderr.decode(errors='replace') if isinstance(error.stderr, bytes) else error.stderr)
                            except OSError as error:
                                row.update(status='launch-failed', error=str(error))
                            row['wallSeconds'] = time.monotonic() - launched
                        manifest['observations'].append(row)
                        manifest['elapsedSeconds'] = time.monotonic() - started
                        write_json(out / 'manifest.json', manifest)
                        print(cache, rnd, arm, mode, row['status'], round(row.get('wallSeconds', 0), 2), flush=True)
    finally:
        manifest['elapsedSeconds'] = time.monotonic() - started
        try:
            final_identities = {'before': artifact_identity(baseline), 'after': artifact_identity(candidate)}
            manifest['finalArtifacts'] = final_identities
            manifest['artifactsUnchanged'] = identities == final_identities
        except (OSError, ValueError) as error:
            manifest['artifactsUnchanged'] = False
            manifest['finalArtifactError'] = str(error)
        manifest['status'] = 'complete' if len(manifest['observations']) == 48 else 'interrupted'
        write_json(out / 'manifest.json', manifest)
        summary = summarize(out, manifest)
        print('workers', summary['workers'], 'failed', len(summary['failed']), 'input failures', len(summary['inputFailures']),
              'A/A SVG drift', len(summary['aaSvgDifferences']), 'candidate SVG changes', len(summary['candidateSvgDifferences']),
              'artifacts unchanged', summary['artifactsUnchanged'], flush=True)


if __name__ == '__main__':
    main()
