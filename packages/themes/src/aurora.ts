import { defineTheme } from './theme.js'

/** aurora — dark, technical (PLAN §5). */
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
    'chart-1': '#6ff0c0',
    'chart-2': '#8f9dff',
    'chart-3': '#ffb86b',
    'chart-4': '#ff7aa2',
    'chart-5': '#5ad1ff',
    'chart-6': '#d7a6ff',
    'chart-7': '#f3e36b',
    'chart-8': '#97a2b9',
  },
  css: /* css */ `
.blitz-slide {
  padding: var(--blitz-pad-y) var(--blitz-pad-x);
  color: var(--blitz-fg);
  background-color: var(--blitz-bg);
  background-image:
    radial-gradient(900px 520px at 100% 0%, var(--blitz-bg-glow-2), transparent 70%),
    radial-gradient(760px 480px at 0% 100%, var(--blitz-bg-glow-1), transparent 70%);
  font: 400 var(--blitz-text)/1.45 var(--blitz-font-sans);
  font-feature-settings: "ss01", "cv11";
  -webkit-font-smoothing: antialiased;
  display: none; flex-direction: column; gap: var(--blitz-gap);
}
.blitz-slide[data-blitz-current] { display: flex; }
.blitz-slide > * { margin: 0; }

h1, h2, h3, h4 { margin: 0; line-height: 1.1; letter-spacing: -0.02em; font-weight: 700; }
h1 { font-size: var(--blitz-h1); }
h2 { font-size: var(--blitz-h2); }
h3 { font-size: var(--blitz-h3); color: var(--blitz-accent); letter-spacing: -0.01em; }
h4 { font-size: var(--blitz-text); color: var(--blitz-fg-muted); text-transform: uppercase; letter-spacing: .08em; }
h1 + *, h2 + * { margin-top: 4px; }

p { margin: 0; }
strong { color: #fff; font-weight: 650; }
em { color: var(--blitz-accent); font-style: normal; }
a { color: var(--blitz-link); text-decoration: underline; text-decoration-thickness: .06em; text-underline-offset: .18em; }
del { color: var(--blitz-fg-muted); }
hr { border: 0; border-top: 2px solid var(--blitz-rule); width: 100%; margin: 4px 0; }
img { max-width: 100%; max-height: 100%; border-radius: var(--blitz-radius); }

ul, ol { margin: 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: .35em; }
ul { list-style: none; padding-left: 1.1em; }
ul > li { position: relative; }
ul > li::before {
  content: ""; position: absolute; left: -1.05em; top: .58em;
  width: .42em; height: .42em; border-radius: 2px; transform: rotate(45deg);
  background: linear-gradient(135deg, var(--blitz-accent), var(--blitz-accent-2));
}
ol > li::marker { color: var(--blitz-accent); font-weight: 700; font-variant-numeric: tabular-nums; }
li > ul, li > ol { margin-top: .35em; font-size: .85em; }
ul.contains-task-list > li::before { display: none; }
ul.contains-task-list { padding-left: 0; }

blockquote {
  margin: 0; padding: 8px 0 8px 32px; border-left: 4px solid var(--blitz-accent);
  font-size: 1.15em; line-height: 1.4; color: var(--blitz-fg);
}
blockquote p + p { margin-top: .5em; color: var(--blitz-fg-muted); font-size: .75em; }

code {
  font-family: var(--blitz-font-mono); font-size: .86em;
  background: var(--blitz-surface-2); border-radius: 6px; padding: .08em .35em;
}
pre {
  margin: 0; padding: 22px 26px; overflow: hidden;
  background: var(--blitz-surface); border: 1px solid var(--blitz-rule); border-radius: var(--blitz-radius);
  font-size: 22px; line-height: 1.5;
}
pre code { background: none; padding: 0; font-size: 1em; }

table { border-collapse: collapse; font-size: var(--blitz-text-small); font-variant-numeric: tabular-nums; }
th, td { padding: 10px 22px; text-align: left; border-bottom: 1px solid var(--blitz-rule); }
th { color: var(--blitz-fg-muted); font-weight: 600; text-transform: uppercase; font-size: .8em; letter-spacing: .06em; }
th[align="right"], td[align="right"] { text-align: right; }
th[align="center"], td[align="center"] { text-align: center; }
table.zebra tbody tr:nth-child(odd) { background: color-mix(in srgb, var(--blitz-surface-2) 70%, transparent); }

.callout {
  padding: 22px 28px; border-radius: var(--blitz-radius);
  background: color-mix(in srgb, var(--blitz-accent) 9%, var(--blitz-surface));
  border: 1px solid color-mix(in srgb, var(--blitz-accent) 35%, transparent);
}
.columns { display: flex; gap: 48px; align-items: flex-start; }
.columns > * { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--blitz-gap); }
.muted { color: var(--blitz-fg-muted); }
.accent { color: var(--blitz-accent); }
.small { font-size: var(--blitz-text-small); }
.big { font-size: 1.6em; }
.center { text-align: center; align-self: center; }

[data-blitz-block] { width: 100%; height: var(--blitz-block-height); flex: none; }
.footnotes { margin-top: auto; font-size: 16px; color: var(--blitz-fg-muted); }
.footnotes h2 { display: none; }
.footnotes ol { gap: 0; }

/* Slide 1 defaults to the title layout (syntax.md §2.5). */
.blitz-slide[data-layout="title"] { justify-content: center; }
.blitz-slide[data-layout="title"] h1 {
  font-size: var(--blitz-title); letter-spacing: -0.035em; width: fit-content;
  background: linear-gradient(100deg, #fff 30%, var(--blitz-accent) 75%, var(--blitz-accent-2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  padding-bottom: .08em;
}
.blitz-slide[data-layout="title"] h1 + p, .blitz-slide[data-layout="title"] h2 { color: var(--blitz-fg-muted); font-weight: 400; font-size: 34px; }
`,
})
