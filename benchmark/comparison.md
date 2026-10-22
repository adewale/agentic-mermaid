# Final-head benchmark comparison

Base: `009159f93e6cea53f97ca53e416cf66b130c8e49`  
Candidate: `646100e475dd1f85b3e8b4513f8545ebb4dd7e37`

Node 24.22.1; 566 enrolled inputs; 402 matched successful official examples. Three interleaved paired rounds, five timing repetitions. The 135 unsupported/refused official examples remain explicit in the raw report.

| Metric | Before | After | Paired change |
| --- | ---: | ---: | ---: |
| corpus | 1460.30 ms | 1521.52 ms | +0.4% |
| architecture | 52.59 ms | 55.22 ms | -0.9% |
| architecture:16-junctions | 19.04 ms | 18.72 ms | -1.7% |
| architecture:32-junctions | 33.16 ms | 31.71 ms | -4.1% |
| architecture:32-large-junctions | 33.22 ms | 34.53 ms | +1.6% |
| passAllocatedBytes | 1258.10 MiB | 1248.95 MiB | -0.7% |
| peakRssBytes | 354.17 MiB | 351.87 MiB | -0.6% |
| retainedGrowthBytes | 4.67 MiB | 3.86 MiB | -17.5% |

Times are medians of observed matched passes. Paired changes are the median within-round ratios, so they need not equal the ratio of the displayed medians. Allocation is the fresh-process whole-pass V8 estimate used by the gate; RSS includes worker import and warm-up.

17/17 gates passed; 0 failed. See report.md for all family/workload results, report.json for measurements, samples.jsonl for raw observations and build-provenance.json for measured package/entry identities.

This run establishes performance within the declared budgets on these inputs. It does not prove exact timing equality or universal geometry correctness.
