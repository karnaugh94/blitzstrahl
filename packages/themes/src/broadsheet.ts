import { INTER, JETBRAINS_MONO, NEWSREADER } from './fonts.js'
import { defineTheme } from './theme.js'

/**
 * broadsheet — light, editorial (PLAN §5). Newsprint: a serif for reading
 * and headlines (Newsreader), Inter for tables and kickers, a masthead
 * rule, newspaper red. Every font it names ships (fonts.ts).
 *
 * Built on the public contract only (tokens, CSS, fonts), so it doubles as
 * the reference for writing a theme. Every rule is scoped to `.blitz-slide`
 * or a `[data-layout]` slide.
 *
 * Chart palette: validated with the dataviz palette checker on `bg`
 * (adjacent CVD ΔE ≥ 10.3, normal-vision ≥ 17.4). Slot 4 (ochre) is 2.8:1
 * on the paper; charts carry legends and labels, as the relief rule asks.
 */
export const broadsheet = defineTheme({
  name: 'broadsheet',
  tokens: {
    'bg': '#f7f4ec',
    'surface': '#efeadf',
    'surface-2': '#e6dfcf',
    'fg': '#1d1b17',
    'fg-muted': '#6b6457',
    'rule': '#d3cab8',
    'accent': '#b8322a',
    'accent-2': '#2f6db5',
    'link': '#2f6db5',
    'highlight': 'rgba(242, 196, 64, .5)',
    'letterbox': '#1b1a17',
    // Newsreader has no Greek or Cyrillic: those letters come from Inter, which is shipped too.
    'font-serif': '"Newsreader", "Inter", Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif',
    'font-sans': '"Inter", "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif',
    'font-mono': '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
    'text': '30px',
    'text-small': '22px',
    'h1': '64px',
    'h2': '48px',
    'h3': '34px',
    'title': '96px',
    'pad-x': '96px',
    'pad-y': '72px',
    'gap': '26px',
    'radius': '4px',
    'block-height': '420px',
    'transition-dur': '500ms',
    'chart-1': '#b8322a',
    'chart-2': '#2f6db5',
    'chart-3': '#15967a',
    'chart-4': '#c4870f',
    'chart-5': '#b05598',
    'chart-6': '#3f8a2e',
    'chart-7': '#51429e',
    'chart-8': '#d0625a',
    'code-foreground': '#1d1b17',
    'code-token-keyword': '#8a2b5e',
    'code-token-string': '#1f7a4d',
    'code-token-string-expression': '#1f7a4d',
    'code-token-function': '#2f5f9e',
    'code-token-constant': '#a4541a',
    'code-token-parameter': '#7a4e1a',
    'code-token-punctuation': '#6b6457',
    'code-token-comment': '#8d8577',
    'code-token-link': '#2f6db5',
    'map-tiles': 'sepia(.25) saturate(.75) contrast(.95)',
  },
  // Its own serif, Inter for the sans, JetBrains Mono for code: every font it names ships.
  fonts: [...NEWSREADER, ...INTER, ...JETBRAINS_MONO],
  css: /* css */ `
.blitz-slide {
  font-family: var(--blitz-font-serif);
  font-optical-sizing: auto;
  font-variant-numeric: oldstyle-nums proportional-nums;
  -webkit-font-smoothing: antialiased;
  /* The masthead: a heavy rule over a hairline, across the type area. */
  background-image:
    linear-gradient(var(--blitz-fg), var(--blitz-fg)),
    linear-gradient(var(--blitz-fg), var(--blitz-fg));
  background-repeat: no-repeat;
  background-size: calc(100% - 2 * var(--blitz-pad-x)) 3px, calc(100% - 2 * var(--blitz-pad-x)) 1px;
  background-position: var(--blitz-pad-x) calc(var(--blitz-pad-y) / 2 - 3px), var(--blitz-pad-x) calc(var(--blitz-pad-y) / 2 + 3px);
}

.blitz-slide h1, .blitz-slide h2, .blitz-slide h3, .blitz-slide h4 { margin: 0; line-height: 1.06; font-weight: 650; letter-spacing: -0.012em; }
.blitz-slide h1 { font-size: var(--blitz-h1); }
.blitz-slide h2 { font-size: var(--blitz-h2); }
.blitz-slide h3 { font-size: var(--blitz-h3); font-style: italic; font-weight: 500; color: var(--blitz-accent); }
.blitz-slide h4 {
  font: 700 var(--blitz-text-small)/1.2 var(--blitz-font-sans);
  color: var(--blitz-accent); text-transform: uppercase; letter-spacing: .12em;
}
.blitz-slide h1 + *, .blitz-slide h2 + * { margin-top: 4px; }

.blitz-slide p { margin: 0; }
.blitz-slide strong { font-weight: 700; }
.blitz-slide em { font-style: italic; }
.blitz-slide a { color: var(--blitz-link); text-decoration: underline; text-decoration-thickness: .05em; text-underline-offset: .16em; }
.blitz-slide del { color: var(--blitz-fg-muted); }
.blitz-slide hr { border: 0; border-top: 1px solid var(--blitz-fg); width: 100%; margin: 4px 0; }
.blitz-slide img { max-width: 100%; max-height: 100%; border-radius: var(--blitz-radius); }

.blitz-slide ul, .blitz-slide ol { margin: 0; padding-left: 1.2em; display: flex; flex-direction: column; gap: .35em; }
.blitz-slide ul { list-style: none; }
.blitz-slide ul > li { position: relative; }
.blitz-slide ul > li::before {
  content: ""; position: absolute; left: -1.05em; top: .6em;
  width: .36em; height: .36em; background: var(--blitz-accent);
}
.blitz-slide ol > li::marker { color: var(--blitz-accent); font-weight: 650; }
.blitz-slide li > ul, .blitz-slide li > ol { margin-top: .35em; font-size: .85em; }
.blitz-slide ul.contains-task-list > li::before { display: none; }
.blitz-slide ul.contains-task-list { padding-left: 0; }

.blitz-slide blockquote {
  margin: 0; padding: 4px 0 4px 30px; border-left: 3px solid var(--blitz-accent);
  font-size: 1.15em; line-height: 1.35; font-style: italic;
}
.blitz-slide blockquote p + p { margin-top: .5em; font-style: normal; color: var(--blitz-fg-muted); font-size: .7em; }

.blitz-slide code {
  font-family: var(--blitz-font-mono); font-size: .8em; font-variant-numeric: normal;
  background: var(--blitz-surface-2); border-radius: 3px; padding: .08em .32em;
}
.blitz-slide pre {
  margin: 0; padding: 20px 26px; overflow: hidden;
  background: var(--blitz-surface); border-top: 3px solid var(--blitz-fg); border-bottom: 1px solid var(--blitz-rule);
  font-size: 22px; line-height: 1.5;
}
.blitz-slide pre code { background: none; padding: 0; font-size: 1em; color: var(--blitz-code-foreground); }

.blitz-slide table {
  border-collapse: collapse; font: 400 var(--blitz-text-small)/1.35 var(--blitz-font-sans);
  font-variant-numeric: tabular-nums lining-nums;
}
.blitz-slide th, .blitz-slide td { padding: 10px 22px 10px 0; text-align: left; border-bottom: 1px solid var(--blitz-rule); }
.blitz-slide th { border-bottom: 2px solid var(--blitz-fg); font-weight: 700; text-transform: uppercase; font-size: .78em; letter-spacing: .08em; }
.blitz-slide th[align="right"], .blitz-slide td[align="right"] { text-align: right; }
.blitz-slide th[align="center"], .blitz-slide td[align="center"] { text-align: center; }
.blitz-slide th[aria-sort] { color: var(--blitz-accent); }
.blitz-slide table.zebra tbody tr:nth-child(odd) { background: var(--blitz-surface); }

.blitz-slide .callout { padding: 20px 26px; background: var(--blitz-surface); border-left: 4px solid var(--blitz-accent); }
.blitz-slide .columns { display: flex; gap: 48px; align-items: flex-start; }
.blitz-slide .columns > * { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--blitz-gap); }
.blitz-slide .muted { color: var(--blitz-fg-muted); }
.blitz-slide .accent { color: var(--blitz-accent); }
.blitz-slide .small { font-size: var(--blitz-text-small); }
.blitz-slide .big { font-size: 1.6em; }
.blitz-slide .center { text-align: center; align-self: center; }

.blitz-slide [data-blitz-block]:has(> .blitz-map-chart) { box-shadow: 0 0 0 1px var(--blitz-rule); }
.blitz-slide [data-blitz-block]:has(> .blitz-embed) {
  background: #fff; box-shadow: 0 0 0 1px var(--blitz-rule), 0 18px 40px rgba(60, 45, 20, .16);
}
.blitz-slide .blitz-embed-fallback { border-radius: 0; max-width: none; max-height: none; }
.blitz-slide .footnotes { margin-top: auto; font: 15px/1.4 var(--blitz-font-sans); color: var(--blitz-fg-muted); }
.blitz-slide .footnotes h2 { display: none; }
.blitz-slide .footnotes ol { gap: 0; }

/* Layouts (syntax.md §10). Geometry comes from layouts.ts; this is the look. */
[data-layout="title"] > [data-slot="main"]::before, [data-layout="end"] > [data-slot="main"]::before,
[data-layout="section"] > [data-slot="main"]::before {
  content: ""; width: 88px; height: 6px; background: var(--blitz-accent); margin-bottom: 6px;
}
[data-layout="title"] h1, [data-layout="end"] h1 { font-size: var(--blitz-title); font-weight: 700; letter-spacing: -0.028em; line-height: 1; }
[data-layout="title"] h1 + p, [data-layout="title"] h2,
[data-layout="end"] h1 + p, [data-layout="end"] h2 { color: var(--blitz-fg-muted); font-weight: 400; font-style: italic; font-size: 36px; }

[data-layout="section"] h1, [data-layout="section"] h2 { font-size: 92px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
[data-layout="section"] p { color: var(--blitz-fg-muted); font-style: italic; }

:is([data-layout="two-col"], [data-layout="three-col"]) > :is([data-slot="middle"], [data-slot="right"]) { position: relative; }
:is([data-layout="two-col"], [data-layout="three-col"]) > :is([data-slot="middle"], [data-slot="right"])::before {
  content: ""; position: absolute; left: -28px; top: 0; bottom: 0; width: 1px; background: var(--blitz-rule);
}

[data-layout="quote"] blockquote {
  border: 0; padding: 0; font-size: 54px; line-height: 1.18; font-weight: 400; letter-spacing: -0.01em;
}
[data-layout="quote"] blockquote::before {
  content: "\\201C"; display: block; height: .5em; font-size: 2.4em; line-height: 1;
  color: var(--blitz-accent); font-style: normal; font-weight: 700;
}
[data-layout="quote"] blockquote + p {
  font: 600 var(--blitz-text-small)/1.3 var(--blitz-font-sans);
  text-transform: uppercase; letter-spacing: .1em; color: var(--blitz-fg-muted);
}
[data-layout="quote"] blockquote + p::before { content: "\\2014\\2002"; color: var(--blitz-accent); }

[data-layout="stat-grid"] > [data-slot="main"] > div { padding-top: 18px; border-top: 3px solid var(--blitz-fg); }
[data-layout="stat-grid"] > [data-slot="main"] > div > :first-child { font-variant-numeric: lining-nums tabular-nums; font-weight: 700; }
[data-layout="stat-grid"] > [data-slot="main"] > div > :not(:first-child) {
  font: 400 var(--blitz-text-small)/1.35 var(--blitz-font-sans); color: var(--blitz-fg-muted);
}

[data-layout="full-bleed"] { background-image: none; color: #fbf8f1; }
[data-layout="full-bleed"] > [data-slot="main"]::before {
  content: ""; position: absolute; inset: 0; z-index: -1;
  background: linear-gradient(to top, rgba(20, 16, 10, .85), rgba(20, 16, 10, .15) 60%, transparent);
}

[data-layout="code"] pre { font-size: 26px; }
`,
})
