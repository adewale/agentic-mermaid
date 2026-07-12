// The contact-sheet scenarios as a visual-regression gate: every lettered
// scenario from `eval/visual-rubric/scenarios.ts` (rendered for humans by
// `bun run contact:sheet`) is pinned here twice over —
//   1. the rubric's HARD metrics must be zero (endpoints on outlines, no
//      diagonals, no unexplained bends, no hitches, no overlaps, labels on
//      their routes, no edge-through-node), and
//   2. the full layout geometry is hash-pinned (drift sentinel), so any
//      change to these drawings fails CI until deliberately re-pinned and
//      re-reviewed via the contact sheet. Explicit hashes avoid Bun's
//      concurrent cross-file snapshot-writer race.
import { describe, expect, it } from 'bun:test'
import { contactSheetScenarios } from '../../eval/visual-rubric/scenarios.ts'
import { layoutGraphSync } from '../layout-engine.ts'
import { assessLayout } from '../layout-rubric.ts'
import { parseMermaid } from '../parser.ts'
import { verifyMermaid } from '../agent/verify.ts'
import { createHash } from 'node:crypto'

function snapshotSafeLabel(label: string | undefined): string | undefined {
  return label?.replace(/\n/g, '\\n')
}

function snapshotSafeLayout(source: string) {
  const layout = verifyMermaid(source).layout
  return {
    ...layout,
    nodes: layout.nodes.map(node => ({ ...node, label: snapshotSafeLabel(node.label) })),
    edges: layout.edges.map(edge => ({
      ...edge,
      label: edge.label ? { ...edge.label, text: snapshotSafeLabel(edge.label.text) } : edge.label,
    })),
  }
}

describe('contact sheet — hard rubric metrics stay zero', () => {
  for (const sc of contactSheetScenarios()) {
    it(`${sc.letter} — ${sc.title}`, () => {
      const graph = parseMermaid(sc.source)
      const result = assessLayout(graph, layoutGraphSync(graph))
      expect(result.violations).toEqual([])
    })
  }
})

const GEOMETRY_HASHES: Record<string, string> = {
  A: 'b0e2fb21dc906f3c35d99232c1c909d8645803b0bb0c0824110438bf1638281e',
  B: 'ba1678b4852ff3a11ecda388d8b42e4132644786504c90d4b6921a39c2630d1b',
  C: '92185b62de40a44020c3c2a99a0d7aa698bacec4040240cf0bc32fc5102dcc90',
  D: 'b6d0fce6651c089331a93e2931c00116a5f4c1cb36d457910f672202de8c4bd7',
  E: '7a4bc0bad16c8bcd4fcf5be43daf932f4a7eae585aed6d8ccda7a9d21f0f865b',
  F: '5dd8cdf925bba7ff1cfb2e424cec63a2053e156760200cb6fb3452853c55b573',
  G: '46d1ecb49f76959f8c4a59f71789069e4b4ef719ff06f84497448b8fc3dc1287',
  H: '0b5e1483fb2ce3edc5b0fe5ddf9dd7e14cfdc98fbf20963471c2d850125fc93d',
  I: '2c45b2d19a5fc9fcbbfb8a53404a6d1cdc6b023f9c224efa7063e8e611fe3f34',
  J: '97c8e2ee5daa947f28b14b2939b27ead647d2df914ed77c68cd7bc1d311af24a',
  K: '10d870fbea204373baf6ebd077df57864ae7ef598ccf550479d5ada1c6acd940',
  L: '8bccd89890dfee5e1b2b736886a3ba6bfec92cc70c97cc648b7cf8cded199a8e',
  M: '7c0b4d834fc66d8430112ddd3dffdbdb557defbb3904e69cbe5ed9dca472ac14',
  N: 'a1ff303c56b1f26d81f87d781e8f6213cbae1596676a3eabf3d4c53ba19a8185',
  O: '8304336149653dabad7623a5faa7605e6ebc8c8fac03c1aba3abe8ca4bcdcf90',
  P: '84b7c66b18ab1fbf652b27ad98aeb2eae578e71102df3abf21327ca33ee59563',
  Q: '3f8a962df9d6838e81205dc904b88ee15aad2a418a30909d07a7f84ee421a6f5',
  R: 'c5dc30bea7622b94e7aabadbd07a0771e44b5ddddb7ec6f14ed059d072c40155',
  S: '445441fba87b23ba034db903a6b85e326239a671ef529679a5d6d6039029d7e6',
  T: '2bb2f0c728e1b8394eae6f25526c5022ddd8a5de2c236deb021e11b3424f5541',
  U: '4232bbdfe73d6a21a14f91376ca8f68aa3873548a4363c409e5ed741f49eac5b',
  V: '16aa64970685497fe4f6e64d12cf67afdca8177a13550eca1332aa4b1073a33f',
  W: '8cc1a4770e43451570aa7c6d181188d5aff7593a7782957b057cd85555c0f9cf',
  X: '7adf951a56c0a98c9b4fcf81e87079c59c4984299dd8d72e42d3e49519f9dadf',
  Y: 'c0f9bd2b024d0a65b324aa2308db69ed01904572fe40d9c639e2b298e868f9f4',
  Z: '037ade43102b4f743fd95db9cf1c009add1894e3a1ff8561a88548625147ff76',
  AA: '74c40e59e62b4df27c2006b42f6a5249f46cce703667eda02b4039d1440e30a1',
  AB: '9403636732d50b42824cd9e34482d30b71e4e4ffb6197dfd9f8ccedb15ebfa29',
  AC: '5232089dfba5fda889eec0c212f1eb119f5ecf5b97e24bc005130508dc95d404',
  AD: '5dd8cdf925bba7ff1cfb2e424cec63a2053e156760200cb6fb3452853c55b573',
  AE: '9403636732d50b42824cd9e34482d30b71e4e4ffb6197dfd9f8ccedb15ebfa29',
  AF: '7fbcaf42a4028c445d1155a94126a53c7b4ee4060ec2490c6ecba3e926238b1a',
  AG: 'd22558d02b42127c17d13128ee2cdfdd2e2c94d1b69089e519b677271a1acd45',
  AH: 'd742d7482f9c80e193f6f2f756d4fdb718982ff309225e1cd4d43bd0c56c3676',
  AI: '933665289af17383d9836c51b2a7c3504fcc753f18320b721f144a119684cfe3',
  AJ: '92d8d68a8cb126c9c5894f3be886f26c9287ab16ad57a6667941a750a253c0e7',
  AK: '837c4ac5be27707e4e02b1e3d2b7d825a0a91f4d486bfff652538fb0f25ea7e2',
  AL: '1966b01cc5aef6f698e83e0531d81c4eab8f1d2b647bb2fa0bf525cca02ebd09',
  AM: '617ae3392a3475a9c86e0c2b876119d7dd57bd5b5766c7e9720b28ceadf1e891',
  AN: 'c1207d7f1498486f09361afa5b4c24749aed025b0c28de2ffefc5483273fe70b',
  AO: '3515bfcd03042c21e6ed3d65e3d9d26956d3371a4d90f0294908fe4c20380240',
  AP: '31b45dc3c39ca4c8d7d60fce135368be186bd7b44231118431180bb9c7a61092',
  AQ: 'c032c6f6a6dacd6177ec79b4272eea2f2dd73999977046e9fb24db0b3657f569',
  AR: '011c81262ea0730d2a8e084511e28f4ca4b69cc9f181d374c3404530625cce1a',
}

describe('contact sheet — pinned geometry (re-pin deliberately, review the sheet)', () => {
  for (const sc of contactSheetScenarios()) {
    it(`${sc.letter} — ${sc.title}`, () => {
      const hash = createHash('sha256').update(JSON.stringify(snapshotSafeLayout(sc.source))).digest('hex')
      expect(hash).toBe(GEOMETRY_HASHES[sc.letter]!)
    })
  }
})
