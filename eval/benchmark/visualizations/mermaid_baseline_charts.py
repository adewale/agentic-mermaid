"""Standalone SVG charts for an already admitted baseline report (stdlib only)."""

from html import escape
import math


def svg(title, rows, ratio=True):
    width, left, plot = 1170, 450, 485
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


def cost_svg(title, cells):
    """Positive cost dots; wide ranges use a labeled logarithmic axis."""
    width, left, plot = 1170, 450, 485
    height = 125 + 29 * len(cells)
    ratios = [cell["ratio"] for cell in cells]
    logarithmic = max(ratios) / min(ratios) > 20
    limits = [1, *ratios, *[value for cell in cells for value in (cell.get("envelope") or []) if cell["status"] == "repeatability-qualified"]]
    low = min(limits) / 1.25 if logarithmic else 0
    high = max(limits) * 1.12

    def position(value):
        fraction = math.log(value / low) / math.log(high / low) if logarithmic else value / high
        return left + plot * fraction

    if logarithmic:
        ticks = [10 ** exponent for exponent in range(math.ceil(math.log10(low)), math.floor(math.log10(high)) + 1)]
    else:
        target = high / 5
        power = 10 ** math.floor(math.log10(target))
        step = next(value * power for value in [1, 2, 2.5, 5, 10] if value * power >= target)
        ticks = [index * step for index in range(math.floor(high / step) + 1)]
    ticks = sorted(set([*ticks, 1]))
    axis = "logarithmic" if logarithmic else "linear"
    if any(cell["status"] == "repeatability-qualified" for cell in cells):
        note = "Whiskers: repeatability envelope, not a confidence interval. Tables retain all missing outcomes."
    elif any(cell["status"] == "unqualified" for cell in cells):
        note = "Hollow gray: unqualified; no repeatability decision. Tables retain all missing outcomes."
    elif all(cell["status"] in {"artifact-size", "observed-delivery-cost"} for cell in cells):
        note = "Observed artifact bytes; no engine speed claim or invented uncertainty band."
    else:
        note = "Descriptive distributions; no paired A/A speedup qualification. Tables retain all missing outcomes."
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
             '<rect width="100%" height="100%" fill="#fff"/>',
             '<style>text{font:13px system-ui,sans-serif;fill:#17212b}.title{font-size:18px;font-weight:650}.note{font-size:11px;fill:#465866}</style>',
             f'<text class="title" x="20" y="27">{escape(title)}</text>',
             f'<text class="note" x="20" y="47">Cost / Mermaid, lower is cheaper; {axis} axis. Mermaid=1.</text>',
             f'<text class="note" x="20" y="64">{escape(note)}</text>']
    for tick in ticks:
        x = position(tick)
        color = "#8d596c" if tick == 1 else "#e4e9ed"
        parts += [f'<line x1="{x:.2f}" y1="88" x2="{x:.2f}" y2="{height-14}" stroke="{color}"'+(' stroke-dasharray="4 3"' if tick == 1 else '')+'/>',
                  f'<text class="note" text-anchor="middle" x="{x:.2f}" y="82">{tick:g}</text>']
    for index, cell in enumerate(cells):
        y = 105 + index * 29
        unqualified = cell["status"] == "unqualified"
        color = "#8a939c" if unqualified else "#485ea8" if cell["tool"] == "mermaid-js/mermaid" else "#167c80"
        parts.append(f'<text x="20" y="{y+5}">{escape(cell["tool"])}</text>')
        envelope = cell.get("envelope") if cell["status"] == "repeatability-qualified" else None
        if envelope:
            start, end = [position(value) for value in envelope]
            parts += [f'<line x1="{start:.2f}" y1="{y}" x2="{end:.2f}" y2="{y}" stroke="{color}" stroke-width="2"/>',
                      f'<path d="M{start:.2f},{y-5}v10 M{end:.2f},{y-5}v10" stroke="{color}"/>']
        fill = "#fff" if unqualified else color
        parts += [f'<circle cx="{position(cell["ratio"]):.2f}" cy="{y}" r="4.5" fill="{fill}" stroke="{color}" stroke-width="2"/>',
                  f'<text x="{left+plot+18}" y="{y+5}">{cell["ratio"]:.4g}×'+(' — unqualified' if unqualified else ' — unresolved' if cell.get('classification') == 'unresolved' and cell['tool'] != 'mermaid-js/mermaid' else '')+'</text>']
    return "\n".join([*parts, "</svg>\n"])


def render_charts(report):
    charts = {}
    for dataset in report["datasets"]:
        for lane in dataset["lanes"]:
            cells = [c for c in lane["cells"] if c.get("ratio") is not None and math.isfinite(c["ratio"]) and c["ratio"] > 0]
            # Proven identical artifact aliases are shown in the table, not
            # additional independent bars or votes.
            cells = sorted((c for c in cells if not c.get("aliasOf")), key=lambda c: c["ratio"])
            if cells:
                date = " — " + dataset["startedAt"][:10] if dataset.get("startedAt") else ""
                charts[f"{dataset['id']}-{lane['id']}.svg"] = cost_svg(dataset["id"] + " / " + lane["id"] + date, cells)
        if dataset["quality"]:
            rows = sorted(dataset["quality"], key=lambda r: -r["passed"])
            charts[f"{dataset['id']}-quality.svg"] = svg(dataset["id"] + " — absolute admission/assertions", [(r["tool"], r["passed"], f"{r['passed']}/{r['population']} ({r['deltaPassedVersusMermaid']:+})") for r in rows], ratio=False)
    return charts
