#!/usr/bin/env python3
"""Summarize retained measurements; never substitute missing or failed observations.

Run after paired.ts completes: python3 eval/font-layout/report.py ../measurements
Outputs report.json (all matched cases) and report.html (reviewable comparisons).
Uses only Python's standard library. Raw inputs remain authoritative.
"""
import collections
import html
import json
import math
import pathlib
import statistics
import sys

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '../measurements')
PAIRED = sys.argv[2] if len(sys.argv) > 2 else 'paired-final'
OUTPUT = sys.argv[3] if len(sys.argv) > 3 else 'report'
VARIANTS = ['baseline', 'shipped-off', 'fonts', 'elk-order', 'ports', 'wrap', 'all',
            'all-minus-fonts', 'all-minus-order', 'all-minus-ports', 'all-minus-wrap']


def read(path):
    return json.loads(path.read_text())


def lines(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def median(values):
    values = [v for v in values if v is not None and math.isfinite(v)]
    return statistics.median(values) if values else None


def percentile(values, fraction):
    values = sorted(v for v in values if v is not None and math.isfinite(v))
    return values[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def flatten(obj, prefix=''):
    result = {}
    for key, value in (obj or {}).items():
        name = prefix + key
        if isinstance(value, dict):
            result.update(flatten(value, name + '.'))
        elif isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            result[name] = value
    return result


def quality_vector(row):
    result = {k: row[k] for k in ['width', 'height', 'viewportScale', 'svgBytes', 'svgGzipBytes', 'svgBrotliBytes', 'receiptBytes'] if isinstance(row.get(k), (int, float))}
    if row.get('width') is not None and row.get('height') is not None:
        result['area'] = row['width'] * row['height']
    for name in ['graphQuality', 'familyQuality']:
        if row.get(name):
            result.update(flatten(row[name].get('metrics'), name + '.'))
            result[name + '.hardViolations'] = len(row[name].get('hardViolations', []))
    raster = row.get('raster') or {}
    for key in ['width', 'height', 'rgbaBytes', 'pngBytes', 'offCanvasPixels', 'minimumFittedFontPx']:
        if isinstance(raster.get(key), (int, float)):
            result['raster.' + key] = raster[key]
    result.update(flatten(raster.get('nodeTextContainment'), 'raster.containment.'))
    ledger = row.get('receipt', {}).get('layoutOptimization')
    if ledger:
        result.update(flatten(ledger, 'optimization.'))
    return result


quality = {}
for variant in VARIANTS:
    rows = lines(ROOT / 'quality' / variant / 'raw-0.jsonl')
    quality[variant] = {(r['observation']['id'], r['observation']['backend']): r['observation'] for r in rows}
base = quality['baseline']
quality_cases, quality_summary = [], []
for variant, rows in quality.items():
    changes = collections.defaultdict(lambda: {'lower': 0, 'equal': 0, 'higher': 0, 'missing': 0})
    totals = collections.defaultdict(float)
    failures, raster_failures = [], []
    for key in sorted(set(base) | set(rows)):
        before, after = base.get(key), rows.get(key)
        if after is None or after.get('failure'):
            failures.append({'id': key[0], 'backend': key[1], 'failure': (after or {}).get('failure', 'missing')})
        if after and (after.get('raster') or {}).get('failure'):
            raster_failures.append({'id': key[0], 'backend': key[1], 'failure': after['raster']['failure']})
        b, a = quality_vector(before or {}), quality_vector(after or {})
        delta = {k: a[k] - b[k] for k in a.keys() & b.keys()}
        for k in b.keys() | a.keys():
            if k not in a or k not in b:
                changes[k]['missing'] += 1
            else:
                d = delta[k]
                epsilon = 1e-7 * max(1, abs(b[k]), abs(a[k]))
                changes[k]['lower' if d < -epsilon else 'higher' if d > epsilon else 'equal'] += 1
        for k, value in a.items():
            totals[k] += value
        quality_cases.append({'variant': variant, 'id': key[0], 'backend': key[1], 'before': b, 'after': a, 'delta': delta,
                              'selected': (after or {}).get('receipt', {}).get('layoutOptimization'),
                              'svg': f'quality/{variant}/{key[1]}/artifacts/{key[0].replace("/", "_")}.svg',
                              'png': f'quality/{variant}/{key[1]}/artifacts/{key[0].replace("/", "_")}.png'})
    ledgers = [r['receipt']['layoutOptimization'] for r in rows.values() if (r.get('receipt') or {}).get('layoutOptimization')]
    quality_summary.append({'variant': variant, 'rows': len(rows), 'renderFailures': failures, 'rasterFailures': raster_failures, 'totals': dict(totals), 'changes': dict(changes),
                            'metricCoverage': {'graph': sum(r.get('graphQuality') is not None for r in rows.values()), 'family': sum(r.get('familyQuality') is not None for r in rows.values()), 'raster': sum(bool(r.get('raster')) and not r['raster'].get('failure') for r in rows.values())},
                            'optimization': {'casesAttempted': sum(r['alternativesAttempted'] > 0 for r in ledgers), 'optionalProducerCalls': sum(r['additionalProducerCalls'] for r in ledgers),
                                             'maxOptionalProducerCalls': max((r['additionalProducerCalls'] for r in ledgers), default=0),
                                             'selections': dict(collections.Counter(s for r in ledgers for s in r['selected']))}})

protocol = read(ROOT / PAIRED / 'protocol.json')
raw = lines(ROOT / PAIRED / 'raw.jsonl')
protocols = [protocol]
warm_protocol_path = ROOT / 'warm-memory/protocol.json'
if warm_protocol_path.exists():
    warm_protocol = read(warm_protocol_path)
    if warm_protocol['head'] == protocol['head'] and warm_protocol['baseline'] == protocol['baseline']:
        protocols.append(warm_protocol)
        if warm_protocol_path.with_name('raw.jsonl').exists():
            raw.extend(lines(warm_protocol_path.with_name('raw.jsonl')))
cost_failures = [r for r in raw if r['status'] != 0 or r['observation'].get('failure')]
grouped = collections.defaultdict(list)
for row in raw:
    grouped[(row['mode'], row['id'], row['backend'])].append(row)
cost_cases = []
for (mode, ident, backend), rows in sorted(grouped.items()):
    rounds = collections.defaultdict(dict)
    for r in rows:
        rounds[r['round']][r['phase'] if r['variant'] == 'baseline' else r['variant']] = r

    def metrics(r):
        obs = r['observation']
        if r['status'] != 0 or obs.get('failure'):
            return {}
        result = {k: obs[k] for k in ['importMs', 'firstMs'] if k in obs}
        if mode == 'startup':
            result['processMs'] = r['elapsedMs']
        if obs.get('samples'):
            result['warmMs'] = median(obs['samples'])
        if mode in ['memory', 'png-memory', 'memory-warm', 'png-memory-warm']:
            for phase in ['beforeImport', 'afterImport', 'outputHeld', 'warmedOutputHeld', 'heldAfterGc', 'releasedAfterGc']:
                result.update(flatten(obs.get(phase), phase + '.'))
            if obs.get('resourceUsage'):
                result['maxRSSKiB'] = obs['resourceUsage']['maxRSS']
        return result

    for variant in VARIANTS[1:]:
        samples, paired, aa, missing = [], [], [], []
        for round_id, run in sorted(rounds.items()):
            if not all(k in run for k in ['control-before', 'control-after', variant]):
                missing.append(round_id)
                continue
            bm, am, vm = [metrics(run[k]) for k in ['control-before', 'control-after', variant]]
            if not bm or not am or not vm:
                missing.append(round_id)
                continue
            control = {k: (bm[k] + am[k]) / 2 for k in bm.keys() & am.keys()}
            ratios = {k: vm[k] / control[k] for k in vm.keys() & control.keys() if control[k]}
            differences = {k: vm[k] - control[k] for k in vm.keys() & control.keys()}
            aa.append({k: abs(bm[k] - am[k]) / control[k] for k in control if control[k]})
            activation = metrics(run['shipped-off']) if 'shipped-off' in run else {}
            marginal = {k: vm[k] / activation[k] for k in vm.keys() & activation.keys() if activation[k]}
            paired.append({'round': round_id, 'control': control, 'feature': vm, 'ratio': ratios, 'delta': differences, 'ratioToShippedOff': marginal})
            samples.extend(run[variant]['observation'].get('samples', []))
        metric_names = set().union(*(p['feature'].keys() for p in paired)) if paired else set()
        summary = {}
        for k in sorted(metric_names):
            noise = max(.03, median([p.get(k) for p in aa]) or 0)
            ratio = median([p['ratio'].get(k) for p in paired])
            summary[k] = {'controlMedian': median([p['control'].get(k) for p in paired]), 'featureMedian': median([p['feature'].get(k) for p in paired]),
                          'pairedRatioMedian': ratio, 'pairedDeltaMedian': median([p['delta'].get(k) for p in paired]),
                          'ratioToShippedOffMedian': median([p['ratioToShippedOff'].get(k) for p in paired]),
                          'observedControlVariationMedian': median([p.get(k) for p in aa]), 'noiseBand': noise,
                          'classification': 'missing' if ratio is None else 'higher' if ratio > 1 + noise else 'lower' if ratio < 1 - noise else 'within observed variation'}
            if mode == 'startup':
                summary[k]['featureP95'] = percentile([p['feature'].get(k) for p in paired], .95)
                summary[k]['controlP95'] = percentile([metrics(r).get(k) for r in rows if r['variant'] == 'baseline'], .95)
        cost_cases.append({'mode': mode, 'id': ident, 'backend': backend, 'variant': variant, 'rounds': len(paired), 'missingRounds': missing,
                           'warmSamples': samples, 'warmP95': percentile(samples, .95), 'metrics': summary, 'paired': paired})

# Same-round conditional costs reveal interactions without changing shipped code.
index = {(c['mode'], c['id'], c['backend'], c['variant']): c for c in cost_cases}
conditional = []
for c in cost_cases:
    if c['variant'] != 'all':
        continue
    for feature, minus in [('fonts', 'fonts'), ('elk-order', 'order'), ('ports', 'ports'), ('wrap', 'wrap')]:
        other = index.get((c['mode'], c['id'], c['backend'], 'all-minus-' + minus))
        if not other:
            continue
        matches = {p['round']: p for p in other['paired']}
        ratios = collections.defaultdict(list)
        for p in c['paired']:
            if p['round'] not in matches:
                continue
            o = matches[p['round']]['feature']
            for k in p['feature'].keys() & o.keys():
                if o[k]:
                    ratios[k].append(p['feature'][k] / o[k])
        conditional.append({'mode': c['mode'], 'id': c['id'], 'backend': c['backend'], 'addedFeature': feature,
                            'allToAllMinusFeatureMedianRatios': {k: median(v) for k, v in ratios.items()}})

bundles = {p.stem.removeprefix('bundles-'): read(p) for p in ROOT.glob('bundles-*.json')}
browser = []
for variant in VARIANTS:
    path = ROOT / 'quality' / variant / 'browser-observed.json'
    updated = path.with_name('browser-observed-cache.json')
    if updated.exists() and read(updated)['sourceRevision'] == protocol['head']:
        path = updated
    if not path.exists():
        continue
    for row in read(path)['rows']:
        browser.append({'variant': variant, 'source': read(path)['sourceRevision'], 'backend': row['backend'], 'errors': row['errors'],
                        'initialRequests': len(row['initial']), 'renderedRequests': len(row['requests']),
                        'initial': {k: sum(r[k] for r in row['initial']) for k in ['encodedBytes', 'decodedBytes', 'transferBytes']},
                        'rendered': {k: sum(r[k] for r in row['requests']) for k in ['encodedBytes', 'decodedBytes', 'transferBytes']}})
font = {}
for variant, path in [('baseline', ROOT / 'baseline-fixed/font-advances.json'), ('fonts', ROOT / 'quality/fonts/font-advances.json')]:
    f = read(path)
    errors = [r['absoluteErrorPx'] for r in f['rows']]
    font[variant] = {'method': f['method'], 'labels': f['labels'], 'probes': len(errors), 'maePx': sum(errors) / len(errors), 'maxPx': max(errors), 'p95Px': percentile(errors, .95)}

observed_modes = collections.Counter(r['mode'] for r in raw)
corpus = read(ROOT / 'baseline-fixed/corpus.json')
expected_keys = set()
for spec in protocols:
    for mode in spec['modes']:
        cohort = ['contact-sheet/A'] if mode == 'startup' else spec['memoryCohort'] if mode in ['memory', 'memory-warm'] else spec['pngCohort'] if mode.startswith('png') else spec['selected']
        for item in corpus:
            if item['id'] not in cohort:
                continue
            backends = ['elk', 'agentic'] if item['family'] in ['flowchart', 'state', 'class', 'er', 'requirement', 'architecture'] else ['elk']
            for backend in backends:
                for round_id in range(21 if mode == 'startup' else spec['rounds']):
                    for phase in ['control-before', 'control-after', *VARIANTS[1:]]:
                        expected_keys.add((mode, round_id, item['id'], backend, phase))
actual_keys = collections.Counter((r['mode'], r['round'], r['id'], r['backend'], r['phase'] if r['variant'] == 'baseline' else r['variant']) for r in raw)
audit = {'missing': sorted(expected_keys - actual_keys.keys()), 'unexpected': sorted(actual_keys.keys() - expected_keys),
         'duplicates': [{'key': k, 'count': n} for k, n in actual_keys.items() if n != 1]}
expected = dict(collections.Counter(k[0] for k in expected_keys))
complete = not any(audit.values())
replay_path = ROOT / 'cache-replay.json'
replay = read(replay_path) if replay_path.exists() else None
cache_followup = replay is not None and replay['source'] == protocol['head']
lazy = {p.stem.removeprefix('lazy-'): read(p) for p in ROOT.glob('lazy-*.json')}
report = {'protocol': protocol, 'auxiliaryProtocols': protocols[1:], 'complete': complete, 'observedRows': dict(observed_modes), 'expectedRows': expected,
          'font': font, 'qualitySummary': quality_summary, 'qualityCases': quality_cases,
          'qualitySources': {v: read(ROOT / 'quality' / v / 'protocol-0.json')['source'] for v in VARIANTS},
          'cacheReplay': replay if cache_followup else None, 'lazyStageClosures': lazy,
          'rowAudit': audit, 'costFailures': cost_failures, 'costCases': cost_cases, 'conditionalCosts': conditional, 'bundles': bundles, 'browser': browser}
(ROOT / (OUTPUT + '.json')).write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')


def esc(v):
    return html.escape(str(v))


def number(v, digits=3):
    return '—' if v is None else f'{v:,.{digits}f}'


def memory_number(case, metric, field, divisor):
    value = case['metrics'].get(metric, {}).get(field)
    return number(None if value is None else value / divisor, 2)


def table(headers, rows):
    return '<div class="scroll"><table><thead><tr>' + ''.join('<th>' + esc(x) + '</th>' for x in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join('<td>' + str(c) + '</td>' for c in row) + '</tr>' for row in rows) + '</tbody></table></div>'


parts = ['''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Agentic Mermaid — measured font and layout changes</title>
<style>body{font:16px/1.5 system-ui,sans-serif;color:#182635;background:#f7f8fa;max-width:1440px;margin:40px auto;padding:0 24px}h1{font-size:36px;line-height:1.15}h2{margin-top:48px}p{max-width:100ch}table{border-collapse:collapse;width:100%;background:white;font-size:13px}th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #dce2e7;font-variant-numeric:tabular-nums;vertical-align:top}th{background:#e6edf2;white-space:nowrap}.scroll{overflow:auto;margin:16px 0}figure{margin:16px 0;background:white;padding:16px;border:1px solid #dce2e7}img{display:block;max-width:100%;height:auto;background:white}figcaption{font-size:13px;color:#41586a}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.note{border-left:4px solid #a96b16;padding:12px 20px;background:#fff5df}code{font-size:.88em}summary{cursor:pointer;font-weight:600;margin:16px 0}a{color:#125d9c}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style>
<h1>Agentic Mermaid: what each improvement buys</h1>''']
parts.append('<p>' + ('Completed comparison.' if complete else '<strong>INCOMPLETE cost collection — provisional report.</strong>') + ' Base <code>' + esc(protocol['baseline']) + '</code>; immutable production head <code>' + esc(protocol['head']) + '</code>. All four features are implemented as opt-in choices. Existing defaults are preserved. <a href="' + esc(OUTPUT) + '.json">Complete matched data</a>; <a href="' + esc(PAIRED) + '/protocol.json">predeclared paired protocol</a>; <a href="' + esc(PAIRED) + '/raw.jsonl">raw cost observations</a>.</p>')
parts.append('''<p>The corpus has 113 sources and 203 source/backend combinations. It includes existing tracker examples, related/duplicate examples, six campaign cases and scaling cases. These are exposed development cases, not a holdout or a user study. Counts describe this corpus; they do not estimate the frequency of benefits in real usage.</p>
<p>All quality configurations use the same frozen inputs and geometry/raster checks, assessed against the same 800×600 target viewport. The viewport scale is the uniform fit factor capped at 1; larger is better. Rendered glyph bounds are checked against the canvas and owning node bounding boxes. This does not prove containment inside curved outlines. Raster allocations, receipts and output dimensions are measured separately from runtime.</p>
<h2>Quality and accuracy</h2>''')
parts.append(table(['Configuration', 'Cases', 'Render / raster failures', 'Hard violations¹', 'Crossings', 'Bends', 'Fit better / worse', 'Area smaller / larger', 'Off-canvas ink / node-box overflows'], [
    [esc(s['variant']), s['rows'], f"{len(s['renderFailures'])} / {len(s['rasterFailures'])}",
     int(s['totals'].get('graphQuality.hardViolations', 0) + s['totals'].get('familyQuality.hardViolations', 0)),
     int(s['totals'].get('graphQuality.edgeCrossings', 0)), int(s['totals'].get('graphQuality.totalBends', 0)),
     f"{s['changes']['viewportScale']['higher']} / {s['changes']['viewportScale']['lower']}",
     f"{s['changes']['area']['lower']} / {s['changes']['area']['higher']}",
     f"{int(s['totals'].get('raster.offCanvasPixels', 0))} / {int(s['totals'].get('raster.containment.outsideBoxes', 0))}"] for s in quality_summary]))
parts.append('<p>¹ Both existing graph and projected-family checks; graph crossings/bends are recorded where the Flowchart rubric applies, rather than inferred for unsupported families. The two violation rubrics can describe the same underlying geometry. All per-case metrics, including symmetry, canonical ports, route associations, SVG/PNG bytes, receipt bytes and RGBA buffers, are in the JSON and detailed tables below. Totals are descriptive, not a weighted quality score.</p>')
parts.append('<p>Check coverage (configuration: graph / projected-family / raster): ' + '; '.join(esc(s['variant']) + ': ' + ' / '.join(str(s['metricCoverage'][k]) for k in ['graph', 'family', 'raster']) for s in quality_summary) + '. Missing graph metrics for other families are unavailable, not zero.</p>')
parts.append(table(['Configuration', 'Cases with alternatives attempted', 'Optional producer calls', 'Maximum in one render', 'Selected strategies'], [[esc(s['variant']), s['optimization']['casesAttempted'], s['optimization']['optionalProducerCalls'], s['optimization']['maxOptionalProducerCalls'], '<br>'.join(esc(k) + ': ' + str(v) for k, v in s['optimization']['selections'].items()) or '—'] for s in quality_summary if s['optimization']['casesAttempted']]))
parts.append('<p>Optional layout work is limited to small graphs (at most 64 authored nodes and 128 edges); port block refinement also limits working vertices and relaxation work. Quality includes a 160-node case, while repeated timing stops at the declared 64-node cohort. No large-graph speedup is claimed. ELK order affects the ELK backend; port placement affects the owned backend. “All” enables every feature applicable to each backend, not two solvers simultaneously.</p>')
parts.append(table(['Advance measurement at 16px', 'Probes', 'Mean absolute error px', '95th percentile px', 'Maximum px'], [[esc(k), v['probes'], number(v['maePx'], 6), number(v['p95Px'], 6), number(v['maxPx'], 6)] for k, v in font.items()]))
parts.append('<p>The estimator includes intentional safety padding. This table measures agreement with natural horizontal advances, not a reduction in already-zero measured glyph overflows. Improved natural sizing can still change layout trade-offs.</p>')
font_advice = ('The first implementation used the conservative host-profile path and had a 4.707× median cached-call ratio to base. Measurements prompted a follow-up: the immutable built-in profile now reuses positioned geometry with a versioned cache identity; host callbacks still bypass it. Current tables measure that follow-up. <a href="report-before-cache.html">The complete first campaign is retained</a>. '
               if cache_followup else 'This measured revision uses the conservative host-profile path, which bypasses some layout/preparation caching. Keep it opt-in until cache eligibility can safely recognize the immutable built-in profile. ')
parts.append('''<p>Font metrics cover printable ASCII with pinned Inter 400/500/600/700 in normal style and sparse pair adjustments. Unsupported styles, weights, families and Unicode retain the estimator and its safety envelopes. This is not a full shaping engine. The oracle shapes entire strings with HarfBuzz; table generation uses the same pinned fonts and HarfBuzz implementation on characters/pairs, so this is an independent full-string comparison, not an independent shaping implementation. All 301 labels × four weights are retained.</p>
<h2>What is worth keeping?</h2>
<p><strong>Bundled metrics:</strong> a large accuracy gain and clearer digit sizing. ''' + font_advice + '''More accurate widths can enlarge diagrams or add bends; font accuracy is not a guarantee of smaller geometry.</p>
<p><strong>ELK order alternative:</strong> removes two of the corpus’s three crossings. It is narrowly triggered, constrained by explicit ordering, limited to small graphs and certified before selection. Its benefits can cost area. It reuses ELK rather than adding another dependency.</p>
<p><strong>Port placement:</strong> reduces bends in the owned backend using actual port offsets and feasible same-layer separation. Isolated: 65 cases attempted, 18 accepted; 11 have fewer bends, while 11 worsen the peer-barycenter symmetry metric and 10 reduce canonical-port rate. These are corpus case counts, including related examples. Keep it selective rather than claiming a universal improvement. The receipt records work even when no output changes. This is a bounded refinement with rigid blocks, not a complete Brandes–Köpf implementation.</p>
<p><strong>Viewport wrapping:</strong> improves fit on selected wide diagrams, but can produce awkward word breaks. Keep it experimental until word integrity and readable line counts enter the objective. An explicit wrapping width and authored breaks retain precedence. It tests complete candidate diagrams, not a globally optimal wrapping solution.</p>
<p class="note">Interactions matter: ELK order, port placement and wrapping share at most two optional producer attempts per render. A crossing-free order candidate may be wider and consume an attempt wrapping could use. Combined fit gains therefore do not equal the sum of isolated gains. Leave-one-out configurations make this visible. Public nested renders receive independent budgets; internal candidate search shares its parent budget.</p>
<p>Library usage: <code>renderMermaidSVGWithReceipt(source, { fontMetrics: 'bundled-inter', graphLayout: { backend: 'agentic', quality: 'balanced', viewport: { width: 800, height: 600 } } })</code>. Select <code>backend: 'elk'</code> to use the bounded ELK order alternative. Omit the viewport to avoid wrapping exploration. The viewport guides candidate selection; it does not rescale the exported SVG itself. Default options retain the estimator and existing layout behavior.</p>
<h2>Actual rendered evidence</h2><p>Images are the renderer’s original PNGs. Each pair is displayed in equal-width columns, so compare the recorded native dimensions and viewport fit, not apparent label size in the page.</p>''')
for ident, backend, variant, caption in [('campaign/digits', 'elk', 'fonts', 'Pinned advances correct underestimated digit widths.'), ('campaign/source-order', 'elk', 'elk-order', 'Relaxing incidental source order removes the crossing.'), ('contact-sheet/L', 'agentic', 'ports', 'Port-aware block placement removes two bends, with an asymmetric hub position.'), ('regression/mfa-login', 'elk', 'wrap', 'Improved viewport fit, but Credentials breaks awkwardly. This is a visible readability trade-off.')]:
    parts.append('<h3>' + esc(ident + ' · ' + backend) + '</h3><p>' + esc(caption) + '</p><div class="pair">')
    for v in ['baseline', variant]:
        c = next(c for c in quality_cases if c['variant'] == v and c['id'] == ident and c['backend'] == backend)
        parts.append(f'<figure><img src="{esc(c["png"])}" alt="{esc(v + " " + ident)}"><figcaption>{esc(v)} · {number(c["after"].get("width"), 1)} × {number(c["after"].get("height"), 1)} · fit {number(c["after"].get("viewportScale"))} · <a href="{esc(c["svg"])}">SVG</a></figcaption></figure>')
    parts.append('</div>')

parts.append('''<h2>Latency: cached and recomputed work</h2>
<p>Each case/backend/round has a fresh baseline process before and after all ten configurations of the same immutable final build. Configuration order rotates across three rounds. Each SVG process fully consumes output and receipt, warms three calls, then records nine calls. Recompute disables engine/positioned caches; cached uses defaults. Raster and quality inspection are absent. PNG has one warmup and three timed calls using the built public native PNG API, including all output bytes and receipt.</p>
<p>Per round, the control is the arithmetic mean of the two baseline medians. Reported ratios and deltas are medians of the three paired results. Classification uses the larger of a predeclared 3% floor and the median A/A control variation. This is a descriptive noise rule, not a confidence interval. Per-case p95 is nearest-rank across the 27 SVG calls or nine PNG calls. Single-case fresh-start p95 uses 21 independent processes per feature and 42 controls; filesystem/OS caches remain warm.</p>''')
parts.append('<p>Measured on ' + esc(protocol['environment']['cpu']) + ', ' + esc(protocol['environment']['os']) + ', Bun ' + esc(protocol['bun']) + '. Timings are local observations, not deployment latency or CPU-dollar estimates.</p>')
for mode, metric in [('recompute', 'warmMs'), ('cached', 'warmMs'), ('png-latency', 'warmMs'), ('startup', 'processMs')]:
    parts.append('<h3>' + esc(mode) + '</h3>')
    grouped_variants = []
    for v in VARIANTS[1:]:
        selected = [c for c in cost_cases if c['mode'] == mode and c['variant'] == v and metric in c['metrics']]
        ratios = [c['metrics'][metric]['pairedRatioMedian'] for c in selected]
        classes = collections.Counter(c['metrics'][metric]['classification'] for c in selected)
        marginal = [c['metrics'][metric]['ratioToShippedOffMedian'] for c in selected]
        grouped_variants.append([esc(v), len(selected), number(median(ratios)), number(min(ratios) if ratios else None) + '–' + number(max(ratios) if ratios else None), number(median(marginal)), f"{classes['lower']} / {classes['within observed variation']} / {classes['higher']}"])
    parts.append(table(['Configuration', 'Cases', 'Median case ratio to base', 'Case range', 'Median ratio to shipped-off', 'Lower / within noise / higher'], grouped_variants))
    parts.append('<p>Ratios summarize equally weighted cases for navigation, not a user workload. Use the absolute per-case numbers below to assess your usage.</p><details><summary>Absolute per-case timings, controls and variation</summary>')
    parts.append(table(['Case · backend', 'Configuration', 'Rounds', 'Control ms', 'Feature ms', 'Δ ms', 'Ratio', 'Noise band', 'Classification', 'Feature p95 ms'], [[esc(c['id'] + ' · ' + c['backend']), esc(c['variant']), c['rounds'], number(c['metrics'][metric]['controlMedian']), number(c['metrics'][metric]['featureMedian']), number(c['metrics'][metric]['pairedDeltaMedian']), number(c['metrics'][metric]['pairedRatioMedian']), number(c['metrics'][metric]['noiseBand'] * 100, 1) + '%', esc(c['metrics'][metric]['classification']), number(c['metrics'][metric].get('featureP95', c['warmP95']))] for c in cost_cases if c['mode'] == mode and metric in c['metrics']]))
    parts.append('</details>')

if cache_followup and (ROOT / 'report-before-cache.json').exists():
    earlier = read(ROOT / 'report-before-cache.json')
    iteration_rows = []
    for mode, metric in [('recompute', 'warmMs'), ('cached', 'warmMs'), ('png-latency', 'warmMs'), ('startup', 'processMs')]:
        for variant in ['fonts', 'all']:
            old = [c for c in earlier['costCases'] if c['mode'] == mode and c['variant'] == variant and metric in c['metrics']]
            new = [c for c in cost_cases if c['mode'] == mode and c['variant'] == variant and metric in c['metrics']]
            iteration_rows.append([esc(mode), esc(variant), len(old), len(new), number(median([c['metrics'][metric]['pairedRatioMedian'] for c in old])), number(median([c['metrics'][metric]['pairedRatioMedian'] for c in new]))])
    parts.append('<h2>What the initial measurements changed</h2><p>The cache follow-up was selected after observing the first campaign. Each iteration has its own alternating controls against the same base. The table compares median case ratios to those controls; it is not a simultaneous direct v1/v2 experiment or independent confirmation. The earlier campaign remains fully available, including failures and raw observations.</p>')
    parts.append(table(['Mode', 'Configuration', 'Earlier cases', 'Final cases', 'Earlier / base ratio', 'Final / base ratio'], iteration_rows))

parts.append('''<h2>Memory and allocation-related costs</h2>
<p>Memory runs are separate fresh children with default caches. RSS is process.resourceUsage().maxRSS (KiB), the process lifetime high-water mark through the post-work/GC sample before worker-report serialization/exit, including Bun, imports, native engines and rasterizer. Heap observations record before/after import, output held, full GC with output held, and released output after GC. Product caches/modules remain live. These are retained/peak observations, not a count of allocated bytes. The first-call PNG lane’s dimension-inspection Buffer remains held until process exit. RGBA and PNG output sizes are measured independently per quality case using Resvg WASM with pinned fonts; public native PNG latency/memory are separate. Browser JS heap snapshots in the raw browser reports exclude workers/native resources and are not a process-memory measurement.</p>''')
if cache_followup:
    parts.append('<p>The follow-up uses the existing shared cache capacities: at most 128 positioned entries with a 16 MiB estimated-residency budget, and 128 retained drawings with an 8 MiB estimated budget. These accounting budgets are not strict RSS limits. Built-in/default variants compete for those capacities; the limits were not raised. The fresh-child measurements below do not saturate a long-lived mixed-workload cache.</p>')
if len(protocols) > 1:
    parts.append('<p><a href="warm-memory/protocol.json">Additional warmed-memory protocol</a> and <a href="warm-memory/raw.jsonl">raw observations</a>: the initial memory lanes retain one render. Warmed lanes make 13 total SVG / five total PNG calls, matching the latency lanes, then take held/released GC snapshots. No extra PNG inspection Buffer is retained in warmed lanes. This follow-up measurement was declared after observing the cache penalty and runs separately from latency. Absolute differences between these two harnesses are not treated as a causal first-to-warm delta.</p>')
for mode in ['memory', 'png-memory', *(['memory-warm', 'png-memory-warm'] if len(protocols) > 1 else [])]:
    parts.append('<h3>' + esc(mode) + '</h3>')
    memory_summary = []
    for variant in VARIANTS[1:]:
        cases = [c for c in cost_cases if c['mode'] == mode and c['variant'] == variant and 'maxRSSKiB' in c['metrics']]
        classes = collections.Counter(c['metrics']['maxRSSKiB']['classification'] for c in cases)
        memory_summary.append([esc(variant), len(cases), number(median([c['metrics']['maxRSSKiB']['pairedDeltaMedian'] / 1024 for c in cases]), 2), number(median([c['metrics']['heldAfterGc.heapUsed']['pairedDeltaMedian'] / 1048576 for c in cases]), 2), f"{classes['lower']} / {classes['within observed variation']} / {classes['higher']}"])
    parts.append(table(['Configuration', 'Cases', 'Median case peak RSS Δ MiB', 'Median held-GC heap Δ MiB', 'RSS lower / within noise / higher'], memory_summary))
    parts.append('<details><summary>Absolute per-case memory</summary>')
    parts.append(table(['Case · backend', 'Configuration', 'Peak RSS base MiB', 'Feature MiB', 'Δ MiB', 'Held GC heap base / feature MiB', 'Released GC heap base / feature MiB'], [[esc(c['id'] + ' · ' + c['backend']), esc(c['variant']), memory_number(c, 'maxRSSKiB', 'controlMedian', 1024), memory_number(c, 'maxRSSKiB', 'featureMedian', 1024), memory_number(c, 'maxRSSKiB', 'pairedDeltaMedian', 1024), ' / '.join(memory_number(c, 'heldAfterGc.heapUsed', k, 1048576) for k in ['controlMedian', 'featureMedian']), ' / '.join(memory_number(c, 'releasedAfterGc.heapUsed', k, 1048576) for k in ['controlMedian', 'featureMedian'])] for c in cost_cases if c['mode'] == mode]))
    parts.append('</details>')

parts.append('<h2>Bundle size and actual network requests</h2><p>Static ESM sizes sum per-file compressed eager internal closures. External dependencies, dynamic imports and font resources are excluded. IIFE sizes are the actual monolith. Historical stages attribute shipping cost; final-minus-wrap also includes integration fixes. Compression can move slightly across chunk boundaries. Runtime activation comparisons use the same final code. No new third-party runtime dependency is introduced.</p>')
stage_rows = []
previous = None
for name in ['baseline', 'fonts-stage', 'elk-stage', 'wrap-stage', 'final-stage', *(['cache-stage'] if cache_followup else [])]:
    b = bundles[name]
    vals = [b['nodeSvg']['totals']['gzip'], b['nodeAgent']['totals']['gzip'], b['browserIife']['gzip']]
    delta = ['—'] * 3 if previous is None else [f'{v - p:+,}' for v, p in zip(vals, previous)]
    stage_rows.append([esc(name), esc(b['revision'][:12]), *[f'{v:,}' for v in vals], *delta])
    previous = vals
parts.append(table(['Build', 'Revision', 'Node SVG gzip B', 'Node PNG gzip B', 'IIFE gzip B', 'Δ SVG B', 'Δ PNG B', 'Δ IIFE B'], stage_rows))
parts.append('<p>The historical wrap stage includes both port placement and wrapping, the unsupported-font safety fix and a TypeScript correction. The separate lazy closure stages below distinguish port placement from the later wrapping/fix increment; these historical increments charge shared scaffolding to the stage that introduced it. The built ESM/IIFE comparison does not invent a split where no corresponding full build was captured.</p>')
lazy_rows, previous = [], None
for name in ['baseline', 'fonts-stage', 'elk-stage', 'ports-stage', 'wrap-stage', 'final-stage', *(['cache-stage'] if cache_followup else [])]:
    if name not in lazy:
        continue
    item = lazy[name]
    flow = item['families']['flowchart']
    values = [flow['gzip'], flow['nativeSolver']['gzip']]
    lazy_rows.append([esc(name), item['initial']['gzip'], *values, *(['—', '—'] if previous is None else [f'{v - p:+,}' for v, p in zip(values, previous)])])
    previous = values
parts.append(table(['Lazy static closure stage', 'Initial gzip B', 'ELK gzip B', 'Native gzip B', 'Δ ELK B', 'Δ native B'], lazy_rows))
parts.append('<p>These static closures use gzip level 9 and exclude the on-demand font table. They include the chosen solver. The actual HTTP request table below uses server gzip and includes every resource fetched for the selected options. Small initial compressed differences come from content-addressed chunk references, not changed initial source length (15,428 bytes throughout).</p>')
parts.append(table(['Configuration', 'Backend', 'Initial requests / gzip B', 'Rendered requests / gzip B', 'Decoded rendered B', 'HTTP transfer B'], [[esc(r['variant']), esc(r['backend']), f"{r['initialRequests']} / {r['initial']['encodedBytes']:,}", f"{r['renderedRequests']} / {r['rendered']['encodedBytes']:,}", f"{r['rendered']['decodedBytes']:,}", f"{r['rendered']['transferBytes']:,}"] for r in browser]))
parts.append('''<p>Actual request closures use a fresh Chromium context over local gzip HTTP with no-store. Strict rendering does not download font files; matching pinned fonts must already be supplied by the host for paint to match the metrics. Initial imports stay unchanged. Single-context browser latency is retained raw but is not used for causal performance claims. Cold network delays vary by deployment.</p>
<h2>Per-case improvements and regressions</h2><p>For each changed metric, negative deltas mean smaller, not necessarily better. Larger viewport fit and canonical-port rates are generally better; smaller bends/crossings/conflicts are generally better. Area and bytes trade off against readability. Full vectors and unchanged cases remain in the JSON.</p>''')
important = ['graphQuality.edgeCrossings', 'graphQuality.totalBends', 'graphQuality.labelConflicts', 'graphQuality.peerBarycenterDelta', 'graphQuality.portEndpointRate', 'viewportScale', 'area', 'raster.rgbaBytes', 'raster.pngBytes', 'svgGzipBytes', 'receiptBytes']
for variant in VARIANTS[1:]:
    parts.append('<details><summary>' + esc(variant) + ': per-case changes</summary>')
    rows = []
    for c in quality_cases:
        if c['variant'] != variant:
            continue
        changes = [(k, c['delta'][k]) for k in important if k in c['delta'] and abs(c['delta'][k]) > 1e-7 * max(1, abs(c['before'][k]))]
        if changes:
            rows.append([esc(c['id'] + ' · ' + c['backend']), '<br>'.join(esc(k.removeprefix('graphQuality.').removeprefix('raster.')) + ': ' + number(c['before'][k]) + ' → ' + number(c['after'][k]) for k, _ in changes), '<a href="' + esc(c['png']) + '">PNG</a>'])
    parts.append(table(['Case', 'Changed values: base → configuration', 'Evidence'], rows))
    parts.append('</details>')
parts.append('<details><summary>Conditional runtime costs: adding one feature to the other three</summary>')
parts.append(table(['Mode', 'Case · backend', 'Added feature', 'All / all-minus-feature'], [[esc(c['mode']), esc(c['id'] + ' · ' + c['backend']), esc(c['addedFeature']), number(c['allToAllMinusFeatureMedianRatios'].get('warmMs' if c['mode'] in ['cached', 'recompute', 'png-latency'] else 'processMs' if c['mode'] == 'startup' else 'maxRSSKiB'))] for c in conditional]))
parts.append('</details>')
validation = '358 relevant tests passed (nine files)' if cache_followup else '349 relevant tests passed (eight files)'
parts.append('''<h2>Reproducibility and limits</h2>
<p>Quality batches reproduce all 203 baseline SVG bytes from the original fresh-process capture. Shipped-off final output also matches all 203 baseline SVGs. Batches disable engine/positioned caches; their time/memory fields are not treated as performance results. Cost workers import built public package entries from immutable checkouts. The paired protocol records the machine, Bun version, sources, controls, cohorts and cache lanes. Build and test load is kept out of the paired cost run.</p>
<p>The first raster harness attempt failed because two Resvg module instances did not share initialization. It remains under baseline/ and was superseded by baseline-fixed/ before production changes; it is excluded from comparisons rather than converted to zero. Earlier source-entry timing and intermediate feature stages remain retained as exploratory measurements; final built-entry ablations are authoritative. One intermediate port-stage TypeScript issue was fixed before final validation. No failed final feature rows are silently dropped.</p>
<p>Validation: ''' + validation + ''', separate nested-budget checks passed, core and repository typechecks passed, lint passed, and all package builds including declarations succeeded. These are local checks; the complete CI suite has not run. Original project checkout remains unchanged; work is isolated on font-layout-costs. No PR or deployment was requested.</p>
<p>These implementations cover bundled-font metrics, a bounded ELK alternative, port-aware owned placement and wrapping evaluated against the complete diagram. They do not deliver general Unicode shaping, a new sparse layered engine, globally optimal layout/wrapping, human readability guarantees or a hidden evaluation set.</p>
<p>Relevant primary references: <a href="https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/gd15.pdf">size- and port-aware placement (Rüegg et al.)</a>, <a href="https://arxiv.org/abs/2008.01252">Brandes–Köpf erratum</a>, <a href="https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-crossingMinimization-forceNodeModelOrder.html">ELK force-node-model-order</a>, <a href="https://harfbuzz.github.io/shaping-and-shape-plans.html">HarfBuzz shaping</a>. The measurements, rather than these papers alone, determine the recommendation here.</p>''')
if cache_followup:
    replay_rows = [r for group in replay['rows'] for r in (group['observations'] or [])]
    parts.append('<p>Cache follow-up quality evidence is reused by artifact identity: <a href="cache-replay.json">the complete built-entry replay</a> compares ' + str(len(replay_rows)) + ' case/backend/configuration combinations on first and repeated calls, with ' + str(sum(not r['coldMatches'] or not r['warmMatches'] for r in replay_rows)) + ' byte mismatches and ' + str(sum(g['status'] != 0 for g in replay['rows'])) + ' failed processes. The JSON preserves the original quality producer revisions and the new replay revision. Additional cache-boundary tests, both typechecks, lint and a complete package build passed after this change. This follow-up was motivated by exposed measurements and remains development tuning.</p>')
parts.append('<p>Recorded rows: ' + esc(dict(observed_modes)) + '. Final worker failures: ' + str(len(cost_failures)) + '.</p></html>')
(ROOT / (OUTPUT + '.html')).write_text('\n'.join(parts))
print(json.dumps({'complete': complete, 'rows': dict(observed_modes), 'failures': len(cost_failures), 'report': str(ROOT / (OUTPUT + '.html'))}))
