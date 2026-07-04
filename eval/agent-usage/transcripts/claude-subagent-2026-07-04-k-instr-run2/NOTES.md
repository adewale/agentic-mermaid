# Run notes

Arm: `--surface instructions`, knowledge-proof cases, one of 3 runs. Result: 2/2,
safePathRate 1.0 — canonical serialization achieved as a verified fixed
point and the stray-end input correctly handled via declared
source-level fallback after asSequence returned null.

Part of the four-surface knowledge-case matrix (none / homepage /
instructions / skill, 3 runs each, same dispatch harness). All three
doc-bearing surfaces scored 6/6 with safePathRate 1.0; the isolated
no-docs baseline scored 3/6. Mean subagent tokens per case: homepage
~28.8k, instructions ~33.8k, skill ~35.9k — equal outcome, the compact
prompt was the cheapest surface. Single-model harness; n=3 per arm
supports direction, not fine magnitudes.
