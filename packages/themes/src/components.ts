/**
 * Components (syntax.md §5.1, docs/themes.md "Components"): `as=` puts
 * `data-as` on a list, table or container, and these rules draw it from the
 * tokens alone, so a tokens-only theme has every one.
 *
 * Rules are `.blitz-slide [data-as=…]`, (0,2,0) or more: enough to beat a
 * theme's `.blitz-slide ul` (bullets, padding, flex), and a theme's rule of
 * the same form, later in the page, beats them. Only CSS: they print.
 *
 * `--_m` (marker size), `--_cols` (grid columns) and `--_gap` are private.
 * An arrow is a box clipped to an arrow's shape; everything that joins two
 * items belongs to the later one, so it arrives with it under `reveal=items`.
 */
const ARROW = 'polygon(0 calc(50% - 1.5px), calc(100% - 12px) calc(50% - 1.5px), calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, calc(100% - 12px) calc(50% + 1.5px), 0 calc(50% + 1.5px))'
const BLOCK_ARROW = 'polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%)'

/** A card's look: cards, flow boxes, stats. The border shows when `surface` is `bg`. */
const BOX = `
  padding: 20px 24px; border-radius: var(--blitz-radius);
  background: var(--blitz-surface);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--blitz-fg) 14%, transparent);`

/** Grid columns by item count: up to four in a row; 5, 6 and 9 make rows of three. */
const COLS = (sel: string) => `
.blitz-slide ${sel} { --_cols: 4; display: grid; grid-template-columns: repeat(var(--_cols), minmax(0, 1fr)); gap: var(--blitz-gap); }
.blitz-slide ${sel}:not(:has(> :nth-child(2))) { --_cols: 1; }
.blitz-slide ${sel}:has(> :nth-child(2):last-child) { --_cols: 2; }
.blitz-slide ${sel}:has(> :nth-child(3):last-child) { --_cols: 3; }
.blitz-slide ${sel}:has(> :is(:nth-child(5), :nth-child(6), :nth-child(9)):last-child) { --_cols: 3; }`

export const componentCss = /* css */ `
/* Every component: no list look of the theme's. */
.blitz-slide [data-as] { list-style: none; margin: 0; padding: 0; }
.blitz-slide [data-as] > li { position: relative; margin: 0; padding: 0; }
.blitz-slide [data-as] > li::before { content: none; }
.blitz-slide [data-as] > li::marker { content: none; }
.blitz-slide [data-as] > * > * { margin: 0; }

/* An item's first paragraph or heading is its title; the rest, its description. */
.blitz-slide :is([data-as="steps"], [data-as="timeline"], [data-as="chevrons"], [data-as="flow"], [data-as="cards"]) > * { font-weight: 700; line-height: 1.25; }
.blitz-slide :is([data-as="steps"], [data-as="timeline"], [data-as="chevrons"], [data-as="flow"], [data-as="cards"]) > * > :not(:first-child) {
  font-weight: 400; color: var(--blitz-fg-muted); font-size: var(--blitz-text-small); line-height: 1.35;
}
.blitz-slide [data-as] > .accent > :not(:first-child) { color: inherit; opacity: .85; }

/* steps: a numbered marker, an arrow from the one before, the text below. */
.blitz-slide [data-as="steps"] {
  --_m: 48px; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr);
  gap: var(--blitz-gap); counter-reset: blitz-item;
}
.blitz-slide [data-as="steps"] > li { counter-increment: blitz-item; display: flex; flex-direction: column; gap: 10px; }
.blitz-slide :is([data-as="steps"], [data-as="timeline"]) > li::before {
  content: counter(blitz-item); position: relative; z-index: 1; flex: none;
  width: var(--_m); height: var(--_m); border-radius: 50%; margin-bottom: 6px;
  display: grid; place-items: center; transform: none;
  background: var(--blitz-marker); color: var(--blitz-marker-fg);
  font: 700 var(--blitz-text-small)/1 var(--blitz-font-sans); font-variant-numeric: tabular-nums;
}
.blitz-slide :is(ul[data-as="steps"], ul[data-as="timeline"]) > li::before { content: ""; }
.blitz-slide :is([data-as="steps"], [data-as="timeline"]) > li.accent::before { background: var(--blitz-accent); color: var(--blitz-accent-fg); }
.blitz-slide :is([data-as="steps"], [data-as="timeline"]) > li.accent > :first-child { color: var(--blitz-accent); }
.blitz-slide [data-as="steps"] > li + li::after {
  content: ""; position: absolute; height: 14px; top: calc(var(--_m) / 2 - 7px);
  left: calc(-100% - var(--blitz-gap) + var(--_m) + 10px); right: calc(100% + 10px);
  background: var(--blitz-connector); clip-path: ${ARROW};
}

/* timeline: a line with an arrowhead, a stop per item, the text centred below. */
.blitz-slide [data-as="timeline"] {
  --_m: 48px; position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr);
  gap: var(--blitz-gap); counter-reset: blitz-item;
}
.blitz-slide [data-as="timeline"]::before {
  content: ""; position: absolute; left: 0; right: 10px; top: calc(var(--_m) / 2 - 2px); height: 4px;
  background: var(--blitz-connector);
}
.blitz-slide [data-as="timeline"]::after {
  content: ""; position: absolute; right: 0; top: calc(var(--_m) / 2 - 10px); width: 18px; height: 20px;
  background: var(--blitz-connector); clip-path: polygon(0 0, 100% 50%, 0 100%);
}
.blitz-slide [data-as="timeline"] > li {
  counter-increment: blitz-item; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px;
}

/* chevrons: a road of arrows. */
.blitz-slide [data-as="chevrons"] { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px; }
.blitz-slide [data-as="chevrons"] > li {
  min-height: 104px; padding: 14px 40px 14px 50px; display: flex; flex-direction: column; justify-content: center; text-align: center; gap: 4px;
  background: color-mix(in srgb, var(--blitz-accent) 14%, var(--blitz-surface-2));
  clip-path: polygon(0 0, calc(100% - 30px) 0, 100% 50%, calc(100% - 30px) 100%, 0 100%, 30px 50%);
}
.blitz-slide [data-as="chevrons"] > li:first-child { padding-left: 26px; clip-path: polygon(0 0, calc(100% - 30px) 0, 100% 50%, calc(100% - 30px) 100%, 0 100%); }
.blitz-slide :is([data-as="chevrons"], [data-as="flow"], [data-as="cards"]) > .accent { background: var(--blitz-accent); color: var(--blitz-accent-fg); }

/* flow: boxes, an arrow into each but the first. */
.blitz-slide [data-as="flow"] { --_gap: 64px; display: flex; flex-flow: row nowrap; align-items: stretch; gap: var(--_gap); }
.blitz-slide [data-as="flow"] > * {
  flex: 1 1 0; min-width: 0; position: relative; display: flex; flex-direction: column; justify-content: center; gap: 6px;
  text-align: center; ${BOX}
}
.blitz-slide [data-as="flow"] > * + *::before, .blitz-slide [data-as="flow"] > li + li::before {
  content: ""; position: absolute; top: calc(50% - 14px); height: 28px;
  right: calc(100% + 10px); width: calc(var(--_gap) - 20px);
  background: var(--blitz-connector); clip-path: ${BLOCK_ARROW};
}

/* cards: a grid of boxes. */
${COLS('[data-as="cards"]')}
.blitz-slide [data-as="cards"] > * { display: flex; flex-direction: column; gap: 10px; ${BOX} }
.blitz-slide :is([data-as="flow"], [data-as="cards"]) > .accent :is(h1, h2, h3, h4, strong, em, a) { color: inherit; }

/* compare: before → after. The arrow belongs to the "after" side. */
.blitz-slide table[data-as="compare"] { width: 100%; border-collapse: collapse; }
.blitz-slide table[data-as="compare"] :is(th, td):last-child { position: relative; padding-left: 104px; }
.blitz-slide table[data-as="compare"] th { text-align: left; }
.blitz-slide table[data-as="compare"] :is(th, td):first-child { color: var(--blitz-fg-muted); }
.blitz-slide table[data-as="compare"] :is(th, td):last-child { color: var(--blitz-accent); font-weight: 700; }
.blitz-slide table[data-as="compare"] td:last-child::before {
  content: ""; position: absolute; left: 24px; top: calc(50% - 13px); width: 60px; height: 26px;
  background: var(--blitz-connector); clip-path: ${BLOCK_ARROW};
}
.blitz-slide div[data-as="compare"] { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 128px; align-items: center; }
.blitz-slide div[data-as="compare"] > * { position: relative; display: flex; flex-direction: column; gap: var(--blitz-gap); }
.blitz-slide div[data-as="compare"] > :first-child { color: var(--blitz-fg-muted); }
.blitz-slide div[data-as="compare"] > :last-child { color: var(--blitz-accent); }
.blitz-slide div[data-as="compare"] > :last-child::before {
  content: ""; position: absolute; right: calc(100% + 24px); top: calc(50% - 20px); width: 80px; height: 40px;
  background: var(--blitz-connector); clip-path: ${BLOCK_ARROW};
}

/* stats: the stat-grid layout's figures, anywhere. */
${COLS('[data-as="stats"]')}
.blitz-slide [data-as="stats"] > * { display: flex; flex-direction: column; gap: 8px; ${BOX} }
.blitz-slide [data-as="stats"] > * > :first-child {
  font-size: 2.8em; font-weight: 800; line-height: 1; letter-spacing: -0.03em;
  color: var(--blitz-accent); font-variant-numeric: tabular-nums;
}
.blitz-slide [data-as="stats"] > * > :not(:first-child) { color: var(--blitz-fg-muted); font-size: var(--blitz-text-small); }
`
