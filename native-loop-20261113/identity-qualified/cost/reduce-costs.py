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
ARMS = [("baseline", "agentic"), ("candidate", "agentic"), ("baseline", "elk"), ("candidate", "elk")]
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
    assert done["completed"] == 240 and not done["errors"], done
    assert receipt_done["completed"] == 60 and not receipt_done["failed"], receipt_done
    cases = read("compatibility-overlay/MEASUREMENT-CASES.json")
    by_id = {c["id"]: c for c in cases}
    family_cases = [c for c in cases if c["cohort"] == "family"]
    assert len(cases) == 5
    observations = [json.loads(line) for line in (ROOT / "performance/results.jsonl").read_text().splitlines()]
    assert len(observations) == 240
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
    assert len(receipt_rows) == 60
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


if __name__ == "__main__":
    main()
