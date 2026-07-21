#!/usr/bin/env python3
"""Canonical generator executed only inside the pinned Linux toolchain."""

import json
import platform
import sys
from pathlib import Path

import brotli
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont


def cmap(path: Path) -> set[int]:
    font = TTFont(path, lazy=False)
    try:
        return {codepoint for table in font["cmap"].tables if table.isUnicode() for codepoint in table.cmap}
    finally:
        font.close()


def probe_codepoints(strings: list[str]) -> list[int]:
    return sorted({ord(character) for value in strings for character in value})


def labels(codepoints: list[int]) -> list[str]:
    return [f"U+{codepoint:04X}" for codepoint in codepoints]


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: subset-website-inter-fonts.py POLICY_JSON OUTPUT_DIRECTORY")
    policy_path = Path(sys.argv[1])
    output_directory = Path(sys.argv[2])
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    output_directory.mkdir(parents=True, exist_ok=False)

    covered = probe_codepoints(policy["probes"]["covered"])
    full_only = probe_codepoints(policy["probes"]["fullOnly"])
    unbundled = probe_codepoints(policy["probes"]["unbundled"])
    coverage = []

    for face in policy["faces"]:
        source = Path("/work/assets/fonts") / face["file"]
        if source.parent != Path("/work/assets/fonts") or not source.is_file():
            raise RuntimeError(f"invalid source font {face['file']}")
        output = output_directory / face["file"].replace(".ttf", ".woff2")
        subset.main([
            str(source),
            f"--output-file={output}",
            *policy["arguments"],
            f"--unicodes={','.join(policy['unicodeRanges'])}",
        ])

        source_cmap = cmap(source)
        subset_cmap = cmap(output)
        missing_source = [point for point in covered + full_only if point not in source_cmap]
        missing_subset = [point for point in covered if point not in subset_cmap]
        leaked_full_only = [point for point in full_only if point in subset_cmap]
        bundled_unbundled = [point for point in unbundled if point in source_cmap or point in subset_cmap]
        if missing_source:
            raise RuntimeError(f"{face['file']} source misses {labels(missing_source)}")
        if missing_subset:
            raise RuntimeError(f"{face['file']} subset misses {labels(missing_subset)}")
        if leaked_full_only:
            raise RuntimeError(f"{face['file']} subset contains full-only {labels(leaked_full_only)}")
        if bundled_unbundled:
            raise RuntimeError(f"{face['file']} unexpectedly bundles {labels(bundled_unbundled)}")
        coverage.append({
            "source": face["file"],
            "covered": labels(covered),
            "fullOnly": labels(full_only),
            "unbundled": labels(unbundled),
        })

    (output_directory / "coverage.json").write_text(json.dumps(coverage, indent=2) + "\n", encoding="utf-8")
    (output_directory / "toolchain.json").write_text(json.dumps({
        "python": platform.python_version(),
        "fonttools": fontTools.__version__,
        "brotli": brotli.__version__,
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
