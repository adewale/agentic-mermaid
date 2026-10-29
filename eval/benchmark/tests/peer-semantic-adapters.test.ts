import { expect, test } from 'bun:test'
import { selectedPeerSemanticAdapter } from '../peer-semantic-adapters.ts'
import { PELE_SEMANTIC_ADAPTER } from '../pele-semantics.ts'

test('rendered semantic adapter requires the complete actual installed pin', () => {
  const pin = { peer: 'pele', version: '1.9.0', integrity: PELE_SEMANTIC_ADAPTER.integrity }
  expect(selectedPeerSemanticAdapter(pin)).toBe('pele-1.9.0-rendered-ids-v1')
  for (const changed of [{ peer: 'beautiful' }, { version: '1.6.0' }, { version: '1.9.1' }, { integrity: 'sha512-different' }, { integrity: undefined }]) expect(selectedPeerSemanticAdapter({ ...pin, ...changed })).toBeUndefined()
})
