"""Validate actual artifact release receipts before composing benchmark reports.

This module does not execute a tool or modify evidence. Callers provide owning
artifact receipts, not versions inferred from chart labels or observed timings.
"""
from pathlib import Path
import json


DEFAULT_MANIFEST = Path(__file__).with_name("tool-versions.json")
TOOL_ALIASES = {
    "agentic": "adewale/agentic-mermaid",
    "agentic-mermaid": "adewale/agentic-mermaid",
    "pele": "obsidianmd/pele",
    "mermaid": "mermaid-js/mermaid",
}


def _text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Missing actual artifact " + field)
    return value.strip()


def _project(value):
    value = _text(value, "tool")
    if value.startswith("npm:"):
        value = value[4:]
    if "/" in value and not value.startswith("@"):
        value = value.lower()
    return TOOL_ALIASES.get(value, value)


def read_tool_versions(manifest_path=None):
    path = Path(manifest_path) if manifest_path is not None else DEFAULT_MANIFEST
    manifest = json.loads(path.read_text())
    if not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int or manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("tools"), dict) or not manifest["tools"]:
        raise ValueError("Invalid tool version manifest: " + str(path))
    tools = {}
    for tool, pin in manifest["tools"].items():
        tool = _project(tool)
        if not isinstance(pin, dict):
            raise ValueError("Invalid version pin for " + tool)
        version = _text(pin.get("version"), "version pin for " + tool)
        if tool in tools:
            raise ValueError("Repeated canonical tool pin: " + tool)
        tools[tool] = {**pin, "version": version}
    return {"schemaVersion": 1, "tools": tools}


def canonical_tool(tool, manifest=None):
    tool = _project(tool)
    for project, pin in (manifest or {}).get("tools", {}).items():
        if pin.get("package") == tool:
            return project
    return tool


def assert_tool_versions(claims, manifest_path=None):
    """Return deduplicated canonical claims, or reject a mixed/missing release.

    Each claim has tool/version/source and optionally an explicitly declared
    variant. Pins apply to every variant. A variant never bypasses a pin, and
    callers must not invent variants to conceal conflicting release receipts.
    """
    manifest = read_tool_versions(manifest_path)
    groups = {}
    for claim in claims:
        if not isinstance(claim, dict):
            raise ValueError("Artifact version claim must be an object")
        tool = canonical_tool(claim.get("tool"), manifest)
        source = _text(claim.get("source"), "version receipt source for " + tool)
        version = _text(claim.get("version"), "version for " + tool + " at " + source)
        variant = claim.get("variant")
        if variant is not None:
            variant = _text(variant, "explicit variant for " + tool)
            if variant in ("candidate", "default"):
                variant = None
        key = (tool, variant)
        existing = groups.get(key)
        if existing and existing["version"] != version:
            raise ValueError(f"Mixed tool versions for {tool}{' / ' + variant if variant else ''}: {existing['version']} at {existing['sources']} versus {version} at {source}")
        if existing:
            if source not in existing["sources"]:
                existing["sources"].append(source)
        else:
            groups[key] = {"tool": tool, "version": version, "source": source, "sources": [source], **({"variant": variant} if variant else {})}
    # Check after collecting so mixed receipts report both owning paths, even
    # when one of the conflicting releases also differs from the active pin.
    for (tool, _variant), claim in groups.items():
        pin = manifest["tools"].get(tool)
        if pin and claim["version"] != pin["version"]:
            raise ValueError(f"Tool version pin mismatch for {tool}: expected {pin['version']}, observed {claim['version']} at {claim['sources']}")
    return sorted(groups.values(), key=lambda claim: (claim["tool"], claim.get("variant", "")))
