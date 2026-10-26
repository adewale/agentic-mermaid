"""Predeclare then run a separate mixed-session memory experiment, without editing its worker."""
import argparse
import hashlib
import json
import math
import os
import pathlib
import shutil
import signal
import statistics
import subprocess
import sys
import time

POLICIES = ['off', 'normal']
ARMS = [('elk-reference', 'candidate', 'elk'), ('elk-aa', 'candidate', 'elk'),
        ('native23', 'baseline', 'agentic'), ('native23-aa', 'baseline', 'agentic'),
        ('native24', 'candidate', 'agentic')]
METRICS = ['passAllocatedBytes', 'passPeakHeapBytes', 'retainedGrowthBytes', 'peakRssBytes']


def sha(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def save(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n')
    temporary.replace(path)


def artifact(root):
    root = pathlib.Path(root).resolve()
    files = [root / 'package.json', *sorted((root / 'dist').glob('*.js'))]
    if (root / 'bun.lock').is_file():
        files.append(root / 'bun.lock')
    if not (root / 'dist/index.js').is_file() or len(files) < 3 or any(not f.is_file() for f in files):
        raise ValueError(f'Missing frozen built artifact: {root}')
    return {'directory': str(root), 'entry': str(root / 'dist/index.js'),
            'files': {str(f.relative_to(root)): sha(f) for f in files}}


def closure(worker):
    worker = pathlib.Path(worker).resolve()
    files = [worker, worker.parent / 'release-bench-fidelity.ts', worker.parent / 'release-bench-types.ts']
    return {str(f): sha(f) for f in files}


def environment(policy):
    return {'AGENTIC_MERMAID_ELK_CACHE': '1' if policy == 'normal' else '0',
            'AGENTIC_MERMAID_EXPERIMENTS': 'text-spans,position-cache' if policy == 'normal' else 'text-spans'}


def read_inputs(path):
    value = json.loads(pathlib.Path(path).read_text())
    if isinstance(value, dict):
        if value.get('protocol') != 'layout-review-population@1' or value.get('scope') != 'historical27':
            raise ValueError('Expected historical27 population envelope')
        return value['inputs']
    return value


def declare(args):
    out = pathlib.Path(args.out).resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError('Output directory must be new or empty')
    inputs_path = pathlib.Path(args.inputs).resolve()
    inputs = read_inputs(inputs_path)
    if not isinstance(inputs, list) or len(inputs) != 27 or len({v['id'] for v in inputs}) != 27:
        raise ValueError('Exactly27 distinct historical inputs required')
    node = shutil.which(args.node)
    if not node:
        raise ValueError('Node executable not found')
    node = pathlib.Path(node).resolve()
    worker = pathlib.Path(args.worker).resolve()
    out.mkdir(parents=True, exist_ok=True)
    frozen_inputs = out / 'inputs.json'
    shutil.copyfile(inputs_path, frozen_inputs)
    plan = {'protocol': 'full27-mixed-session-memory-only@1', 'declaredAtUtc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'status': 'predeclared-unexecuted', 'out': str(out), 'node': str(node), 'nodeSha256': sha(node),
            'driver': str(pathlib.Path(__file__).resolve()), 'driverSha256': sha(__file__),
            'worker': str(worker), 'workerClosure': closure(worker),
            'inputs': str(frozen_inputs), 'inputsSha256': sha(frozen_inputs),
            'cohort': [{'id': v['id'], 'family': v['family'], 'sourceSha256': hashlib.sha256(v['source'].encode()).hexdigest(), 'workflow': v.get('workflow'), 'kind': v.get('kind')} for v in inputs],
            'artifacts': {'baseline': artifact(args.baseline), 'candidate': artifact(args.candidate)},
            'policies': POLICIES, 'arms': [{'label': a, 'artifact': b, 'layoutMode': c} for a, b, c in ARMS],
            'rounds': 3, 'budgetMsPerPolicy': 480000, 'repsJobField': 25,
            'workerCountPerPolicy': 15, 'armOrder': 'rotate left by roundIndex; serial workers; off policy then normal policy',
            'gates': {'aaReciprocalAllocationAndRss': 1.1, 'candidateAllocationAndRssGrowth': 1.25, 'candidateRetainedGrowthBytes': 16777216},
            'scope': ['Separate new memory experiment; never repairs or replaces failed legacy release/differential deadline outcomes.',
                      'Each worker receives all historical27 inputs in their declared order. Warmup is one whole pass; GC-boundary allocation/heap estimates include per-input calls and a later complete mixed-session pass.',
                      'RSS is the entire fresh worker lifetime; retention is one settled whole27 pass, not7 official corpus or individual scaling-process retention.',
                      'Memory mode ignores reps except positive-integer validation;25 is retained solely for the unchanged file protocol. No latency/repetition-count claims.',
                      'Unchanged memory worker consumes complete UTF8 SVG and serialized receipt but exposes no SVG/receipt fingerprints; A/A proves same frozen artifact and identical job parameters, with symmetric memory health checks. Earlier timing campaigns retain correctness/determinism evidence.',
                      'No retries, no reduced population, no increased deadline. Remaining unlaunched rows remain explicit after budget exhaustion.',
                      'Allocation and peak heap are GC-boundary estimates; post-GC retained growth is clamped at zero. Retained ratios with zero denominators are null; retention has an absolute cap rather than fragile reciprocal-ratio gating.']}
    save(out / 'plan.json', plan)
    print(json.dumps({'plan': str(out / 'plan.json'), 'planSha256': sha(out / 'plan.json'), 'inputsSha256': plan['inputsSha256'], 'workerClosure': plan['workerClosure'], 'workerCount': 30, 'status': plan['status']}, indent=2))


def paired(rows, numerator, denominator, metric):
    ratios = []
    for r in range(1, 4):
        a = next((v for v in rows if v['round'] == r and v['arm'] == numerator and v['status'] == 'ok'), None)
        b = next((v for v in rows if v['round'] == r and v['arm'] == denominator and v['status'] == 'ok'), None)
        x, y = (a['result'].get(metric), b['result'].get(metric)) if a and b else (None, None)
        ratios.append(x / y if isinstance(x, (float, int)) and isinstance(y, (float, int)) and y > 0 else None)
    complete = all(v is not None and math.isfinite(v) for v in ratios)
    return {'rounds': ratios, 'complete': complete, 'median': statistics.median(ratios) if complete else None}


def summarize(rows):
    result = []
    for name, numerator, denominator, aa in [('elk-aa', 'elk-aa', 'elk-reference', True), ('native23-aa', 'native23-aa', 'native23', True),
                                             ('native24-elk', 'native24', 'elk-reference', False), ('native24-native23', 'native24', 'native23', False)]:
        metrics = {m: paired(rows, numerator, denominator, m) for m in METRICS}
        limit = 1.1 if aa else 1.25
        checks = []
        for metric in ['passAllocatedBytes', 'peakRssBytes']:
            value = metrics[metric]['median']
            checks.append({'name': metric, 'ok': value is not None and (1 / limit <= value <= limit if aa else value <= limit), 'ratio': value, 'limit': limit, 'symmetric': aa})
        if not aa:
            values = [v.get('result', {}).get('retainedGrowthBytes') for v in rows if v['arm'] == numerator and v['status'] == 'ok']
            checks.append({'name': 'all3 candidate whole27 pass retained growth ≤16MiB', 'ok': len(values) == 3 and all(v <= 16777216 for v in values), 'bytes': values})
        result.append({'name': name, 'metrics': metrics, 'checks': checks, 'gatesPass': all(c['ok'] for c in checks)})
    return result


def run(args):
    plan_path = pathlib.Path(args.plan).resolve()
    p = json.loads(plan_path.read_text())
    out = pathlib.Path(p['out'])
    report_path = out / 'report.json'
    if report_path.exists():
        raise ValueError('Refusing a second execution/retry of this declaration')
    if p['protocol'] != 'full27-mixed-session-memory-only@1' or p['rounds'] != 3 or p['budgetMsPerPolicy'] != 480000 or p['policies'] != POLICIES or p['arms'] != [{'label': a, 'artifact': b, 'layoutMode': c} for a, b, c in ARMS]:
        raise ValueError('Protocol fields changed')
    if sha(__file__) != p['driverSha256'] or sha(p['node']) != p['nodeSha256'] or sha(p['inputs']) != p['inputsSha256'] or closure(p['worker']) != p['workerClosure']:
        raise ValueError('Declared driver/node/inputs/worker changed')
    if any(artifact(v['directory']) != v for v in p['artifacts'].values()):
        raise ValueError('Declared renderer artifacts changed')
    inputs = read_inputs(p['inputs'])
    report = {'protocol': p['protocol'], 'planSha256': sha(plan_path), 'status': 'running', 'policies': [], 'ok': None,
              'nodeVersion': subprocess.check_output([p['node'], '--version'], text=True).strip(), 'pythonVersion': sys.version}
    save(report_path, report)
    try:
        for policy in POLICIES:
            start = time.monotonic()
            deadline = start + 480
            section = {'layoutCache': policy, 'budgetMs': 480000, 'cacheEnvironment': environment(policy), 'observations': [], 'status': 'running'}
            report['policies'].append(section)
            for r in range(1, 4):
                ordered = ARMS[r - 1:] + ARMS[:r - 1]
                for label, which, mode in ordered:
                    prefix = out / f'{policy}-{r}-{label}'
                    row = {'round': r, 'arm': label, 'status': 'running'}
                    section['observations'].append(row)
                    job = {'entry': p['artifacts'][which]['entry'], 'mode': 'memory', 'inputs': inputs, 'reps': 25, 'layoutMode': mode, 'layoutCache': policy, 'consumeReceipt': True}
                    job_path = prefix.with_suffix('.job.json')
                    result_path = prefix.with_suffix('.json')
                    save(job_path, job)
                    row['jobSha256'] = sha(job_path)
                    save(report_path, report)
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        row.update(status='budget-exhausted', failure='Shared480000ms policy deadline reached before worker launch')
                        save(report_path, report)
                        continue
                    child = subprocess.Popen([p['node'], '--expose-gc', '--no-warnings', p['worker'], str(job_path), str(result_path)],
                                             cwd=str(pathlib.Path(p['worker']).parent.parent.parent), env={**os.environ, **environment(policy), 'AGENTIC_MERMAID_SCENE_ASSERTIONS': '0'},
                                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
                    timed_out = False
                    try:
                        stdout, stderr = child.communicate(timeout=remaining)
                    except subprocess.TimeoutExpired:
                        timed_out = True
                        try:
                            os.killpg(child.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        stdout, stderr = child.communicate()
                    except BaseException:
                        if child.poll() is None:
                            os.killpg(child.pid, signal.SIGKILL)
                        child.communicate()
                        raise
                    prefix.with_suffix('.stdout').write_text(stdout)
                    prefix.with_suffix('.stderr').write_text(stderr)
                    row.update(exitCode=child.returncode, status='timeout' if timed_out else 'worker-failed' if child.returncode else 'ok', stderr=stderr)
                    if row['status'] == 'ok':
                        try:
                            result = json.loads(result_path.read_text())
                            if [v['id'] for v in result['perInput']] != [v['id'] for v in inputs] or result.get('cacheEnvironment') != environment(policy):
                                raise ValueError('Incomplete/reordered population or wrong cache environment')
                            values = [result.get(k) for k in METRICS] + [v.get(k) for v in result['perInput'] for k in ['allocatedBytes', 'peakHeapBytes']]
                            if any(not isinstance(v, (float, int)) or not math.isfinite(v) or v < 0 for v in values):
                                raise ValueError('Invalid memory metric')
                            row['result'] = result
                            row['resultSha256'] = sha(result_path)
                        except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError) as exc:
                            row.update(status='result-invalid', failure=str(exc))
                    if row['status'] != 'ok':
                        progress = pathlib.Path(str(result_path) + '.progress.json')
                        if progress.exists():
                            row['lastProgress'] = json.loads(progress.read_text())
                    save(report_path, report)
            section['elapsedSeconds'] = time.monotonic() - start
            section['summary'] = summarize(section['observations'])
            section['measurementsComplete'] = len(section['observations']) == 15 and all(v['status'] == 'ok' for v in section['observations'])
            section['artifactsUnchanged'] = all(artifact(v['directory']) == v for v in p['artifacts'].values()) and closure(p['worker']) == p['workerClosure']
            section['ok'] = section['measurementsComplete'] and section['artifactsUnchanged'] and all(v['gatesPass'] for v in section['summary'])
            section['status'] = 'completed'
            save(report_path, report)
        report.update(status='completed', ok=all(v['ok'] for v in report['policies']))
        save(report_path, report)
        return 0 if report['ok'] else 1
    except BaseException as exc:
        report.update(status='failed', ok=False, error=f'{type(exc).__name__}: {exc}')
        save(report_path, report)
        raise


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    d = sub.add_parser('declare')
    for key in ['baseline', 'candidate', 'worker', 'inputs', 'out']:
        d.add_argument('--' + key, required=True)
    d.add_argument('--node', default='node')
    r = sub.add_parser('run')
    r.add_argument('--plan', required=True)
    args = parser.parse_args()
    if args.command == 'run':
        from ci_policy import assert_benchmark_execution_allowed
        assert_benchmark_execution_allowed()
        return run(args)
    return declare(args)


if __name__ == '__main__':
    sys.exit(main())
