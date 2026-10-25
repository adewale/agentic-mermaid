#!/usr/bin/env python3
"""Export portable benchmark evidence as four PNG/SVG/PDF figures and a gallery.

python3 charts.py --report /path/to/report.json --out /path/to/fresh/charts
Requires matplotlib. Reads observations only; never runs a benchmark or Git.
"""
from __future__ import annotations

import argparse
from html import escape
import json
import math
import os
from pathlib import Path
from statistics import median
import tempfile


COLORS = {
    "complete": "#187c6c",
    "partial": "#b77816",
    "failed": "#b93b43",
    "unmeasured": "#87929c",
}
LABELS = {
    "complete": "Declared native + painted criteria complete",
    "partial": "Partial semantic scope; see case evidence",
    "failed": "Declared checks failed in observed workers",
    "unmeasured": "No checked worker evidence",
}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def observed(values):
    return [value for value in values if finite(value)]


def criteria(case):
    if not case or not case.get("checkedWorkers"):
        return "unmeasured"
    if case.get("failedWorkers", 0):
        return "failed"
    if case.get("blockedWorkers", 0) >= case["checkedWorkers"]:
        return "unmeasured"
    return "complete" if case.get("semanticComplete") else "partial"


def family_cases(summary):
    return sorted((case for case in summary["cases"] if case["cohort"] == "family"), key=lambda case: case["family"])


def timing(summary, case_id, track):
    return next((row for row in summary["timing"] if row["caseId"] == case_id and row["track"] == track), None)


def positive_value(row, key):
    value = row.get(key) if row else None
    return value if finite(value) and value > 0 and row.get("samples", 0) > 0 else None


def decorate_y(axis, cases):
    axis.set_yticks(range(len(cases)), [case["family"] for case in cases])
    axis.invert_yaxis()
    for label, case in zip(axis.get_yticklabels(), cases):
        label.set_color(COLORS[criteria(case)])
    axis.grid(axis="x", color="#dbe1e6", linewidth=0.6)
    axis.set_axisbelow(True)


def scope_legend(figure, line_type):
    handles = [line_type([0], [0], marker="o", linestyle="none", color=color, label=LABELS[key]) for key, color in COLORS.items()]
    figure.legend(handles=handles, loc="lower center", ncol=2, fontsize=8, bbox_to_anchor=(0.5, 0.045))


def export(figure, out, stem):
    for suffix in ("png", "svg", "pdf"):
        figure.savefig(out / f"{stem}.{suffix}", dpi=180, facecolor="white")


def family_latency(summary, plt, line_type):
    cases = family_cases(summary)
    figure, axis = plt.subplots(figsize=(11, max(8, len(cases) * 0.27 + 2.5)))
    uncalibrated = 0
    missing = 0
    for index, case in enumerate(cases):
        color = COLORS[criteria(case)]
        for track, key, marker, offset in (("warm-repeat", "medianMs", "o", -0.13), ("first-use", "p95Ms", "D", 0.13)):
            row = timing(summary, case["id"], track)
            value = positive_value(row, key)
            if value is None:
                missing += 1
                continue
            calibrated = row.get("calibration", {}).get("status") == "calibrated"
            uncalibrated += not calibrated
            axis.scatter(value, index + offset, color=color if calibrated else "white", edgecolors=color, marker=marker, s=32, zorder=3)
    if cases:
        decorate_y(axis, cases)
    axis.set_xscale("log")
    axis.set_xlabel("API latency (ms, log scale); import and qualification excluded")
    axis.set_title("Family representatives: warm median and fresh-process first-use p95", loc="left", pad=17)
    figure.legend(handles=[line_type([0], [0], marker="o", color="#334354", linestyle="none", label="Warm repeated API median"), line_type([0], [0], marker="D", color="#334354", linestyle="none", label="Fresh first-use p95"), line_type([0], [0], marker="o", color="#334354", markerfacecolor="white", linestyle="none", label="Open marker: uncalibrated")], loc="upper center", ncol=3, bbox_to_anchor=(0.56, 0.965), fontsize=8)
    scope_legend(figure, line_type)
    figure.text(0.02, 0.012, f"{missing} missing timing points omitted; {uncalibrated} observed points uncalibrated. First-use p95 uses individual fresh-process calls.\nWarm samples are adaptive batch means. A representative case does not establish complete family functionality.", fontsize=8)
    figure.subplots_adjust(left=0.22, right=0.97, top=0.85, bottom=0.19)
    return figure


def scaling(summary, plt):
    rows = [row for row in summary["timing"] if row["cohort"] == "scaling"]
    families = sorted({row["family"] for row in rows})
    figure, axes = plt.subplots(1, 2, figsize=(13, 6), sharex=True)
    case_by_id = {case["id"]: case for case in summary["cases"]}
    palette = plt.get_cmap("tab10")
    omitted = 0
    incomplete = 0
    for family_index, family in enumerate(families):
        for axis, track, key in ((axes[0], "warm-repeat", "medianMs"), (axes[1], "first-use", "p95Ms")):
            selected = sorted((row for row in rows if row["family"] == family and row["track"] == track and finite(row.get("scale")) and row["scale"] > 0), key=lambda row: row["scale"])
            # Missing sizes break the curve rather than suggesting an observed interpolation.
            xs, ys = [], []
            for row in selected:
                xs.append(row["scale"])
                value = positive_value(row, key)
                ys.append(value if value is not None else float("nan"))
                omitted += value is None
                if value is not None:
                    complete = criteria(case_by_id.get(row["caseId"])) == "complete"
                    calibrated = row.get("calibration", {}).get("status") == "calibrated"
                    incomplete += not complete
                    axis.scatter(row["scale"], value, marker="o" if calibrated else "x", color=palette(family_index % 10), s=38, zorder=3)
            if xs:
                axis.plot(xs, ys, color=palette(family_index % 10), label=family, linewidth=1.3)
    for axis, title in zip(axes, ("Warm repeated API median", "Fresh-process first-use p95")):
        axis.set_xscale("log")
        axis.set_yscale("log")
        axis.set_xlabel("Authored scale parameter (log); work per unit differs by family")
        axis.set_ylabel("API latency (ms, log)")
        axis.set_title(title, loc="left")
        axis.grid(which="both", color="#e0e5e9", linewidth=0.6)
    if families:
        axes[1].legend(loc="best", fontsize=9)
    figure.suptitle("Scaling within each family", x=0.08, ha="left", fontsize=15)
    figure.text(0.04, 0.03, f"{omitted} missing points omitted; {incomplete} plotted points have partial/failed/unmeasured semantic scope. × = uncalibrated timing.\nWarm p95 (not plotted) is a percentile of adaptive batch means, not individual-call tail latency. Imports and qualification excluded.\nSizes count each fixture's authored construction parameter; equal sizes across families do not imply equal work.", fontsize=8)
    figure.subplots_adjust(left=0.08, right=0.98, top=0.86, bottom=0.24, wspace=0.28)
    return figure


def calibration(summary, plt, line_type):
    cases = family_cases(summary)
    figure, axes = plt.subplots(1, 2, figsize=(14, max(8, len(cases) * 0.28 + 2.4)), sharey=True)
    omitted = 0
    for axis, track, title in zip(axes, ("warm-repeat", "first-use"), ("Warm repeated API batch means", "Individual fresh first-use calls")):
        for index, case in enumerate(cases):
            row = timing(summary, case["id"], track)
            record = row.get("calibration", {}) if row else {}
            band = record.get("controlBand")
            if band and all(finite(band.get(key)) and band[key] > 0 for key in ("lower", "upper")):
                color = "#8fbfb5" if record.get("status") == "calibrated" else "#d9c49b"
                axis.plot([band["lower"], band["upper"]], [index, index], color=color, linewidth=8, solid_capstyle="butt", zorder=1)
            control = [value for value in observed(record.get("controlRatios", [])) if value > 0]
            replica = [value for value in observed(record.get("candidateRatios", [])) if value > 0]
            if not control and not replica:
                omitted += 1
            axis.scatter(control, [index - 0.10] * len(control), color="#53606b", marker="o", s=12, zorder=3)
            axis.scatter(replica, [index + 0.10] * len(replica), color="#7156a5", marker="^", s=18, zorder=3)
            ratio = record.get("candidateRatio")
            if finite(ratio) and ratio > 0:
                axis.scatter(ratio, index, color="#241739", marker="|", s=95, zorder=4)
        axis.axvline(1, color="#7f8c96", linestyle="--", linewidth=0.8)
        axis.set_xscale("log")
        axis.set_xlabel("Observed time ratio (log); 1 = equal measured time")
        axis.set_title(title, loc="left")
        axis.grid(axis="x", color="#e0e5e9", linewidth=0.6)
    if cases:
        decorate_y(axes[0], cases)
    figure.suptitle("Same-artifact A/A/B calibration — variation, not product improvement", x=0.02, ha="left", fontsize=14)
    figure.legend(handles=[line_type([0], [0], color="#8fbfb5", linewidth=7, label="Observed reciprocal A/A band; calibrated"), line_type([0], [0], color="#d9c49b", linewidth=7, label="Observed A/A band; uncalibrated"), line_type([0], [0], marker="o", linestyle="none", color="#53606b", label="Round A1 / A0"), line_type([0], [0], marker="^", linestyle="none", color="#7156a5", label="Round B / √(A0 × A1)"), line_type([0], [0], marker="|", linestyle="none", color="#241739", label="Median B ratio")], loc="lower center", ncol=3, bbox_to_anchor=(0.5, 0.055), fontsize=8)
    figure.text(0.02, 0.015, f"{omitted} case/track ratio sets unavailable and omitted. Each replica uses the same admitted artifact. Bands are observed ranges, not confidence intervals.\nThis panel covers family representatives only. Full case/track calibration and gaps remain in report.json; a ratio outside its A/A band is advisory.", fontsize=8)
    figure.subplots_adjust(left=0.16, right=0.94, top=0.89, bottom=0.20, wspace=0.12)
    return figure


def memory(summary, plt, line_type):
    cases = family_cases(summary)
    figure, axes = plt.subplots(1, 3, figsize=(15, max(8, len(cases) * 0.28 + 2.4)), sharey=True)
    missing = [0, 0, 0]
    for index, case in enumerate(cases):
        resources = [row for row in summary["resources"] if row["caseId"] == case["id"]]
        groups = [
            observed([row.get("apiReturnDelta", {}).get("rss") for row in resources]),
            observed([row.get("retainedDelta", {}).get("heapUsed") for row in resources if row.get("gcAvailable")]),
            observed([(row.get("wholeWorker") or {}).get("peakRssBytes") for row in resources]),
        ]
        for column, (axis, values, divisor) in enumerate(zip(axes, groups, (1048576, 1024, 1048576))):
            if not values:
                missing[column] += 1
                continue
            values = [value / divisor for value in values]
            color = COLORS[criteria(case)]
            axis.plot([min(values), max(values)], [index, index], color=color, linewidth=1, zorder=2)
            axis.scatter(median(values), index, color=color, s=24, zorder=3)
    if cases:
        decorate_y(axes[0], cases)
    for axis, title, xlabel, count in zip(axes, ("API-return RSS change", "Post-GC retained JS heap change", "Whole-worker peak RSS"), ("Signed change from pre-call RSS (MiB)", "Signed change from pre-call heap (KiB)", "Absolute process high-water RSS (MiB)"), missing):
        axis.set_title(title, loc="left", fontsize=11)
        axis.set_xlabel(xlabel, fontsize=9)
        axis.axvline(0, color="#7f8c96", linestyle="--", linewidth=0.8)
        axis.grid(axis="x", color="#e0e5e9", linewidth=0.6)
        axis.text(0.02, -0.10, f"{count} families without observed values", transform=axis.transAxes, fontsize=8)
    figure.suptitle("Memory: API snapshots and separately scoped worker peaks", x=0.02, ha="left", fontsize=15)
    scope_legend(figure, line_type)
    figure.text(0.02, 0.012, "Dots = observed round medians; lines = observed min–max, not confidence intervals. Signed deltas are not clamped. Post-GC points require GC availability.\nAPI snapshots precede qualification; retained heap follows output release and requested GC. Independent import-only baselines are not subtracted here.\nWhole-worker peaks include runtime, import, driver, GC and qualification; they are not API-only peaks, live heap, PSS, native/GPU accounting or leak proof.", fontsize=8)
    figure.subplots_adjust(left=0.15, right=0.98, top=0.89, bottom=0.24, wspace=0.20)
    return figure


FIGURES = (
    ("family-latency", "Family representative latency", "Warm repeated API median and fresh-process first-use p95. Color describes declared semantic evidence, while open markers identify uncalibrated timing. Missing observations are omitted."),
    ("scaling", "Within-family scaling", "Warm medians and first-use p95 across authored sizes. Scale units are fixture-specific. Equal scales across families do not imply equal work."),
    ("calibration", "Same-artifact calibration", "A0, A1 and B use the same admitted artifact. Ratios diagnose variation and cannot establish a product improvement. Observed control bands are not confidence intervals."),
    ("memory", "Memory with separate measurement scopes", "Signed API-return RSS changes and post-GC retained JS heap changes share no peak-memory claim. Whole-worker GNU time peaks include import, runtime, driver, GC and qualification."),
)


def gallery(report, out):
    summary = report["summary"]
    counts = summary["counts"]
    blocks = []
    for stem, title, description in FIGURES:
        links = " · ".join(f'<a href="{stem}.{suffix}">{suffix.upper()}</a>' for suffix in ("png", "svg", "pdf"))
        blocks.append(f'<section><h2>{escape(title)}</h2><p>{escape(description)}</p><p>{links}</p><img src="{stem}.svg" alt="{escape(title)}"></section>')
    scopes = []
    for case in summary["cases"]:
        scope = "; ".join(case.get("unmeasuredScopes", [])) or ("Declared native + painted checks complete" if case.get("semanticComplete") else "See raw case evidence")
        label = LABELS[criteria(case)] if case.get("expectedAccepted") else "Negative-source acceptance/rejection checks only"
        scopes.append(f'<tr><td>{escape(case["id"])}</td><td>{escape(label)}</td><td>{case.get("failedWorkers", 0)} / {case.get("blockedWorkers", 0)}</td><td>{escape(scope)}</td></tr>')
    title = f'{report["project"]} {report["version"]}: benchmark observations'
    document = f'''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{escape(title)}</title><style>
body{{max-width:1280px;margin:2rem auto;padding:0 1rem;font:16px/1.55 system-ui,sans-serif;color:#213140;background:#fff}}
h1,h2{{line-height:1.2}}section{{margin:3rem 0}}img{{display:block;width:100%;height:auto}}a{{color:#075d9c}}table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{padding:.6rem;text-align:left;border-bottom:1px solid #dae1e7;vertical-align:top}}.scroll{{overflow-x:auto}}
</style><body><h1>{escape(title)}</h1>
<p>Measured {escape(report["startedAt"])} through {escape(report["finishedAt"])}. {'Retained measurements reused; no new clocks.' if report.get('reused') else 'Fresh retained measurements.'}</p>
<p>{counts['cases']} cases; {counts['families']} family representatives; {counts['failedWorkers']} failed and {counts['blockedWorkers']} blocked workers. {counts['calibratedTimingRows']}/{counts['totalTimingRows']} timing rows calibrated. Declared native + painted criteria complete for {counts['completeSemanticCases']}/{counts['positiveCases']} positive cases.</p>
<p>Acceptance, declared semantic evidence and timing calibration are separate observations. Partial semantic coverage is not a failed tool. These representatives do not exercise every feature of each family. Raw report.json and worker evidence remain authoritative.</p>
{''.join(blocks)}
<section><h2>Case scope and gaps</h2><p>Failed and blocked counts describe workers, not tool-level scores. Unmeasured scopes are not silently counted as passing fidelity checks.</p><div class="scroll"><table><thead><tr><th>Case</th><th>Declared evidence</th><th>Failed / blocked workers</th><th>Unmeasured scopes</th></tr></thead><tbody>{''.join(scopes)}</tbody></table></div></section>
<p>Dollar costs are not plotted: CPU counters need an explicit rate and coarse zero counters are censored; model costs require actual transcript and dated price evidence. See the report for available cost evidence.</p>
</body></html>'''
    (out / "index.html").write_text(document, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--report", required=True, type=Path, help="Completed portable report.json")
    parser.add_argument("--out", required=True, type=Path, help="Fresh output directory; existing directories are refused")
    options = parser.parse_args()
    report = json.loads(options.report.read_text(encoding="utf-8"))
    summary = report.get("summary")
    if report.get("schemaVersion") != 1 or not isinstance(summary, dict) or not all(isinstance(summary.get(key), list) for key in ("cases", "timing", "familyTimings", "resources")):
        parser.error("Expected portable report schemaVersion 1 with cases, timing, familyTimings and resources")
    if options.out.exists():
        parser.error("Output directory already exists; choose a fresh directory")
    os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "mermaid-benchmark-matplotlib"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.lines import Line2D
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "pdf.fonttype": 42, "svg.fonttype": "path"})
    options.out.mkdir(parents=True, exist_ok=False)
    for stem, builder in (("family-latency", lambda: family_latency(summary, plt, Line2D)), ("scaling", lambda: scaling(summary, plt)), ("calibration", lambda: calibration(summary, plt, Line2D)), ("memory", lambda: memory(summary, plt, Line2D))):
        figure = builder()
        export(figure, options.out, stem)
        plt.close(figure)
    gallery(report, options.out)
    print(f"Wrote four PNG/SVG/PDF figures and index.html to {options.out}")


if __name__ == "__main__":
    main()
