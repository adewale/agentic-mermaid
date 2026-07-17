# Official Python MCP SDK probe against both agentic-mermaid servers.
# Run from the repo root (see the plan doc's multi-client section):
#   bun run scripts/interop/serve-hosted.ts   # note the printed URL
#   uv run --with mcp scripts/interop/probe-python.py <hosted-url>
# Probes the hosted Streamable HTTP endpoint and the local stdio bin with the
# reference Python client, printing one PASS/FAIL line per check and exiting
# nonzero on any failure.

import asyncio
import json
import sys
from pathlib import Path

import mcp
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamablehttp_client

REPO_ROOT = Path(__file__).resolve().parents[2]
FLOW = "flowchart LR\n  A --> B"
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
            check("hosted: 9-tool surface", len(names) == 9, ",".join(names))
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
            check("stdio: 4-tool surface", len(names) == 4, ",".join(names))
            executed = await session.call_tool("execute", {"code": "return 1 + 41"})
            text = executed.content[0].text if executed.content else ""
            value = json.loads(text).get("value") if text else None
            check("stdio: real sandbox execute", value == 42, text[:80])


async def main() -> None:
    print(f"python-sdk version: {mcp.__version__ if hasattr(mcp, '__version__') else 'unknown'}")
    await probe_hosted(sys.argv[1])
    await probe_stdio()


asyncio.run(main())
if failures:
    sys.exit(1)
