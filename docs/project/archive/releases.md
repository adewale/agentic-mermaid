# Verified releases

Completed deliveries are recorded below. Follow the
[release checklist](../../contributing/releasing.md) when adding an entry.
Source preparation alone does not establish publication or deployment.

## 0.5.6 — 2026-11-02

- [Release v0.5.6](https://github.com/adewale/agentic-mermaid/releases/tag/v0.5.6)
  points to `a66282d831c0b9d677a5a92b3be48d9ea9b35d19`.
- [Canonical CI](https://github.com/adewale/agentic-mermaid/actions/runs/41463134976)
  passed on that exact main commit, including unit shards, semantic conformance,
  browser comparisons, installed quickstarts and packed consumers.
- [Publication](https://github.com/adewale/agentic-mermaid/actions/runs/41466325272)
  passed macOS Intel and Windows rendering checks, verified one tarball and
  published npm plus the active MCP Registry record
  `io.github.adewale/agentic-mermaid@0.5.6`. Public npm metadata and the `latest`
  tag both resolve to 0.5.6; the Registry job verified the same package integrity
  before publication.
- A fresh Node 24.19.0 consumer installed the public npm tarball and passed all
  six documented JS/TS examples and CLI SVG/PNG/ASCII exports. Additional checks
  passed SVG, PNG and resolved-scene rendering with ELK and strict Agentic;
  editing, verification and serialization; deferred native PNG initialization;
  single-read action options; typed artwork refusals; CLI aliases; offline agent
  instructions; and `init-agent` output with a version-pinned MCP configuration.
  Installed stdio MCP discovery, Code Mode rendering and typed error read-back
  passed. The downloaded tarball matched npm's SHA-512 integrity; its SHA-256 is
  `8cd34af7bf7b457f8e636c99b64ee476268f02dbdd2ec5f75727cb96ace25e4f`.
- [Production deployment](https://github.com/adewale/agentic-mermaid/actions/runs/41468285879)
  completed at 15:14 UTC. Browser artifacts matched the public npm package
  byte-for-byte. Zero-traffic website and full MCP probes passed before promotion;
  production identity, live verify/execute and website checks passed after
  promotion to 100% traffic. This was an actual deployment. The workspace network
  policy blocked direct website and Registry reads; their public checks ran in
  the publication and deployment workflows.

AGENT-1 is delivered in 0.5.6: one maintained operating guide supplies offline
CLI instructions and the repo-local agent workflow. AGENT-2 remains deferred
to 0.6.0. This release keeps the layout repair order and resource/quality limits;
mathematical labels remain research only.

## 0.5.5 — 2026-10-31

- [Release v0.5.5](https://github.com/adewale/agentic-mermaid/releases/tag/v0.5.5)
  points to `e165cff16d53bfa7b8fea1a6704282a99a96ec68`.
- [Canonical CI](https://github.com/adewale/agentic-mermaid/actions/runs/41212294422)
  passed on that exact main commit, including unit shards, semantic conformance,
  browser comparisons, installed quickstarts and packed consumers.
- [Publication](https://github.com/adewale/agentic-mermaid/actions/runs/41213616825)
  passed macOS Intel and Windows rendering checks, verified one tarball and
  published npm plus the MCP Registry record
  `io.github.adewale/agentic-mermaid@0.5.5`. npm accepted the upload before the
  version became publicly readable. Retrying only the failed MCP job after
  public availability completed publication using the retained artifact.
- A fresh Node 24.19.0 consumer installed npm 0.5.5 and passed SVG, PNG and
  resolved-scene rendering with ELK and strict Agentic; terminal output; typed
  editing, verification and serialization; extreme XY ranges; and typed artwork
  refusals. CLI aliases, capabilities and Markdown verification passed. The
  installed stdio MCP passed resolved-scene discovery, Code Mode rendering and
  typed error read-back. The downloaded tarball matched npm's SHA-512 integrity;
  its SHA-256 is
  `dd1cc5dd119ed66d15ab4095e90623b63cc686caa90ecbdbb38bf5e76c3dffd2`.
  Direct workflow-artifact download was blocked by the workspace network policy;
  the workflow itself verified the transferred tarball before publication.
- [Production deployment](https://github.com/adewale/agentic-mermaid/actions/runs/41214591346)
  verified this commit at 100% traffic by 15:30 GMT. Browser artifacts matched
  the published package. Zero-traffic website and full MCP probes passed before
  promotion; production identity, live verify/execute and website checks passed
  after promotion. This was an actual deployment, not a skipped green run.

AGENT-3 is delivered in 0.5.5: resolved-scene discovery, Code Mode access and
stable typed artwork failures are released and verified. AGENT-1/2 remain
assigned to 0.6.0. Mathematical labels remain research only; this release does
not change the 25-pass layout order or its resource/quality limits.

## 0.5.4 — 2026-10-30

- [Release v0.5.4](https://github.com/adewale/agentic-mermaid/releases/tag/v0.5.4)
  points to `83744a4e1ae5c9d3821ba8a283811367fd31eade`.
- [Canonical CI](https://github.com/adewale/agentic-mermaid/actions/runs/40992077656)
  passed on that exact main commit.
- [Publication](https://github.com/adewale/agentic-mermaid/actions/runs/40993548242)
  passed macOS Intel and Windows rendering checks and published npm plus the
  MCP Registry record `io.github.adewale/agentic-mermaid@0.5.4`. npm processing
  delayed public reads; retrying only the failed MCP job completed publication.
- A fresh Node 24.19.0 consumer installed npm 0.5.4 and passed CLI capabilities,
  SVG/ASCII rendering, PNG signature and certified SVG checks with both ELK
  and strict Agentic. The downloaded npm tarball matched the workflow artifact's
  SHA-256: `9622a3d3c4081b24d9a2af0d9eaf8ce66a2a1b6c1552ece91ee6e0cf9f78523a`.
- [Production deployment](https://github.com/adewale/agentic-mermaid/actions/runs/40994851812)
  verified the same commit at 100% traffic at 03:07 GMT. The candidate passed
  74 website checks and 44 MCP checks; production passed 73 website checks
  plus build-identity and live verify/execute probes. Browser artifacts matched
  the published package byte-for-byte.

REL-1's 0.5.4 publication/delivery work is complete. Native-layout qualification
and AGENT-1/2/3 remain assigned to 0.6.0 in `TODO.md`; this release does not
establish broader performance superiority or remove documented export limits.
