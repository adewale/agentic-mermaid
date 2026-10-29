Arrowhead evidence for PR #585

See receipt.json for renderer revisions, raster scale, crop coordinates and limitations. inputs.json contains the exact source/options for each before/after pair. All SVG and PNG pairs use those same inputs.

Run `RENDERER_ROOT=/path/to/checkout OUTPUT_DIR=/tmp/rendered bun render-evidence.ts before` (use `after` at the head revision) at each recorded renderer revision with its installed dependencies. Compare full SVGs for context. The montage crops the attachment point of the connector named in each input.

The timing probe used 5 warmups then 15 samples per fixture and reports median and maximum sample (labelled p95). A subsequent performance observation recorded 0 warm ELK layout misses and 0 layout fallbacks per fixture at both revisions. These small sequential measurements establish no general speedup.
