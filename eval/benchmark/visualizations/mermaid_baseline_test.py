"""Behavioral controls for retained-data composition; never executes a renderer."""

import contextlib
import io
import json
import gzip
import os
import subprocess
import shutil
from pathlib import Path
import tempfile
import unittest

import mermaid_baseline as baseline
from evidence import read_document


class BaselineControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)

    def write(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        return path

    def test_real_typescript_document_exports_remain_portable_and_reject_changed_data(self):
        module = Path(__file__).resolve().parents[1] / 'portable/project-records.ts'
        source = self.root / 'source'
        source.mkdir()
        output = source / 'summary.json'
        expected = {'title': 'Trident λ漢', 'rows': [{'samplesMs': [1.25, 2.5]}]}
        script = f'import {{writeBenchmarkDocument}} from {json.dumps(str(module))};writeBenchmarkDocument({json.dumps(str(output))},{json.dumps(expected)});'
        subprocess.run([os.environ.get('NODE_BIN', 'node'), '--input-type=module', '-e', script], check=True, capture_output=True, text=True)
        copied = self.root / 'copied'
        copied.mkdir()
        for name in ('summary.json', 'summary.json.gz'):
            shutil.copy2(source / name, copied / name)
        shutil.rmtree(source)
        self.assertEqual(read_document(copied / 'summary.json'), expected)
        (copied / 'summary.json.gz').write_bytes(gzip.compress(json.dumps({'title': 'Trident λ漢', 'rows': [{'samplesMs': [0.001]}]}).encode()))
        with self.assertRaisesRegex(ValueError, 'immutable reference'):
            read_document(copied / 'summary.json')

    def dave(self):
        report = {"status": "completed", "startedAt": "start", "finishedAt": "end", "browser": "same-browser", "environment": {},
                  "policy": {"rounds": 3, "measured": 3, "timing": "public browser SVG return"},
                  "identities": [{"label": label, "name": label, "version": version} for label, version in [("candidate", "0.4.2"), ("pele", "1.9.0"), ("mermaid", "12.2.0")]],
                  "payload": {label: {"monolithic": {"gzip": size, "raw": size * 2, "sha256": label}} for label, size in [("candidate", 30), ("pele", 10), ("mermaid", 100)]}}
        path = self.write("browser-report.json", report)
        self.write("corpus.json", {"occurrenceCount": 3, "upstream": {"version": "12.2.0"}, "occurrences": [{"id": case} for case in ["a", "b", "c"]]})
        rows = []
        for engine, time in [("candidate", 10), ("pele", 1), ("mermaid", 100)]:
            for round_id in [1, 2, 3]:
                for case in ["a", "b", "c"]:
                    rows.append({"engine": engine, "round": round_id, "id": case,
                                 "ok": not (engine == "candidate" and case == "b" or engine == "mermaid" and case == "c"),
                                 "ms": time if case == "a" else 999})
        (self.root / "browser-samples.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))
        return path

    def test_direct_mermaid_intersection_never_divides_unequal_candidate_cohorts(self):
        result, _ = baseline.dave(self.dave())
        lane = result["lanes"][0]
        self.assertEqual(lane["caseIds"], ["a"])
        self.assertEqual({r["tool"]: r["ratio"] for r in lane["cells"]}, {"adewale/agentic-mermaid": .1, "obsidianmd/pele": .01, "mermaid-js/mermaid": 1})
        self.assertEqual([(r["passed"], r["population"], r["deltaPassedVersusMermaid"]) for r in result["quality"]], [(2, 3, 0), (3, 3, 1), (2, 3, 0)])

    def test_zero_duration_rejected_attempts_are_retained(self):
        path = self.dave()
        samples = self.root / "browser-samples.jsonl"
        rows = [json.loads(line) for line in samples.read_text().splitlines()]
        for row in rows:
            if not row["ok"]:
                row["ms"] = 0
        samples.write_text("".join(json.dumps(row) + "\n" for row in rows))
        result, _ = baseline.dave(path)
        self.assertEqual(len(result["lanes"][0]["caseIds"]), 1)

    def test_missing_or_duplicate_round_cannot_manufacture_success(self):
        path = self.dave()
        samples = self.root / "browser-samples.jsonl"
        rows = samples.read_text().splitlines()
        samples.write_text("\n".join(rows[:-1]) + "\n")
        with self.assertRaisesRegex(ValueError, "Incomplete Dave round"):
            baseline.dave(path)
        samples.write_text("\n".join(rows + [rows[0]]) + "\n")
        with self.assertRaisesRegex(ValueError, "Duplicate Dave sample"):
            baseline.dave(path)

    def test_version_rejection_happens_before_output_writes(self):
        path = self.dave()
        report = json.loads(path.read_text())
        report["identities"][1]["version"] = "1.6.0"
        path.write_text(json.dumps(report))
        out = self.root / "out"
        out.mkdir()
        sentinel = out / "summary.json"
        sentinel.write_text("previous-report")
        with self.assertRaises(ValueError), contextlib.redirect_stdout(io.StringIO()):
            baseline.main(["--dave", str(path), "--out", str(out)])
        self.assertEqual(sentinel.read_text(), "previous-report")
        self.assertEqual(list(out.iterdir()), [sentinel])

    def test_original_assertions_keep_unavailable_in_mermaid_denominator(self):
        paths = []
        for engine, statuses in [("mermaid", {"passed": 2, "unavailable": 1}), ("agentic", {"passed": 1, "failed": 1, "unavailable": 1})]:
            outcomes = ["passed", "passed" if engine == "mermaid" else "failed", "blocked"]
            observations = [{"operation": "original-upstream-assertions", "caseId": str(i), "status": status, "metrics": {"implementation": engine, "upstreamCommit": "same-actual-pin"}} for i, status in enumerate(outcomes)]
            paths.append(self.write(engine + ".json", {"observations": observations, "evidence": {"results": [{"engine": engine, "artifact": {"version": "12.2.0" if engine == "mermaid" else "0.4.2"}, "statuses": statuses, "callbacks": 3}]}}))
        result, _ = baseline.upstream(paths)
        self.assertEqual([(row["passed"], row["population"], row["deltaPassedVersusMermaid"]) for row in result["quality"]], [(2, 3, 0), (1, 3, -1)])
        self.assertEqual(result["lanes"], [])

    def test_predeclared_control_envelope_leaves_ambiguous_or_noisy_cost_unresolved(self):
        a0, a1 = [100] * 5, [102] * 5
        self.assertEqual(baseline.relative_decision([20] * 5, a0, a1, .1, 5)["classification"], "lower-cost")
        self.assertEqual(baseline.relative_decision([200] * 5, a0, a1, .1, 5)["classification"], "higher-cost")
        self.assertEqual(baseline.relative_decision([99] * 5, a0, a1, .1, 5)["classification"], "unresolved")
        noisy = baseline.relative_decision([20] * 5, a0, [130] * 5, .1, 5)
        self.assertEqual((noisy["status"], noisy["classification"], noisy["envelope"]), ("unqualified", "unresolved", None))
        self.assertEqual(baseline.relative_decision([20] * 5, a0, a1, .1, 5, rolling=True)["status"], "unqualified")
        self.assertEqual(baseline.relative_decision([20] * 4, a0[:4], a1[:4], .1, 5)["status"], "unqualified")

    def test_browser_negative_rejection_is_quality_not_fast_svg_success(self):
        roles = {"mermaid-a0": (baseline.MERMAID, 100), "mermaid-a1": (baseline.MERMAID, 102), "agentic": ("adewale/agentic-mermaid", 20), "pele": ("obsidianmd/pele", 5)}
        cases = [{"id": name, "expected": {"accept": accepted}} for name, accepted in [("good", True), ("unsupported", True), ("invalid", False)]]
        rows = []
        for role, (tool, duration) in roles.items():
            for case in cases:
                for round_id in range(1, 6):
                    accepted = case["expected"]["accept"] and not (role == "pele" and case["id"] == "unsupported")
                    status = "passed" if accepted == case["expected"]["accept"] else "unsupported"
                    metrics = {"expectedAccepted": case["expected"]["accept"], "accepted": accepted, "round": round_id, "sample": 0}
                    rows.append({"tool": tool, "role": role, "caseId": case["id"], "round": round_id, "sample": 0, "runtime": "chromium:same", "mode": "reused-page-render", "status": status, "samplesMs": [duration], "metrics": metrics})
            for sample in range(25):
                rows.append({"tool": tool, "role": role, "caseId": "good", "round": 0, "sample": sample, "runtime": "chromium:same", "mode": "fresh-browser-first-result", "status": "passed", "samplesMs": [duration], "metrics": {"expectedAccepted": True, "accepted": True, "round": 0, "sample": sample}})
        for row in rows:
            row["metrics"]["collectionId"] = "original-window"
        path = self.write("fresh.json", {"startedAt": "start", "finishedAt": "end", "rolling": False, "collectionId": "original-window", "settings": {"rendererRounds": 5, "startupSamplesPerRole": 25, "controlToleranceRatio": .1, "controlMinimumPairs": 5}, "identities": [{"tool": tool, "version": version} for tool, version in [(baseline.MERMAID, "12.2.0"), ("adewale/agentic-mermaid", "0.4.2"), ("obsidianmd/pele", "1.9.0")]], "cases": cases, "observations": rows})
        result, _ = baseline.browser_baseline(path)
        self.assertEqual(result["lanes"][0]["caseIds"], ["good"])
        self.assertEqual(result["lanes"][0]["excludedCaseIds"], ["invalid", "unsupported"])
        self.assertEqual([(r["passed"], r["population"]) for r in result["quality"]], [(3, 3), (3, 3), (2, 3)])
        self.assertEqual(result["lanes"][0]["cells"][1]["classification"], "lower-cost")
        rows.append(rows[0])
        report = json.loads(path.read_text())
        report["observations"] = rows
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(ValueError, "Duplicate browser sample"):
            baseline.browser_baseline(path)

    def test_declared_fresh_window_cannot_override_mixed_or_missing_measurement_uuids(self):
        rows = []
        roles = {"mermaid-a0": baseline.MERMAID, "mermaid-a1": baseline.MERMAID, "agentic": "adewale/agentic-mermaid", "pele": "obsidianmd/pele"}
        for role, tool in roles.items():
            for round_id in range(1, 6):
                rows.append({"tool": tool, "role": role, "caseId": "same", "round": round_id, "sample": 0, "runtime": "chromium:same", "mode": "reused-page-render", "status": "passed", "samplesMs": [20 if role == "agentic" else 100], "metrics": {"round": round_id, "sample": 0, "expectedAccepted": True, "accepted": True, "collectionId": "original"}})
        report = {"startedAt": "start", "finishedAt": "end", "rolling": False, "collectionId": "original", "settings": {"rendererRounds": 5, "startupSamplesPerRole": 25, "controlToleranceRatio": .1, "controlMinimumPairs": 5}, "identities": [{"tool": tool, "version": version} for tool, version in [(baseline.MERMAID, "12.2.0"), ("adewale/agentic-mermaid", "0.4.2"), ("obsidianmd/pele", "1.9.0")]], "cases": [{"id": "same", "expected": {"accept": True}}], "observations": rows}
        path = self.write("uuid.json", report)
        fresh, _ = baseline.browser_baseline(path)
        self.assertEqual(fresh["lanes"][0]["cells"][1]["classification"], "lower-cost")
        for wrong in ["another-window", None]:
            rows[0]["metrics"]["collectionId"] = wrong
            path.write_text(json.dumps(report))
            mixed, _ = baseline.browser_baseline(path)
            self.assertTrue(mixed["rolling"])
            self.assertFalse(mixed["collectionIdentityComplete"])
            self.assertTrue(all(cell["status"] == "unqualified" and cell["classification"] == "unresolved" for cell in mixed["lanes"][0]["cells"]))

    def test_parser_workflow_cost_and_unavailable_negative_do_not_become_api_or_syntax_credit(self):
        targets = []
        for project, version, scale in [(baseline.MERMAID, "12.2.0", 100), ("adewale/agentic-mermaid", "0.4.2", 20)]:
            negative_unavailable = project != baseline.MERMAID
            bindings = [
                {"bindingId": "positive", "source": "flowchart LR; A-->B", "expectedAccepted": True, "uniqueId": "source1", "result": {"status": "passed", "publicAccepted": True, "accepted": True, "expectedTypeMatches": True, "preludeMatches": True}},
                {"bindingId": "negative", "source": "bad", "expectedAccepted": False, "uniqueId": "source2", "result": {"status": "blocked" if negative_unavailable else "passed", "unavailable": "TypeError" if negative_unavailable else None, "publicAccepted": None if negative_unavailable else False, "syntaxRejected": not negative_unavailable, "preludeMatches": True}},
            ]
            targets.append({"project": project, "version": version, "boundary": "Node public parser", "artifact": {"target": {"project": project, "version": version}, "package": {"name": project, "version": version}, "entrySha256": "entry-receipt"}, "recordId": project, "startedAt": "start", "finishedAt": "end",
                            "functionality": {"bindings": bindings, "uniqueInvocations": 2},
                            "startup": {"caseId": "two-node", "count": 2, "samplesMs": [scale, scale], "rows": [{"status": "passed"}, {"status": "passed"}], "scope": "spawn through consumed first parse"},
                            "resources": {"rows": [{"status": "passed", "wholeWorker": {"peakRssBytes": scale}}] * 2, "scope": "whole child peak"}})
        path = self.write("parser.json", {"targets": targets, "commonQualifiedCaseIds": ["positive"], "settings": {"startupCase": {"id": "two-node"}, "startupSamples": 2, "resourceSamples": 2}})
        result, _ = baseline.parser_baseline(path)
        self.assertEqual(result["quality"][1]["statuses"], {"passed": 1, "unavailable": 1})
        cell = result["lanes"][0]["cells"][1]
        self.assertEqual((cell["ratio"], cell["status"], cell["classification"]), (.2, "unpaired-advisory", "unresolved"))
        self.assertEqual((result["commonPositiveAdmission"]["bindingCount"], result["commonPositiveAdmission"]["uniqueInvocationCount"]), (1, 1))
        targets[1]["artifact"]["package"]["version"] = "different"
        path.write_text(json.dumps({"targets": targets, "commonQualifiedCaseIds": ["positive"], "settings": {"startupCase": {"id": "two-node"}, "startupSamples": 2, "resourceSamples": 2}}))
        with self.assertRaisesRegex(ValueError, "artifact version mismatch"):
            baseline.parser_baseline(path)


if __name__ == "__main__":
    unittest.main()
