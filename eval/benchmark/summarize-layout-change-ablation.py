#!/usr/bin/env python3
"""Summarize memory from an existing layout-final-cost manifest; launches nothing.

Writes a separate memory summary, leaving measured driver/results/summary intact.
Per-input peak heap is available; RSS is process/corpus scope, not per input.
"""
import argparse
import hashlib
import json
import math
import pathlib
import statistics


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def ratios(values):
    result = {}
    for label, numerator, denominator in [('aa', 'before-aa', 'before'), ('afterBefore', 'after', 'before'),
                                          ('beforeElk', 'before', 'elk'), ('afterElk', 'after', 'elk')]:
        if numerator not in values or denominator not in values:
            continue
        rounds = [a / b if a is not None and b is not None and b > 0 else None
                  for a, b in zip(values[numerator], values[denominator])]
        valid = [value for value in rounds if value is not None]
        result[label] = {'rounds': rounds, 'validRounds': len(valid), 'complete': len(valid) == len(rounds),
                         'median': statistics.median(valid) if valid else None}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=pathlib.Path)
    parser.add_argument('--out', type=pathlib.Path, help='Default: directory/summary-memory.json')
    args = parser.parse_args()
    root = args.directory.resolve()
    manifest_path = root / 'manifest.json'
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    plan = manifest['plan']
    arms = plan['arms']
    results, failures = {}, []
    rows = [row for row in manifest['observations'] if row['mode'] == 'memory']
    for row in rows:
        if row.get('status') != 'ok':
            failures.append(row)
            continue
        try:
            path = pathlib.Path(row['resultFile'])
            results[(row['cache'], row['round'], row['arm'])] = json.loads(path.read_text())
        except (OSError, ValueError) as error:
            failures.append({**row, 'error': str(error)})
    summary = {'protocol': 'layout-change-memory-summary@1', 'sourceManifestSha256': hashlib.sha256(manifest_bytes).hexdigest(),
               'plan': plan, 'workers': len(rows), 'failed': failures, 'perInput': {}, 'corpus': {},
               'limitations': [
                   'Read-only analysis of existing fresh-worker results; no additional measurements.',
                   'Per-input peakHeapBytes is estimated absolute heap occupancy at GC boundaries, not incremental retained bytes.',
                   'peakRssBytes is the maximum across the worker lifetime, including import and warmup. The worker does not measure per-input RSS.',
                   'retainedGrowthBytes is clamped nonnegative by the worker. Ratios with a zero denominator are unavailable.',
                   'Three rounds and one post-warmup memory render per input per worker; timing reps do not multiply memory samples.',
                   'Partial ratios remain incomplete. This is bounded input evidence, not full release qualification.']}
    for cache in plan['policies']:
        summary['perInput'][cache] = {}
        for item in plan['inputs']:
            case = item['id']
            cell = {}
            for metric in ['allocatedBytes', 'peakHeapBytes']:
                values = {arm: [] for arm in arms}
                for rnd in range(1, plan['rounds'] + 1):
                    for arm in arms:
                        result = results.get((cache, rnd, arm), {})
                        found = next((value for value in result.get('perInput', []) if value.get('id') == case), {})
                        values[arm].append(number(found.get(metric)))
                cell[metric] = {'scope': 'single post-warmup input render', 'values': values, 'ratios': ratios(values)}
            summary['perInput'][cache][case] = cell
        summary['corpus'][cache] = {}
        for metric in ['passAllocatedBytes', 'passPeakHeapBytes', 'retainedGrowthBytes', 'peakRssBytes']:
            values = {arm: [number(results.get((cache, rnd, arm), {}).get(metric)) for rnd in range(1, plan['rounds'] + 1)]
                      for arm in arms}
            summary['corpus'][cache][metric] = {'scope': 'worker lifetime maximum' if metric == 'peakRssBytes' else 'declared input population pass',
                                               'values': values, 'ratios': ratios(values)}
    output = args.out.resolve() if args.out else root / 'summary-memory.json'
    measured = {manifest_path, root / 'plan.json', root / 'summary.json'}
    measured.update(pathlib.Path(row['resultFile']).resolve() for row in manifest['observations'] if row.get('resultFile'))
    measured.update(pathlib.Path(row['jobFile']).resolve() for row in manifest['observations'] if row.get('jobFile'))
    if output in measured:
        parser.error('--out must not overwrite measured manifests, jobs, results or the original summary')
    output.write_text(json.dumps(summary, indent=2, allow_nan=False) + '\n')
    print(output)


if __name__ == '__main__':
    main()
