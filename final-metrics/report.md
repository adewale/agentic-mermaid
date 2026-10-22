# Final-head geometry comparison

Base: `009159f93e6cea53f97ca53e416cf66b130c8e49`  
Candidate: `646100e475dd1f85b3e8b4513f8545ebb4dd7e37`

Command: `bun run eval/endpoint-marker/compare.ts BASE_CHECKOUT HEAD_CHECKOUT OUT_DIR` after building both clean revisions with `bun x tsup`. `build-provenance.json` records the measured entry hashes.

35/35 Architecture inputs measured; 185 routes, 370 shaft endpoints and 253 marker checks. Every per-input metric is non-increasing, meaning is preserved, and candidate contact/certificate contracts pass.

| Metric | Before | After |
| --- | ---: | ---: |
| routes | 185 | 185 |
| endpointChecks | 370 | 370 |
| markerChecks | 253 | 253 |
| crossings | 4 | 4 |
| bends | 84 | 84 |
| maxBendsPerEdge | 2 | 2 |
| hitches | 0 | 0 |
| clearLaneHitches | 0 | 0 |
| offOutlineEndpoints | 185 | 0 |
| offOutlineMarkers | 171 | 0 |
| unverifiedMarkerBodies | 70 | 0 |
| labelOverlaps | 0 | 0 |
| labelPillConflicts | 0 | 0 |
| routeCertificateFindings | 185 | 0 |
| paintCertificateFindings | 78 | 16 |
| placementConflicts | 0 | 0 |
| unverifiedPaint | 9 | 8 |
| unmeasuredPaint | 0 | 0 |
| maxShaftErrorPx | 6 | 0 |
| maxMarkerErrorPx | 6 | 0 |

840 corpus entries enrolled: 704 successful on both revisions, 136 explicit refusals. Unrelated families have identical SVG, public geometry and certificates; no lost renders. All 11 generated visual control PNG/SVG pairs are also byte-identical.

The 16 candidate paint warnings are the unchanged conservative attached-marker occlusion warnings in eight custom 3px-stroke fixtures. Actual marker contacts survive clipping; independent viewport/tangent checks verify visible bodies outside the attached filled shapes. Full issues remain in metrics.json. This does not change the native verifier status or prove arbitrary-font behavior.
