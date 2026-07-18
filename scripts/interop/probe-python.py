# Official Python MCP SDK probe against both agentic-mermaid servers.
# Run from the repo root (see the plan doc's multi-client section):
#   bun run scripts/interop/serve-hosted.ts   # note the printed URL
#   uv run --with 'mcp==1.28.1' scripts/interop/probe-python.py <hosted-url>
# To probe the latest SDK as a compatibility canary instead:
#   uv run --with mcp scripts/interop/probe-python.py <hosted-url>
# Probes the hosted Streamable HTTP endpoint and the local stdio bin with the
# reference Python client, printing one PASS/FAIL line per check and exiting
# nonzero on any failure or if the combined probe exceeds two minutes.

import asyncio
import json
import sys
from importlib.metadata import version
from pathlib import Path

import mcp
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

REPO_ROOT = Path(__file__).resolve().parents[2]
FLOW = "flowchart LR\n  A --> B"
TIMEOUT_SECONDS = 120
HOSTED_TOOL_NAMES = [
    "build",
    "describe",
    "describe_sdk",
    "execute",
    "mutate",
    "render_ascii",
    "render_png",
    "render_svg",
    "verify",
]
LOCAL_TOOL_NAMES = ["describe", "describe_sdk", "execute", "render_png"]
failures = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


async def probe_hosted(url: str) -> None:
    async with streamablehttp_client(url) as (read, write, get_session_id):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            check("hosted: initialize completes", True, f"negotiated {init.protocolVersion}")
            check(
                "hosted: negotiated version is server-supported",
                init.protocolVersion in ("2024-11-05", "2025-03-26", "2025-06-18"),
                init.protocolVersion,
            )
            check("hosted: server identity", init.serverInfo.name == "agentic-mermaid-hosted", init.serverInfo.name)
            check("hosted: sessionless (no session id issued)", get_session_id() is None, str(get_session_id()))
            tools = await session.list_tools()
            names = sorted(tool.name for tool in tools.tools)
            check("hosted: exact 9-tool surface", names == HOSTED_TOOL_NAMES, ",".join(names))
            rendered = await session.call_tool("render_svg", {"source": FLOW})
            text = rendered.content[0].text if rendered.content else ""
            check("hosted: render_svg round-trip", "<svg" in text, f"{len(text)} bytes")


async def probe_stdio() -> None:
    params = StdioServerParameters(command="bun", args=["run", "src/mcp/mcp-bin.ts"], cwd=str(REPO_ROOT))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            check("stdio: initialize completes", True, f"negotiated {init.protocolVersion}")
            check("stdio: negotiates the pinned 2024-11-05", init.protocolVersion == "2024-11-05", init.protocolVersion)
            tools = await session.list_tools()
            names = sorted(tool.name for tool in tools.tools)
            check("stdio: exact 4-tool surface", names == LOCAL_TOOL_NAMES, ",".join(names))
            executed = await session.call_tool("execute", {"code": "return 1 + 41"})
            text = executed.content[0].text if executed.content else ""
            value = json.loads(text).get("value") if text else None
            check("stdio: real sandbox execute", value == 42, text[:80])


async def main() -> None:
    print(f"python-sdk version: {version('mcp')}")
    await probe_hosted(sys.argv[1])
    await probe_stdio()


async def run_with_timeout() -> None:
    try:
        await asyncio.wait_for(main(), timeout=TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        check("combined probe timeout", False, f"exceeded {TIMEOUT_SECONDS}s")


if len(sys.argv) != 2:
    print("usage: probe-python.py <hosted-mcp-url>")
    sys.exit(2)

asyncio.run(run_with_timeout())
if failures:
    sys.exit(1)
