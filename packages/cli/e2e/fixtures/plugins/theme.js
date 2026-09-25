// A local theme: tokens, CSS and a font.
export default {
  name: 'test-paper',
  tokens: {
    bg: 'rgb(250, 248, 240)',
    fg: 'rgb(20, 20, 20)',
    'fg-muted': 'rgb(100, 100, 100)',
    accent: 'rgb(194, 65, 12)',
    'chart-1': '#c2410c', 'chart-2': '#0f766e', 'chart-3': '#1d4ed8', 'chart-4': '#a16207',
    'chart-5': '#7e22ce', 'chart-6': '#be123c', 'chart-7': '#15803d', 'chart-8': '#525252',
    'font-serif': '"Test Serif", Georgia, serif',
  },
  css: '.blitz-slide h1 { font-family: var(--blitz-font-serif); }',
  fonts: [{ family: 'Test Serif', src: './theme-font.woff2' }],
}
