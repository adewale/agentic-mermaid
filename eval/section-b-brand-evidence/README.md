# Section B visual evidence

The baseline rejects the public `roles` field, so no plausible before image exists. `baseline.mmd` and `role-style.json` are the exact committed inputs. Reproduce the causal baseline with the command retained in `evidence-receipt.json`; the expected result is an `Invalid style spec` error.

The generated after sheet renders every registered family through one deliberately distinctive sentinel and three holdout inline StyleSpec records. Every cell uses the public native PNG API; the receipt also hashes no-color Unicode output for the same family×style matrix. Inspect typography, padding/radius/line-weight changes, cross-family palette coherence, and the Pie card: `Pro` remains the family-authored highlighted slice while the sentinel category binding changes its paint without changing wedge geometry. The manual native-size review and deployed-website comparison are recorded by `visual-approval.json` and `production-comparison.md`.

Approval is intentionally separate from generation: run `bun run gallery:section-b` to create a candidate, inspect all 60 cells at native size, update `visual-approval.json` with the candidate SHA-256 and audit path, then rerun the command to refresh the receipt. `bun run gallery:section-b:check` verifies source/font freshness, output bytes, and that the approval names those exact bytes.
