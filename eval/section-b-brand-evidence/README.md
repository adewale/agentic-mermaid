# Section B visual evidence

The baseline rejects the public `roles` field, so no plausible before image exists. `baseline.mmd` and `role-style.json` are the exact committed inputs. Reproduce the causal baseline with the command retained in `evidence-receipt.json`; the expected result is an `Invalid style spec` error.

The generated after sheet renders every registered family through three ordinary inline StyleSpec records. Inspect typography, padding/radius/line-weight changes, cross-family palette coherence, and the Pie card: `Pro` remains the family-authored highlighted slice while the sentinel category binding changes its paint without changing wedge geometry.

Regenerate with `bun run gallery:section-b`; verify freshness with `bun run gallery:section-b:check`.
