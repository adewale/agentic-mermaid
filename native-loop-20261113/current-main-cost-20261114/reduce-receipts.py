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
    done = read("RECEIPT-PERFORMANCE-COMPLETED.json")
    assert done["completed"] == 48 and not done["failed"], done
    cases = read("compatibility-overlay/MEASUREMENT-CASES.json")
    assert len(cases) == 4
    by_id = {c["id"]: c for c in cases}
    receipt_rows = [json.loads(line) for line in (ROOT / "receipt-performance/results.jsonl").read_text().splitlines()]
    assert len(receipt_rows) == 48
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
    assert len(receipts) == 16

if __name__ == "__main__":
    main()
