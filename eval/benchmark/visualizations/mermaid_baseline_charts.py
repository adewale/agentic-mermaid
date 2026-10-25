"""Standalone SVG charts for an already admitted baseline report (stdlib only)."""

from html import escape
import math


def svg(title, rows, ratio=True):
    width, left, plot = 1100, 470, 540
    height = 95 + 29 * len(rows)
    values = [row[1] for row in rows]
    maximum = max([1, *values])
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
             '<rect width="100%" height="100%" fill="#fff"/>',
             '<style>text{font:13px system-ui,sans-serif;fill:#17212b}.title{font-size:18px;font-weight:650}.note{font-size:11px;fill:#465866}</style>',
             f'<text class="title" x="20" y="28">{escape(title)}</text>',
             '<text class="note" x="20" y="49">Cost / Mermaid; lower is cheaper. Separate boundaries; advisory unless controls qualify.</text>' if ratio else '<text class="note" x="20" y="49">Absolute passed counts; unavailable and unsuccessful cases remain in the denominator.</text>']
    if ratio:
        x = left + plot / maximum
        parts += [f'<line x1="{x:.2f}" y1="60" x2="{x:.2f}" y2="{height-15}" stroke="#8d596c" stroke-dasharray="4 3"/>']
    for i, (label, value, suffix) in enumerate(rows):
        y = 66 + i * 29
        color = "#485ea8" if label == "mermaid-js/mermaid" else "#167c80"
        parts += [f'<text x="20" y="{y+15}">{escape(label)}</text>',
                  f'<rect x="{left}" y="{y}" width="{plot*value/maximum:.2f}" height="19" fill="{color}"/>',
                  f'<text x="{left+plot*value/maximum+7:.2f}" y="{y+15}">{escape(suffix)}</text>']
    return "\n".join([*parts, "</svg>\n"])


def render_charts(report):
    charts = {}
    for dataset in report["datasets"]:
        for lane in dataset["lanes"]:
            cells = [c for c in lane["cells"] if c.get("ratio") is not None and math.isfinite(c["ratio"]) and c["status"] != "unqualified"]
            # Proven identical artifact aliases are shown in the table, not
            # additional independent bars or votes.
            cells = sorted((c for c in cells if not c.get("aliasOf")), key=lambda c: c["ratio"])
            if cells:
                charts[f"{dataset['id']}-{lane['id']}.svg"] = svg(lane["id"], [(c["tool"], c["ratio"], f"{c['ratio']:.3f}×") for c in cells])
        if dataset["quality"]:
            rows = sorted(dataset["quality"], key=lambda r: -r["passed"])
            charts[f"{dataset['id']}-quality.svg"] = svg(dataset["id"] + " — absolute admission/assertions", [(r["tool"], r["passed"], f"{r['passed']}/{r['population']} ({r['deltaPassedVersusMermaid']:+})") for r in rows], ratio=False)
    return charts
