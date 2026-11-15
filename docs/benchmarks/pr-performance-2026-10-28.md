# Historical PR performance ordering — 28 October 2026

This is retained historical evidence from the frozen 27–28 October campaign. It does not rank current AM main or current PR heads. [Ownership and reproduction](campaign-2026-10-28.md). Original producer identities and missing observations remain unchanged.

These are frozen 27 October heads measured on 28 October, not current active-PR scores. Three paired rounds, six fixed inputs across five families; actual metric participation is retained in the source protocol. Lower ratios mean lower observed cost. A/A decision bands include a 3% practical floor and are observed variation, not confidence intervals. An ordinal position does not establish a statistically distinct winner.

Frozen main: `cd5dfe4a84ddd7b88e987b3f90045b042c8792ca`. All 54 core jobs finished by 2026-10-28T06:54:26.836Z, before the known 13:13 UTC interference window.

[Compact metric/commit evidence](https://github.com/adewale/trident/blob/a91a354f04fae37a73d6748fafbd4b9a7d756224/docs/evidence/campaign-2026-10-28/pr-metrics.json) · [Campaign overview](https://github.com/adewale/trident/blob/a91a354f04fae37a73d6748fafbd4b9a7d756224/docs/campaign-results-2026-10-28.md)

## Exact measured targets

| Target | PR head | Measured source | Role | Reused renderer evidence |
| --- | --- | --- | --- | --- |
| main | cd5dfe4a84ddd7b88e987b3f90045b042c8792ca | cd5dfe4a84ddd7b88e987b3f90045b042c8792ca | main | main |
| pr-374 | 2ed20a17e3234f77bb82f15d1291638c6f5fff6e | 2ed20a17e3234f77bb82f15d1291638c6f5fff6e | conflicting-head | pr-374 |
| base-374 | 8a49c285b4c8dea42a9dc663226184c6ffb97659 | 8a49c285b4c8dea42a9dc663226184c6ffb97659 | branch-base | base-374 |
| pr-553 | 63ca3a9b646da7026aba9cb259263b11167ae95f | a5f6676385ae5f74b8c5e7413c332cc09ab40d45 | integrated | main |
| pr-547 | fb57360fe16e2c95cbea2b7ae2432a73a17bc920 | fb57360fe16e2c95cbea2b7ae2432a73a17bc920 | conflicting-head | pr-547 |
| base-547 | 7411848ef8ca91f0841f1244401f4d0cd47daed5 | 7411848ef8ca91f0841f1244401f4d0cd47daed5 | branch-base | base-547 |
| pr-545 | 8f04d52a4a4654230e4570a67c293e4dcfe7597e | ff0af9fb99336c7e743178bee86e5800467ce99b | integrated | pr-545 |
| pr-543 | 439eb19f5316af7153737b4ef3c859e731cfc0ba | d6cbb31662cf5e960a399b2d3e40ca4aededa922 | integrated | pr-543 |
| pr-542 | 54f0e8d4386d2e0b88076f5322fa3ce64643f884 | 54f0e8d4386d2e0b88076f5322fa3ce64643f884 | conflicting-head | pr-542 |
| base-542 | 415ee88f785c883e09ec1640b509f4dc5a57432a | 415ee88f785c883e09ec1640b509f4dc5a57432a | branch-base | base-542 |
| pr-541 | 65e6555c1f624a321457501b87aeaf3469f2e523 | cb147a6eed0e98b998fff2669c4aa7fd5ac5b5a9 | integrated | pr-541 |
| pr-536 | cfd58df8ab8c21ce76eb46556296a7439f231bbf | 48a5c41b30edb85334513ff4d477711c4f72849c | integrated | pr-536 |
| pr-449 | 795b2b4c62b595cc904802aa25aaafe8ae54df62 | 795b2b4c62b595cc904802aa25aaafe8ae54df62 | conflicting-head | pr-449 |
| base-449 | 7411848ef8ca91f0841f1244401f4d0cd47daed5 | 7411848ef8ca91f0841f1244401f4d0cd47daed5 | branch-base | base-547 |
| pr-393 | 7c891e1857633cbb9de0c5768ed233e148a1bf1b | 5c9eaf5c78e7c63069b17110399ac00feaab35d4 | integrated | main |

## Integrated targets versus frozen main

Documentation-only #553 and #393 reuse main renderer evidence. They are listed above and omitted from the ordering below to avoid counting one result three times. PNG and PNG-with-receipt portfolios are unavailable; they receive no rank.

### Result-cache flag 0

1 = explicit repeated-input result reuse;0 = result-cache flag off; other default caches retain artifact policy

#### cold

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.927 | 0.922–1.085 | within observed variation |
| 2 | main | 1.000 | 0.889–1.125 | within observed variation |
| 3 | pr-536 | 1.010 | 0.939–1.065 | within observed variation |
| 4 | pr-541 | 1.073 | 0.955–1.047 | higher observed cost |
| 5 | pr-543 | 1.083 | 0.889–1.125 | within observed variation |

#### import

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.904 | 0.822–1.217 | within observed variation |
| 2 | main | 1.000 | 0.822–1.217 | within observed variation |
| 3 | pr-543 | 1.005 | 0.894–1.118 | within observed variation |
| 4 | pr-536 | 1.039 | 0.911–1.098 | within observed variation |
| 5 | pr-541 | 1.122 | 0.891–1.123 | within observed variation |

#### firstSvg

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.925 | 0.921–1.085 | within observed variation |
| 2 | pr-536 | 0.993 | 0.911–1.098 | within observed variation |
| 3 | main | 1.000 | 0.886–1.128 | within observed variation |
| 4 | pr-541 | 1.050 | 0.938–1.067 | within observed variation |
| 5 | pr-543 | 1.127 | 0.886–1.128 | within observed variation |

#### svg

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-536 | 0.965 | 0.814–1.229 | within observed variation |
| 2 | pr-545 | 0.969 | 0.857–1.166 | within observed variation |
| 3 | pr-541 | 0.979 | 0.853–1.172 | within observed variation |
| 4 | main | 1.000 | 0.814–1.229 | within observed variation |
| 5 | pr-543 | 1.002 | 0.899–1.112 | within observed variation |

#### svgReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.963 | 0.920–1.087 | within observed variation |
| 2 | pr-536 | 0.996 | 0.851–1.175 | within observed variation |
| 3 | main | 1.000 | 0.851–1.175 | within observed variation |
| 4 | pr-543 | 1.003 | 0.856–1.168 | within observed variation |
| 5 | pr-541 | 1.030 | 0.906–1.104 | within observed variation |

#### ascii

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.961 | 0.903–1.107 | within observed variation |
| 2 | main | 1.000 | 0.903–1.107 | within observed variation |
| 3 | pr-536 | 1.007 | 0.923–1.084 | within observed variation |
| 4 | pr-541 | 1.022 | 0.948–1.055 | within observed variation |
| 5 | pr-543 | 1.027 | 0.959–1.043 | within observed variation |

#### asciiReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-536 | 0.971 | 0.928–1.078 | within observed variation |
| 2 | pr-545 | 0.987 | 0.906–1.103 | within observed variation |
| 3 | main | 1.000 | 0.862–1.161 | within observed variation |
| 4 | pr-543 | 1.011 | 0.970–1.030 | within observed variation |
| 5 | pr-541 | 1.024 | 0.862–1.161 | within observed variation |

#### unicode

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-536 | 0.943 | 0.938–1.066 | within observed variation |
| 2 | pr-545 | 0.958 | 0.895–1.117 | within observed variation |
| 3 | main | 1.000 | 0.895–1.117 | within observed variation |
| 4 | pr-541 | 1.002 | 0.898–1.113 | within observed variation |
| 5 | pr-543 | 1.036 | 0.970–1.030 | higher observed cost |

#### unicodeReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.953 | 0.876–1.141 | within observed variation |
| 2 | pr-536 | 0.982 | 0.894–1.118 | within observed variation |
| 3 | pr-541 | 0.999 | 0.921–1.085 | within observed variation |
| 4 | main | 1.000 | 0.876–1.141 | within observed variation |
| 5 | pr-543 | 1.004 | 0.938–1.066 | within observed variation |

#### agent

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-543 | 0.862 | 0.820–1.220 | within observed variation |
| 2 | pr-545 | 0.890 | 0.729–1.371 | within observed variation |
| 3 | pr-536 | 0.975 | 0.810–1.235 | within observed variation |
| 4 | main | 1.000 | 0.729–1.371 | within observed variation |
| 5 | pr-541 | 1.058 | 0.783–1.277 | within observed variation |

#### layoutReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-541 | 0.946 | 0.866–1.155 | within observed variation |
| 2 | pr-543 | 0.993 | 0.869–1.151 | within observed variation |
| 3 | main | 1.000 | 0.733–1.365 | within observed variation |
| 4 | pr-536 | 1.048 | 0.942–1.061 | within observed variation |
| 5 | pr-545 | 1.067 | 0.841–1.189 | within observed variation |

### Result-cache flag 1

1 = explicit repeated-input result reuse;0 = result-cache flag off; other default caches retain artifact policy

#### cold

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-543 | 0.977 | 0.895–1.117 | within observed variation |
| 2 | pr-545 | 0.990 | 0.686–1.458 | within observed variation |
| 3 | main | 1.000 | 0.686–1.458 | within observed variation |
| 4 | pr-536 | 1.032 | 0.863–1.159 | within observed variation |
| 5 | pr-541 | 1.067 | 0.840–1.191 | within observed variation |

#### import

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-543 | 0.976 | 0.893–1.119 | within observed variation |
| 2 | main | 1.000 | 0.813–1.231 | within observed variation |
| 3 | pr-545 | 1.023 | 0.849–1.178 | within observed variation |
| 4 | pr-536 | 1.071 | 0.813–1.231 | within observed variation |
| 5 | pr-541 | 1.148 | 0.875–1.142 | higher observed cost |

#### firstSvg

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.972 | 0.619–1.615 | within observed variation |
| 2 | pr-543 | 0.982 | 0.887–1.127 | within observed variation |
| 3 | main | 1.000 | 0.619–1.615 | within observed variation |
| 4 | pr-536 | 1.012 | 0.890–1.123 | within observed variation |
| 5 | pr-541 | 1.024 | 0.821–1.218 | within observed variation |

#### svg

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-543 | 0.977 | 0.897–1.114 | within observed variation |
| 2 | pr-545 | 0.987 | 0.813–1.231 | within observed variation |
| 3 | pr-536 | 0.989 | 0.836–1.196 | within observed variation |
| 4 | main | 1.000 | 0.792–1.263 | within observed variation |
| 5 | pr-541 | 1.077 | 0.921–1.086 | within observed variation |

#### svgReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-536 | 0.957 | 0.896–1.116 | within observed variation |
| 2 | pr-545 | 0.977 | 0.905–1.105 | within observed variation |
| 3 | main | 1.000 | 0.847–1.181 | within observed variation |
| 4 | pr-541 | 1.008 | 0.970–1.030 | within observed variation |
| 5 | pr-543 | 1.012 | 0.847–1.181 | within observed variation |

#### ascii

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-543 | 0.950 | 0.970–1.030 | lower observed cost |
| 2 | pr-545 | 0.991 | 0.928–1.078 | within observed variation |
| 3 | pr-536 | 0.991 | 0.894–1.119 | within observed variation |
| 4 | main | 1.000 | 0.876–1.141 | within observed variation |
| 5 | pr-541 | 1.008 | 0.913–1.095 | within observed variation |

#### asciiReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-541 | 0.972 | 0.924–1.083 | within observed variation |
| 2 | pr-543 | 0.996 | 0.865–1.157 | within observed variation |
| 3 | main | 1.000 | 0.865–1.157 | within observed variation |
| 4 | pr-545 | 1.013 | 0.967–1.035 | within observed variation |
| 5 | pr-536 | 1.050 | 0.939–1.065 | within observed variation |

#### unicode

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-536 | 0.970 | 0.914–1.094 | within observed variation |
| 2 | pr-545 | 0.982 | 0.920–1.087 | within observed variation |
| 3 | pr-541 | 0.996 | 0.953–1.049 | within observed variation |
| 4 | pr-543 | 0.999 | 0.908–1.102 | within observed variation |
| 5 | main | 1.000 | 0.908–1.102 | within observed variation |

#### unicodeReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-545 | 0.974 | 0.872–1.146 | within observed variation |
| 2 | pr-543 | 0.995 | 0.949–1.054 | within observed variation |
| 3 | pr-536 | 0.995 | 0.901–1.110 | within observed variation |
| 4 | main | 1.000 | 0.872–1.146 | within observed variation |
| 5 | pr-541 | 1.061 | 0.944–1.060 | higher observed cost |

#### agent

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-541 | 0.905 | 0.930–1.075 | lower observed cost |
| 2 | main | 1.000 | 0.760–1.316 | within observed variation |
| 3 | pr-536 | 1.065 | 0.953–1.049 | higher observed cost |
| 4 | pr-545 | 1.113 | 0.792–1.263 | within observed variation |
| 5 | pr-543 | 1.139 | 0.895–1.118 | higher observed cost |

#### layoutReceipt

| Order | Target | Candidate / paired control | Observed control band | Assessment |
| --- | --- | --- | --- | --- |
| 1 | pr-541 | 0.965 | 0.827–1.210 | within observed variation |
| 2 | main | 1.000 | 0.827–1.210 | within observed variation |
| 3 | pr-543 | 1.020 | 0.916–1.092 | within observed variation |
| 4 | pr-536 | 1.064 | 0.913–1.095 | within observed variation |
| 5 | pr-545 | 1.106 | 0.901–1.110 | within observed variation |

## Conflicting heads against their own bases

These four comparisons have different historical bases and are not placed in the frozen-main integration ranking.

### pr-374

| Metric | Cache | Head / own-base control | Assessment |
| --- | --- | --- | --- |
| cold | 1 | 1.059 | within observed variation |
| import | 1 | 1.090 | within observed variation |
| firstSvg | 1 | 1.016 | within observed variation |
| svg | 1 | 1.025 | within observed variation |
| svgReceipt | 1 | 0.988 | within observed variation |
| ascii | 1 | 1.030 | within observed variation |
| asciiReceipt | 1 | 1.032 | within observed variation |
| unicode | 1 | 0.993 | within observed variation |
| unicodeReceipt | 1 | 1.036 | within observed variation |
| png | 1 | unavailable | unavailable |
| pngReceipt | 1 | unavailable | unavailable |
| layoutReceipt | 1 | 0.941 | within observed variation |
| agent | 1 | 0.923 | lower observed cost |
| cold | 0 | 0.880 | within observed variation |
| import | 0 | 0.902 | lower observed cost |
| firstSvg | 0 | 0.852 | within observed variation |
| svg | 0 | 0.938 | within observed variation |
| svgReceipt | 0 | 0.977 | within observed variation |
| ascii | 0 | 1.005 | within observed variation |
| asciiReceipt | 0 | 0.971 | within observed variation |
| unicode | 0 | 1.006 | within observed variation |
| unicodeReceipt | 0 | 0.980 | within observed variation |
| png | 0 | unavailable | unavailable |
| pngReceipt | 0 | unavailable | unavailable |
| layoutReceipt | 0 | 0.980 | within observed variation |
| agent | 0 | 1.133 | within observed variation |

### pr-547

| Metric | Cache | Head / own-base control | Assessment |
| --- | --- | --- | --- |
| cold | 1 | 1.012 | within observed variation |
| import | 1 | 1.074 | within observed variation |
| firstSvg | 1 | 1.017 | within observed variation |
| svg | 1 | 0.999 | within observed variation |
| svgReceipt | 1 | 1.004 | within observed variation |
| ascii | 1 | 0.981 | within observed variation |
| asciiReceipt | 1 | 1.041 | higher observed cost |
| unicode | 1 | 1.000 | within observed variation |
| unicodeReceipt | 1 | 1.026 | within observed variation |
| png | 1 | unavailable | unavailable |
| pngReceipt | 1 | unavailable | unavailable |
| layoutReceipt | 1 | 0.983 | within observed variation |
| agent | 1 | 0.971 | within observed variation |
| cold | 0 | 0.927 | within observed variation |
| import | 0 | 0.918 | within observed variation |
| firstSvg | 0 | 0.942 | within observed variation |
| svg | 0 | 1.012 | within observed variation |
| svgReceipt | 0 | 0.980 | within observed variation |
| ascii | 0 | 0.984 | within observed variation |
| asciiReceipt | 0 | 1.017 | within observed variation |
| unicode | 0 | 0.970 | within observed variation |
| unicodeReceipt | 0 | 0.982 | within observed variation |
| png | 0 | unavailable | unavailable |
| pngReceipt | 0 | unavailable | unavailable |
| layoutReceipt | 0 | 1.044 | within observed variation |
| agent | 0 | 0.962 | within observed variation |

### pr-542

| Metric | Cache | Head / own-base control | Assessment |
| --- | --- | --- | --- |
| cold | 1 | 0.971 | within observed variation |
| import | 1 | 0.981 | within observed variation |
| firstSvg | 1 | 0.977 | within observed variation |
| svg | 1 | 1.007 | within observed variation |
| svgReceipt | 1 | 0.985 | within observed variation |
| ascii | 1 | 1.022 | within observed variation |
| asciiReceipt | 1 | 1.085 | higher observed cost |
| unicode | 1 | 0.963 | within observed variation |
| unicodeReceipt | 1 | 0.943 | within observed variation |
| png | 1 | unavailable | unavailable |
| pngReceipt | 1 | unavailable | unavailable |
| layoutReceipt | 1 | 0.963 | within observed variation |
| agent | 1 | 0.918 | within observed variation |
| cold | 0 | 1.007 | within observed variation |
| import | 0 | 1.028 | within observed variation |
| firstSvg | 0 | 0.997 | within observed variation |
| svg | 0 | 1.067 | within observed variation |
| svgReceipt | 0 | 1.025 | within observed variation |
| ascii | 0 | 0.976 | within observed variation |
| asciiReceipt | 0 | 1.040 | higher observed cost |
| unicode | 0 | 0.969 | within observed variation |
| unicodeReceipt | 0 | 0.962 | within observed variation |
| png | 0 | unavailable | unavailable |
| pngReceipt | 0 | unavailable | unavailable |
| layoutReceipt | 0 | 1.107 | higher observed cost |
| agent | 0 | 1.124 | higher observed cost |

### pr-449

| Metric | Cache | Head / own-base control | Assessment |
| --- | --- | --- | --- |
| cold | 1 | 1.158 | higher observed cost |
| import | 1 | 1.172 | within observed variation |
| firstSvg | 1 | 1.128 | higher observed cost |
| svg | 1 | 1.812 | higher observed cost |
| svgReceipt | 1 | 1.685 | higher observed cost |
| ascii | 1 | 1.620 | higher observed cost |
| asciiReceipt | 1 | 1.638 | higher observed cost |
| unicode | 1 | 1.674 | higher observed cost |
| unicodeReceipt | 1 | 1.669 | higher observed cost |
| png | 1 | unavailable | unavailable |
| pngReceipt | 1 | unavailable | unavailable |
| layoutReceipt | 1 | 1.796 | higher observed cost |
| agent | 1 | 1.105 | within observed variation |
| cold | 0 | 1.019 | within observed variation |
| import | 0 | 0.986 | within observed variation |
| firstSvg | 0 | 1.041 | within observed variation |
| svg | 0 | 1.320 | higher observed cost |
| svgReceipt | 0 | 1.398 | higher observed cost |
| ascii | 0 | 1.542 | higher observed cost |
| asciiReceipt | 0 | 1.558 | higher observed cost |
| unicode | 0 | 1.704 | higher observed cost |
| unicodeReceipt | 0 | 1.531 | higher observed cost |
| png | 0 | unavailable | unavailable |
| pngReceipt | 0 | unavailable | unavailable |
| layoutReceipt | 0 | 1.526 | higher observed cost |
| agent | 0 | 1.073 | within observed variation |

## Current PR inventory

Checked 28 October 2026. #571 was opened after the campaign and has no measured result. The old heads of eight campaign PRs have since landed, often after revision; no score transfers automatically to those revised commits.

| PR | Current head | Measured here? |
| --- | --- | --- |
| 571 | 1993fbc5ce7b1800d808d9c1576efe82bdfa605d | No — new head |
| 393 | 7c891e1857633cbb9de0c5768ed233e148a1bf1b | Same frozen head; dated result only |
| 374 | 2ed20a17e3234f77bb82f15d1291638c6f5fff6e | Same frozen head; dated result only |

Broad family/invocation groups do not qualify these core costs as complete-product performance. Fourteen family groups failed at adapter enumeration before testing cases. Overlapping base547 and CFD invocation clocks are withheld; their functional outcomes remain in the evidence. Missing bindings are benchmark gaps, not zero product fidelity.
