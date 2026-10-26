#!/usr/bin/env python3
"""Reduce retained evidence against the pinned Mermaid in the SAME lane.

This program does not import a renderer or execute a benchmark. Ratios are
tool cost / Mermaid cost, so lower is cheaper. Different lanes are never pooled.
"""

import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
from statistics import median
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evidence import read_document
from tool_versions import assert_tool_versions, canonical_tool, read_tool_versions
from mermaid_baseline_charts import render_charts

MERMAID = "mermaid-js/mermaid"
ALIASES = {"candidate": "adewale/agentic-mermaid", "pele": "obsidianmd/pele", "mermaid": MERMAID}


def load(path):
    return read_document(path)


def positive(values):
    return isinstance(values, list) and bool(values) and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v > 0 for v in values)


def claim(tool, version, source):
    if not version:
        raise ValueError(f"Missing executed artifact version for {tool}: {source}")
    return {"tool": tool, "version": version, "source": str(source)}


def ratios(tool_rounds, baseline_rounds):
    if len(tool_rounds) != len(baseline_rounds) or not positive(tool_rounds) or not positive(baseline_rounds):
        raise ValueError("Incomplete or invalid matched cost samples")
    values = [a / b for a, b in zip(tool_rounds, baseline_rounds)]
    return {"ratio": median(values), "perRoundRatios": values, "toolRoundCosts": tool_rounds, "mermaidRoundCosts": baseline_rounds}


def quality_row(tool, statuses, baseline, population, scope):
    passed = statuses.get("passed", 0)
    return {"tool": tool, "passed": passed, "population": population, "deltaPassedVersusMermaid": passed - baseline,
            "statuses": dict(statuses), "scope": scope}


def community(path):
    root = Path(path)
    result = load(root / "community-result.json")
    ranks = load(root / "community-ranks.json")
    inputs = load(root / "community-inputs.json")
    observations = result["observations"]
    tools = {a["node"]["id"]: a for a in ranks["artifacts"]}
    catalog_path = Path(__file__).resolve().parents[3] / "docs" / "mermaid-community.json"
    catalog = load(catalog_path)
    measured_catalog_count = len(tools)
    for node in catalog["nodes"]:
        tools.setdefault(node["id"], {"node": node, "artifact": None})
    claims = [claim(tool, a["artifact"].get("version"), root / "community-ranks.json") for tool, a in tools.items() if a.get("artifact")]
    for row in observations:
        if row["status"] == "passed" and row.get("samplesMs"):
            tool = row["metrics"]["implementation"]
            if not tools.get(tool, {}).get("artifact"):
                raise ValueError("Executed community cost has no owning artifact: " + tool)
            claims.append(claim(tool, row["metrics"].get("version"), root / "community-result.json"))
    expected = [w["id"] for w in inputs["workloads"] if "core-graph-batch" in w["features"]]
    if len(expected) != len(set(expected)) or not expected:
        raise ValueError("Invalid independently declared community core cohort")
    rounds = ranks["rounds"]
    lanes = []
    # Only these public boundaries have an actual pinned-Mermaid comparator.
    boundaries = [("browser-svg", "browser:public-api", "svg", "render"),
                  ("node-public-parse", "node:public-parse-validation", "parse", "parse")]
    for name, baseline_surface, output, operation in boundaries:
        accepted_surfaces = {baseline_surface} if output == "svg" else {baseline_surface, "node:public-api"}
        rows = [o for o in observations if o["surface"] in accepted_surfaces and o["format"] == output and o["operation"] == operation and o["caseId"] in expected]
        groups = defaultdict(list)
        for row in rows:
            groups[row["metrics"]["implementation"]].append(row)
        baseline = groups.get(MERMAID, [])
        runtime = {o["runtime"] for o in baseline}
        if len(runtime) != 1:
            raise ValueError(f"Missing/ambiguous Mermaid runtime for {name}")

        def totals(selected):
            if len(selected) != len(expected) * rounds:
                return None
            values = []
            for round_id in range(1, rounds + 1):
                total = 0
                for case in expected:
                    matches = [r for r in selected if r["caseId"] == case and r["metrics"].get("round") == round_id]
                    if len(matches) != 1 or matches[0]["status"] != "passed" or not positive(matches[0].get("samplesMs")) or matches[0]["runtime"] not in runtime:
                        return None
                    total += median(matches[0]["samplesMs"])
                values.append(total)
            return values

        base = totals(baseline)
        if base is None:
            raise ValueError(f"Pinned Mermaid does not qualify the complete {name} cohort")
        cells = []
        for tool in tools:
            values = totals(groups.get(tool, []))
            alias = ranks.get("aliases", {}).get(tool)
            cells.append({"tool": tool, "version": (tools[tool].get("artifact") or {}).get("version"),
                          "status": "matched-advisory" if values else "unranked",
                          "reason": None if values else "No complete, uniquely passed same-runtime public-boundary core in every round",
                          "aliasOf": alias.get("representative") if alias else None,
                          **(ratios(values, base) if values else {"ratio": None})})
        lanes.append({"id": name, "boundary": f"{next(iter(runtime))} public {operation} return; validation excluded",
                      "caseIds": expected, "rounds": rounds, "unit": "sum of per-case median milliseconds",
                      "cachePolicies": sorted({o["metrics"]["cache"] for o in rows if o["metrics"].get("cache")}),
                      "noiseQualification": "Uncalibrated historical three-round distributions; descriptive ordering, no statistically qualified speedup claim",
                      "qualification": "SVG: XML/canvas/authored-label admission, not diagram semantic fidelity. Parse: Mermaid syntax acceptance; peers may additionally validate native models. Public call time excludes those validators.",
                      "cells": cells})
    # Keep the declared portfolio denominator. Functional-only corpus rows carry
    # no speed samples and are never silently promoted into a timing rank.
    quality = []
    browser_rows = [o for o in observations if o["surface"] == "browser:public-api" and o["operation"] == "render" and o["format"] == "svg"]
    case_ids = [w["id"] for w in inputs["workloads"]]
    by_tool_case = defaultdict(lambda: defaultdict(list))
    for row in browser_rows:
        by_tool_case[row["metrics"].get("implementation")][row["caseId"]].append(row)

    def outcomes(tool):
        outcomes = Counter()
        for case in case_ids:
            matches = by_tool_case[tool].get(case, [])
            if not matches:
                outcomes["unmeasured"] += 1
            elif case in expected and (len(matches) != rounds or {o["metrics"].get("round") for o in matches} != set(range(1, rounds + 1))):
                outcomes["incomplete-rounds"] += 1
            elif all(o["status"] == "passed" for o in matches):
                outcomes["passed"] += 1
            else:
                outcomes["/".join(sorted({o["status"] for o in matches if o["status"] != "passed"}))] += 1
        return outcomes

    baseline_passed = outcomes(MERMAID)["passed"]
    for tool in tools:
        quality.append(quality_row(tool, outcomes(tool), baseline_passed, len(case_ids), "Public browser SVG admission: XML/canvas/authored labels; not semantic fidelity. Unsupported/not-applicable/missing remain in denominator."))
    composition = result.get("composition") or {}
    receipts = []
    for tool, artifact in tools.items():
        value = artifact.get("artifact")
        # Reference the immutable full dependency/file ledger instead of copying
        # tens of MB into a derived report. No original receipts are modified.
        compact = {key: item for key, item in (value or {}).items() if key not in {"files", "runtimeDependencyRoots", "detail"}}
        receipts.append({"tool": tool, "artifact": compact if value else None,
                         "fileReceiptCount": len((value or {}).get("files", [])),
                         "fullReceipt": {"source": str(root / "community-ranks.json"), "collection": "artifacts", "nodeId": tool},
                         "node": {"id": tool, "relation": artifact["node"].get("relation")}})
    return {"id": "historical-community", "source": str(root), "startedAt": result["startedAt"], "finishedAt": result["finishedAt"],
            "settings": {"rounds": rounds, "protocol": ranks["protocol"], "composition": {k: v for k, v in composition.items() if k in {"id", "sourceCommunity", "composedAt", "scope", "policy", "preservedObservations", "replacedObservations", "freshObservations"}}, "fullCompositionSource": str(root / "community-result.json"), "historicalCatalogCount": measured_catalog_count, "currentCatalogCount": len(catalog["nodes"]), "currentCatalogSource": str(catalog_path)},
            "identities": receipts,
            "lanes": lanes, "quality": quality,
            "gaps": ["Historical composed correctness repair retains original and repaired windows; this is not a current product speedup experiment.",
                     "Mermaid's own admission result is not100%: fixture selection, parser-only scopes, optional loaders, environment and XML/label expectations differ from an independent complete Mermaid specification. Higher admission here does not establish higher semantic fidelity.",
                     f"Historical campaign enrolled {measured_catalog_count} tools; current catalog contains {len(catalog['nodes'])}. Added tools have no historical measurements and remain explicitly unranked.",
                     "Node SVG, terminal, PNG, CLI, React, Bun and Python lanes have no same-boundary pinned Mermaid baseline and remain unranked here.",
                     "Historical repeated public calls use library defaults, including any internal memoization; these are not isolated uncached layout timings or fully consumed sidecar workflows.",
                     "Post-portfolio heap includes differing successful outputs, excludes WASM/native/process memory, and is not an efficiency rank."]}, claims


def dave(path):
    path = Path(path)
    report = load(path)
    corpus = load(path.parent / "corpus.json")
    identities = report["identities"]
    actual = {}
    for artifact in identities:
        tool = ALIASES.get(artifact["label"], artifact["name"])
        if tool in actual:
            raise ValueError("Duplicate Dave canonical tool; baseline variants require a separate evidence set")
        actual[tool] = artifact
    claims = [claim(tool, a.get("version"), path) for tool, a in actual.items()]
    rounds = report["policy"]["rounds"]
    population = report["policy"]["measured"]
    if report["status"] != "completed" or corpus["occurrenceCount"] != population:
        raise ValueError("Dave report/corpus is incomplete")
    samples = defaultdict(dict)
    with (path.parent / "browser-samples.jsonl").open() as stream:
        for line in stream:
            row = json.loads(line)
            tool = ALIASES.get(row["engine"], row["engine"])
            key = (row["round"], row["id"])
            if key in samples[tool]:
                raise ValueError(f"Duplicate Dave sample {tool} {key}")
            samples[tool][key] = row
    baseline = samples.get(MERMAID, {})
    expected = {occurrence["id"] for occurrence in corpus["occurrences"]}
    if len(expected) != population or {case for round_id, case in baseline} != expected:
        raise ValueError("Missing Dave denominator")
    for tool in actual:
        if set(samples[tool]) != {(r, case) for r in range(1, rounds + 1) for case in expected}:
            raise ValueError(f"Incomplete Dave round coverage: {tool}")
        for row in samples[tool].values():
            duration = row.get("ms")
            if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration) or duration < 0:
                raise ValueError(f"Invalid Dave duration: {tool}")
    # One fixed intersection across every displayed engine, so each ratio has
    # exactly the same numerator/denominator inputs (not candidate-relative sets).
    common = sorted(case for case in expected if all(samples[t][(r, case)]["ok"] for t in actual for r in range(1, rounds + 1)))
    if not common:
        raise ValueError("No common successful Dave inputs")
    totals = {tool: [sum(samples[tool][(r, case)]["ms"] for case in common) for r in range(1, rounds + 1)] for tool in actual}
    cells = [{"tool": tool, "version": actual[tool]["version"], "status": "matched-advisory", **ratios(values, totals[MERMAID])} for tool, values in totals.items()]
    outcomes = {tool: Counter("passed" if all(samples[tool][(r, case)]["ok"] for r in range(1, rounds + 1)) else "failed" for case in expected) for tool in actual}
    quality = [quality_row(tool, status, outcomes[MERMAID]["passed"], population, "Docs-occurrence public render acceptance; SVG returned, not authored-meaning or visual-fidelity proof") for tool, status in outcomes.items()]
    payload = []
    baseline_gzip = report["payload"]["mermaid"]["monolithic"]["gzip"]
    for label, tool in ALIASES.items():
        artifact = report["payload"].get(label, {}).get("monolithic")
        if tool in actual and artifact:
            payload.append({"tool": tool, "version": actual[tool]["version"], "gzipBytes": artifact["gzip"], "rawBytes": artifact["raw"], "ratio": artifact["gzip"] / baseline_gzip, "status": "artifact-size", "sha256": artifact["sha256"]})
    return {"id": "dave-docs-browser", "source": str(path), "startedAt": report["startedAt"], "finishedAt": report["finishedAt"],
            "identities": identities, "settings": {"policy": report["policy"], "browser": report["browser"], "environment": report["environment"], "corpusUpstream": corpus["upstream"]},
            "lanes": [{"id": "dave-common-success-browser-svg", "boundary": report["policy"]["timing"], "caseIds": common, "population": population,
                       "rounds": rounds, "unit": "sum of single-call milliseconds per round", "noiseQualification": "Advisory three-round counterbalanced experiment; no A/A noise qualification", "cells": cells},
                      {"id": "dave-monolithic-browser-gzip", "boundary": "Complete shipped browser-global artifact, gzip level9; alternatives/focused/lazy entries excluded", "caseIds": [], "unit": "gzip bytes", "cells": payload}],
            "quality": quality, "gaps": ["The shared-success cost cohort excludes failures, so admission counts must be read beside cost.", "Docs examples include optional/environmental cases and are not a conformance oracle.", "Focused/lazy delivery has no matched Mermaid entry configuration and is not ranked against its full global artifact."]}, claims


def upstream(paths):
    rows, claims, receipts, sources = [], [], [], []
    cohorts = {}
    for path in paths:
        report = load(path)
        evidence = report["evidence"]
        sources.append({"path": str(path), "protocol": report.get("protocol"), "currentAssertionScope": evidence.get("currentAssertionScope"), "currentInventory": evidence.get("currentInventory")})
        for result in evidence["results"]:
            artifact = result["artifact"]
            tool = canonical_tool(result["engine"])
            claims.append(claim(tool, artifact.get("version"), path))
            receipts.append({"tool": tool, "artifact": artifact})
            statuses = result["statuses"]
            if sum(statuses.values()) != result["callbacks"]:
                raise ValueError("Original-assertion callback accounting does not close")
            if any(r["tool"] == tool for r in rows):
                raise ValueError("Repeated original-assertion project result")
            callbacks = [o for o in report["observations"] if o["operation"] == "original-upstream-assertions" and canonical_tool(o["metrics"]["implementation"]) == tool]
            ids = [o["caseId"] for o in callbacks]
            if len(ids) != result["callbacks"] or len(set(ids)) != len(ids):
                raise ValueError("Missing or duplicate actual original-assertion callbacks")
            observed = Counter({"blocked": "unavailable", "not-applicable": "skipped-upstream"}.get(o["status"], o["status"]) for o in callbacks)
            if {k: v for k, v in statuses.items() if v} != dict(observed):
                raise ValueError("Original-assertion statuses disagree with actual callbacks")
            commits = {o["metrics"].get("upstreamCommit") for o in callbacks}
            if len(commits) != 1 or None in commits:
                raise ValueError("Missing/ambiguous original upstream source pin")
            cohorts[tool] = (set(ids), commits)
            rows.append({"tool": tool, "statuses": statuses, "population": result["callbacks"], "passed": statuses.get("passed", 0), "workflow": result.get("workflow"), "requestedParseCalls": result.get("requestedParseCalls"), "preparedParseCalls": result.get("preparedParseCalls")})
    baseline = next((r for r in rows if r["tool"] == MERMAID), None)
    if baseline is None:
        raise ValueError("No actual pinned Mermaid original-assertion result")
    for row in rows:
        if row["population"] != baseline["population"] or cohorts[row["tool"]] != cohorts[MERMAID]:
            raise ValueError("Different original-assertion callback denominators")
        row["deltaPassedVersusMermaid"] = row["passed"] - baseline["passed"]
        row["scope"] = "Unchanged two-file Mindmap/GitGraph callback expectations through public-result facades; strict diagnostics/private representation, not all Mermaid functionality"
    return {"id": "original-upstream-assertions", "sources": sources, "identities": receipts, "lanes": [], "quality": rows,
            "gaps": ["Whole worker/import/preparation/facade/assertion wall time is workflow diagnostic only, not original upstream runner or engine speed rank.", "Unavailable private assertions and upstream skips remain in the100-callback denominator;3995 declarations are inventoried, not executed assertions."]}, claims


def relative_decision(values, a0, a1, tolerance, minimum_pairs, rolling=False):
    """Predeclared repeatability envelope, NOT a statistical confidence interval."""
    result = ratios(values, a0)
    controls = ratios(a1, a0)
    result["controlRatio"] = controls["ratio"]
    result["controlPairs"] = len(a0)
    calibrated = (not rolling and len(a0) >= minimum_pairs and 0 < tolerance < 1
                  and 1 - tolerance <= controls["ratio"] <= 1 + tolerance)
    if not calibrated:
        return {**result, "status": "unqualified", "classification": "unresolved", "envelope": None,
                "reason": "A/A guard unavailable/outside predeclared tolerance, insufficient pairs, or rolling measurement windows"}
    envelope = [min(result["perRoundRatios"]) / (1 + tolerance), max(result["perRoundRatios"]) / (1 - tolerance)]
    classification = "lower-cost" if envelope[1] < 1 else "higher-cost" if envelope[0] > 1 else "unresolved"
    return {**result, "status": "repeatability-qualified", "classification": classification,
            "envelope": envelope, "envelopeScope": "Observed paired-ratio range widened by the predeclared A/A tolerance; not a confidence interval or causal release effect"}


def browser_baseline(path):
    report = load(path)
    settings = report["settings"]
    identities = report["identities"]
    claims = [claim(i["tool"], i.get("version"), path) for i in identities]
    versions = {i["tool"]: i["version"] for i in identities}
    if len(versions) != len(identities) or MERMAID not in versions:
        raise ValueError("Missing/duplicate actual browser baseline identity")
    roles = {"mermaid-a0": MERMAID, "agentic": "adewale/agentic-mermaid", "pele": "obsidianmd/pele", "mermaid-a1": MERMAID}
    cases = {c["id"]: c for c in report["cases"]}
    if len(cases) != len(report["cases"]) or not cases:
        raise ValueError("Missing/duplicate browser input cases")
    for case in cases.values():
        if type(case["expected"]["accept"]) is not bool:
            raise ValueError("Missing independently declared browser input acceptance")
    observations = report["observations"]
    primary = [o for o in observations if o["mode"] in {"reused-page-render", "fresh-browser-first-result"}]
    by_mode_role_case = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    seen = set()
    for row in primary:
        role = row["role"]
        if roles.get(role) != row["tool"] or row["tool"] not in versions or row["caseId"] not in cases:
            raise ValueError("Browser cost row has unknown owner/role/input")
        if row.get("round") != row["metrics"].get("round") or row.get("sample") != row["metrics"].get("sample"):
            raise ValueError("Conflicting browser sample coordinates")
        key = (role, row["mode"], row["caseId"], row["round"], row["sample"])
        if key in seen:
            raise ValueError("Duplicate browser sample")
        seen.add(key)
        if row["metrics"].get("expectedAccepted") != cases[row["caseId"]]["expected"]["accept"]:
            raise ValueError("Browser sample changed the authored acceptance expectation")
        by_mode_role_case[row["mode"]][role][row["caseId"]].append(row)
    rolling = report.get("rolling") not in [None, False]
    if isinstance(report.get("rolling"), dict):
        # An explicit false marker is useful for a fresh record; absent/mixed
        # dates are not inferred to be the same experimental window.
        rolling = report["rolling"].get("isRolling", True)
    collection_rows = [o for o in observations if o["mode"] in {"reused-page-render", "fresh-browser-first-result", "browser-document-resource"}]
    collection_ids = {o["metrics"].get("collectionId") for o in collection_rows}
    collection_id = report.get("collectionId")
    collection_complete = isinstance(collection_id, str) and bool(collection_id) and collection_ids == {collection_id}
    # Recheck immutable per-measurement ownership instead of allowing a stale
    # combined view's rolling=false to bless unrelated project windows.
    rolling = rolling or not collection_complete
    if settings.get("controlToleranceRatio") != .1 or settings.get("controlMinimumPairs") != 5:
        raise ValueError("Fresh browser report does not carry the predeclared A/A policy")
    policy = {"toleranceRatio": .1, "minimumControlPairs": 5, "envelope": "[minimum tool/A0 ratio divided by1.1, maximum tool/A0 ratio divided by0.9]", "classification": "lower-cost only if envelope upper<1; higher-cost only if lower>1; otherwise unresolved", "interpretation": "A/A repeatability envelope, not a confidence interval or a causal release effect"}
    lanes = []
    for mode, expected_count, unit in [("reused-page-render", settings["rendererRounds"], "sum of fully consumed SVG result milliseconds per renderer round"),
                                       ("fresh-browser-first-result", settings["startupSamplesPerRole"], "fresh browser launch through first consumed SVG result milliseconds")]:
        grouped = by_mode_role_case[mode]
        attempted_ids = sorted(set().union(*(set(grouped[role]) for role in roles)))

        def admitted(role, case_id):
            rows = grouped[role].get(case_id, [])
            return (len(rows) == expected_count and all(r["status"] == "passed" and r["metrics"].get("accepted") is True
                    and positive(r.get("samplesMs")) for r in rows))

        common = [case for case in attempted_ids if cases[case]["expected"]["accept"] and all(admitted(role, case) for role in roles)]
        excluded = [case for case in attempted_ids if case not in common]
        cells = []
        if common:
            totals = {}
            expected_keys = None
            for role in roles:
                totals[role] = defaultdict(float)
                for case in common:
                    for row in grouped[role][case]:
                        totals[role][(row["round"], row["sample"])] += median(row["samplesMs"])
                keys = sorted(totals[role])
                if len(keys) != expected_count or expected_keys is not None and keys != expected_keys:
                    raise ValueError("Different browser sample coordinate sets across roles")
                expected_keys = keys
            values = {role: [totals[role][key] for key in expected_keys] for role in roles}
            runtimes = {r["runtime"] for role in roles for case in common for r in grouped[role][case]}
            if len(runtimes) != 1:
                raise ValueError("Different browser runtimes within the matched cohort")
            for role, tool in roles.items():
                if role == "mermaid-a1":
                    continue
                cells.append({"tool": tool, "version": versions[tool], "role": role,
                              **relative_decision(values[role], values["mermaid-a0"], values["mermaid-a1"], .1, 5, rolling=rolling)})
        else:
            cells = [{"tool": tool, "version": versions[tool], "status": "unranked", "classification": "unresolved", "ratio": None,
                      "reason": "No complete common positively admitted cohort"} for role, tool in roles.items() if role != "mermaid-a1"]
        lanes.append({"id": mode, "boundary": mode + ": fully consumed public SVG plus declared sidecars; qualifiers outside clock", "caseIds": common,
                      "attemptedCaseIds": attempted_ids, "excludedCaseIds": excluded, "rounds": expected_count, "unit": unit,
                      "noiseQualification": policy["interpretation"], "decisionPolicy": policy, "cells": cells})
    # Resource clocks are separate passes. Only a same-source positive result
    # admits its matching resource receipt; metadata rows alone are not success.
    resource_points = defaultdict(dict)
    delivery_points = defaultdict(dict)
    resource_case_ids = set()
    for row in observations:
        if row["mode"] not in {"browser-document-resource-checkpoints", "delivery"}:
            continue
        role = row["role"]
        if roles.get(role) != row["tool"]:
            raise ValueError("Resource/delivery receipt has an unknown owner")
        coordinates = (row["round"], row["sample"])
        stage = row["metrics"].get("checkpoint")
        if row["mode"] == "delivery" and stage != "startup":
            continue
        result_mode = "browser-document-resource" if stage == "resource" else "fresh-browser-first-result"
        results = [r for r in observations if r["role"] == role and r["mode"] == result_mode and r["caseId"] == row["caseId"] and (r["round"], r["sample"]) == coordinates]
        if len(results) != 1 or results[0]["status"] != "passed" or results[0]["metrics"].get("accepted") is not True:
            continue
        if row["caseId"] not in cases or not cases[row["caseId"]]["expected"]["accept"]:
            raise ValueError("Resource receipt has no authored positive source")
        resource_case_ids.add(row["caseId"])
        points = resource_points if stage == "resource" else delivery_points
        if coordinates in points[role]:
            raise ValueError("Duplicate admitted resource/delivery receipt")
        if stage == "resource":
            receipt_path = Path(row["metrics"]["rawEvidence"])
            if not receipt_path.is_absolute():
                receipt_path = Path(path).parent / receipt_path
            receipt = load(receipt_path)
            if receipt["tool"] != row["tool"] or receipt["role"] != role or (receipt["round"], receipt["sample"]) != coordinates or receipt["configuration"] != settings["configuration"]:
                raise ValueError("Resource sidecar contradicts its owning measurement")
            points[role][coordinates] = receipt["snapshots"]
        else:
            points[role][coordinates] = row["metrics"]
    if len(resource_case_ids) > 1:
        raise ValueError("Resource/delivery passes used different input sources")
    for name, points, count, getter, boundary, unit, timing in [
        ("browser-document-heap-output-held-after-gc", resource_points, settings.get("resourcePassesPerRole", 5), lambda p: p.get("outputHeldAfterGc", {}).get("usedSize"), "Separate fresh-document V8 used heap with output held after GC; native/worker/GPU/whole-browser peak excluded", "V8 heap bytes", True),
        ("browser-document-heap-after-consumer-release", resource_points, settings.get("resourcePassesPerRole", 5), lambda p: p.get("afterConsumerReleaseAfterGc", {}).get("usedSize"), "Separate fresh-document V8 heap after consumer release and GC; imported module state retained", "V8 heap bytes", True),
        ("browser-requested-gzip-through-first-result", delivery_points, settings["startupSamplesPerRole"], lambda p: p.get("perFileGzipBytes"), "Actual requested shipped-file closure through the same first SVG; per-file gzip estimate, not HTTP transfer bytes", "gzip bytes", False),
        ("browser-requested-initial-raw-bytes", delivery_points, settings["startupSamplesPerRole"], lambda p: p.get("initialBytes"), "Actual requested shipped-file closure through module readiness, before first SVG; uncompressed response bodies", "raw bytes", False),
    ]:
        cells = []
        base_keys = sorted(points["mermaid-a0"])
        complete = len(base_keys) == count and all(sorted(points[role]) == base_keys and positive([getter(points[role][key]) for key in base_keys]) for role in roles)
        for role, tool in roles.items():
            if role == "mermaid-a1":
                continue
            cell = {"tool": tool, "version": versions[tool], "status": "unranked", "ratio": None, "classification": "unresolved"}
            if complete:
                values = {r: [getter(points[r][key]) for key in base_keys] for r in roles}
                cell.update(relative_decision(values[role], values["mermaid-a0"], values["mermaid-a1"], .1, 5, rolling=rolling))
                if not timing and not rolling:
                    cell["status"] = "observed-delivery-cost"
                    cell["classification"] = "descriptive only"
                    cell["envelope"] = None
                    cell.pop("envelopeScope", None)
                cell["toolMedianCost"] = median(values[role])
                cell["mermaidMedianCost"] = median(values["mermaid-a0"])
            cells.append(cell)
        lanes.append({"id": name, "boundary": boundary, "caseIds": sorted(resource_case_ids), "unit": unit, "sampleCount": count,
                      "noiseQualification": policy["interpretation"] if timing else "Observed artifact request cost; no engine API timing claim", "cells": cells})
    quality = []
    outcomes_by_role = {}
    for role in roles:
        statuses = Counter()
        for case_id, case in cases.items():
            rows = by_mode_role_case["reused-page-render"][role].get(case_id, [])
            if len(rows) != settings["rendererRounds"]:
                status = "unmeasured-or-incomplete"
            elif all(r["status"] == "passed" for r in rows):
                status = "passed"
            else:
                status = "/".join(sorted({r["status"] for r in rows if r["status"] != "passed"}))
            statuses[status] += 1
        outcomes_by_role[role] = statuses
    for role, tool in roles.items():
        if role != "mermaid-a1":
            row = quality_row(tool, outcomes_by_role[role], outcomes_by_role["mermaid-a0"]["passed"], len(cases), "Declared positive admission and negative rejection; SVG XML/namespace/canvas/authored-label checks, not full semantic or visual fidelity")
            row["positiveCaseCount"] = sum(c["expected"]["accept"] for c in cases.values())
            row["negativeCaseCount"] = sum(not c["expected"]["accept"] for c in cases.values())
            quality.append(row)
    return {"id": "fresh-browser-baseline", "source": str(path), "startedAt": report["startedAt"], "finishedAt": report["finishedAt"], "settings": settings,
            "decisionPolicy": policy, "rolling": rolling, "declaredRolling": report.get("rolling"), "collectionId": collection_id,
            "observedCollectionIds": sorted(value for value in collection_ids if isinstance(value, str)), "collectionIdentityComplete": collection_complete,
            "identities": identities, "lanes": lanes, "quality": quality,
            "controlQuality": dict(outcomes_by_role["mermaid-a1"]), "gaps": report.get("gaps", []) + ["The cost cohort is the explicit common-success intersection, not the complete declared input population. Excluded positive cases remain visible in quality outcomes.", "A1 is a same-artifact Mermaid repeatability control, not another independent implementation.", "Structured result consumption is measured, callbacks/perceptual paint/GPU and complete authored semantics are not."]}, claims


def parser_baseline(path):
    report = load(path)
    targets = report["targets"]
    claims = [claim(t["project"], t["artifact"]["package"].get("version"), path) for t in targets]
    by_tool = {t["project"]: t for t in targets}
    if len(by_tool) != len(targets) or MERMAID not in by_tool:
        raise ValueError("Missing/duplicate Node parser baseline target")
    for target in targets:
        if target["version"] != target["artifact"]["package"].get("version") or target["version"] != target["artifact"]["target"]["version"] or target["project"] != target["artifact"]["target"]["project"]:
            raise ValueError("Node parser target/owning artifact version mismatch")
    baseline = by_tool[MERMAID]
    cells = []
    expected_case = report["settings"]["startupCase"]["id"]
    for target in targets:
        startup = target["startup"]
        rows = startup.get("rows", [])
        # End-to-end costs are diagnostic, separately from each row's inner API
        # duration. Never rename these spawn/import/preparation samples API time.
        qualified = (startup["caseId"] == expected_case and positive(startup.get("samplesMs"))
                     and startup["count"] == report["settings"]["startupSamples"]
                     and len(startup["samplesMs"]) == startup["count"]
                     and all(r.get("status") == "passed" for r in rows)
                     and len(rows) == startup["count"])
        base_startup = baseline["startup"]
        base_qualified = (base_startup["caseId"] == expected_case and positive(base_startup.get("samplesMs"))
                          and base_startup["count"] == report["settings"]["startupSamples"]
                          and len(base_startup.get("rows", [])) == base_startup["count"]
                          and all(r.get("status") == "passed" for r in base_startup["rows"]))
        ratio = median(startup["samplesMs"]) / median(base_startup["samplesMs"]) if qualified and base_qualified else None
        cells.append({"tool": target["project"], "version": target["version"], "status": "unpaired-advisory" if ratio is not None else "unranked", "ratio": ratio,
                      "classification": "unresolved", "toolMedianMs": median(startup["samplesMs"]) if positive(startup.get("samplesMs")) else None,
                      "mermaidMedianMs": median(base_startup["samplesMs"]) if positive(base_startup.get("samplesMs")) else None,
                      "sampleCount": startup["count"], "scope": startup.get("scope"), "boundary": target["boundary"]})
    quality = []
    binding_sets = []
    for target in targets:
        bindings = target["functionality"]["bindings"]
        ids = [b["bindingId"] for b in bindings]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate Node parser functionality binding")
        binding_sets.append({json.dumps({k: v for k, v in binding.items() if k != "result"}, sort_keys=True) for binding in bindings})
        statuses = Counter()
        for binding in bindings:
            r = binding["result"]
            if r.get("status") == "unsupported" or r.get("preserved"):
                status = "unsupported"
            elif r.get("unavailable") or r.get("status") == "blocked":
                status = "unavailable"
            elif binding["expectedAccepted"] is False:
                status = "passed" if (r.get("syntaxRejected") is True or r.get("unsupported") is True) and r.get("publicAccepted") is False and r.get("preludeMatches") is True else "failed"
            else:
                status = "passed" if r.get("publicAccepted") is True and r.get("accepted") is True and r.get("expectedTypeMatches") is True and r.get("preludeMatches") is True else "failed"
            statuses[status] += 1
        quality.append({"tool": target["project"], "passed": statuses["passed"], "population": len(bindings), "uniqueInvocations": target["functionality"]["uniqueInvocations"], "statuses": dict(statuses), "interpretationNotes": sorted({b["result"]["scopeNote"] for b in bindings if b["result"].get("scopeNote")}), "scope": "Public parser acceptance/rejection and declared family/prelude bindings; duplicate corpus memberships are bindings, not independent invocations. No AST, rendering or semantic-fidelity equivalence"})
    if any(ids != binding_sets[0] for ids in binding_sets):
        raise ValueError("Node parser targets have different functionality binding sets")
    expected_common = [binding["bindingId"] for binding in baseline["functionality"]["bindings"] if len(targets) > 1 and binding["expectedAccepted"] and all(any(b["bindingId"] == binding["bindingId"] and b["result"]["status"] == "passed" and b["result"].get("accepted") is True for b in target["functionality"]["bindings"]) for target in targets)]
    declared_common = report["commonQualifiedCaseIds"]
    if len(declared_common) != len(set(declared_common)) or set(declared_common) != set(expected_common):
        raise ValueError("Node parser shared positive binding ledger differs from actual target results")
    unique_common = sorted({b["uniqueId"] for b in baseline["functionality"]["bindings"] if b["bindingId"] in declared_common})
    baseline_passed = next(r["passed"] for r in quality if r["tool"] == MERMAID)
    for row in quality:
        row["deltaPassedVersusMermaid"] = row["passed"] - baseline_passed
    resource_cells = []
    resource_count = report["settings"]["resourceSamples"]
    resource_values = {}
    for target in targets:
        rows = target["resources"]["rows"]
        values = [r.get("wholeWorker", {}).get("peakRssBytes") for r in rows]
        admitted_startup = next(c for c in cells if c["tool"] == target["project"])["ratio"] is not None
        if len(rows) == resource_count and all(r.get("status") == "passed" for r in rows) and positive(values) and admitted_startup:
            resource_values[target["project"]] = values
    for target in targets:
        values, base = resource_values.get(target["project"]), resource_values.get(MERMAID)
        resource_cells.append({"tool": target["project"], "version": target["version"], "ratio": median(values) / median(base) if values and base else None,
                               "status": "unpaired-advisory" if values and base else "unranked", "classification": "unresolved", "wholeChildPeakRssBytes": values,
                               "scope": target["resources"]["scope"]})
    for target in report.get("unavailableTargets", []):
        for destination in [cells, resource_cells]:
            destination.append({"tool": target["project"], "version": None, "ratio": None, "status": "unranked", "classification": "unresolved", "reason": target["reason"]})
    return {"id": "node-parser-baseline", "source": str(path), "settings": report["settings"], "identities": [{"tool": t["project"], "artifact": {"target": t["artifact"]["target"], "package": {"name": t["artifact"]["package"]["name"], "version": t["artifact"]["package"]["version"]}, "entrySha256": t["artifact"]["entrySha256"]}, "fullReceiptSource": str(path), "recordId": t["recordId"], "startedAt": t["startedAt"], "finishedAt": t["finishedAt"]} for t in targets],
            "unavailableTargets": report.get("unavailableTargets", []),
            "commonPositiveAdmission": {"bindingIds": declared_common, "bindingCount": len(declared_common), "uniqueInvocationIds": unique_common, "uniqueInvocationCount": len(unique_common), "scope": "Functional admission only. Repeated corpus memberships are not independent samples; startup/resource costs use their separate single two-node source."},
            "lanes": [{"id": "fresh-node-parser-first-consumed-result", "boundary": "Fresh parent spawn through first fully consumed serialized public parser return; host setup/jsdom/import included", "caseIds": [expected_case], "unit": "median milliseconds", "cells": cells, "noiseQualification": "Unpaired25-sample descriptive distributions; no A/A or statistically qualified speedup claim"},
                      {"id": "fresh-node-parser-whole-child-peak-rss", "boundary": "Separate fresh process import/setup/first consumed parse; GNU time whole-child peak RSS, not API allocation or browser memory", "caseIds": [expected_case], "unit": "peak RSS bytes", "cells": resource_cells, "noiseQualification": "Separate five-pass unpaired resource distributions; no calibrated efficiency claim"}],
            "quality": quality, "gaps": report.get("gaps", []) + ["Parser startup is not SVG rendering or warm public API latency. Resource snapshots/whole-child RSS use different scopes and are not pooled.", "This advisory ratio has no paired A/A calibration; all better/worse decisions remain unresolved."]}, claims


def markdown(report):
    lines = ["# Pinned Mermaid baseline", "", "Cost ratio = tool / Mermaid; Mermaid=1 and lower costs less. Each table has its own public boundary and exact input cohort. No overall score. Historical and current evidence are separate sets.", ""]
    for dataset in report["datasets"]:
        source_paths = [dataset["source"]] if dataset.get("source") else [source["path"] if isinstance(source, dict) else str(source) for source in dataset.get("sources", [])]
        lines += ["## " + dataset["id"], "", "Evidence:", "", *[f"- `{path}`" for path in source_paths], ""]
        if dataset.get("startedAt") and dataset.get("finishedAt"):
            lines += [f"Window: {dataset['startedAt']} → {dataset['finishedAt']}", ""]
        else:
            lines += ["Windows: see the owning retained records referenced by these sources; detailed provenance is in summary.json.", ""]
        for lane in dataset["lanes"]:
            lines += ["### " + lane["id"], "", lane["boundary"], "", lane.get("noiseQualification", ""), "", f"Matched inputs: {len(lane['caseIds'])}; units: {lane['unit']}.", "", "|Tool|Cost / Mermaid|Status|Decision|A1/A0 median|Repeatability envelope|", "|---|---:|---|---|---:|---|"]
            for cell in sorted(lane["cells"], key=lambda c: (c.get("ratio") is None, c.get("ratio") or 0, c["tool"])):
                ratio = "—" if cell.get("ratio") is None else f"{cell['ratio']:.4f}"
                decision = "reference" if cell["tool"] == MERMAID and cell.get("ratio") == 1 else cell.get("classification", "descriptive only")
                control = f"{cell['controlRatio']:.4f}" if cell.get("controlRatio") is not None else "—"
                envelope = f"[{cell['envelope'][0]:.4f}, {cell['envelope'][1]:.4f}]" if cell.get("envelope") and cell["status"] == "repeatability-qualified" else "—"
                lines.append(f"|{cell['tool']}|{ratio}|{cell['status']}{'; artifact alias of '+cell['aliasOf'] if cell.get('aliasOf') else ''}|{decision}|{control}|{envelope}|")
            lines.append("")
        if dataset["quality"]:
            lines += ["### Absolute admission / assertions", "", "|Tool|Passed / declared population|Passed delta versus Mermaid|Other outcomes|", "|---|---:|---:|---|"]
            for row in dataset["quality"]:
                other = {k: v for k, v in row["statuses"].items() if k != "passed"}
                lines.append(f"|{row['tool']}|{row['passed']}/{row['population']}|{row['deltaPassedVersusMermaid']:+}|{json.dumps(other, sort_keys=True)}|")
            lines += ["", dataset["quality"][0]["scope"], ""]
            for row in dataset["quality"]:
                lines += [f"{row['tool']}: {note}" for note in row.get("interpretationNotes", [])]
            if dataset.get("commonPositiveAdmission"):
                common = dataset["commonPositiveAdmission"]
                lines += ["", f"Common positive admission: {common['bindingCount']} binding IDs / {common['uniqueInvocationCount']} unique source/prelude invocations. These are functional checks; startup/resource costs use one separate two-node source.", ""]
        lines += ["Remaining limits:", "", *["- " + gap for gap in dataset["gaps"]], ""]
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--community", type=Path)
    parser.add_argument("--dave", type=Path)
    parser.add_argument("--upstream", type=Path, action="append", default=[])
    parser.add_argument("--parser", type=Path)
    parser.add_argument("--browser", type=Path)
    parser.add_argument("--tool-versions", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    if args.community and (args.dave or args.upstream or args.parser or args.browser):
        parser.error("Historical community is a separate dated set; do not compose it with current lanes")
    datasets, claims = [], []
    for function, value in [(community, args.community), (dave, args.dave), (upstream, args.upstream), (parser_baseline, args.parser), (browser_baseline, args.browser)]:
        if value:
            dataset, additions = function(value)
            datasets.append(dataset)
            claims.extend(additions)
    if not datasets:
        parser.error("Choose retained evidence to reduce")
    # All checks precede creation/writes. Raw evidence is immutable.
    admitted = assert_tool_versions(claims, args.tool_versions)
    manifest = read_tool_versions(args.tool_versions)
    for dataset in datasets:
        for lane in dataset["lanes"]:
            for cell in lane["cells"]:
                cell["tool"] = canonical_tool(cell["tool"], manifest)
        for row in dataset["quality"]:
            row["tool"] = canonical_tool(row["tool"], manifest)
    baseline_versions = {c["version"] for c in admitted if c["tool"] == MERMAID}
    if len(baseline_versions) != 1:
        raise ValueError("No unique admitted Mermaid baseline version")
    report = {"schema": "mermaid-baseline-report-v1", "baseline": {"tool": MERMAID, "version": next(iter(baseline_versions))}, "ratio": "tool cost / same-lane Mermaid cost; lower is better", "toolVersions": admitted, "datasets": datasets}
    charts = render_charts(report)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "summary.json").write_text(json.dumps(report, separators=(",", ":")) + "\n")
    (args.out / "report.md").write_text(markdown(report))
    for filename, content in charts.items():
        (args.out / filename).write_text(content)
    print(json.dumps({"out": str(args.out), "datasets": len(datasets), "claims": len(admitted), "charts": len(charts)}))


if __name__ == "__main__":
    main()
