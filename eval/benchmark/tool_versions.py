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


def _name(value):
    value = _text(value, "tool")
    if value.startswith("npm:"):
        value = value[4:]
    if "/" in value and not value.startswith("@"):
        value = value.lower()
    return value


def _resolve(value, aliases):
    value = _name(value)
    seen = []
    while value in aliases:
        if value in seen:
            raise ValueError("Cyclic tool aliases: " + " -> ".join([*seen, value]))
        seen.append(value)
        value = _name(aliases[value])
    return value


def _project(value):
    return _resolve(value, TOOL_ALIASES)


def read_tool_versions(manifest_path=None):
    path = Path(manifest_path) if manifest_path is not None else DEFAULT_MANIFEST
    manifest = json.loads(path.read_text())
    if not isinstance(manifest, dict) or type(manifest.get("schemaVersion")) is not int or manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("tools"), dict) or not manifest["tools"]:
        raise ValueError("Invalid tool version manifest: " + str(path))
    declared_aliases = manifest.get("aliases", {})
    if not isinstance(declared_aliases, dict):
        raise ValueError("Tool aliases must be an explicit ownership mapping")
    aliases = dict(TOOL_ALIASES)
    normalized = {}
    for alias, target in declared_aliases.items():
        alias, target = _name(alias), _name(target)
        if alias in normalized and normalized[alias] != target:
            raise ValueError("Conflicting normalized tool alias: " + alias)
        normalized[alias] = target
        aliases[alias] = target
    for alias in aliases:
        _resolve(alias, aliases)
    for alias in TOOL_ALIASES:
        if _resolve(alias, aliases) != _project(alias):
            raise ValueError("Conflicting established tool alias: " + alias)
    tools = {}
    for tool, pin in manifest["tools"].items():
        tool = _resolve(tool, aliases)
        if not isinstance(pin, dict):
            raise ValueError("Invalid version pin for " + tool)
        version = _text(pin.get("version"), "version pin for " + tool)
        if tool in tools:
            raise ValueError("Repeated canonical tool pin: " + tool)
        tools[tool] = {**pin, "version": version}
    packages = {}
    for tool, pin in tools.items():
        package = pin.get("package")
        if package is None:
            continue
        package = _name(package)
        resolved = _resolve(package, aliases)
        if resolved != package and resolved != tool:
            raise ValueError("Package alias conflicts with owning tool: " + package)
        if package in packages and packages[package] != tool:
            raise ValueError("Package has conflicting tool owners: " + package)
        packages[package] = tool
    return {"schemaVersion": 1, "tools": tools, "aliases": {alias: _resolve(alias, aliases) for alias in aliases}}


def canonical_tool(tool, manifest=None):
    tool = _resolve(tool, {**TOOL_ALIASES, **(manifest or {}).get("aliases", {})})
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
