// Canonical built-in palette seed data.
//
// Runtime discovery and collision policy live in the kind-specific Style
// registry. `THEMES` is deliberately generated from this catalog as the
// legacy render-options projection; it is not a second palette authority.

export interface BuiltinPaletteDefinition {
  readonly id: `palette:${string}`
  readonly legacyName: string
  readonly displayLabel: string
  readonly colors: Readonly<{
    bg: string
    fg: string
    line?: string
    accent?: string
    muted?: string
    surface?: string
    border?: string
  }>
}

export const BUILTIN_PALETTE_DEFINITIONS = Object.freeze([
  {
    id: 'palette:paper', legacyName: 'paper', displayLabel: 'Paper',
    colors: { bg: '#F5F0E4', fg: '#221E16', accent: '#9A4A24' },
  },
  {
    id: 'palette:dusk', legacyName: 'dusk', displayLabel: 'Dusk',
    colors: { bg: '#2A2521', fg: '#E9DFCC', accent: '#CC8A57' },
  },
  { id: 'palette:zinc-light', legacyName: 'zinc-light', displayLabel: 'Zinc Light', colors: { bg: '#FFFFFF', fg: '#27272A' } },
  { id: 'palette:zinc-dark', legacyName: 'zinc-dark', displayLabel: 'Zinc Dark', colors: { bg: '#18181B', fg: '#FAFAFA' } },
  {
    id: 'palette:tokyo-night', legacyName: 'tokyo-night', displayLabel: 'Tokyo Night',
    colors: { bg: '#1a1b26', fg: '#a9b1d6', line: '#3d59a1', accent: '#7aa2f7', muted: '#565f89' },
  },
  {
    id: 'palette:tokyo-night-storm', legacyName: 'tokyo-night-storm', displayLabel: 'Tokyo Night Storm',
    colors: { bg: '#24283b', fg: '#a9b1d6', line: '#3d59a1', accent: '#7aa2f7', muted: '#565f89' },
  },
  {
    id: 'palette:tokyo-night-light', legacyName: 'tokyo-night-light', displayLabel: 'Tokyo Night Light',
    colors: { bg: '#d5d6db', fg: '#343b58', line: '#34548a', accent: '#34548a', muted: '#9699a3' },
  },
  {
    id: 'palette:catppuccin-mocha', legacyName: 'catppuccin-mocha', displayLabel: 'Catppuccin Mocha',
    colors: { bg: '#1e1e2e', fg: '#cdd6f4', line: '#585b70', accent: '#cba6f7', muted: '#6c7086' },
  },
  {
    id: 'palette:catppuccin-latte', legacyName: 'catppuccin-latte', displayLabel: 'Catppuccin Latte',
    colors: { bg: '#eff1f5', fg: '#4c4f69', line: '#9ca0b0', accent: '#8839ef', muted: '#9ca0b0' },
  },
  {
    id: 'palette:nord', legacyName: 'nord', displayLabel: 'Nord',
    colors: { bg: '#2e3440', fg: '#d8dee9', line: '#4c566a', accent: '#88c0d0', muted: '#616e88' },
  },
  {
    id: 'palette:nord-light', legacyName: 'nord-light', displayLabel: 'Nord Light',
    colors: { bg: '#eceff4', fg: '#2e3440', line: '#aab1c0', accent: '#5e81ac', muted: '#7b88a1' },
  },
  {
    id: 'palette:dracula', legacyName: 'dracula', displayLabel: 'Dracula',
    colors: { bg: '#282a36', fg: '#f8f8f2', line: '#6272a4', accent: '#bd93f9', muted: '#6272a4' },
  },
  {
    id: 'palette:github-light', legacyName: 'github-light', displayLabel: 'GitHub Light',
    colors: { bg: '#ffffff', fg: '#1f2328', line: '#d1d9e0', accent: '#0969da', muted: '#59636e' },
  },
  {
    id: 'palette:github-dark', legacyName: 'github-dark', displayLabel: 'GitHub Dark',
    colors: { bg: '#0d1117', fg: '#e6edf3', line: '#3d444d', accent: '#4493f8', muted: '#9198a1' },
  },
  {
    id: 'palette:solarized-light', legacyName: 'solarized-light', displayLabel: 'Solarized Light',
    colors: { bg: '#fdf6e3', fg: '#657b83', line: '#93a1a1', accent: '#268bd2', muted: '#93a1a1' },
  },
  {
    id: 'palette:solarized-dark', legacyName: 'solarized-dark', displayLabel: 'Solarized Dark',
    colors: { bg: '#002b36', fg: '#839496', line: '#586e75', accent: '#268bd2', muted: '#586e75' },
  },
  {
    id: 'palette:one-dark', legacyName: 'one-dark', displayLabel: 'One Dark',
    colors: { bg: '#282c34', fg: '#abb2bf', line: '#4b5263', accent: '#c678dd', muted: '#5c6370' },
  },
  {
    id: 'palette:salmon', legacyName: 'salmon', displayLabel: 'Salmon',
    colors: { bg: '#FFFBF5', fg: '#521000', line: '#C9A88A', accent: '#FF4801', muted: '#85532E', surface: '#FFFDFB', border: '#D4B89E' },
  },
  {
    id: 'palette:salmon-dark', legacyName: 'salmon-dark', displayLabel: 'Salmon Dark',
    colors: { bg: '#1F1008', fg: '#F5DCC8', line: '#6B4A2E', accent: '#FF6B35', muted: '#A07858', surface: '#2A1810', border: '#5A3A22' },
  },
  {
    id: 'palette:tufte', legacyName: 'tufte', displayLabel: 'Tufte',
    colors: { bg: '#FFFFF8', fg: '#111111', line: '#AAAAAA', accent: '#7A0000', muted: '#888888', surface: '#F5F0E8', border: '#CCCCCC' },
  },
  {
    id: 'palette:tufte-dark', legacyName: 'tufte-dark', displayLabel: 'Tufte Dark',
    colors: { bg: '#1C1C1A', fg: '#E8E4DC', line: '#666660', accent: '#C87070', muted: '#908880', surface: '#2A2926', border: '#444440' },
  },
] as const satisfies readonly BuiltinPaletteDefinition[])
