# Official Python MCP SDK probe against both agentic-mermaid servers.
# Run from the repo root (see the plan doc's multi-client section):
#   bun run scripts/interop/serve-hosted.ts   # note the printed URL
#   uv run --with 'mcp==1.28.1' scripts/interop/probe-python.py <hosted-url>
# To probe the latest SDK as a compatibility canary instead:
#   uv run --refresh-package mcp --with mcp scripts/interop/probe-python.py <hosted-url>
# Probes the hosted Streamable HTTP endpoint and the local stdio bin with the
# reference Python client, printing one PASS/FAIL line per check and exiting
# nonzero on any failure or if the combined probe exceeds two minutes.
# WIRE lines contain method/status/version and session-header presence only,
# never URLs, source/tool arguments, credentials, or session ID values.

import asyncio
import json
import sys
from importlib.metadata import version
from pathlib import Path

from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

from mcp import ClientSession, StdioServerParameters

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


async def server_protocol_versions() -> dict[str, list[str]]:
    # Read the same authorities as the servers, not another copied version list.
    process = await asyncio.create_subprocess_exec(
        "bun", "-e",
        "import { SUPPORTED_PROTOCOL_VERSIONS as hosted } from './src/mcp/hosted-server.ts';"
        "import { STDIO_PROTOCOL_VERSIONS as stdio } from './src/mcp/server.ts';"
        "console.log(JSON.stringify({hosted, stdio}))",
        cwd=REPO_ROOT,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await process.communicate()
    finally:
        if process.returncode is None:
            process.kill()
            await process.wait()
    if process.returncode:
        raise RuntimeError(f"Cannot read server protocol versions: {stderr.decode()}")
    return json.loads(stdout)


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(label)


async def probe_hosted(url: str, supported_versions: list[str]) -> None:
    wire: list[dict] = []
    requests: dict[int, dict] = {}

    async def on_request(request) -> None:
        entry = {
            "method": request.method,
            "protocol_version": request.headers.get("mcp-protocol-version"),
            "session_id_present": "mcp-session-id" in request.headers,
        }
        if request.method == "POST":
            payload = json.loads(await request.aread())
            entry["rpc_method"] = payload.get("method")
            if payload.get("method") == "initialize":
                entry["offered_version"] = payload.get("params", {}).get("protocolVersion")
        wire.append(entry)
        requests[id(request)] = entry

    async def on_response(response) -> None:
        entry = requests[id(response.request)]
        entry["status"] = response.status_code
        entry["response_session_id_present"] = "mcp-session-id" in response.headers

    # Hooks observe the SDK's actual transport, not a separately invented GET.
    try:
        # Use the SDK's own HTTP client and redirect/timeout policy. SDK 1 uses
        # httpx; SDK 2 uses httpx2 and yields two streams instead of three.
        async with create_mcp_http_client() as client:
            client.event_hooks["request"].append(on_request)
            client.event_hooks["response"].append(on_response)
            async with streamable_http_client(url, http_client=client) as streams:
                read, write = streams[:2]
                async with ClientSession(read, write) as session:
                    init = (await session.initialize()).model_dump(by_alias=True)
                    negotiated = init["protocolVersion"]
                    check("hosted: initialize completes", True, f"negotiated {negotiated}")
                    check("hosted: server identity", init["serverInfo"]["name"] == "agentic-mermaid-hosted", init["serverInfo"]["name"])
                    initialization = [entry for entry in wire if entry.get("rpc_method") == "initialize"]
                    check(
                        "hosted: sessionless (no session id issued)",
                        bool(initialization) and all(entry.get("response_session_id_present") is False for entry in initialization),
                        "observed response header presence only; no session values logged",
                    )
                    tools = await session.list_tools()
                    names = sorted(tool.name for tool in tools.tools)
                    check("hosted: exact 9-tool surface", names == HOSTED_TOOL_NAMES, ",".join(names))
                    rendered = await session.call_tool("render_svg", {"source": FLOW})
                    text = rendered.content[0].text if rendered.content else ""
                    check("hosted: render_svg round-trip", "<svg" in text, f"{len(text)} bytes")
                    # A followed redirect remains in WIRE, but only the final
                    # successful exchange proves the server accepted the tool.
                    tool_requests = [entry for entry in wire if entry.get("rpc_method") in ("tools/list", "tools/call") and entry.get("status") == 200]
                    check(
                        "hosted: supported negotiated version accepted on tool requests",
                        negotiated in supported_versions
                        and {entry["rpc_method"] for entry in tool_requests} == {"tools/list", "tools/call"}
                        and all(entry["protocol_version"] == negotiated for entry in tool_requests),
                        negotiated,
                    )
    finally:
        for entry in wire:
            print("WIRE " + json.dumps(entry, sort_keys=True))
        gets = [entry for entry in wire if entry["method"] == "GET"]
        observed_405 = any(entry.get("status") == 405 for entry in gets)
        print(f"INFO hosted: SDK GET requests={len(gets)}; GET->405 observed={observed_405}")
        if not gets:
            print("INFO hosted: GET->405 client handling was not exercised")


async def probe_stdio(supported_versions: list[str]) -> None:
    params = StdioServerParameters(command="bun", args=["run", "src/mcp/mcp-bin.ts"], cwd=str(REPO_ROOT))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = (await session.initialize()).model_dump(by_alias=True)
            negotiated = init["protocolVersion"]
            check("stdio: initialize completes", True, f"negotiated {negotiated}")
            check("stdio: negotiated version is server-supported", negotiated in supported_versions, negotiated)
            tools = await session.list_tools()
            names = sorted(tool.name for tool in tools.tools)
            check("stdio: exact 4-tool surface", names == LOCAL_TOOL_NAMES, ",".join(names))
            executed = await session.call_tool("execute", {"code": "return 1 + 41"})
            text = executed.content[0].text if executed.content else ""
            value = json.loads(text).get("value") if text else None
            check("stdio: real sandbox execute", value == 42, text[:80])


async def main() -> None:
    print(f"python-sdk version: {version('mcp')}")
    supported = await server_protocol_versions()
    await probe_hosted(sys.argv[1], supported["hosted"])
    await probe_stdio(supported["stdio"])


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
