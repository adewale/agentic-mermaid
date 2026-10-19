import type { MermaidFrontmatterMap } from '../mermaid-source.ts'
import { getFrontmatterMap } from '../mermaid-source.ts'
import type { PacketVisualConfig } from './types.ts'

export const PACKET_CONFIG_KEYS = ['bitsPerRow', 'bitOrder', 'showBits', 'rowHeight', 'bitWidth', 'paddingX', 'paddingY', 'useMaxWidth'] as const
export function resolvePacketConfig(frontmatter: MermaidFrontmatterMap = {}): PacketVisualConfig {
  const raw = getFrontmatterMap(frontmatter, ['packet']) ?? {}
  const positive = (key: string, fallback: number): number => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] > 0 ? raw[key] : fallback)
  const padding = (key: string): number => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : 5)
  return {
    bitsPerRow: typeof raw.bitsPerRow === 'number' && Number.isSafeInteger(raw.bitsPerRow) && raw.bitsPerRow > 0 ? raw.bitsPerRow : 32,
    bitOrder: raw.bitOrder === 'descending' ? 'descending' : 'ascending',
    showBits: raw.showBits !== false,
    rowHeight: positive('rowHeight', 32),
    bitWidth: positive('bitWidth', 32),
    paddingX: padding('paddingX'),
    paddingY: padding('paddingY'),
  }
}
