Preparation/runtime tooling failures retained:

1. Initial Bun driver attempted node:v8 deserialize on the existing Node archive; Bun 1.4.4 threw `TypeError: Unable to deserialize data`. Pinned Node v24 converted only archived input to captured-input.json. No layout executed in this attempt.
2. Initial trace captured `finishLayout` internal Component instead of public ELK result; post-render report attempted r.edges.flatMap and threw. The source load was changed to collect the public `return data` boundary. No candidate gain was inferred from that incomplete run.
3. Initial forced summary read public layout.width/height and serialized null. Actual public RenderedLayout declares bounds:{w,h}. Driver and retained per-case summaries corrected from actual bounds without rendering again. Initial forced.log remains unmodified and records null; per-case JSON is authoritative.

No rendering errors occurred in the complete forced/unforced matrix. No production files were modified.
