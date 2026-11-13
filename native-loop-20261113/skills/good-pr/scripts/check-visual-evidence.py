#!/usr/bin/env python3
"""Lint mechanical properties of visual evidence in a PR description.

This dependency-free check does not judge pixels, causality, receipts, fixtures,
or whether evidence is proportionate. Those remain review decisions described by
the good-pr skill.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse


VISUAL_HEADING_RE = re.compile(
    r"^(#{2,6})\s+(?:visual(?:\s+evidence|s)?|screenshots?"
    r"(?:\s*/\s*recordings?)?|recordings?)(?:\s*/[^\n]+)?\s*$",
    re.IGNORECASE | re.MULTILINE,
)
ANY_HEADING_RE = re.compile(r"^(#{1,6})\s+.+$", re.MULTILINE)
FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
MARKDOWN_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)")
REFERENCE_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\[([^\]]*)\]")
SHORTCUT_IMAGE_RE = re.compile(r"!\[([^\]]+)\](?![\[(])")
REFERENCE_DEFINITION_RE = re.compile(
    r"^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]+)>|(\S+))(?:[ \t]+[^\n]+)?$",
    re.MULTILINE,
)
HTML_MEDIA_RE = re.compile(r"<(img|video)\b([^>]*)>", re.IGNORECASE)
HTML_ATTRIBUTE_RE = re.compile(r"([:\w-]+)\s*=\s*([\"'])(.*?)\2", re.DOTALL)
ATTACHMENT_URL_PATTERN = r"https://github\.com/user-attachments/assets/[A-Za-z0-9-]+"
MARKDOWN_ATTACHMENT_LINK_RE = re.compile(
    rf"(?<!!)\[([^\]]+)\]\(({ATTACHMENT_URL_PATTERN})\)", re.IGNORECASE
)
BARE_ATTACHMENT_RE = re.compile(ATTACHMENT_URL_PATTERN, re.IGNORECASE)
MALFORMED_URL_RE = re.compile(r"\(\s*``https?://|https?://[^\s)]+``\s*\)", re.IGNORECASE)
BASELINE_SHA_RE = re.compile(
    r"\b(?:base|baseline)(?:\s+(?:commit|sha))?\s*(?::|=|is|at)?\s*`?([0-9a-f]{7,40})`?\b",
    re.IGNORECASE,
)
CURRENT_SHA_RE = re.compile(
    r"\b(?:current|head)(?:\s+(?:commit|sha))?\s*(?::|=|is|at)?\s*`?([0-9a-f]{7,40})`?\b",
    re.IGNORECASE,
)
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)


@dataclass(frozen=True)
class Media:
    alt: str
    url: str
    source: str


@dataclass(frozen=True)
class Finding:
    level: str
    code: str
    message: str


def read_body(path: str) -> str:
    if path == "-":
        return sys.stdin.read()
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise SystemExit(f"cannot read PR body {path!r}: {exc}") from exc


def markdown_views(text: str) -> tuple[str, str]:
    """Return block-filtered and fully rendered-ish Markdown views.

    Fenced/indented code and HTML comments are removed from both views. Inline
    code is retained in the first view for malformed-image diagnostics and
    removed from the second so examples cannot count as media.
    """
    block: list[str] = []
    rendered: list[str] = []
    fence: tuple[str, int] | None = None
    in_comment = False
    inline_ticks = 0

    for line in text.splitlines(keepends=True):
        newline = "\n" if line.endswith("\n") else ""
        fence_match = FENCE_RE.match(line)
        if fence:
            if fence_match:
                marker, remainder = fence_match.groups()
                if marker[0] == fence[0] and len(marker) >= fence[1] and not remainder.strip():
                    fence = None
            block.append(newline)
            rendered.append(newline)
            continue
        if not in_comment and not inline_ticks and fence_match:
            marker, remainder = fence_match.groups()
            if marker[0] == "~" or "`" not in remainder:
                fence = marker[0], len(marker)
                block.append(newline)
                rendered.append(newline)
                continue
        if not in_comment and not inline_ticks and (line.startswith("    ") or line.startswith("\t")):
            block.append(newline)
            rendered.append(newline)
            continue

        block_line: list[str] = []
        rendered_line: list[str] = []
        index = 0
        while index < len(line):
            if in_comment:
                end = line.find("-->", index)
                if end < 0:
                    padding = len(line) - index - len(newline)
                    block_line.append(" " * max(padding, 0) + newline)
                    rendered_line.append(" " * max(padding, 0) + newline)
                    index = len(line)
                    continue
                width = end + 3 - index
                block_line.append(" " * width)
                rendered_line.append(" " * width)
                index = end + 3
                in_comment = False
                continue
            if inline_ticks:
                delimiter = "`" * inline_ticks
                end = line.find(delimiter, index)
                if end < 0:
                    segment = line[index:]
                    block_line.append(segment)
                    rendered_line.append("\n" if segment.endswith("\n") else " " * len(segment))
                    index = len(line)
                    continue
                segment = line[index : end + inline_ticks]
                block_line.append(segment)
                rendered_line.append(" " * len(segment))
                index = end + inline_ticks
                inline_ticks = 0
                continue
            if line.startswith("<!--", index):
                in_comment = True
                continue
            if line[index] == "`":
                end = index
                while end < len(line) and line[end] == "`":
                    end += 1
                inline_ticks = end - index
                delimiter = line[index:end]
                block_line.append(delimiter)
                rendered_line.append(" " * len(delimiter))
                index = end
                continue
            block_line.append(line[index])
            rendered_line.append(line[index])
            index += 1
        block.append("".join(block_line))
        rendered.append("".join(rendered_line))
    return "".join(block), "".join(rendered)


def visual_sections(body: str) -> list[str]:
    sections: list[str] = []
    headings = list(ANY_HEADING_RE.finditer(body))
    for index, heading in enumerate(headings):
        if not VISUAL_HEADING_RE.fullmatch(heading.group(0)):
            continue
        level = len(heading.group(1))
        end = len(body)
        for later in headings[index + 1 :]:
            if len(later.group(1)) <= level:
                end = later.start()
                break
        sections.append(body[heading.start() : end].strip())
    return sections


def reference_definitions(body: str) -> dict[str, str]:
    return {
        match.group(1).strip().casefold(): (match.group(2) or match.group(3)).strip()
        for match in REFERENCE_DEFINITION_RE.finditer(body)
    }


def extract_media(text: str, definitions: dict[str, str]) -> list[Media]:
    media = [
        Media(match.group(1).strip(), match.group(2).strip(), "markdown")
        for match in MARKDOWN_IMAGE_RE.finditer(text)
    ]
    for match in REFERENCE_IMAGE_RE.finditer(text):
        label = match.group(2).strip() or match.group(1).strip()
        url = definitions.get(label.casefold())
        if url:
            media.append(Media(match.group(1).strip(), url, "reference"))
    for match in SHORTCUT_IMAGE_RE.finditer(text):
        url = definitions.get(match.group(1).strip().casefold())
        if url:
            media.append(Media(match.group(1).strip(), url, "reference"))
    for match in HTML_MEDIA_RE.finditer(text):
        attributes = {
            key.casefold(): value.strip()
            for key, _, value in HTML_ATTRIBUTE_RE.findall(match.group(2))
        }
        if attributes.get("src"):
            media.append(
                Media(
                    attributes.get("alt", attributes.get("aria-label", "")),
                    attributes["src"],
                    match.group(1).casefold(),
                )
            )
    known_urls = {item.url for item in media}
    for match in MARKDOWN_ATTACHMENT_LINK_RE.finditer(text):
        if match.group(2) not in known_urls:
            media.append(Media(match.group(1).strip(), match.group(2), "attachment"))
            known_urls.add(match.group(2))
    for match in BARE_ATTACHMENT_RE.finditer(text):
        if match.group(0) not in known_urls:
            media.append(Media("", match.group(0), "attachment"))
            known_urls.add(match.group(0))
    return media


def github_ref(url: str) -> tuple[bool, str | None]:
    parsed = urlparse(url)
    parts = [part for part in parsed.path.split("/") if part]
    host = parsed.netloc.casefold()
    if host == "raw.githubusercontent.com" and len(parts) >= 3:
        return True, parts[2]
    if host == "github.com" and len(parts) >= 5 and parts[2] in {"blob", "raw"}:
        return True, parts[3]
    if not parsed.scheme and not parsed.netloc:
        return True, None
    return False, None


def same_commit_ref(left: str, right: str) -> bool:
    left, right = left.casefold(), right.casefold()
    return left.startswith(right) or right.startswith(left)


def audit(
    body: str,
    requested_kind: str,
    fallback_kind: str = "none",
    *,
    expected_base_sha: str | None = None,
    expected_current_sha: str | None = None,
) -> dict:
    block_body, rendered_body = markdown_views(body)
    rendered_sections = visual_sections(rendered_body)
    block_sections = visual_sections(block_body)
    evidence = "\n\n".join(rendered_sections)
    diagnostic_evidence = "\n\n".join(block_sections)
    definitions = reference_definitions(rendered_body)
    media = extract_media(evidence, definitions)
    all_media = extract_media(rendered_body, definitions)
    kind = (
        ("ui" if rendered_sections or all_media else fallback_kind)
        if requested_kind == "auto"
        else requested_kind
    )
    findings: list[Finding] = []

    def add(level: str, code: str, message: str) -> None:
        findings.append(Finding(level, code, message))

    if kind in {"ui", "generated"}:
        if rendered_sections:
            add("pass", "visual-section", "Dedicated visual-evidence section found.")
        else:
            add("error", "visual-section", "Add a dedicated Visual evidence or Screenshots section.")
        if media:
            add("pass", "visual-assets", f"Found {len(media)} embedded visual asset(s).")
        elif all_media:
            add("error", "visual-assets", "Move embedded visual assets into the dedicated visual-evidence section.")
        else:
            add("error", "visual-assets", "Embed at least one screenshot, recording, or rendered artifact.")

    if MALFORMED_URL_RE.search(diagnostic_evidence):
        add("error", "markdown-image-url", "An image URL is wrapped in doubled backticks and may not render.")

    if media:
        missing_alt = sum(not item.alt.strip() for item in media)
        if missing_alt:
            add("warning", "alt-text", f"{missing_alt} asset(s) have missing alt/link text.")
        else:
            add("pass", "alt-text", "Every embedded asset has alt or link text.")

    unpinned: list[str] = []
    external_generated = 0
    uploaded_generated = 0
    repository_hosted = 0
    unsupported_schemes = 0
    for item in media:
        parsed = urlparse(item.url)
        scheme = parsed.scheme.casefold()
        if scheme not in {"", "http", "https"}:
            unsupported_schemes += 1
            continue
        hosted, ref = github_ref(item.url)
        if hosted:
            repository_hosted += 1
            if ref is None or not FULL_SHA_RE.fullmatch(ref):
                unpinned.append(item.url)
        elif kind == "generated" and parsed.netloc.casefold() in {
            "github.com", "user-images.githubusercontent.com", "private-user-images.githubusercontent.com"
        }:
            uploaded_generated += 1
        elif kind == "generated" and (scheme in {"http", "https"} or parsed.netloc):
            external_generated += 1
    if unsupported_schemes:
        add(
            "error",
            "unsupported-url-scheme",
            f"{unsupported_schemes} asset(s) use URL schemes that GitHub cannot review as embedded evidence.",
        )
    if repository_hosted and not unpinned:
        add("pass", "immutable-urls", "Repository-hosted URLs use full commit SHAs.")
    elif unpinned:
        add(
            "error" if kind == "generated" else "warning",
            "immutable-urls",
            f"{len(unpinned)} repository-hosted asset(s) use mutable or relative refs.",
        )
    if uploaded_generated:
        add("warning", "generated-upload-provenance", f"{uploaded_generated} generated asset(s) are uploaded attachments.")
    if external_generated:
        add("warning", "external-url-provenance", f"{external_generated} generated asset(s) use unverified external URLs.")

    if kind == "generated":
        base = BASELINE_SHA_RE.search(diagnostic_evidence)
        current = CURRENT_SHA_RE.search(diagnostic_evidence)
        if not base:
            add("error", "baseline-provenance", "Add a labelled base/baseline SHA.")
        elif expected_base_sha and not same_commit_ref(base.group(1), expected_base_sha):
            add("error", "baseline-provenance", "The labelled baseline SHA differs from the supplied merge-base.")
        else:
            suffix = " and matches the supplied merge-base" if expected_base_sha else " (shape only; direct mode is not repository-bound)"
            add("pass", "baseline-provenance", f"A labelled baseline SHA is present{suffix}.")
        if not current:
            add("error", "current-provenance", "Add a labelled current/head SHA.")
        elif expected_current_sha and not same_commit_ref(current.group(1), expected_current_sha):
            add("error", "current-provenance", "The labelled current SHA differs from the supplied HEAD.")
        else:
            suffix = " and matches the supplied HEAD" if expected_current_sha else " (shape only; direct mode is not repository-bound)"
            add("pass", "current-provenance", f"A labelled current SHA is present{suffix}.")
        if base and current and same_commit_ref(base.group(1), current.group(1)):
            add("error", "distinct-revisions", "Baseline and current labels identify the same revision.")

    errors = sum(item.level == "error" for item in findings)
    warnings = sum(item.level == "warning" for item in findings)
    return {
        "status": "fail" if errors else "warn" if warnings else "pass",
        "kind": kind,
        "media_count": len(media),
        "errors": errors,
        "warnings": warnings,
        "findings": [asdict(item) for item in findings],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("body_file", nargs="?", default="-", help="PR description Markdown; default: stdin")
    parser.add_argument("--kind", choices=("auto", "ui", "generated", "none"), default="auto")
    parser.add_argument("--fallback-kind", choices=("ui", "none"), default="none")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    parser.add_argument("--expected-base-sha")
    parser.add_argument("--expected-current-sha")
    parser.add_argument("--strict", action="store_true", help="return non-zero for warnings")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = audit(
        read_body(args.body_file),
        args.kind,
        args.fallback_kind,
        expected_base_sha=args.expected_base_sha,
        expected_current_sha=args.expected_current_sha,
    )
    if args.format == "json":
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Visual Evidence Lint ({result['kind']})")
        print("=" * 30)
        symbols = {"pass": "✓", "warning": "⚠", "error": "✗"}
        for finding in result["findings"]:
            print(f"{symbols[finding['level']]}  {finding['code']}: {finding['message']}")
        if not result["findings"]:
            print("✓  No mechanical visual-evidence checks apply.")
        print(f"\nResult: {result['status'].upper()} ({result['errors']} error(s), {result['warnings']} warning(s))")
    return 1 if result["errors"] or (args.strict and result["warnings"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())

