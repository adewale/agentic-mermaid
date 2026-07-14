# Publishing agentic-mermaid to the MCP registries

Owner-runnable steps to list the hosted MCP endpoint (`https://agentic-mermaid.dev/mcp`)
in the official MCP Registry and the secondary directories. The listing metadata is
`server.json` in this directory — remotes-only (the registry hosts metadata, not
artifacts, and a `remotes`-only entry needs no npm package), name
`dev.agentic-mermaid/mcp` in the domain-verified namespace, version pinned to the
repo's package version (bump both together when releasing).

All commands below were checked against the registry's live docs
(<https://github.com/modelcontextprotocol/registry>, `docs/modelcontextprotocol-io/`
and `docs/reference/cli/commands.md`) as of 2026-07.

## 1. Install `mcp-publisher`

```bash
brew install mcp-publisher
# or the pre-built binary:
curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz mcp-publisher && sudo mv mcp-publisher /usr/local/bin/
```

## 2. Prove ownership of `agentic-mermaid.dev` (DNS TXT)

The `dev.agentic-mermaid/*` namespace requires domain-based auth. Generate an
Ed25519 keypair and derive the TXT record (requires OpenSSL 3 — macOS's system
LibreSSL lacks Ed25519 in `genpkey`; `brew install openssl@3` and call it
explicitly):

```bash
openssl genpkey -algorithm Ed25519 -out key.pem
PUBLIC_KEY="$(openssl pkey -in key.pem -pubout -outform DER | tail -c 32 | base64)"
echo "agentic-mermaid.dev. IN TXT \"v=MCPv1; k=ed25519; p=${PUBLIC_KEY}\""
```

Add the printed TXT record in the Cloudflare DNS dashboard. Record shape:

```text
agentic-mermaid.dev.  IN  TXT  "v=MCPv1; k=ed25519; p=<base64 public key>"
```

Two gotchas from the registry docs: the record goes on the **apex**
(`agentic-mermaid.dev`), not under a selector like `_mcp-auth.` — SPF-style
placement, not DKIM-style; and if you ever rotate keys, delete the old TXT
record, since a stale one is tried first and fails verification. Keep `key.pem`
somewhere safe — you need it for every future publish (version bumps).

After the record propagates, extract the key hex to a file rather than an
environment variable or inline substitution — key material in a shell variable
lands in shell history, `ps` output, and secret-scanner findings:

```bash
openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n' > key.hex
chmod 600 key.hex
mcp-publisher login dns --domain agentic-mermaid.dev --private-key "$(cat key.hex)"
shred -u key.hex   # or rm; key.pem remains the durable copy
```

(Equivalent alternative if DNS is inconvenient: first add a generated static
asset at `/.well-known/mcp-registry-auth` containing
`v=MCPv1; k=ed25519; p=<base64>`, deploy it, and then run
`mcp-publisher login http`. That optional auth asset is not published by the
current site.)

## 3. Validate and publish

```bash
cd website/source/mcp-registry
mcp-publisher validate   # exhaustive offline check of ./server.json
mcp-publisher publish    # publishes ./server.json to registry.modelcontextprotocol.io
```

Confirm the listing:

```bash
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=agentic-mermaid"
```

Re-run `login` + `publish` with a bumped `version` in `server.json` on each
release; the registry rejects version ranges, so keep it an exact semver equal
to the repo's package version.

## 4. Secondary directories

- **PulseMCP** — no action needed once the official registry entry is live:
  PulseMCP ingests the official registry daily and processes entries weekly, so
  the listing appears after it has been in the official registry for about a
  week (per <https://www.pulsemcp.com/submit>). For expedited listing or
  corrections, email <hello@pulsemcp.com> with the site or repo URL.
- **Glama** — sign in at <https://glama.ai> and use the Add Server flow at
  <https://glama.ai/mcp/servers/add> (submit the GitHub repository URL); once
  listed, use the claim flow on the server page to mark it owner-verified. The
  add flow is behind a login, so the exact form fields could not be verified
  from the docs — follow the form.
- **Smithery** — go to <https://smithery.ai/new>, enter the public HTTPS URL
  `https://agentic-mermaid.dev/mcp`, and complete the publishing flow. Smithery
  scans the server to extract tool metadata; if the scan is blocked (e.g. by the
  WAF rate limit), it falls back to
  `https://agentic-mermaid.dev/.well-known/mcp/server-card.json`, which this
  site already serves.
