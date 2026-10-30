# Verified releases

Record completion after package publication and production verification.
Source preparation alone is not a completed release. Dated evidence below
does not claim to describe a later deployment.

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
