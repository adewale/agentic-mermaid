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
ARMS = [("main", "agentic"), ("main", "elk"), ("pr", "agentic"), ("pr", "elk")]
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
    assert done["completed"] == 5952 and not done["errors"], done
    assert receipt_done["completed"] == 864 and not receipt_done["failed"], receipt_done
    cases = read("MEASUREMENT-CASES.json")
    by_id = {c["id"]: c for c in cases}
    family_cases = [c for c in cases if c["cohort"] == "family"]
    assert len(family_cases) == 33
    observations = [json.loads(line) for line in (ROOT / "performance/results.jsonl").read_text().splitlines()]
    assert len(observations) == 5952
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
    assert len(receipt_rows) == 864
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

    fidelity = read("fidelity/RESULTS.json")
    fidelity_cases = read("FIDELITY-CASES.json")["selected"]
    source_match = {c["id"]: next((f["id"] for f in fidelity_cases if f["source"] == c["source"]), None) for c in family_cases}
    fid_lookup = {(r["target"], r["backend"], r["id"]): r for r in fidelity}
    payload = list(csv.DictReader((ROOT / "browser/FAMILY-PAYLOAD.csv").open()))
    payload_lookup = {(r["target"], r["backend"], r["family"]): r for r in payload}
    pilot = read("PILOT.json")
    pilot_lookup = {(r["target"], r["backend"], r["id"]): r for r in pilot}
    stability = []
    for c in cases:
        stem_id = c['id'].replace(':', '_')
        for target, backend in ARMS:
            paths = [ROOT / 'performance/svg' / f'cache{cache}-{target}-{backend}-{stem_id}-warm-B.svg' for cache in [0, 1]]
            pilot_path = ROOT / 'pilot' / f'{target}-{backend}-{stem_id}.svg.gz'
            values = [p.read_bytes() if p.exists() else None for p in paths]
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
            for left, right, label in [(('pr','agentic'),('pr','elk'),'PR Native versus ELK'),
                                       (('main','agentic'),('main','elk'),'Main Native versus ELK'),
                                       (('pr','agentic'),('main','agentic'),'PR versus Main Native'),
                                       (('pr','elk'),('main','elk'),'PR versus Main ELK')]:
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

    lines = ["# Native and ELK: frozen PR versus Main", "",
             "Main `4260292397d4bca7624a30c34649eb943a5f8e0c`; PR `599bee58db7cb54293866cc8aa86c887ef93e9a4`; Trident `f080278e31e4202ca89d524e4ee9e4cf3cbff038`.", "",
             "Native has lower observed layout-cache-disabled SVG and full-product runtime medians than ELK on all eight graph-family representatives, and smaller fetched browser closures. Main already has that Native advantage. These small examples do not establish workload-wide replacement correctness.", "",
             f"The PR is not a general performance improvement over current Main. For the100-node chain, full SVG+receipt repeat medians with layout cache disabled are {fmt(number(receipt_lookup['main','agentic',0,'diagnostic:chain100'],'repeat_wallMs'))}ms on Main Native and {fmt(number(receipt_lookup['pr','agentic',0,'diagnostic:chain100'],'repeat_wallMs'))}ms on PR Native. With the existing cache enabled, the PR's repeated-source median is {fmt(number(receipt_lookup['pr','agentic',1,'diagnostic:chain100'],'repeat_wallMs'))}ms, but its first authored edit costs {fmt(number(receipt_lookup['pr','agentic',1,'diagnostic:chain100'],'firstEdit_wallMs'))}ms. The100ms fresh-work target remains unmet. PR diagnostic products are proof-unverified while Main's pass; raw execution costs are not rates of equivalently proved diagrams.", "",
             "The demonstrated visible gain versus Main is controlled embedded-image delivery, shared by both backends. It comes alongside larger browser payloads and six additional unverified larger outputs in the62-case seed cohort. Native/ELK quality tradeoffs and unavailable geometry remain separate below.", "",
             "All33 family representatives return SVG in all four arms. Only eight representatives record a graph-solver choice; the other25 have identical Native/ELK SVGs and provide shared-renderer coverage, not an algorithm contest. Native is `agentic` in raw results. Fallback is disabled in every arm.", "",
             "Measurements are exploratory: three fresh process replicas and seven adaptive warm batch means, one round; below Trident's full calibration. Numbers are medians of process medians in milliseconds. Raw process min/max and all samples remain available; no broad calibrated replacement or speed-ratio claim. The SVG-only public API and the entire consumed SVG+receipt API are separate boundaries. Cold excludes import; import is separately recorded. Cache0 disables the layout cache, not every application/module cache. Cache1 enables it. Alternating edits revisit two authored source variants; comment variants may normalize to the same cache key. Receipt first-edit is the first edited source, while later edited calls are repeats.", "",
             "## Correctness and availability", "",
             "Independent99-case authored-meaning/finalSVG cohort, including91 cases with deeper declared expectations and8 labels-only supplements:", "",
             "| Arm | Returned /99 | Trident projected-meaning complete passes /91 | Declared paint checks complete /99 | Known paint failures | Proof P/U/no receipt |", "|---|---:|---:|---:|---:|---|"]
    for target, backend in ARMS:
        rr = [r for r in fidelity if r["target"] == target and r["backend"] == backend]
        deep = [r for r in rr if not r["expectationDepth"].startswith("family/labels")]
        proof = Counter(r.get("rendered", {}).get("receipt", {}).get("layoutCertification", {}).get("status", "no-receipt") for r in rr)
        lines.append(f"|{target} {'Native' if backend=='agentic' else 'ELK'}|{sum(r.get('rendered',{}).get('accepted',False) for r in rr)}|{sum(status(r.get('meaning'))=='passed' for r in deep)}|{sum(status(r.get('paint'))=='passed' for r in rr)}|{sum(status(r.get('paint'))=='failed' for r in rr)}|{proof['passed']}/{proof['unverified']}/{proof['no-receipt']}|")
    lines += ['', 'The projected-meaning totals retain an observer-schema mismatch in Event Modeling in all four arms: Trident reads `boxes/relations`, while the actual public native model contains ordered `frames` with the authored IDs and labels. Actual SVG paint finds the expected nodes and connections. Its raw failed meaning checks remain retained, but deeper qualification is unavailable through this adapter; this is not demonstrated missing meaning in either renderer. Sequence-note semantics and ZenUML structured meaning also remain unavailable. Counts are not an overall correctness score, and parsing may pass even where rendering fails. The parser is shared between requested layout backends, so matching parse facts alone do not establish post-layout correctness. See QUALIFICATION-ANNOTATIONS.json.', '', 'The existing quantitative paint observers record21 passed and6 unavailable chart/family checks per arm, with no known failed quantitative check. These are check counts across the99-case cohort, not21 completely verified diagrams. Exact expected/actual quantities and observer tolerances remain in fidelity/RESULTS.json and the same-input family rows.']
    lines += ["", "Declared paint completion covers each case's enrolled checks. The eight labels-only supplements do not test deeper visible structure even when those checks pass. PR's controlled embedded-image case improves authored meaning and actual image paint in both backends. Two fontSize configuration-reset errors per arm remain enrolled. Unknown/incomplete paint and meaning are not passes. Native's one additional complete paint case versus ELK is Requirement relationship-label ownership unavailable to the ELK observer, not a demonstrated missing visible label; that difference already exists on Main. Separate62-case seed cohort:58 returned/arm, four shared errors/arm (including three authored invalid sources); Main56 passed proofs/2 unverified, PR50/8. Six larger outputs lose proof availability in the PR in both backends: flowchart128, sequence128, state128, chain100, fanin100, chain300. This does not by itself establish visible failure, and it remains an adverse result.", "",
              "## All33 families: public SVG runtime", "",
              "Main N/E and PR N/E are Native / ELK ms. Cache0 cold and warm are SVG + UTF8 consumption. Cache1 warm is separately shown; this is not a receipt-cost table.", "",
              "| Family | Graph choice | Main cold N/E | PR cold N/E | Main warm0 N/E | PR warm0 N/E | PR warm1 N/E |", "|---|---|---:|---:|---:|---:|---:|"]
    def pair(family, target, field):
        return "/".join(fmt(f_lookup[target, backend, family].get(field)) for backend in ["agentic", "elk"])
    for c in family_cases:
        f = c["family"]
        lines.append(f"|{f}|{'yes' if f in GRAPH_FAMILIES else 'shared/no choice'}|{pair(f,'main','cache0_coldMs')}|{pair(f,'pr','cache0_coldMs')}|{pair(f,'main','cache0_warmMs')}|{pair(f,'pr','cache0_warmMs')}|{pair(f,'pr','cache1_warmMs')}|")
    lines += ["", "## All33 families: fully consumed receipt product", "",
              "Entire public SVG+receipt result JSON-serialized once and UTF8-counted inside each clock. Receipt artifacts encoded after the clock; profiling and source observers disabled. Median of each process's four repeat calls; first-edit is a separate call. No subtraction from the SVG-only table is attributed to a specific internal stage.", "",
              "| Family | Main repeat0 N/E | PR repeat0 N/E | PR repeat1 N/E | PR first edit0 N/E | PR first edit1 N/E |", "|---|---:|---:|---:|---:|---:|"]
    for c in family_cases:
        f = c["family"]
        lines.append(f"|{f}|{pair(f,'main','cache0_receipt_repeat_wallMs')}|{pair(f,'pr','cache0_receipt_repeat_wallMs')}|{pair(f,'pr','cache1_receipt_repeat_wallMs')}|{pair(f,'pr','cache0_receipt_firstEdit_wallMs')}|{pair(f,'pr','cache1_receipt_firstEdit_wallMs')}|")
    lines += ["", "## All33 families: finalSVG layout quality", "",
              "Same-source independent finalSVG observations where available; the unmatched Event Modeling representative has only its actual pilot SVG viewport measured. PR Native/ELK vectors are area (SVG units squared), strict owned linear wire/bends/crossings/parallel/opposing overlaps. Curved/relative/transformed or unowned paths are unavailable, never zero. Browser centerline approximation and separate width/height are in FAMILY-METRICS. Exact node-body contacts, exact pairwise glyph-collision counts and finalSVG flow-axis violation counts are unavailable across this run. Source direction/labels and browser visibility/clipping checks do not replace those geometric observations. Area and wire are tradeoffs, not correctness scores.", "",
              "| Family | PR area N/E | Area Native vs ELK | Native wire/bend/cross/parallel/opposing | ELK wire/bend/cross/parallel/opposing | Meaning N/E | Paint N/E | Proof N/E |", "|---|---:|---:|---|---|---|---|---|"]
    def linear(r):
        q = r["linear"]
        return "/".join(fmt(q.get(k), 0 if k != 'wire' else 1) for k in ["wire", "bends", "crossings", "parallelOverlaps", "opposingOverlaps"]) if q.get('status') == 'measured' else 'unavailable'
    for c in family_cases:
        f = c["family"]; n,e = [f_lookup['pr',b,f] for b in ['agentic','elk']]
        percent = pct(n['area'],e['area'])
        lines.append(f"|{f}|{pair(f,'pr','area')}|{fmt(percent)+'%' if percent is not None else 'unavailable'}|{linear(n)}|{linear(e)}|{n['meaning']}/{e['meaning']}|{n['paint']}/{e['paint']}|{n['proof']}/{e['proof']}|")
    lines += ["", "## All33 families: browser delivery and memory", "",
              "Actual fresh-realm fetched browser-lazy product closure; product byte columns exclude binding/instrumentation transport, whose bytes are separately retained. Request counts include the observed binding requests. gzip9 and Brotli11 are real offline compressed module bytes, not observed compressed HTTP transfer or complete npm tarballs. Browser JS heap is post-GC document heap for the support-probe plus enrolled-source portfolio, not process/GPU memory. Whole-process Node RSS includes import, driver, GC and qualification and is not an API allocation peak. Do not sum cold closures across families as a warm-portfolio cost.", "",
              "| Family | PR requests N/E | PR raw KiB N/E | Main gzip KiB N/E | PR gzip KiB N/E | PR Brotli KiB N/E | PR browser JS heap MiB N/E | PR Node peak RSS MiB N/E |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    def scaled_pair(family, target, field, scale):
        return '/'.join(fmt(f_lookup[target,b,family].get(field)/scale if f_lookup[target,b,family].get(field) is not None else None) for b in ['agentic','elk'])
    for c in family_cases:
        f=c['family']
        lines.append(f"|{f}|{pair(f,'pr','requests')}|{scaled_pair(f,'pr','productRaw',1024)}|{scaled_pair(f,'main','productGzip9',1024)}|{scaled_pair(f,'pr','productGzip9',1024)}|{scaled_pair(f,'pr','productBrotli11',1024)}|{scaled_pair(f,'pr','jsHeapUsedBytes',1048576)}|{scaled_pair(f,'pr','cache0_wholeProcessPeakRssBytes',1048576)}|")
    lines += ["", "## Scaling and100/300-node diagnostics", "",
              "Same fixed source per row. Public SVG warm0 and full receipt repeat0 are different boundaries; no solver-only claim. These diagnostics have no independently authored deeper meaning expectations. A returned output or a helper proof is not a complete visible-correctness claim.", "",
              "| Case | Main SVG N/E ms | PR SVG N/E ms | PR receipt N/E ms | PR proof N/E |", "|---|---:|---:|---:|---|"]
    for c in cases:
        if not (c['cohort'] == 'scaling' or c['id'].startswith('diagnostic:')):
            continue
        def m_pair(target):
            return '/'.join(fmt(number(lookup[target,b,0,c['id']], 'warmMs')) for b in ['agentic','elk'])
        rp='/'.join(fmt(number(receipt_lookup.get(('pr',b,0,c['id']),{}),'repeat_wallMs')) for b in ['agentic','elk'])
        proof='/'.join(pilot_lookup['pr',b,c['id']].get('proof','no-receipt') for b in ['agentic','elk'])
        lines.append(f"|{c['id']}|{m_pair('main')}|{m_pair('pr')}|{rp}|{proof}|")
    lines += ["", "## Evidence and limitations", "",
              "[All family metrics](FAMILY-METRICS.csv), [all SVG timing/resource cells](SVG-METRICS.csv), [all full-product cells](RECEIPT-METRICS.csv), [same-input observed deltas](COMPARISONS.csv). These include cold/import, warm, edits, both cache regimes, CPU, Node heap/external/ArrayBuffer snapshots, baseline-adjusted retained memory, process RSS and serialized sizes. Raw samples and process spread are in JSON and performance/results.jsonl; render/refusal costs remain enrolled, and invalid-input timing is not a successful-layout win.", "",
              "[Authored meaning and actual ink](fidelity/SUMMARY.md), [all396 fidelity rows](fidelity/RESULTS.json), [per-family fidelity coverage](fidelity/FAMILY-RESULTS.csv), [browser closures](browser/FAMILY-PAYLOAD.csv), [frozen identity](IDENTITY.json), [protocol](PLAN.json), [pilot receipts](PILOT.json), [original Trident calibration/p95](CALIBRATION.json), [output stability](OUTPUT-STABILITY.json). Frozen input literals, all returned SVGs/receipts, failures and unknowns are retained. The failed oracle-path setup and both worker smoke checks are retained outside measurement results. No production source changes, optimizer, new cache, or acceptance gate was introduced. Scoped Node/browser artifacts are not a complete package build. The lost original12 grouped inputs and original campaign baseline/pinned peer renderer comparisons were not recovered or claimed. Replacement24 remains sealed. The old automation remains disabled.", "",
              "Small family representatives do not requalify historical larger counterexamples: forest wire +16.89% with area −6.43%, Requirement TB/BT area +9.53%, implemented Sparse256 area +5.04% (the +0.97% candidate is unshipped). Sparse32's proof-budget limitation and the shared ER256 relationship-chain refusal remain separate known limitations. Those are retained historical results, not new measurements on these frozen heads.", ""]
    outcomes = Counter(row.get('status') for process in receipt_rows for row in process['data']['rows'])
    proofs = Counter(row.get('proof', {}).get('status', 'no-receipt') for process in receipt_rows for row in process['data']['rows'])
    stability_summary = {'crossLayoutCacheSvg': dict(Counter(str(r['cacheBytesEqual']) for r in stability)),
                         'publicSvgVersusReceiptSvg': dict(Counter(str(r['publicSvgVersusReceiptSvgEqual']) for r in stability)),
                         'repeatSvgExactWarmup': dict(sum((Counter(r['repeatSvgExactWarmup']) for r in receipts), Counter())),
                         'repeatReceiptExactWarmup': dict(sum((Counter(r['repeatReceiptExactWarmup']) for r in receipts), Counter())),
                         'editedSvgChanged': dict(sum((Counter(r['editedSvgChanged']) for r in receipts), Counter())),
                         'fullProductOutcomes': dict(outcomes), 'fullProductProofStatuses': dict(proofs)}
    write('OUTPUT-STABILITY-SUMMARY.json', stability_summary)
    lines += ['## Product outcomes and stability', '',
              f"The864 full-product workers performed {sum(outcomes.values())} measured calls: {dict(outcomes)}. Proof status totals across those calls are {dict(proofs)}; repeated/cached calls are not additional independent diagrams.", '',
              f"Exact same-input SVG comparisons across layout-cache modes and public SVG/receipt APIs: {stability_summary['crossLayoutCacheSvg']} and {stability_summary['publicSvgVersusReceiptSvg']}, respectively. The16 unavailable rows are actual errors/refusals and do not compare equal. Same-process warm repeats preserve complete SVG and receipt bytes in all3456 observations. All3456 edit outputs change bytes; byte change alone does not prove authored edit semantics. See OUTPUT-STABILITY-SUMMARY.json and the retained declared checks.", '']
    report = '\n'.join(lines)
    for before, after in {'All33': 'All 33', 'other25': 'other 25', 'Independent99': 'Independent 99',
            'including91': 'including 91', 'and8 ': 'and 8 ', 'record21': 'record 21', 'and6 ': 'and 6 ',
            'the99-case': 'the 99-case', 'not21 ': 'not 21 ', 'Separate62': 'Separate 62', 'cohort:58': 'cohort: 58',
            'Main56': 'Main 56', 'PR50': 'PR 50', 'original12': 'original 12', 'the100-node': 'the 100-node',
            'The100ms': 'The 100 ms', 'the62-case': 'the 62-case', 'The864': 'The 864', 'The16': 'The 16',
            'all3456': 'all 3456', 'All3456': 'All 3456', 'and100/300': 'and 100/300'}.items():
        report = report.replace(before, after)
    (ROOT / 'REPORT.md').write_text(report)
    write('REDUCER-COMPLETED.json', {'svgWorkers': len(observations), 'receiptWorkers': len(receipt_rows),
          'familyRows': len(family_rows), 'sourceChanged': False, 'calibration': 'exploratory',
          'matchedIndependentSources': source_match})

if __name__ == '__main__':
    main()
