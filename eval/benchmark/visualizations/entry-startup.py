#!/usr/bin/env python3
"""Read completed benchmark JSON; export tables, an HTML gallery and figures.

python3 entry-startup.py --startup PROJECT=/path/to/raw-result.json \
  --startup PEER=/path/to/result.json --required-family /path/to/result.json \
  --upstream /path/to/upstream-test-assertions-report.json --out /path/to/charts

--summary-only uses only Python's standard library and never imports matplotlib.
Rendering requires matplotlib. This program never imports a renderer, runs a
benchmark, queries Git, changes records, or awards an aggregate tool score.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
from html import escape
import json
import math
from pathlib import Path
from statistics import median
import sys
from textwrap import fill

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evidence import read_document
from tool_versions import DEFAULT_MANIFEST, assert_tool_versions, canonical_tool, read_tool_versions


BASE = ("suite", "surface", "runtime", "family", "caseId", "operation", "format", "mode")
COORDINATES = ("round", "sample", "requestedOperation", "resourcePass", "checkpoint")
PRIMARY = {"process-to-first-consumed", "process-to-fully-consumed-output", "process-initialize-first-fully-consumed-tool", "browser-launch-to-first-consumed", "eight-input-burst-to-latest-verified-DOM", "changed-input-to-verified-DOM"}
RESOURCE = {"fresh-process-resource-paired-control", "fresh-cli-process-resource", "fresh-mcp-server-resource"}
PROJECT_NAMES = {"adewale/agentic-mermaid": "Agentic Mermaid", "obsidianmd/pele": "Pele", "mermaid-js/mermaid": "Mermaid"}
PROJECT_ALIASES = {"agentic": "adewale/agentic-mermaid", "pele": "obsidianmd/pele", "mermaid": "mermaid-js/mermaid"}
STATUS_COLORS = {"passed": "#187c6c", "failed": "#b93b43", "blocked": "#89949e", "unsupported": "#c29550", "not-applicable": "#d1d6db", "missing": "#f4f6f8", "mixed": "#7b64a7"}
MIB = 1024 * 1024


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load(path):
    return read_document(path)


def save(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def stats(values, latency=False):
    values = sorted(value for value in values if finite(value))
    if not values:
        return {"n": 0, "median": None, "min": None, "max": None, "p95": None}
    return {"n": len(values), "median": median(values), "min": values[0], "max": values[-1], "p95": values[math.ceil(len(values) * .95) - 1] if latency and len(values) >= 20 else None}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def role(row):
    metrics = row.get("metrics", {})
    if row.get("surface") == "browser:editor":
        return "editor-eight-edit-burst" if "eight-input" in row.get("mode", "") else "editor-input-to-DOM"
    if row.get("mode") == "fresh-browser":
        return "page-to-API-ready"
    if row.get("mode") == "process-to-first-consumed" and metrics.get("role") != "public renderer":
        return "namespace-discovery"
    return "public-result"


def dimensions(project, row):
    value = {name: row.get(name, "") for name in BASE}
    value["project"] = project
    value["role"] = role(row)
    value["requestedOperation"] = row.get("metrics", {}).get("requestedOperation")
    return value


def group_key(project, row):
    value = dimensions(project, row)
    return canonical(value)


def startup_identity_file(file):
    file = Path(file).resolve()
    identity = file.parent / "identity.json"
    if not identity.is_file() and (file.parent / "cache.json").is_file():
        directory = load(file.parent / "cache.json").get("evidenceDirectory")
        if directory:
            identity = Path(directory) / "identity.json"
    if not identity.is_file() and (identity.parent / 'result.json.gz').is_file():
        return identity.parent / 'result.json.gz'
    return identity


def artifact_package(identity):
    artifact = identity.get("artifact", {})
    package = artifact.get("package", artifact)
    metadata = package.get("packageMetadata", {})
    return (metadata.get("version") or package.get("version") or package.get("artifact", {}).get("version"),
            metadata.get("name") or package.get("packageName") or package.get("name"))


def executed(row):
    metrics = row.get("metrics", {})
    if metrics.get("runtimeExecuted") is True or row.get("samplesMs"):
        return True
    if any(isinstance(metrics.get(key), bool) for key in ("observedAccepted", "observedParserAccepted", "parseAccepted")):
        return True
    return row.get("status") in ("passed", "failed") and row.get("mode") not in ("declaration", "not-executed")


def version_claims(startup, required_files, upstream_files, dave_file, manifest):
    """Read only declared owning receipt paths; never search recursively for a version."""
    claims, package_owners = [], defaultdict(set)

    def add(tool, version, source, package=None, variant=None):
        tool = canonical_tool(tool, manifest)
        if package:
            package_owners[package].add(tool)
        claims.append({"tool": tool, "version": version, "source": str(source), **({"variant": variant} if variant is not None else {})})

    def owner_of(row):
        metrics = row.get("metrics", {})
        return canonical_tool(metrics.get("project") or metrics.get("implementation") or row.get("surface", "").split(":")[0], manifest)

    for project, file in startup:
        file = Path(file).resolve()
        result = load(file)
        identity_file = startup_identity_file(file)
        if not identity_file.is_file():
            if any(executed(row) for row in result.get("observations", [])):
                raise ValueError("Missing owning startup artifact version receipt: " + str(identity_file))
            continue
        identity = load(identity_file)
        identity = identity.get('identity', identity)
        if canonical_tool(identity.get("project"), manifest) != canonical_tool(project, manifest):
            raise ValueError("Owning startup identity names a different selected project: " + str(identity_file))
        version, name = artifact_package(identity)
        add(identity["project"], version, identity_file, name)

    for file in required_files:
        file = Path(file).resolve()
        result = load(file)
        owners = set()
        for declared in result.get("artifacts", []):
            support_file = Path(declared)
            if not support_file.is_absolute():
                support_file = file.parent / support_file
            if support_file.name != "required-family-support.json":
                continue
            identity_file = support_file.parent / 'identity.json'
            if not identity_file.is_file():
                identity_file = support_file.parent / 'result.json.gz'
            if not support_file.is_file() or not identity_file.is_file():
                raise ValueError("Missing owning required-family artifact receipt: " + str(identity_file))
            support, identity = load(support_file), load(identity_file)
            identity = identity.get('identity', identity)
            owner = canonical_tool(identity.get("project"), manifest)
            if canonical_tool(support.get("project"), manifest) != owner:
                raise ValueError("Required-family support and identity name different projects: " + str(support_file))
            owners.add(owner)
            version, name = artifact_package(identity)
            add(owner, version, identity_file, name)
        for row in result.get("observations", []):
            if executed(row) and owner_of(row) not in owners:
                raise ValueError("Missing executed required-family artifact version for " + owner_of(row) + " at " + str(file))

    for file in upstream_files:
        file = Path(file).resolve()
        result = load(file)
        receipts = [(file, result)] if isinstance(result.get("evidence", {}).get("results"), list) else []
        if not receipts:
            for declared in result.get("artifacts", []):
                receipt = Path(declared)
                if not receipt.is_absolute():
                    receipt = file.parent / receipt
                if receipt.name == "upstream-test-assertions-report.json":
                    receipts.append((receipt, load(receipt)))
        owners = set()
        for source, receipt in receipts:
            for row in receipt.get("evidence", {}).get("results", []):
                artifact = row.get("artifact") or {}
                tool = artifact.get("project") or row.get("project") or row.get("engine") or artifact.get("name")
                if not artifact and not row.get("callbacks"):
                    continue
                owner = canonical_tool(tool, manifest)
                owners.add(owner)
                add(owner, artifact.get("version"), str(source) + "#evidence.results/" + str(row.get("engine")), artifact.get("name"))
        for row in result.get("observations", []):
            if executed(row) and owner_of(row) not in owners:
                raise ValueError("Missing executed upstream artifact version for " + owner_of(row) + " at " + str(file))

    if dave_file:
        result = load(dave_file)
        identities = defaultdict(list)
        for identity in result.get("identities", []):
            identities[identity.get("label")].append(identity)
        for engine in result.get("engines", []):
            receipts = identities.get(engine.get("label"), [])
            if len(receipts) != 1:
                raise ValueError("Missing or ambiguous executed Dave artifact identity for " + str(engine.get("label")) + " at " + str(dave_file))
            identity = receipts[0]
            add(identity.get("project") or identity.get("name"), identity.get("version"), str(Path(dave_file).resolve()) + "#identities/" + str(engine.get("label")), variant="baseline" if identity.get("label") == "baseline" else None)

    # Unknown package names can be linked to a canonical owner only through an
    # explicit owning artifact receipt. Ambiguous fork/package aliases fail.
    for claim in claims:
        owners = package_owners.get(claim["tool"], set())
        if len(owners) > 1:
            raise ValueError("Ambiguous owning projects for package " + claim["tool"])
        if owners:
            claim["tool"] = next(iter(owners))
    return claims


def summarize_startup(project, file):
    file = Path(file).resolve()
    result = load(file)
    identity_file = startup_identity_file(file)
    package_version = None
    if identity_file.is_file():
        identity = load(identity_file)
        if canonical_tool(identity.get("project")) != canonical_tool(project):
            raise ValueError("Owning identity names a different startup project")
        package_version, _name = artifact_package(identity)
    if not result.get("finishedAt") or not isinstance(result.get("observations"), list):
        raise ValueError("Startup input is not a completed measured result: " + str(file))
    rows = result["observations"]
    declared_projects = {canonical_tool(row["metrics"]["project"]) for row in rows if row.get("metrics", {}).get("project") is not None}
    if declared_projects - {project}:
        raise ValueError("Explicit project differs from startup observations: " + str(declared_projects))
    seen = set()
    latency_groups, resource_groups, heap_groups = defaultdict(list), defaultdict(list), defaultdict(list)
    for ordinal, row in enumerate(rows):
        metrics = row.get("metrics", {})
        samples = row.get("samplesMs", [])
        if not isinstance(samples, list) or any(not finite(value) or value < 0 for value in samples):
            raise ValueError(f"Invalid elapsed sample at {file}:{ordinal}")
        if samples:
            identity = canonical([*[row.get(key) for key in BASE], *[metrics.get(key) for key in COORDINATES]])
            if identity in seen:
                raise ValueError(f"Duplicate actual timed-sample coordinates at {file}:{ordinal}")
            seen.add(identity)
        if row.get("mode") in PRIMARY or row.get("mode") == "fresh-browser":
            latency_groups[group_key(project, row)].append(row)
        if row.get("mode") in RESOURCE:
            resource_groups[group_key(project, row)].append(row)
        if row.get("mode") in ("fresh-browser-resource-heap", "post-first-output-held-heap"):
            heap_groups[group_key(project, row)].append(row)
    latencies = []
    for key, group in latency_groups.items():
        good = [row for row in group if row.get("status") == "passed" and not row.get("findings") and (row.get("mode") != "process-to-first-consumed" or row.get("metrics", {}).get("lifecycleExitCode") == 0)]
        samples = [sample for row in good for sample in row.get("samplesMs", [])]
        phase_names = ("observedSpawnToApiReadyMs", "moduleImportMs", "firstApiMs", "consumptionMs", "launchToReadyMs", "pageToReadyMs", "firstInputMs", "inputToCurrentDomMs", "initializeMs", "initializedAndToolsConsumedMs", "firstCallAndConsumptionMs")
        phases = {name: stats([row.get("metrics", {}).get(name) for row in good], True) for name in phase_names}
        latencies.append({**json.loads(key), "attemptedRows": len(group), "statuses": dict(Counter(row["status"] for row in group)), "qualifiedRows": len(good), "elapsedMs": stats(samples, True), "rawSamplesMs": samples, "phasesMs": {name: value for name, value in phases.items() if value["n"]}, "clock": group[0].get("metrics", {}).get("clock"), "qualificationScope": group[0].get("metrics", {}).get("qualificationScope"), "actualTool": group[0].get("metrics", {}).get("actualTool"), "requestArguments": group[0].get("metrics", {}).get("requestArguments")})
    resources = []
    primary_roles = {tuple(row[key] for key in ("surface", "runtime", "family", "caseId", "operation", "format")): row["role"] for row in latencies if row["mode"] in PRIMARY}
    for key, group in resource_groups.items():
        good = [row for row in group if row.get("status") == "passed"]
        values = {name: stats([row.get("metrics", {}).get(name) for row in good]) for name in ("peakRssBytes", "baselinePeakRssBytes", "peakDifferenceBytes", "userCpuMs", "systemCpuMs", "baselineUserCpuMs", "baselineSystemCpuMs")}
        values["totalCpuMs"] = stats([row["metrics"]["userCpuMs"] + row["metrics"]["systemCpuMs"] for row in good if finite(row.get("metrics", {}).get("userCpuMs")) and finite(row.get("metrics", {}).get("systemCpuMs"))])
        phases, control_phases, missing = defaultdict(list), defaultdict(list), []
        for row in good:
            raw = row.get("metrics", {}).get("rawSnapshots")
            if not raw:
                continue
            path = Path(raw)
            if not path.is_absolute():
                path = file.parent / path
            if not path.is_file():
                missing.append(str(path))
                continue
            record = load(path)
            for target, source in ((phases, record.get("resource", {})), (control_phases, record.get("baseline", {}))):
                for phase, snapshot in source.get("snapshots", {}).items():
                    for field, value in snapshot.items():
                        if finite(value):
                            target[phase + "." + field].append(value)
        metrics = group[0].get("metrics", {})
        coordinate = json.loads(key)
        coordinate["role"] = primary_roles.get(tuple(coordinate[name] for name in ("surface", "runtime", "family", "caseId", "operation", "format")), coordinate["role"])
        resources.append({**coordinate, "attemptedRows": len(group), "statuses": dict(Counter(row["status"] for row in group)), "qualifiedRows": len(good), "values": {name: value for name, value in values.items() if value["n"]}, "snapshotsBytes": {name: stats(values) for name, values in phases.items()}, "controlSnapshotsBytes": {name: stats(values) for name, values in control_phases.items()}, "missingSnapshotEvidence": missing, "scope": metrics.get("rssScope") or metrics.get("memoryScope") or metrics.get("scope"), "cpuResolutionMs": metrics.get("cpuResolutionMs", 10), "rawSnapshotFiles": [row.get("metrics", {}).get("rawSnapshots") for row in good if row.get("metrics", {}).get("rawSnapshots")]})
    browser_heaps = [{**json.loads(key), "values": {field: stats([row.get("metrics", {}).get(field) for row in group if row.get("status") == "passed"]) for field in ("usedSize", "totalSize")}, "statuses": dict(Counter(row["status"] for row in group)), "scope": group[0].get("metrics", {}).get("scope"), "checkpoint": group[0].get("metrics", {}).get("checkpoint")} for key, group in heap_groups.items()]
    delivery_groups, seen_paths, seen_coordinates = defaultdict(list), set(), set()
    for declared in result.get("artifacts", []):
        path = Path(declared)
        if not path.is_absolute():
            path = file.parent / path
        if not path.name.endswith("-payload.json") or not path.is_file() or path.resolve() in seen_paths:
            continue
        seen_paths.add(path.resolve())
        payload = load(path)
        if payload.get("resourcePass") is not False or not all(name in payload for name in ("surface", "round", "sample", "initial", "allFamilies")):
            continue
        prefix = f"{payload['surface']}-{payload['round']}-{payload['sample']}-"
        suffix = "-latency-payload.json"
        if not path.name.startswith(prefix) or not path.name.endswith(suffix):
            raise ValueError("Delivery artifact lacks its actual operation coordinates: " + str(path))
        operation = path.name[len(prefix):-len(suffix)]
        coordinate = (payload["surface"], payload["round"], payload["sample"], operation)
        if coordinate in seen_coordinates:
            raise ValueError("Duplicate actual delivery observation: " + repr(coordinate))
        seen_coordinates.add(coordinate)
        observed = {"round": payload["round"], "sample": payload["sample"], "source": str(path)}
        for stage, name in (("initial", "initial"), ("firstResult", "allFamilies")):
            files = {}
            for entry in payload[name].get("files", []):
                if entry.get("url") in files and files[entry["url"]] != entry:
                    raise ValueError("Conflicting repeated delivery path: " + str(path))
                files[entry["url"]] = entry
            observed[stage + "Paths"] = sorted(files)
            observed[stage + "Files"] = list(files.values())
            observed[stage + "Bytes"] = sum(entry.get("bytes", 0) for entry in files.values())
            observed[stage + "GzipBytes"] = sum(entry.get("gzip", 0) for entry in files.values())
        delivery_groups[(payload["surface"], operation)].append(observed)
    delivery = [{"project": project, "surface": "browser:" + surface, "operation": operation, "n": len(group), "initialBytes": stats([row["initialBytes"] for row in group]), "firstResultBytes": stats([row["firstResultBytes"] for row in group]), "initialGzipBytes": stats([row["initialGzipBytes"] for row in group]), "firstResultGzipBytes": stats([row["firstResultGzipBytes"] for row in group]), "uniqueObservedPaths": sorted({path for row in group for path in row["firstResultPaths"]}), "observations": group, "scope": "Unique fetched URL file bodies per actual fresh-browser observation; no repeated metadata sums. Gzip is sum of per-file gzip estimates, not measured compressed wire bytes/HTTP overhead. Editor is eight-edit completion, not single-preview startup."} for (surface, operation), group in sorted(delivery_groups.items())]
    project_label = PROJECT_NAMES.get(project, project) + (" " + package_version if package_version else "")
    for group in (*latencies, *resources, *browser_heaps, *delivery):
        group["projectLabel"] = project_label
    return {"project": project, "packageVersion": package_version, "identitySource": str(identity_file) if identity_file.is_file() else None, "source": str(file), "sourceStatus": result.get("status"), "startedAt": result["startedAt"], "finishedAt": result["finishedAt"], "observationCount": len(rows), "statuses": dict(Counter(row["status"] for row in rows)), "gaps": result.get("gaps", []), "latencies": latencies, "resources": resources, "browserHeaps": browser_heaps, "delivery": delivery, "artifacts": result.get("artifacts", [])}


def summarize_required(files):
    cells = defaultdict(list)
    sources = []
    for file in files:
        result = load(file)
        sources.append(str(Path(file).resolve()))
        for row in result.get("observations", []):
            metrics = row.get("metrics", {})
            if metrics.get("expectedAccepted") is not True:
                continue
            project = metrics.get("implementation")
            if project:
                cells[(project, row["family"])].append(row)
    return {"sources": sources, "scope": "Authored positive family witnesses: format and labels. Not comprehensive feature, native-semantic or painted-semantic fidelity.", "cells": [{"project": project, "family": family, "status": rows[0]["status"] if len({row["status"] for row in rows}) == 1 else "mixed", "statuses": dict(Counter(row["status"] for row in rows)), "cases": [row["caseId"] for row in rows], "scopes": sorted({row.get("metrics", {}).get("qualificationScope", "unmeasured") for row in rows})} for (project, family), rows in sorted(cells.items())]}


def summarize_upstream(files):
    groups = defaultdict(list)
    sources, workflows, seen = [], [], set()
    for file in files:
        result = load(file)
        sources.append(str(Path(file).resolve()))
        for row in result.get("observations", []):
            if row.get("operation") != "original-upstream-assertions" or row.get("caseId") in ("artifact-admission", "worker-admission", "worker-execution", "worker-publication"):
                continue
            project = row.get("metrics", {}).get("implementation") or row.get("surface", "").split(":")[0]
            identity = (PROJECT_ALIASES.get(project, project), row["family"], row["caseId"])
            if identity in seen:
                raise ValueError("Duplicate original callback across upstream inputs: " + repr(identity))
            seen.add(identity)
            groups[(PROJECT_ALIASES.get(project, project), row["family"])].append(row)
        for row in result.get("evidence", {}).get("results", []):
            workflows.append({"project": PROJECT_ALIASES.get(row.get("engine"), row.get("engine")), "workflow": row.get("workflow"), "scope": "Single uncalibrated whole worker: preparation/imports/adapters/replays/assertions; not upstream-runner or parser speed rank."})
    return {"sources": sources, "scope": "Original main Mindmap/GitGraph callbacks through reviewed public-model facades. Wider upstream files remain unprojected; executed assertion count is not a fixed score denominator.", "groups": [{"project": project, "family": family, "statuses": dict(Counter(row["status"] for row in rows)), "executedAssertions": sum(row.get("metrics", {}).get("executedAssertions", 0) for row in rows), "passedAssertions": sum(row.get("metrics", {}).get("passedAssertions", 0) for row in rows)} for (project, family), rows in sorted(groups.items())], "workflows": workflows}


def summarize_dave(file):
    if not file:
        return None
    result = load(file)
    if result.get("status") != "completed":
        raise ValueError("Dave input is not completed: " + file)
    identities = {row["label"]: {key: row[key] for key in ("name", "version")} for row in result.get("identities", [])}
    return {"source": str(Path(file).resolve()), "startedAt": result.get("startedAt"), "finishedAt": result.get("finishedAt"), "scope": result.get("policy", {}).get("timing"), "identities": identities, "engines": [{"label": row["label"], "accepted": row["accepted"], "population": row["population"], "complete": row.get("complete"), "failureCategories": dict(Counter(item.get("category", "unclassified") for item in row.get("failures", [])))} for row in result.get("engines", [])], "matched": [{"comparator": row["comparator"], "matchedInputs": len(row["inputIds"]), "inputIds": row["inputIds"], "candidateMs": stats(row["candidateMs"]), "comparatorMs": stats(row["comparatorMs"]), "rawCandidateMs": row["candidateMs"], "rawComparatorMs": row["comparatorMs"]} for row in result.get("matched", [])], "payload": result.get("payload")}


def brief(value):
    if value is None:
        return "—"
    return f"{value:.3f}" if abs(value) < 10 else f"{value:.2f}"


def label(row, runtime=True):
    project = row.get("projectLabel") or PROJECT_NAMES.get(row["project"], row["project"])
    entry = row["surface"].removeprefix("library:")
    operation = row.get("requestedOperation") or row["operation"]
    operation = operation.removesuffix(":" + row["format"]).replace("createMermaidPNGRenderer", "PNG renderer factory").replace("createMermaidRenderer", "renderer factory").replace("renderMermaid", "").replace("WithReceipt", "+receipt").replace("WithMeta", "+meta").replace(":", " → ")
    runtime_label = "Chromium" if row["runtime"].startswith("chromium:") else row["runtime"]
    suffix = f" · {runtime_label}" if runtime else ""
    # CLI file/stdin are genuine different workflows, not independent engines.
    input_mode = " · " + row["caseId"].split("/")[-1] if row["surface"].startswith("cli:") else ""
    return f"{project} · {entry} · {operation} · {row['format']}{input_mode}{suffix}"


def write_tables(summary, out):
    latency_rows = []
    for project in summary["startup"]:
        for row in project["latencies"]:
            values = row["elapsedMs"]
            latency_rows.append({**{key: row.get(key) for key in ("project", *BASE, "role", "requestedOperation")}, "n": values["n"], "medianMs": values["median"], "p95Ms": values["p95"], "minMs": values["min"], "maxMs": values["max"], "attemptedRows": row["attemptedRows"], "statuses": canonical(row["statuses"]), "clock": row["clock"]})
    resource_rows = []
    for project in summary["startup"]:
        for row in project["resources"]:
            entry = {key: row.get(key) for key in ("project", *BASE, "role")}
            for name, value in row["values"].items():
                entry.update({name + suffix: value[key] for suffix, key in (("Median", "median"), ("Min", "min"), ("Max", "max"), ("Samples", "n"))})
            entry["scope"] = row["scope"]
            entry["cpuResolutionMs"] = row["cpuResolutionMs"]
            entry["qualifiedRows"] = row["qualifiedRows"]
            resource_rows.append(entry)
    delivery_rows = [{"project": row["project"], "surface": row["surface"], "operation": row["operation"], "n": row["n"], "initialBytesMedian": row["initialBytes"]["median"], "firstResultBytesMedian": row["firstResultBytes"]["median"], "firstResultBytesMin": row["firstResultBytes"]["min"], "firstResultBytesMax": row["firstResultBytes"]["max"], "firstResultPerFileGzipEstimateBytesMedian": row["firstResultGzipBytes"]["median"], "uniqueObservedPaths": canonical(row["uniqueObservedPaths"]), "scope": row["scope"]} for project in summary["startup"] for row in project["delivery"]]
    for name, rows in (("latencies.csv", latency_rows), ("resources.csv", resource_rows), ("browser-delivery.csv", delivery_rows)):
        keys = list(dict.fromkeys(key for row in rows for key in row))
        with (out / name).open("w", newline="") as file:
            writer = csv.DictWriter(file, keys)
            writer.writeheader()
            writer.writerows(rows)
    return latency_rows


def summary_markdown(summary):
    lines = ["# Public entry startup and resource evidence", "", "Each row keeps its actual public interface and clock boundary. There is no aggregate winner. Fresh processes do not imply a cold filesystem cache. These are descriptive distributions, not calibrated causal speedups.", "", "| Project | Measurement window | Observations | Statuses |", "|---|---|---:|---|"]
    for result in summary["startup"]:
        lines.append(f"| {result['project']} | {result['startedAt']} → {result['finishedAt']} | {result['observationCount']} | {canonical(result['statuses'])} |")
    lines += ["", "Latency p95 uses nearest rank and requires at least20 independent observations. Each reported distribution retains its raw samples and attempted statuses. Namespace discovery, page/API readiness, single returned artifacts, and editor eight-edit completion are different workloads.", "", "Resource diagnostics use their actual count (normally5 round samples), median and observed range. No resource p95 is reported. GNU time peak RSS covers whole child lifetime; CPU has10ms per-field resolution and zero is censored below that resolution. Baseline differences are descriptive, may be negative, and do not attribute allocations.", "", "JS heap, external memory and RSS overlap and cannot be stacked. Browser document V8 heap excludes worker/native/GPU/process memory; editor DOM retains the preview after consumer sink release. Native CLI and MCP server have no injected JS snapshots. SDK latency cannot certify later server exit status.", "", "Initial editor preview completion, browser-only launch duration and browser-only module-import duration remain unmeasured. launchToReadyMs directly measures launch through API availability; it is not a paint/preview signal. Full editor mode submits8 edits, not one.", "", "## Inputs", ""]
    lines += [f"- {result['project']}: `{result['source']}`" for result in summary["startup"]]
    lines += ["", "## Uniform tool versions", "", "Manifest: `" + summary["toolVersions"]["manifest"] + "`. Every supplied lane was checked before report output. Owning receipt paths remain in summary.json.", "", "| Tool | Version | Explicit variant |", "|---|---|---|"]
    lines += [f"| {claim['tool']} | {claim['version']} | {claim.get('variant', '—')} |" for claim in summary["toolVersions"]["claims"]]
    for name in ("requiredFamily", "upstream"):
        lines += [f"- {name}: `{source}`" for source in summary[name]["sources"]]
    if summary["requiredFamily"]["cells"]:
        lines += ["", "## Family witness admission", "", summary["requiredFamily"]["scope"], ""]
        for project in sorted({row["project"] for row in summary["requiredFamily"]["cells"]}):
            lines.append(f"- {project}: {canonical(dict(Counter(row['status'] for row in summary['requiredFamily']['cells'] if row['project'] == project)))}")
    if summary["upstream"]["groups"]:
        lines += ["", "## Original upstream assertion subset", "", summary["upstream"]["scope"], "", "| Project | Family | Callback outcomes | Executed assertions | Passed assertions |", "|---|---|---|---:|---:|"]
        for row in summary["upstream"]["groups"]:
            lines.append(f"| {row['project']} | {row['family']} | {canonical(row['statuses'])} | {row['executedAssertions']} | {row['passedAssertions']} |")
    if summary.get("dave"):
        lines += ["", "## Dave corpus", "", f"Input: `{summary['dave']['source']}`. {summary['dave']['scope']}. Three corpus rounds do not support p95. Each pair keeps its own matched input set. Actual tool versions match the same comparison-set manifest used by the other supplied lanes."]
    return "\n".join(lines) + "\n"


def export(figure, out, stem):
    for suffix in ("svg", "png", "pdf"):
        figure.savefig(out / f"{stem}.{suffix}", dpi=170, facecolor="white", bbox_inches="tight")


def plot_height(labels, minimum=4.5):
    # Default subplot margins leave roughly77% of the figure height for ticks.
    # .29in/line therefore leaves at least .22in per displayed wrapped line,
    # plus row padding. Every equally spaced row can hold the longest label.
    lines = max((label.count("\n") + 1 for label in labels), default=1)
    return max(minimum, len(labels) * (lines * .29 + .12) + 1.8)


def render(summary, out):
    # Importing plotting machinery is deliberately deferred; summary-only can
    # run while another controller owns benchmark clocks without this cost.
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    from matplotlib.patches import Patch
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False, "svg.fonttype": "none"})
    palette = {project["project"]: plt.get_cmap("tab10")(index) for index, project in enumerate(summary["startup"])}
    latencies = [row for project in summary["startup"] for row in project["latencies"]]
    resources = [row for project in summary["startup"] for row in project["resources"]]
    figures = []

    def dots(rows, title, filename, subtitle, value="elapsedMs"):
        if not rows:
            return
        rows = sorted(rows, key=lambda row: (row["runtime"], row["project"], row["surface"], row["operation"], row["caseId"]))
        tick_labels = [fill(label(row) + f" · n={row[value]['n']}", 65) for row in rows]
        fig, axis = plt.subplots(figsize=(12, plot_height(tick_labels)))
        for index, row in enumerate(rows):
            point = row[value]
            if point.get("median") is None:
                continue
            color = palette[row["project"]]
            axis.scatter(point["median"], index, color=color, marker="o", s=24)
            if point.get("p95") is not None:
                axis.plot([point["median"], point["p95"]], [index, index], color=color, alpha=.55)
                axis.scatter(point["p95"], index, color=color, marker="D", s=20)
        axis.set_yticks(range(len(rows)), tick_labels); axis.invert_yaxis()
        axis.set_xscale("log"); axis.set_xlabel("Elapsed milliseconds (log scale)"); axis.grid(axis="x", alpha=.2)
        axis.set_title(title + "\n" + subtitle, loc="left", fontsize=12, pad=18)
        axis.legend(handles=[Line2D([], [], marker="o", linestyle="none", color="#334354", label="Median"), Line2D([], [], marker="D", linestyle="none", color="#334354", label="p95 only when n ≥20")], loc="best")
        export(fig, out, filename); plt.close(fig); figures.append(filename)

    svg = [row for row in latencies if row["mode"] == "process-to-first-consumed" and row["role"] == "public-result" and row["family"] == "flowchart" and row["format"] == "svg"]
    compact = [row for row in svg if row["surface"] in ("library:.", "library:./svg") and row["operation"] in ("renderMermaidSVG:svg", "render:svg")]
    dots(compact, "Public SVG startup: root and focused entry comparison", "public-svg-startup", "Common two-node source; independent fresh samples (n shown). Descriptive distributions, no causal speedup calibration.")
    dots(svg, "All public SVG entries: process to fully consumed first result", "public-svg-all-entries", "Common two-node source; receipt/factory workflows and runtimes stay distinct. Exact methods in HTML/CSV.")
    for family, prefix in (("cli", "cli:"), ("mcp", "mcp:"), ("browser", "browser:")):
        chosen = [row for row in latencies if row["surface"].startswith(prefix) and row["mode"] in PRIMARY and row["role"] == "public-result"]
        dots(chosen, family.upper() + ": first fully consumed public result", family + "-startup", "Complete per-format workflows; distinct transport/process boundaries are labelled, not combined into a rank.")
    editor = [row for row in latencies if row["surface"] == "browser:editor" and row["mode"] in PRIMARY]
    dots(editor, "Editor: browser launch through eight edits and current verified DOM", "editor-eight-edit-startup", "Includes page/API availability and final DOM verification; initial-preview and pixel-paint completion are unmeasured.")

    # These are directly measured, overlapping boundaries, not additive parts.
    simple = [row for row in svg if row["operation"].startswith(("renderMermaidSVG:", "render:svg", "renderAsync:svg"))]
    if simple:
        phase_keys = ("observedSpawnToApiReadyMs", "moduleImportMs", "firstApiMs")
        tick_labels = [fill(label(row), 55) for row in simple]
        fig, axes = plt.subplots(1, 3, figsize=(14, plot_height(tick_labels)), sharey=True)
        for axis, key, title in zip(axes, phase_keys, ("Spawn → observed API ready", "Target module import", "Awaited first public API call")):
            for index, row in enumerate(simple):
                point = row["phasesMs"].get(key)
                if point and point["median"] is not None:
                    axis.scatter(point["median"], index, color=palette[row["project"]], s=25)
            axis.set_title(title); axis.set_xscale("log"); axis.set_xlabel("Median milliseconds"); axis.grid(axis="x", alpha=.2)
        axes[0].set_yticks(range(len(simple)), tick_labels); axes[0].invert_yaxis()
        fig.suptitle("Direct phase clocks: plain public SVG workflows\nOverlapping boundaries; do not add medians or interpret API time as layout-only time", x=.01, ha="left", fontsize=12)
        export(fig, out, "svg-direct-phases"); plt.close(fig); figures.append("svg-direct-phases")

    for fmt in ("svg", "png"):
        chosen = [row for row in resources if row["format"] == fmt and row["family"] == "flowchart"]
        if not chosen:
            continue
        tick_labels = [fill(label(row) + f" · n={row['qualifiedRows']}", 67) for row in chosen]
        fig, axis = plt.subplots(figsize=(13, plot_height(tick_labels, 5)))
        for index, row in enumerate(chosen):
            color = palette[row["project"]]
            for key, marker, offset in (("peakRssBytes", "o", -.10), ("baselinePeakRssBytes", "s", .10)):
                value = row["values"].get(key)
                if value and value["median"] is not None:
                    axis.plot([value["min"] / MIB, value["max"] / MIB], [index + offset] * 2, color=color, alpha=.45)
                    axis.scatter(value["median"] / MIB, index + offset, marker=marker, color=color, s=23, facecolors="none" if key.startswith("baseline") else color)
        axis.set_yticks(range(len(chosen)), tick_labels); axis.invert_yaxis(); axis.set_xlabel("Whole child lifetime peak RSS (MiB); median and observed range")
        axis.grid(axis="x", alpha=.2); axis.set_title(fmt.upper() + ": fresh public-process peak memory\nSeparate fresh diagnostics; API/CLI/MCP lifecycles differ; client memory excluded from MCP server", loc="left", fontsize=12, pad=18)
        axis.legend(handles=[Line2D([], [], marker="o", linestyle="none", color="#334354", label="Actual public process"), Line2D([], [], marker="s", markerfacecolor="none", linestyle="none", color="#334354", label="Matched empty runtime control (library only)")])
        export(fig, out, fmt + "-process-peak-rss"); plt.close(fig); figures.append(fmt + "-process-peak-rss")

    cpu = [row for row in resources if row["format"] == "svg" and row["family"] == "flowchart" and row["values"].get("totalCpuMs", {}).get("n")]
    if cpu:
        tick_labels = [fill(label(row) + f" · n={row['qualifiedRows']}", 65) for row in cpu]
        fig, axis = plt.subplots(figsize=(12, plot_height(tick_labels, 5)))
        for index, row in enumerate(cpu):
            value = row["values"]["totalCpuMs"]
            axis.plot([value["min"], value["max"]], [index] * 2, color=palette[row["project"]], alpha=.5)
            axis.scatter(value["median"], index, color=palette[row["project"]], s=24)
        axis.set_yticks(range(len(cpu)), tick_labels); axis.invert_yaxis(); axis.grid(axis="x", alpha=.2)
        axis.set_xlabel("Observed whole-process user + system CPU milliseconds; median and observed range")
        axis.set_title("SVG process CPU diagnostics; different public process lifecycles remain labelled\n10ms resolution per CPU field; zero is censored below resolution. No dollar/token cost or causal allocation credit.", loc="left", fontsize=12, pad=18)
        export(fig, out, "svg-whole-process-cpu"); plt.close(fig); figures.append("svg-whole-process-cpu")

    delivery = [row for project in summary["startup"] for row in project["delivery"]]
    if delivery:
        tick_labels = [fill((row.get("projectLabel") or PROJECT_NAMES.get(row["project"], row["project"])) + " · " + row["surface"] + " · " + row["operation"] + f" · n={row['n']}", 55) for row in delivery]
        fig, axes = plt.subplots(1, 2, figsize=(14, plot_height(tick_labels, 5)), sharey=True)
        for axis, field, title in zip(axes, ("firstResultBytes", "firstResultGzipBytes"), ("Fetched unique file bodies", "Sum of per-file gzip estimates")):
            for index, row in enumerate(delivery):
                value = row[field]
                axis.plot([value["min"] / 1024, value["max"] / 1024], [index] * 2, color=palette[row["project"]], alpha=.5)
                axis.scatter(value["median"] / 1024, index, color=palette[row["project"]], s=25)
            axis.set_title(title); axis.set_xlabel("KiB through first result; median/range"); axis.grid(axis="x", alpha=.2)
        axes[0].set_yticks(range(len(delivery)), tick_labels); axes[0].invert_yaxis()
        fig.suptitle("Browser delivery through the actual first public workflow\nEach observation counts each URL once. Gzip is a file estimate, not observed compressed wire transfer. Editor completes8 edits.", x=.01, ha="left", fontsize=12)
        export(fig, out, "browser-first-result-delivery"); plt.close(fig); figures.append("browser-first-result-delivery")

    heap = [row for row in resources if row["format"] in ("svg", "png") and row["family"] == "flowchart" and row["snapshotsBytes"]]
    if heap:
        tick_labels = [fill(label(row) + f" · n={row['qualifiedRows']}", 55) for row in heap]
        fig, axes = plt.subplots(1, 2, figsize=(14, plot_height(tick_labels, 5)), sharey=True)
        for axis, field, title in zip(axes, ("heapUsed", "external"), ("JavaScript heap used", "External memory (overlaps arrayBuffers)")):
            for index, row in enumerate(heap):
                for phase, marker, offset in (("outputHeldAfterGc", "o", -.10), ("afterReleaseAfterGc", "D", .10)):
                    value = row["snapshotsBytes"].get(phase + "." + field)
                    if value:
                        axis.plot([value["min"] / MIB, value["max"] / MIB], [index + offset] * 2, color=palette[row["project"]], alpha=.35)
                        axis.scatter(value["median"] / MIB, index + offset, marker=marker, color=palette[row["project"]], s=24)
            axis.set_title(title); axis.set_xlabel("MiB; diagnostic median and observed range"); axis.grid(axis="x", alpha=.2)
        axes[0].set_yticks(range(len(heap)), tick_labels); axes[0].invert_yaxis()
        fig.suptitle("Library memory: live returned output versus released consumer references\nCircle: output held after GC. Diamond: consumer references released + GC; module/renderer caches remain.", x=.01, ha="left", fontsize=12)
        export(fig, out, "library-live-released-memory"); plt.close(fig); figures.append("library-live-released-memory")

    browser_heap = [row for project in summary["startup"] for row in project["browserHeaps"] if row["mode"] == "fresh-browser-resource-heap"]
    if browser_heap:
        tick_labels = [fill(label(row) + f" · n={row['values']['usedSize']['n']}", 65) for row in browser_heap]
        fig, axis = plt.subplots(figsize=(12, plot_height(tick_labels, 5)))
        for index, row in enumerate(browser_heap):
            value = row["values"]["usedSize"]
            if value["median"] is not None:
                axis.plot([value["min"] / MIB, value["max"] / MIB], [index] * 2, color=palette[row["project"]], alpha=.4)
                axis.scatter(value["median"] / MIB, index, color=palette[row["project"]], s=25)
        axis.set_yticks(range(len(browser_heap)), tick_labels); axis.invert_yaxis(); axis.set_xlabel("Main-document V8 heap after consumer sink release + GC (MiB)"); axis.grid(axis="x", alpha=.2)
        axis.set_title("Browser document heap only; diagnostic median and range\nWorker/native/GPU/whole-browser process memory unmeasured. Editor preview DOM remains held.", loc="left", fontsize=12, pad=18)
        export(fig, out, "browser-document-heap"); plt.close(fig); figures.append("browser-document-heap")

    cells = summary["requiredFamily"]["cells"]
    if cells:
        from matplotlib.colors import ListedColormap
        families, projects = sorted({row["family"] for row in cells}), sorted({row["project"] for row in cells})
        statuses = list(STATUS_COLORS); lookup = {(row["project"], row["family"]): row["status"] for row in cells}
        matrix = [[statuses.index(lookup.get((project, family), "missing")) for family in families] for project in projects]
        fig, axis = plt.subplots(figsize=(max(11, len(families) * .45), 3.5 + len(projects) * .35))
        axis.imshow(matrix, cmap=ListedColormap(list(STATUS_COLORS.values())), vmin=-.5, vmax=len(statuses) - .5, aspect="auto", interpolation="nearest")
        axis.set_xticks(range(len(families)), families, rotation=65, ha="right"); axis.set_yticks(range(len(projects)), [PROJECT_NAMES.get(project, project) for project in projects])
        axis.set_title("Authored family witness admission: format and labels\nNo cell certifies complete family functionality or native/painted semantic fidelity", loc="left", pad=18)
        fig.legend(handles=[Patch(facecolor=STATUS_COLORS[status], label=status) for status in statuses if status in lookup.values() or status == "missing"], loc="lower center", ncol=5)
        fig.subplots_adjust(bottom=.35); export(fig, out, "family-witness-coverage"); plt.close(fig); figures.append("family-witness-coverage")

    upstream = summary["upstream"]["groups"]
    if upstream:
        fig, axis = plt.subplots(figsize=(11, max(4, len(upstream) * .4 + 1.8)))
        for index, row in enumerate(upstream):
            left = 0
            for status in ("passed", "failed", "blocked", "not-applicable"):
                count = row["statuses"].get(status, 0)
                axis.barh(index, count, left=left, color=STATUS_COLORS[status]); left += count
        axis.set_yticks(range(len(upstream)), [PROJECT_NAMES.get(row["project"], row["project"]) + " · " + row["family"] for row in upstream]); axis.invert_yaxis(); axis.set_xlabel("Original callbacks, not assertions or full upstream declarations")
        axis.set_title("Original Mindmap/GitGraph assertion callbacks through public adapters\nGray = unavailable/private/unprojected callback; wider upstream files remain outside this subset", loc="left", fontsize=12, pad=18)
        axis.legend(handles=[Patch(facecolor=STATUS_COLORS[status], label=status) for status in ("passed", "failed", "blocked", "not-applicable")], loc="upper center", bbox_to_anchor=(.5, -.17), ncol=4)
        export(fig, out, "upstream-original-callbacks"); plt.close(fig); figures.append("upstream-original-callbacks")
    dave = summary.get("dave")
    if dave:
        fig, axes = plt.subplots(1, 2, figsize=(13, 5), gridspec_kw={"width_ratios": [1, 1.6]})
        name = lambda key: dave["identities"].get(key, {}).get("name", key) + " " + dave["identities"].get(key, {}).get("version", "")
        for index, row in enumerate(dave["engines"]):
            axes[0].barh(index, row["population"], color="#e0e6eb")
            axes[0].barh(index, row["accepted"], color="#187c6c")
            axes[0].text(row["accepted"], index, f" {row['accepted']}/{row['population']}", va="center", fontsize=9)
        axes[0].set_yticks(range(len(dave["engines"])), [name(row["label"]) for row in dave["engines"]]); axes[0].invert_yaxis(); axes[0].set_xlabel("Accepted corpus inputs; advisory Dave policy")
        for index, row in enumerate(dave["matched"]):
            for offset, key, color in ((-.12, "candidateMs", "#187c6c"), (.12, "comparatorMs", "#536cb0")):
                value = row[key]
                axes[1].plot([value["min"], value["max"]], [index + offset] * 2, color=color)
                axes[1].scatter(value["median"], index + offset, color=color, s=30)
        axes[1].set_yticks(range(len(dave["matched"])), [name(row["comparator"]) + f" matched set\nn={row['matchedInputs']} inputs" for row in dave["matched"]]); axes[1].invert_yaxis(); axes[1].set_xscale("log"); axes[1].set_xlabel("Matched corpus render-call total milliseconds; round median/range")
        axes[1].legend(handles=[Patch(facecolor="#187c6c", label="Agentic Mermaid"), Patch(facecolor="#536cb0", label="Named comparator")]); axes[1].grid(axis="x", alpha=.2)
        fig.suptitle("Dave benchmark: accepted corpus and same-input render-call totals\nInitialization/inspection/cleanup/paint excluded; no p95. Dave versions are labelled; startup uses separately bound artifacts.", x=.01, ha="left", fontsize=12)
        fig.tight_layout(rect=(0, 0, 1, .88)); export(fig, out, "dave-acceptance-and-matched-totals"); plt.close(fig); figures.append("dave-acceptance-and-matched-totals")
    return figures


def html_report(summary, table, figures):
    cards = "".join(f'<figure><a href="{name}.svg"><img loading="lazy" src="{name}.svg" alt="{escape(name)}"></a><figcaption>{escape(name)} · <a href="{name}.png">PNG</a> · <a href="{name}.pdf">PDF</a></figcaption></figure>' for name in figures)
    payload = json.dumps(table, ensure_ascii=False, allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Public entry startup evidence</title><style>
body{font:15px/1.5 system-ui,sans-serif;color:#243442;background:#f5f7f9;margin:0;padding:32px;max-width:1600px}h1{font-size:30px;margin-bottom:8px}p{max-width:1050px}figure{background:white;margin:24px 0;padding:20px;border:1px solid #d9e0e6;border-radius:8px}img{max-width:100%;height:auto}figcaption{font-size:13px;color:#546574}a{color:#176d82}select,input{font:inherit;padding:7px;margin:5px;border:1px solid #b8c4ce;border-radius:4px}table{border-collapse:collapse;width:100%;font-size:12px;background:white}td,th{padding:7px;border-bottom:1px solid #e0e6eb;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#e8eef3;cursor:pointer}.scroll{max-height:750px;overflow:auto}#count{font-weight:600}.note{background:#fff4d9;padding:14px;border-radius:5px}</style>
<h1>Public entry startup and resource evidence</h1><p>Fresh-process public interfaces, complete returned content, independent qualification after the clock. Discovery, API readiness, rendered results and the editor eight-edit burst stay separate. No aggregate winner or causal speedup score.</p>
<p class="note">p95 requires ≥20 independent latency samples. Resource charts use the actual diagnostic count, median and range. Browser document heap excludes worker/native/GPU/process memory. First editor preview completion remains unmeasured.</p><p><a href="summary.md">Methods and input provenance</a> · <a href="summary.json">Full summary and raw latency samples</a> · <a href="latencies.csv">Latency CSV</a> · <a href="resources.csv">Resource CSV</a> · <a href="browser-delivery.csv">Browser delivery and actual paths CSV</a></p>''' + cards + '''<h2>All measured latency interfaces</h2><p>Select comparable boundaries, runtime and output before comparing values. Header clicks sort the visible table. Missing values remain blank.</p><div id="filters"></div><label>Search <input id="search" type="search"></label> <span id="count"></span><div class="scroll"><table><thead id="head"></thead><tbody id="body"></tbody></table></div>
<script id="data" type="application/json">''' + payload + '''</script><script>
const rows=JSON.parse(document.getElementById('data').textContent), filters=document.getElementById('filters'), fields=['project','surface','runtime','format','role','mode'];const selects={};for(const field of fields){const label=document.createElement('label');label.textContent=field+' ';const select=document.createElement('select');const all=document.createElement('option');all.value='';all.textContent='All';select.append(all);for(const value of [...new Set(rows.map(row=>row[field]))].sort()){const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option)}select.onchange=draw;selects[field]=select;label.append(select);filters.append(label)}const columns=['project','surface','runtime','family','operation','format','role','mode','requestedOperation','n','medianMs','p95Ms','statuses'];let sort='project',direction=1;const header=document.createElement('tr');for(const key of columns){const th=document.createElement('th');th.textContent=key;th.onclick=()=>{direction=sort===key?-direction:1;sort=key;draw()};header.append(th)}document.getElementById('head').append(header);function draw(){const search=document.getElementById('search').value.toLowerCase();const selected=rows.filter(row=>fields.every(field=>!selects[field].value||row[field]===selects[field].value)&&(!search||JSON.stringify(row).toLowerCase().includes(search)));selected.sort((a,b)=>{const x=a[sort],y=b[sort];if(x==null)return 1;if(y==null)return-1;return direction*(typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y)))});const body=document.getElementById('body');body.replaceChildren();for(const row of selected){const tr=document.createElement('tr');for(const key of columns){const td=document.createElement('td');const value=row[key];td.textContent=value==null?'':typeof value==='number'?Number.isInteger(value)?String(value):value.toFixed(3):String(value);tr.append(td)}body.append(tr)}document.getElementById('count').textContent=selected.length+' interfaces'}document.getElementById('search').oninput=draw;draw();
</script></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--startup", action="append", default=[], metavar="PROJECT=RESULT_JSON")
    parser.add_argument("--required-family", action="append", default=[], metavar="RESULT_JSON")
    parser.add_argument("--upstream", action="append", default=[], metavar="REPORT_JSON")
    parser.add_argument("--dave", metavar="BROWSER_REPORT_JSON")
    parser.add_argument("--tool-versions", type=Path, default=DEFAULT_MANIFEST, metavar="MANIFEST_JSON", help="Uniform comparison-set version pins; defaults to the maintained tool-versions.json")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()
    startup_inputs = []
    projects = set()
    try:
        manifest = read_tool_versions(args.tool_versions)
        for specification in args.startup:
            project, separator, path = specification.partition("=")
            if not separator or not project:
                parser.error("Each --startup needs one unique explicit PROJECT=RESULT_JSON")
            project = canonical_tool(project, manifest)
            if project in projects:
                parser.error("Each --startup needs one unique canonical project")
            projects.add(project)
            startup_inputs.append((project, path))
        admitted_versions = assert_tool_versions(version_claims(startup_inputs, args.required_family, args.upstream, args.dave, manifest), args.tool_versions)
    except (ValueError, OSError, TypeError, KeyError) as error:
        parser.error(str(error))
    startup = [summarize_startup(project, path) for project, path in startup_inputs]
    summary = {"schema": "public-entry-evidence-visualization-v1", "toolVersions": {"manifest": str(args.tool_versions.resolve()), "claims": admitted_versions, "scope": "One actual artifact version per canonical tool and explicitly declared variant across all supplied lanes; missing executed-artifact receipts and mixed versions are rejected before report output."}, "statistics": {"latencyP95": "nearest rank; only n>=20", "resource": "median/min/max; no p95; normally5 independent round diagnostics", "comparison": "descriptive, distinct boundaries; no aggregate or causal speedup score"}, "startup": startup, "requiredFamily": summarize_required(args.required_family), "upstream": summarize_upstream(args.upstream), "dave": summarize_dave(args.dave)}
    args.out.mkdir(parents=True, exist_ok=True)
    save(args.out / "summary.json", summary)
    (args.out / "summary.md").write_text(summary_markdown(summary))
    table = write_tables(summary, args.out)
    figures = [] if args.summary_only else render(summary, args.out)
    (args.out / "index.html").write_text(html_report(summary, table, figures))
    print(json.dumps({"out": str(args.out.resolve()), "projects": len(startup), "latencyInterfaces": len(table), "figures": figures, "summaryOnly": args.summary_only}))


if __name__ == "__main__":
    main()
