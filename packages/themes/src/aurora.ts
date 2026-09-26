import { defineTheme } from './theme.js'

/**
 * aurora — dark, technical (PLAN §5).
 *
 * Every rule is scoped to `.blitz-slide` (or a `[data-layout]` slide), so
 * the theme never styles the overlays or the presenter view.
 */
export const aurora = defineTheme({
  name: 'aurora',
  tokens: {
    'bg': '#0b1020',
    'bg-glow-1': 'rgba(92, 225, 180, .10)',
    'bg-glow-2': 'rgba(120, 130, 255, .12)',
    'surface': '#121a30',
    'surface-2': '#18223d',
    'fg': '#e9edf5',
    'fg-muted': '#97a2b9',
    'rule': '#28324d',
    'accent': '#6ff0c0',
    'accent-2': '#8f9dff',
    'link': '#8fd8ff',
    'highlight': 'rgba(111, 240, 192, .30)',
    'letterbox': '#05070e',
    'font-sans': '"Inter", "InterVariable", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    'font-mono': '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
    'text': '30px',
    'text-small': '22px',
    'h1': '60px',
    'h2': '46px',
    'h3': '34px',
    'title': '84px',
    'pad-x': '88px',
    'pad-y': '64px',
    'gap': '26px',
    'radius': '12px',
    'block-height': '420px',
    'transition-dur': '550ms',
    'chart-1': '#6ff0c0',
    'chart-2': '#8f9dff',
    'chart-3': '#ffb86b',
    'chart-4': '#ff7aa2',
    'chart-5': '#5ad1ff',
    'chart-6': '#d7a6ff',
    'chart-7': '#f3e36b',
    'chart-8': '#97a2b9',
    // Code highlighting (cli/highlight.ts reads these through shiki).
    'code-foreground': '#e9edf5',
    'code-token-keyword': '#c3a6ff',
    'code-token-string': '#6ff0c0',
    'code-token-string-expression': '#6ff0c0',
    'code-token-function': '#8fd8ff',
    'code-token-constant': '#ffb86b',
    'code-token-parameter': '#ff9dbb',
    'code-token-punctuation': '#97a2b9',
    'code-token-comment': '#6f7a94',
    'code-token-link': '#8fd8ff',
    'map-tiles': 'invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.35)',
  },
  css: /* css */ `
.blitz-slide {
  color: var(--blitz-fg);
  background-color: var(--blitz-bg);
  background-image:
    radial-gradient(900px 520px at 100% 0%, var(--blitz-bg-glow-2), transparent 70%),
    radial-gradient(760px 480px at 0% 100%, var(--blitz-bg-glow-1), transparent 70%);
  font: 400 var(--blitz-text)/1.45 var(--blitz-font-sans);
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
}

.blitz-slide h1, .blitz-slide h2, .blitz-slide h3, .blitz-slide h4 { margin: 0; line-height: 1.1; letter-spacing: -0.02em; font-weight: 700; }
.blitz-slide h1 { font-size: var(--blitz-h1); }
.blitz-slide h2 { font-size: var(--blitz-h2); }
.blitz-slide h3 { font-size: var(--blitz-h3); color: var(--blitz-accent); letter-spacing: -0.01em; }
.blitz-slide h4 { font-size: var(--blitz-text); color: var(--blitz-fg-muted); text-transform: uppercase; letter-spacing: .08em; }
.blitz-slide h1 + *, .blitz-slide h2 + * { margin-top: 4px; }

.blitz-slide p { margin: 0; }
.blitz-slide strong { color: #fff; font-weight: 650; }
.blitz-slide em { color: var(--blitz-accent); font-style: normal; }
.blitz-slide a { color: var(--blitz-link); text-decoration: underline; text-decoration-thickness: .06em; text-underline-offset: .18em; }
.blitz-slide del { color: var(--blitz-fg-muted); }
.blitz-slide hr { border: 0; border-top: 2px solid var(--blitz-rule); width: 100%; margin: 4px 0; }
.blitz-slide img { max-width: 100%; max-height: 100%; border-radius: var(--blitz-radius); }

.blitz-slide ul, .blitz-slide ol { margin: 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: .35em; }
.blitz-slide ul { list-style: none; padding-left: 1.1em; }
.blitz-slide ul > li { position: relative; }
.blitz-slide ul > li::before {
  content: ""; position: absolute; left: -1.05em; top: .58em;
  width: .42em; height: .42em; border-radius: 2px; transform: rotate(45deg);
  background: linear-gradient(135deg, var(--blitz-accent), var(--blitz-accent-2));
}
.blitz-slide ol > li::marker { color: var(--blitz-accent); font-weight: 700; font-variant-numeric: tabular-nums; }
.blitz-slide li > ul, .blitz-slide li > ol { margin-top: .35em; font-size: .85em; }
.blitz-slide ul.contains-task-list > li::before { display: none; }
.blitz-slide ul.contains-task-list { padding-left: 0; }

.blitz-slide blockquote {
  margin: 0; padding: 8px 0 8px 32px; border-left: 4px solid var(--blitz-accent);
  font-size: 1.15em; line-height: 1.4; color: var(--blitz-fg);
}
.blitz-slide blockquote p + p { margin-top: .5em; color: var(--blitz-fg-muted); font-size: .75em; }

.blitz-slide code {
  font-family: var(--blitz-font-mono); font-size: .86em;
  background: var(--blitz-surface-2); border-radius: 6px; padding: .08em .35em;
}
.blitz-slide pre {
  margin: 0; padding: 22px 26px; overflow: hidden;
  background: var(--blitz-surface); border: 1px solid var(--blitz-rule); border-radius: var(--blitz-radius);
  font-size: 22px; line-height: 1.5;
}
.blitz-slide pre code { background: none; padding: 0; font-size: 1em; color: var(--blitz-code-foreground); }

.blitz-slide table { border-collapse: collapse; font-size: var(--blitz-text-small); font-variant-numeric: tabular-nums; }
.blitz-slide th, .blitz-slide td { padding: 10px 22px; text-align: left; border-bottom: 1px solid var(--blitz-rule); }
.blitz-slide th { color: var(--blitz-fg-muted); font-weight: 600; text-transform: uppercase; font-size: .8em; letter-spacing: .06em; }
.blitz-slide th[align="right"], .blitz-slide td[align="right"] { text-align: right; }
.blitz-slide th[align="center"], .blitz-slide td[align="center"] { text-align: center; }
.blitz-slide th[aria-sort] { color: var(--blitz-accent); }
.blitz-slide table.zebra tbody tr:nth-child(odd) { background: color-mix(in srgb, var(--blitz-surface-2) 70%, transparent); }

.blitz-slide .callout {
  padding: 22px 28px; border-radius: var(--blitz-radius);
  background: color-mix(in srgb, var(--blitz-accent) 9%, var(--blitz-surface));
  border: 1px solid color-mix(in srgb, var(--blitz-accent) 35%, transparent);
}
.blitz-slide .columns { display: flex; gap: 48px; align-items: flex-start; }
.blitz-slide .columns > * { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--blitz-gap); }
.blitz-slide .muted { color: var(--blitz-fg-muted); }
.blitz-slide .accent { color: var(--blitz-accent); }
.blitz-slide .small { font-size: var(--blitz-text-small); }
.blitz-slide .big { font-size: 1.6em; }
.blitz-slide .center { text-align: center; align-self: center; }

.blitz-slide [data-blitz-block]:has(> .blitz-map-chart) { border-radius: var(--blitz-radius); box-shadow: 0 0 0 1px var(--blitz-rule); }
.blitz-slide [data-blitz-block]:has(> .blitz-embed) {
  border-radius: var(--blitz-radius); background: var(--blitz-surface);
  box-shadow: 0 0 0 1px var(--blitz-rule), 0 24px 60px rgba(0, 0, 0, .35);
}
.blitz-slide .blitz-embed-fallback { border-radius: 0; max-width: none; max-height: none; }
.blitz-slide .footnotes { margin-top: auto; font-size: 16px; color: var(--blitz-fg-muted); }
.blitz-slide .footnotes h2 { display: none; }
.blitz-slide .footnotes ol { gap: 0; }

/* Layouts (syntax.md §10). Geometry comes from layouts.ts; this is the look. */
[data-layout="title"] h1, [data-layout="end"] h1 {
  font-size: var(--blitz-title); letter-spacing: -0.035em; width: fit-content;
  background: linear-gradient(100deg, #fff 30%, var(--blitz-accent) 75%, var(--blitz-accent-2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  padding-bottom: .08em;
}
/* Chromium's PDF output draws the edge of a text-clipped gradient's box
   around the text; print the title solid instead. */
@media print {
  [data-layout="title"] h1, [data-layout="end"] h1 { background: none; color: #fff; }
}
[data-layout="title"] h1 + p, [data-layout="title"] h2,
[data-layout="end"] h1 + p, [data-layout="end"] h2 { color: var(--blitz-fg-muted); font-weight: 400; font-size: 34px; }

[data-layout="section"] h1, [data-layout="section"] h2 { font-size: 96px; letter-spacing: -0.04em; }
[data-layout="section"] > [data-slot="main"]::before {
  content: ""; width: 72px; height: 6px; border-radius: 3px; margin-bottom: 8px;
  background: linear-gradient(90deg, var(--blitz-accent), var(--blitz-accent-2));
}
[data-layout="section"] p { color: var(--blitz-fg-muted); }

[data-layout="two-col"] > [data-slot="main"], [data-layout="three-col"] > [data-slot="main"] { padding-bottom: 6px; }
:is([data-layout="two-col"], [data-layout="three-col"]) > :is([data-slot="middle"], [data-slot="right"]) { position: relative; }
:is([data-layout="two-col"], [data-layout="three-col"]) > :is([data-slot="middle"], [data-slot="right"])::before {
  content: ""; position: absolute; left: -28px; top: 0; bottom: 0; width: 1px; background: var(--blitz-rule);
}

[data-layout="quote"] blockquote {
  border: 0; padding: 0; font-size: 52px; line-height: 1.2; letter-spacing: -0.015em; font-weight: 500;
}
[data-layout="quote"] blockquote::before {
  content: "\\201C"; display: block; height: .55em; font-size: 2.4em; line-height: 1;
  color: var(--blitz-accent); font-weight: 700;
}
[data-layout="quote"] blockquote + p { color: var(--blitz-fg-muted); font-size: var(--blitz-text); }
[data-layout="quote"] blockquote + p::before { content: "\\2014\\2002"; color: var(--blitz-accent); }

[data-layout="stat-grid"] > [data-slot="main"] > div {
  padding: 28px 30px; border-radius: var(--blitz-radius);
  background: var(--blitz-surface); border: 1px solid var(--blitz-rule);
}
[data-layout="stat-grid"] > [data-slot="main"] > div > :first-child { color: var(--blitz-accent); font-variant-numeric: tabular-nums; }
[data-layout="stat-grid"] > [data-slot="main"] > div > :not(:first-child) { color: var(--blitz-fg-muted); font-size: var(--blitz-text-small); }

[data-layout="full-bleed"] > [data-slot="main"]::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(to top, rgba(5, 7, 14, .85), rgba(5, 7, 14, .15) 60%, transparent);
}

[data-layout="code"] pre { font-size: 26px; }
`,
})
