/**
 * Layout geometry shared by every theme (syntax.md §10, PLAN §5 layer 2):
 * which slot goes where. Themes add the look on top, and may override any
 * of it. Reads only tokens every theme defines (`pad-x`, `pad-y`, `gap`).
 *
 * DOM: `<section class="blitz-slide" data-layout>` holding
 * `<div class="blitz-slot" data-slot>` children, `main` first.
 */
export const layoutCss = /* css */ `
.blitz-slide[data-blitz-current], .blitz-slide[data-blitz-outgoing], .blitz-slide[data-blitz-measure], .blitz-thumb-canvas > .blitz-slide, .blitz-print > .blitz-slide { display: grid; }
.blitz-slide {
  padding: var(--blitz-pad-y) var(--blitz-pad-x);
  grid-template: "main" minmax(0, 1fr) / minmax(0, 1fr);
  gap: var(--blitz-gap) 56px;
}
.blitz-slot {
  display: flex; flex-direction: column; gap: var(--blitz-gap);
  min-width: 0; min-height: 0;
}
.blitz-slot > * { margin: 0; }
.blitz-slot[data-slot="main"] { grid-area: main; }
.blitz-slot[data-slot="left"] { grid-area: left; }
.blitz-slot[data-slot="middle"] { grid-area: middle; }
.blitz-slot[data-slot="right"] { grid-area: right; }
.blitz-slot[data-slot="image"] { grid-area: image; }

/*
 * Chrome (syntax.md §3.6): footer, number and logo, laid over the slide in its
 * padding; title, author and date hidden until a theme places them. Rules are
 * .blitz-chrome [data-chrome], which beats a theme's .blitz-slide img
 * and loses to its own chrome rules, which come later.
 */
.blitz-chrome { position: absolute; inset: 0; pointer-events: none; }
.blitz-chrome > * { position: absolute; margin: 0; pointer-events: auto; }
.blitz-chrome :is([data-chrome="footer"], [data-chrome="number"]) {
  bottom: calc(var(--blitz-pad-y) / 2); transform: translateY(50%);
  font-size: var(--blitz-text-small); line-height: 1.2; color: var(--blitz-fg-muted);
  white-space: nowrap;
}
.blitz-chrome [data-chrome="footer"] { left: var(--blitz-pad-x); max-width: calc(100% - 2 * var(--blitz-pad-x) - 8em); overflow: hidden; text-overflow: ellipsis; }
.blitz-chrome [data-chrome="number"] { right: var(--blitz-pad-x); font-variant-numeric: tabular-nums; }
.blitz-chrome [data-chrome="logo"] {
  top: calc(var(--blitz-pad-y) / 2); right: var(--blitz-pad-x); transform: translateY(-50%);
  height: calc(var(--blitz-pad-y) * .6); width: auto; max-width: none; border-radius: 0;
}
.blitz-chrome :is([data-chrome="title"], [data-chrome="author"], [data-chrome="date"]) { display: none; }
:where(.blitz-slide:is([data-layout="title"], [data-layout="section"], [data-layout="end"])) .blitz-chrome [data-chrome="number"] { display: none; }

/* Render blocks in a column or beside an image fill the space left. */
.blitz-slide :is([data-slot="left"], [data-slot="middle"], [data-slot="right"], [data-slot="image"]) > [data-blitz-block] {
  flex: 1 1 0; height: auto; min-height: 200px;
}

.blitz-slide:is([data-layout="title"], [data-layout="section"], [data-layout="end"], [data-layout="quote"]) > [data-slot="main"] {
  justify-content: center;
}
.blitz-slide:is([data-layout="section"], [data-layout="end"]) > [data-slot="main"] {
  align-items: center; text-align: center;
}

.blitz-slide[data-layout="two-col"] {
  grid-template: "main main" auto "left right" minmax(0, 1fr) / minmax(0, 1fr) minmax(0, 1fr);
}
.blitz-slide[data-layout="three-col"] {
  grid-template: "main main main" auto "left middle right" minmax(0, 1fr) / minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
}

.blitz-slide[data-layout="quote"] > [data-slot="main"] { padding: 0 6%; }

.blitz-slide[data-layout="stat-grid"] > [data-slot="main"] {
  flex-flow: row wrap; align-content: flex-start;
}
[data-layout="stat-grid"] > [data-slot="main"] > :not(div) { flex: 0 0 100%; }
[data-layout="stat-grid"] > [data-slot="main"] > div {
  flex: 1 1 0; min-width: 180px; display: flex; flex-direction: column; gap: 8px;
}
[data-layout="stat-grid"] > [data-slot="main"] > div > :first-child {
  font-size: 2.8em; font-weight: 800; line-height: 1; letter-spacing: -0.03em;
}

.blitz-slide[data-layout="full-bleed"] { padding: 0; }
[data-layout="full-bleed"] > [data-slot="main"] {
  position: relative; isolation: isolate; justify-content: flex-end;
  padding: var(--blitz-pad-y) var(--blitz-pad-x);
}
[data-layout="full-bleed"] > [data-slot="main"] > :is(p:has(> img:only-child), [data-blitz-block]) {
  position: absolute; inset: 0; z-index: -2; width: auto; height: auto;
}
[data-layout="full-bleed"] > [data-slot="main"] > p > img:only-child {
  width: 100%; height: 100%; max-width: none; max-height: none; object-fit: cover; border-radius: 0; display: block;
}

.blitz-slide:is([data-layout="image-left"], [data-layout="image-right"]) { padding: 0; column-gap: 0; }
.blitz-slide[data-layout="image-left"] { grid-template: "image main" minmax(0, 1fr) / minmax(0, 1fr) minmax(0, 1fr); }
.blitz-slide[data-layout="image-right"] { grid-template: "main image" minmax(0, 1fr) / minmax(0, 1fr) minmax(0, 1fr); }
:is([data-layout="image-left"], [data-layout="image-right"]) > [data-slot="main"] {
  padding: var(--blitz-pad-y) calc(var(--blitz-pad-x) * .7); justify-content: center;
}
:is([data-layout="image-left"], [data-layout="image-right"]) > [data-slot="image"] { gap: 0; }
[data-slot="image"] > p:has(> img:only-child) { flex: 1 1 0; min-height: 0; }
[data-slot="image"] > p > img:only-child {
  width: 100%; height: 100%; max-width: none; max-height: none; object-fit: cover; border-radius: 0; display: block;
}

.blitz-slide[data-layout="code"] > [data-slot="main"] > pre { flex: 1 1 auto; min-height: 0; }
`
