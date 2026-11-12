"""Reporting only: reduce retained Trident observations; never execute a renderer."""
import csv
import gzip
import hashlib
import json
import math
import statistics
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
ARMS = [("pr", "agentic"), ("pr", "elk")]
GRAPH_FAMILIES = {"flowchart", "state", "class", "er", "architecture", "requirement", "agentflow", "usecase"}

def read(name):
    return json.loads((ROOT / name).read_text())

def write(name, value):
    (ROOT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")

def median(values):
    values = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    return statistics.median(values) if values else None

def summary(values):
    values = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    return {"median": median(values), "min": min(values) if values else None,
            "max": max(values) if values else None, "processes": len(values)}

def csv_write(name, rows):
    if not rows:
        return
    fields = list(dict.fromkeys(k for r in rows for k in r))
    with (ROOT / name).open("w", newline="") as f:
        writer = csv.DictWriter(f, fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items()})

def fmt(value, digits=1):
    return "—" if value is None else f"{value:,.{digits}f}"

def number(obj, key):
    return obj.get(key, {}).get("median")

def status(check):
    if not check:
        return "unavailable"
    if any(c.get("status") == "failed" for c in check.get("checks", [])):
        return "failed"
    return "passed" if check.get("complete") and check.get("passed") else "unknown"

def delta(a, b):
    return None if a is None or b is None else a - b

def pct(a, b):
    return None if a is None or not b else 100 * (a / b - 1)

def canonical(svg):
    # Existing observer canonicalization: emitted document style identity only.
    import re
    return re.sub(r"am-[a-z0-9]+", "am-CANONICAL", svg)

def main():
    done = read("PERFORMANCE-COMPLETED.json")
    receipt_done = read("RECEIPT-PERFORMANCE-COMPLETED.json")
    assert done["completed"] == 2976 and not done["errors"], done
    assert receipt_done["completed"] == 432 and not receipt_done["failed"], receipt_done
    cases = read("compatibility-overlay/MEASUREMENT-CASES.json")
    by_id = {c["id"]: c for c in cases}
    family_cases = [c for c in cases if c["cohort"] == "family"]
    assert len(family_cases) == 33
    observations = [json.loads(line) for line in (ROOT / "performance/results.jsonl").read_text().splitlines()]
    assert len(observations) == 2976
    groups = defaultdict(list)
    for row in observations:
        result = row["result"]
        groups[row["target"], row["backend"], row["cache"], result["caseId"]].append(result)
    metrics = []
    for (target, backend, cache, case_id), rows in groups.items():
        modes = defaultdict(list)
        for row in rows:
            modes[row["mode"]].append(row)
        row = {"target": target, "backend": backend, "cache": cache, "id": case_id,
               "family": by_id[case_id]["family"], "cohort": by_id[case_id]["cohort"],
               "expectedAccept": by_id[case_id]["expected"]["accept"],
               "statusCounts": dict(Counter(r["status"] for r in rows)),
               "errors": list(dict.fromkeys(r["error"] for r in rows if r.get("error")))}
        calls = [r for r in rows if r['mode'] != 'baseline']
        row['actualAcceptedCounts'] = dict(Counter(str(r.get('qualification', {}).get('accepted', 'unavailable')) for r in calls))
        row['allMeasuredOutputsReturnedWithNoKnownDeclaredFailure'] = bool(calls) and all(
            r.get('qualification', {}).get('accepted') is True and r.get('status') not in ['failed', 'blocked'] for r in calls)
        for mode, track, label in [("warm", "warm-repeat", "warmMs"), ("warm", "warm-new-source", "commentVariantMs"),
                                   ("warm", "warm-label-edit", "alternatingEditMs"), ("cold", "first-use", "coldMs")]:
            row[label] = summary([median(r.get("tracks", {}).get(track, [])) for r in modes[mode]])
        row["importMs"] = summary([r.get("importMs") for r in modes["cold"]])
        row["outputBytes"] = summary([r.get("outputBytes") for r in modes["warm"]])
        for phase in ["before", "atReturn", "afterGc"]:
            for field in ["rss", "heapUsed", "external", "arrayBuffers"]:
                row[f"{phase}_{field}Bytes"] = summary([r.get("memory", {}).get(phase, {}).get(field) for r in modes["memory"]])
        for label, phase in [("apiReturn", "atReturn"), ("retained", "afterGc")]:
            for field in ["rss", "heapUsed", "external", "arrayBuffers"]:
                row[f"{label}Delta_{field}Bytes"] = summary([delta(r.get("memory", {}).get(phase, {}).get(field),
                           r.get("memory", {}).get("before", {}).get(field)) for r in modes["memory"]])
        baseline = {r["replica"]: r for r in modes["baseline"]}
        for field in ["rss", "heapUsed", "external", "arrayBuffers"]:
            row[f"baselineAdjustedRetained_{field}Bytes"] = summary([
                delta(r.get("memory", {}).get("afterGc", {}).get(field),
                      baseline.get(r["replica"], {}).get("memory", {}).get("afterGc", {}).get(field))
                for r in modes["memory"]])
        for mode, label in [("memory", "wholeProcess"), ("baseline", "baselineProcess")]:
            row[label + "PeakRssBytes"] = summary([r.get("resource", {}).get("peakRssBytes") for r in modes[mode]])
            row[label + "CpuSeconds"] = summary([r.get("resource", {}).get("userSeconds", 0) + r.get("resource", {}).get("systemSeconds", 0)
                                                 for r in modes[mode] if r.get("resource")])
        metrics.append(row)
    write("SVG-METRICS.json", metrics)
    csv_write("SVG-METRICS.csv", metrics)
    lookup = {(r["target"], r["backend"], r["cache"], r["id"]): r for r in metrics}

    receipt_rows = [json.loads(line) for line in (ROOT / "receipt-performance/results.jsonl").read_text().splitlines()]
    assert len(receipt_rows) == 432
    receipt_groups = defaultdict(list)
    for r in receipt_rows:
        receipt_groups[r["target"], r["backend"], r["cache"], r["id"]].append(r["data"])
    receipts = []
    for (target, backend, cache, case_id), rows in receipt_groups.items():
        result = {"target": target, "backend": backend, "cache": cache, "id": case_id, "family": by_id[case_id]["family"],
                  "importMs": summary([r.get("importMs") for r in rows])}
        result["repeatSvgExactWarmup"] = dict(Counter(str(r.get("wholeSvgExactWarmup", "unavailable"))
            for p in rows for r in p["rows"] if r["phase"].startswith("repeat")))
        result["repeatReceiptExactWarmup"] = dict(Counter(str(r.get("entireReceiptExactWarmup", "unavailable"))
            for p in rows for r in p["rows"] if r["phase"].startswith("repeat")))
        result["editedSvgChanged"] = dict(Counter(str(r.get("editChanged", "unavailable"))
            for p in rows for r in p["rows"] if r["phase"].startswith("edit")))
        for phases, label in [(["cold-render"], "cold"), (["repeat1", "repeat2", "repeat3", "repeat4"], "repeat"),
                              (["edit1"], "firstEdit"), (["edit2", "edit3", "edit4"], "repeatedEdit")]:
            selected = [[r for r in process["rows"] if r["phase"] in phases] for process in rows]
            for field in ["wallMs", "cpuMs", "bytes", "peakRssKiB"]:
                result[label + "_" + field] = summary([median([r.get(field) for r in process]) for process in selected])
            result[label + "_status"] = dict(Counter(r.get("status") for process in selected for r in process))
            result[label + "_proof"] = dict(Counter(r.get("proof", {}).get("status", "no-receipt") for process in selected for r in process))
            result[label + "_failures"] = list(dict.fromkeys(str(r.get("failure")) for process in selected for r in process if r.get("failure")))
            for phase in ["before", "after"]:
                for field in ["rss", "heapUsed", "external", "arrayBuffers"]:
                    result[f"{label}_{phase}_{field}Bytes"] = summary([
                        median([r.get(phase, {}).get(field) for r in process]) for process in selected])
        receipts.append(result)
    write("RECEIPT-METRICS.json", receipts)
    csv_write("RECEIPT-METRICS.csv", receipts)
    receipt_lookup = {(r["target"], r["backend"], r["cache"], r["id"]): r for r in receipts}

    fidelity = read("compatibility-overlay/CURRENT-FIDELITY.json")
    fidelity_cases = read("FIDELITY-CASES.json")["selected"]
    source_match = {c["id"]: next((f["id"] for f in fidelity_cases if f["source"] == c["source"]), None) for c in family_cases}
    fid_lookup = {(r["target"], r["backend"], r["id"]): r for r in fidelity}
    payload = list(csv.DictReader((ROOT / "browser/FAMILY-PAYLOAD.csv").open()))
    payload_lookup = {(r["target"], r["backend"], r["family"]): r for r in payload}
    pilot = read("compatibility-overlay/CURRENT-PILOT.json")
    pilot_lookup = {(r["target"], r["backend"], r["id"]): r for r in pilot}
    stability = []
    for c in cases:
        stem_id = c['id'].replace(':', '_')
        for target, backend in ARMS:
            paths = [ROOT / 'performance/svg' / f'cache{cache}-{target}-{backend}-{stem_id}-warm-B.svg' for cache in [0, 1]]
            pilot_path = ROOT / 'pilot' / f'{target}-{backend}-{stem_id}.svg.gz'
            values = [p.read_bytes() if p.exists() else None for p in paths]
            if not pilot_path.exists(): pilot_path = ROOT / 'compatibility-overlay/pilot' / pilot_path.name
            original = gzip.decompress(pilot_path.read_bytes()) if pilot_path.exists() else None
            stability.append({'target': target, 'backend': backend, 'id': c['id'],
                'cache0Sha256': hashlib.sha256(values[0]).hexdigest() if values[0] is not None else None,
                'cache1Sha256': hashlib.sha256(values[1]).hexdigest() if values[1] is not None else None,
                'cacheBytesEqual': values[0] == values[1] if all(v is not None for v in values) else 'unavailable',
                'publicSvgVersusReceiptSvgEqual': values[0] == original if values[0] is not None and original is not None else 'unavailable'})
    write('OUTPUT-STABILITY.json', stability)
    family_rows = []
    for c in family_cases:
        for target, backend in ARMS:
            p = pilot_lookup[target, backend, c["id"]]
            b = payload_lookup[target, backend, c["family"]]
            f = fid_lookup.get((target, backend, source_match[c["id"]]), {})
            q = f.get("quality", {})
            if not q:
                # One eventmodeling representative has a different source from
                # the deeper authored case. Read only its actual SVG viewport;
                # never borrow meaning/paint/route results from another input.
                svg_path = ROOT / 'pilot' / f"{target}-{backend}-{c['id'].replace(':','_')}.svg.gz"
                element = ET.fromstring(gzip.decompress(svg_path.read_bytes()))
                box = [float(x) for x in element.attrib['viewBox'].replace(',', ' ').split()]
                q = {'width': box[2], 'height': box[3], 'area': box[2] * box[3],
                     'viewportScope': 'actual same-input pilot SVG viewBox; deeper authored case differs'}
            row = {"target": target, "backend": backend, "family": c["family"], "id": c["id"],
                   "graphChoiceRecorded": c["family"] in GRAPH_FAMILIES, "delivery": p["delivery"],
                   "proof": p.get("proof", "no-receipt"), "meaning": status(f.get("meaning")),
                   "meaningScope": f.get("expectationDepth", "same-source independent case unavailable"),
                   "quantitativeChecks": f.get("quantitative", []),
                   "paint": status(f.get("paint")), "width": q.get("width"), "height": q.get("height"), "area": q.get("area"),
                   "centerline": q.get("browserCenterline", {"status": "unavailable", "reason": "No same-input independent route observation"}),
                   "linear": q.get("linear", {"status": "unavailable", "reason": "No same-input owned linear-route observation"}),
                   "contacts": q.get("contactCounts", {"status": "unavailable"}),
                   "flowAxisViolations": {"status": "unavailable", "reason": "No enrolled finalSVG flow-axis observer; parsed direction is not geometric compliance"},
                   "exactLabelCollisionCount": {"status": "unavailable", "reason": "Declared browser label visibility/clipping checks are separate from an exact pairwise glyph-collision count"},
                   "svgBytes": p.get("svgBytes"), "receiptBytes": p.get("receiptBytes"),
                   "meaningEvidence": source_match[c["id"]]}
            row['viewportScope'] = q.get('viewportScope', 'actual same-input finalSVG viewBox')
            if f.get("expectationDepth", "").startswith("family/labels"):
                row["meaning"] = "labels-only; deeper unknown"
            receipt_file = ROOT / "pilot" / f"{target}-{backend}-{c['id'].replace(':','_')}.receipt.json.gz"
            actual_receipt = json.loads(gzip.decompress(receipt_file.read_bytes()))
            row["layoutDecisions"] = actual_receipt.get("layoutDecisions", [])
            row["graphChoiceRecorded"] = bool(row["layoutDecisions"])
            assert row["graphChoiceRecorded"] == (c["family"] in GRAPH_FAMILIES), (c, row["layoutDecisions"])
            for field in ["requests", "productRaw", "productGzip9", "productBrotli11", "bindingRaw", "bindingGzip9", "bindingBrotli11", "jsHeapUsedBytes"]:
                row[field] = int(b[field]) if b[field] else None
            for cache in [0, 1]:
                m = lookup[target, backend, cache, c["id"]]
                rr = receipt_lookup[target, backend, cache, c["id"]]
                for field in ["warmMs", "coldMs", "importMs", "alternatingEditMs", "commentVariantMs", "wholeProcessPeakRssBytes",
                              "atReturn_heapUsedBytes", "retainedDelta_heapUsedBytes", "baselineAdjustedRetained_heapUsedBytes"]:
                    row[f"cache{cache}_{field}"] = number(m, field)
                for field in ["cold_wallMs", "repeat_wallMs", "firstEdit_wallMs", "repeatedEdit_wallMs", "repeat_cpuMs", "repeat_bytes"]:
                    row[f"cache{cache}_receipt_{field}"] = number(rr, field)
            family_rows.append(row)
    write("FAMILY-METRICS.json", family_rows)
    csv_write("FAMILY-METRICS.csv", family_rows)
    f_lookup = {(r["target"], r["backend"], r["family"]): r for r in family_rows}
    comparisons = []
    for c in cases:
        for cache in [0, 1]:
            for left, right, label in [(('pr','agentic'),('pr','elk'),'Current PR Native versus ELK')]:
                a, b = lookup[*left, cache, c["id"]], lookup[*right, cache, c["id"]]
                row = {"id": c["id"], "family": c["family"], "cache": cache, "comparison": label,
                       "expectedAccept": c["expected"]["accept"], "calibration": "exploratory; not a qualified ratio",
                       "graphChoiceRecordedForFamilyRepresentative": c["family"] in GRAPH_FAMILIES,
                       "leftActualAcceptedCounts": a['actualAcceptedCounts'], "rightActualAcceptedCounts": b['actualAcceptedCounts'],
                       "leftStatusCounts": a['statusCounts'], "rightStatusCounts": b['statusCounts']}
                comparable = c['expected']['accept'] and a['allMeasuredOutputsReturnedWithNoKnownDeclaredFailure'] and b['allMeasuredOutputsReturnedWithNoKnownDeclaredFailure']
                row['bothReturnedWithoutKnownDeclaredFailure'] = comparable
                row['outcomeScope'] = 'Observed API return/XML/declared-label checks; not a complete correctness or layout-quality qualification'
                for field in ["warmMs", "coldMs", "alternatingEditMs", "wholeProcessPeakRssBytes", "atReturn_heapUsedBytes"]:
                    row[field + "Left"] = number(a, field)
                    row[field + "Right"] = number(b, field)
                    row[field + "ObservedPercent"] = pct(number(a, field), number(b, field)) if comparable else None
                comparisons.append(row)
    csv_write("COMPARISONS.csv", comparisons)

    # Historical hand-written report text deliberately not carried into new measurements.
    outcomes = Counter(row.get('status') for process in receipt_rows for row in process['data']['rows'])
    proofs = Counter(row.get('proof', {}).get('status', 'no-receipt') for process in receipt_rows for row in process['data']['rows'])
    stability_summary = {'crossLayoutCacheSvg': dict(Counter(str(r['cacheBytesEqual']) for r in stability)),
                         'publicSvgVersusReceiptSvg': dict(Counter(str(r['publicSvgVersusReceiptSvgEqual']) for r in stability)),
                         'repeatSvgExactWarmup': dict(sum((Counter(r['repeatSvgExactWarmup']) for r in receipts), Counter())),
                         'repeatReceiptExactWarmup': dict(sum((Counter(r['repeatReceiptExactWarmup']) for r in receipts), Counter())),
                         'editedSvgChanged': dict(sum((Counter(r['editedSvgChanged']) for r in receipts), Counter())),
                         'fullProductOutcomes': dict(outcomes), 'fullProductProofStatuses': dict(proofs)}
    write('OUTPUT-STABILITY-SUMMARY.json', stability_summary)
    write('REDUCER-COMPLETED.json', {'svgWorkers': len(observations), 'receiptWorkers': len(receipt_rows),
          'familyRows': len(family_rows), 'sourceChanged': False, 'calibration': 'exploratory',
          'matchedIndependentSources': source_match})

if __name__ == '__main__':
    main()
