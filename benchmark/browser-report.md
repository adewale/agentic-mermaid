# Browser and competitor scorecard (advisory)

1095/1095 upstream fence occurrences, 546 distinct examples across 34 pages. Chromium 145.0.7632.6; 3 counterbalanced rounds.

| Engine | Returns SVG in every round | Median all-attempt call time | Complete bundle gzip |
|---|---:|---:|---:|
| candidate 0.4.2 | 823/1095 | 2716.8 ms | 1147.2 KiB |
| baseline 0.4.2 | 823/1095 | 2750.0 ms | 1147.1 KiB |
| pele 1.6.0 | 1063/1095 | 127.8 ms | 246.9 KiB |
| mermaid 12.2.0 | 1061/1095 | 16940.3 ms | 1534.1 KiB |

All-attempt totals include rejections and are not a speed score. Ratios below exclude failures in either engine across any round.

| Comparator | Shared successes | Candidate / comparator, by round | Median ratio |
|---|---:|---|---:|
| baseline | 823 | 0.90 / 0.99 / 1.04 | 0.99× |
| pele | 823 | 30.44 / 33.18 / 22.51 | 30.44× |
| mermaid | 821 | 0.18 / 0.19 / 0.20 | 0.19× |

## First-round failures

| Engine | Unsupported | Asset/environment | Other render errors |
|---|---:|---:|---:|
| candidate | 270 | 0 | 2 |
| baseline | 270 | 0 | 2 |
| pele | 32 | 0 | 0 |
| mermaid | 32 | 2 | 0 |

## Candidate/baseline lazy delivery

| Engine | Initial JS gzip / requests | Through first flow gzip / requests |
|---|---:|---:|
| candidate | 5.4 KiB / 4 | 259.3 KiB / 31 |
| baseline | 5.4 KiB / 4 | 259.2 KiB / 31 |

Bundled focused SVG ESM consumer (Bun 1.4.2): **929.2 KiB gzip**. This excludes optional sketch backends, terminal output and typed editing; it is a consumer build from the installed tarball, not a second shipped IIFE. The complete-bundle comparison above retains the full API.

| Engine | Focused SVG consumer raw | Focused SVG consumer gzip |
|---|---:|---:|
| candidate | 3027.5 KiB | 929.2 KiB |
| baseline | 3027.3 KiB | 929.1 KiB |

Acceptance means returned SVG, not semantic or visual fidelity. Complete bundles are measured separately from lazy delivery; an unloaded loader is not a usable renderer. Cold lazy timings include localhost module fetches and are diagnostic, not network or paint benchmarks. Remote images/fonts are blocked and failures remain in the denominator. Full failures, per-round samples, fetched module paths, compression sizes and package identities accompany this report. No competitor threshold gates publication.
