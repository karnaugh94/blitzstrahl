/**
 * Structural CSS the runtime depends on: viewport, scaled stage, slide
 * visibility, step states, emphasis effects. Themes style everything else.
 *
 * Kept free of DOM access so the CLI can import it in Node
 * (`@blitzstrahl/runtime/css`).
 */
export const runtimeCss = /* css */ `
html, body { margin: 0; height: 100%; }
body { background: var(--blitz-letterbox, #000); overflow: hidden; }
.blitz-viewport {
  position: fixed; inset: 0; overflow: hidden;
  touch-action: pan-y pinch-zoom;
  -webkit-tap-highlight-color: transparent;
}
.blitz-viewport[data-blitz-gutter="left"] { cursor: w-resize; }
.blitz-viewport[data-blitz-gutter="right"] { cursor: e-resize; }
.blitz-stage {
  position: absolute; left: 0; top: 0;
  width: var(--blitz-canvas-w); height: var(--blitz-canvas-h);
  transform-origin: 0 0;
  transform: translate(var(--blitz-offset-x, 0px), var(--blitz-offset-y, 0px)) scale(var(--blitz-scale, 1));
  overflow: hidden;
}
.blitz-slide {
  position: absolute; inset: 0; box-sizing: border-box;
  display: none;
  background-size: cover; background-position: center;
}
.blitz-slide[data-blitz-current], .blitz-slide[data-blitz-outgoing], .blitz-slide[data-blitz-measure], .blitz-thumb-canvas > .blitz-slide { display: block; }

/* Print layout (print.ts): while it exists, it's the whole page. */
html[data-blitz-printing], html[data-blitz-printing] body { height: auto; overflow: visible; background: none; }
html[data-blitz-printing] body > :is(.blitz-viewport, .blitz-blackout, .blitz-layer, .blitz-overflow-badge) { display: none !important; }
/* Anything else in <body> is a library measuring text (mermaid, d3): it has
   to stay laid out to be measured, so it moves off the pages instead. */
html[data-blitz-printing] body > :not(.blitz-print, .blitz-viewport, .blitz-blackout, .blitz-layer, .blitz-overflow-badge) {
  position: absolute !important; left: -100000px !important; top: 0 !important;
}
/* Where a renderer lays something out to measure it: off screen and unscaled. */
.blitz-scratch { position: absolute; left: -100000px; top: 0; width: 1280px; pointer-events: none; }
.blitz-print > .blitz-slide {
  display: block; position: relative; inset: auto; overflow: hidden;
  width: var(--blitz-canvas-w); height: var(--blitz-canvas-h);
  break-after: page; break-inside: avoid;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

/* Overflow detector (overflow.ts): slides are measured as hidden clones. */
.blitz-measure { position: absolute; inset: 0; visibility: hidden; pointer-events: none; }
[data-blitz-overflow] { outline: 3px dashed #ff4d6d !important; outline-offset: 2px; }
.blitz-overflow-badge {
  position: fixed; left: 12px; top: 12px; z-index: 45; max-width: min(560px, calc(100vw - 24px));
  font: 600 13px/1.4 system-ui, sans-serif; color: #fff; background: #c2183f;
  padding: 8px 12px; border-radius: 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, .4); pointer-events: none;
}
.blitz-overflow-badge[hidden] { display: none; }
.blitz-overflow-badge ul { margin: 4px 0 0; padding-left: 18px; font-weight: 400; }
.blitz-slide[data-blitz-outgoing] { pointer-events: none; }

/* Ink (ink.ts): drawing and the laser pointer, over the slides, in canvas pixels. */
.blitz-ink { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 5; pointer-events: none; overflow: visible; }
.blitz-stroke { fill: none; stroke-linecap: round; stroke-linejoin: round; }
.blitz-laser {
  fill: var(--blitz-laser, #ff3344);
  filter: drop-shadow(0 0 5px var(--blitz-laser, #ff3344)) drop-shadow(0 0 14px var(--blitz-laser, #ff3344));
}
.blitz-laser-trail {
  fill: none; stroke: var(--blitz-laser, #ff3344); stroke-width: 8; opacity: .4;
  stroke-linecap: round; stroke-linejoin: round;
}
.blitz-viewport[data-blitz-tool="laser"] { cursor: none; }
.blitz-viewport[data-blitz-tool="pen"] { cursor: crosshair; touch-action: none; }

/* Slide transitions (transitions.ts). The stage is snapshotted on its own,
   and its pseudo-elements are animated from script. */
:root { view-transition-name: none; }
.blitz-stage { view-transition-name: blitz-stage; }
::view-transition-group(blitz-stage) { animation: none; }
::view-transition-image-pair(blitz-stage) { overflow: clip; }
::view-transition-old(blitz-stage), ::view-transition-new(blitz-stage) {
  animation: none; mix-blend-mode: normal; height: 100%;
}
:root[data-blitz-vt-top="old"]::view-transition-old(blitz-stage) { z-index: 1; }
/* auto-animate: the old side of each morphing pair (\`blitz-morph-*\`) fades
   out, at the transition's duration; transitions.ts moves it. */
:root[data-blitz-vt-morph]::view-transition-old(*) {
  animation-duration: var(--blitz-vt-dur); animation-timing-function: var(--blitz-vt-ease);
}
/* Magic move (code-morph.ts): code lifted above both slides while it moves. */
.blitz-slide[data-blitz-lift] { display: block; z-index: 3; background: none !important; pointer-events: none; }
.blitz-slide[data-blitz-lift]::before, .blitz-slide[data-blitz-lift]::after,
[data-blitz-lift-chain]::before, [data-blitz-lift-chain]::after { content: none !important; }
[data-blitz-tokens] .line > span, .blitz-slide[data-blitz-lift] .line > span { display: inline-block; }
.blitz-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}

[data-blitz-hidden] { visibility: hidden !important; }
[data-blitz-box] { display: inline-block; }
[data-blitz-block] { position: relative; }

/* Embeds (renderers/embed.ts). */
.blitz-embed { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
.blitz-embed iframe { display: block; width: 100%; height: 100%; border: 0; }
.blitz-embed:not([data-loading]) iframe { background: #fff; }
.blitz-embed[data-loading]::before, .blitz-embed-offline {
  position: absolute; inset: 0; margin: 0; display: grid; place-items: center;
  font-size: 20px; opacity: .6;
}
.blitz-embed[data-loading]::before { content: "Loading " attr(data-loading) "\\2026"; }
.blitz-embed-fallback { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }

/* Mermaid (renderers/mermaid.ts): the drawing, centred in its block. */
.blitz-mermaid { position: absolute; inset: 0; display: grid; place-items: center; overflow: hidden; }
.blitz-mermaid > svg { display: block; }

/* Maps (renderers/map.ts): tiles under the chart. Themes filter the tiles
   with --blitz-map-tiles so a light basemap sits in a dark deck. */
.blitz-map-tiles, .blitz-map-chart { position: absolute; inset: 0; overflow: hidden; border-radius: inherit; }
.blitz-map-tiles { filter: var(--blitz-map-tiles, none); }
.blitz-map-tiles > .blitz-tile {
  position: absolute; max-width: none; max-height: none; border-radius: 0;
  user-select: none; pointer-events: none;
}
.blitz-map-attribution {
  position: absolute; right: 0; bottom: 0; padding: 2px 8px; border-top-left-radius: 6px;
  font: 13px/1.5 system-ui, sans-serif; color: #333; background: rgba(255, 255, 255, .75);
}

/* Sortable tables (renderers/table.ts): header buttons that look like headers. */
.blitz-sort {
  all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: .35em;
  font: inherit; color: inherit; letter-spacing: inherit; text-transform: inherit;
}
.blitz-sort:focus-visible { outline: 2px solid var(--blitz-accent, currentColor); outline-offset: 3px; border-radius: 3px; }
.blitz-sort::after {
  content: ""; width: .5em; height: .5em; opacity: .35; flex: none;
  background: currentColor; clip-path: polygon(50% 0, 100% 40%, 0 40%, 50% 0, 50% 100%, 100% 60%, 0 60%, 50% 100%);
}
th[aria-sort="ascending"] > .blitz-sort::after { opacity: 1; clip-path: polygon(50% 15%, 100% 75%, 0 75%); }
th[aria-sort="descending"] > .blitz-sort::after { opacity: 1; clip-path: polygon(0 25%, 100% 25%, 50% 85%); }

[data-blitz-fx="highlight"], [data-blitz-fx="strike"] {
  background-repeat: no-repeat;
  background-size: 0% 100%;
  transition: background-size var(--blitz-fx-dur, 600ms) var(--blitz-fx-ease, cubic-bezier(.16,1,.3,1)) var(--blitz-fx-delay, 0ms);
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
[data-blitz-fx="highlight"] {
  background-image: linear-gradient(var(--blitz-highlight, #ffe16680), var(--blitz-highlight, #ffe16680));
  background-position: 0 88%;
  background-size: 0% 40%;
}
[data-blitz-fx="highlight"][data-blitz-active] { background-size: 100% 40%; }
[data-blitz-fx="strike"] {
  background-image: linear-gradient(currentColor, currentColor);
  background-position: 0 55%;
  background-size: 0% .08em;
}
[data-blitz-fx="strike"][data-blitz-active] { background-size: 100% .08em; }
pre[data-blitz-lines] .line { transition: opacity var(--blitz-fx-dur, 400ms) ease; }
pre[data-blitz-lines-on] .line:not([data-blitz-focus]) { opacity: var(--blitz-dim-opacity, .3); }
[data-blitz-dim] > * { transition: opacity var(--blitz-fx-dur, 600ms) ease; }
[data-blitz-dim] > :not([data-blitz-active]) { opacity: var(--blitz-dim-opacity, .3); }

.blitz-snap, .blitz-snap * { transition: none !important; }
@media (prefers-reduced-motion: reduce) {
  .blitz-stage, .blitz-stage * { transition: none !important; animation: none !important; }
}

/* Overlays (ui.ts): outside the viewport, never scaled. */
.blitz-blackout {
  position: fixed; inset: 0; background: #000; z-index: 50;
  opacity: 0; pointer-events: none; transition: opacity .25s ease;
}
.blitz-blackout[data-blitz-on] { opacity: 1; pointer-events: auto; cursor: none; }
.blitz-layer {
  position: fixed; z-index: 40; box-sizing: border-box;
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #e9edf5; color-scheme: dark;
  --blitz-ui-accent: var(--blitz-accent, #6ff0c0);
}
.blitz-layer :focus-visible { outline: 2px solid var(--blitz-ui-accent); outline-offset: 2px; }
.blitz-overview {
  inset: 0; overflow-y: auto; padding: 32px;
  background: rgba(5, 7, 14, .94); backdrop-filter: blur(6px);
}
.blitz-overview-grid {
  display: grid; gap: 24px; max-width: 1600px; margin: 0 auto;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}
.blitz-thumb {
  all: unset; display: flex; flex-direction: column; gap: 8px; cursor: pointer;
  border-radius: 10px; padding: 6px; min-width: 0;
}
.blitz-thumb[aria-selected="true"] { background: rgba(255, 255, 255, .08); }
.blitz-thumb-frame {
  position: relative; overflow: hidden; border-radius: 6px;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, .12);
}
.blitz-thumb[aria-current="true"] .blitz-thumb-frame { box-shadow: 0 0 0 3px var(--blitz-ui-accent); }
.blitz-thumb-canvas {
  position: absolute; left: 0; top: 0; transform-origin: 0 0;
  transform: scale(var(--blitz-thumb-scale, .2)); pointer-events: none;
}
.blitz-thumb-canvas > .blitz-slide { position: absolute; inset: 0; }
.blitz-thumb-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #97a2b9; }
.blitz-thumb-label b { color: #e9edf5; font-variant-numeric: tabular-nums; margin-right: 4px; }
[data-blitz-placeholder]::before {
  content: attr(data-blitz-placeholder); position: absolute; inset: 0;
  display: grid; place-items: center; font: 600 28px/1 system-ui, sans-serif;
  color: rgba(255, 255, 255, .45); border: 2px dashed rgba(255, 255, 255, .2); border-radius: 12px;
}
.blitz-dialog {
  left: 50%; top: 18%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px));
  background: #121726; border: 1px solid rgba(255, 255, 255, .12); border-radius: 14px;
  padding: 22px 26px; box-shadow: 0 30px 80px rgba(0, 0, 0, .6);
}
.blitz-dialog:focus { outline: none; }
.blitz-dialog h2 { margin: 0 0 12px; font-size: 18px; }
.blitz-dialog-close {
  all: unset; position: absolute; right: 14px; top: 10px; font-size: 22px; cursor: pointer; color: #97a2b9;
}
.blitz-help table { border-collapse: collapse; width: 100%; }
.blitz-help th { text-align: left; font-weight: 400; padding: 5px 16px 5px 0; white-space: nowrap; }
.blitz-help td { color: #97a2b9; padding: 5px 0; }
.blitz-help p { margin: 12px 0 0; color: #97a2b9; }
.blitz-layer kbd {
  font: 13px/1 ui-monospace, monospace; padding: 3px 6px; border-radius: 5px;
  background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .15);
}
.blitz-presenter-link { color: var(--blitz-ui-accent); font-size: 18px; font-weight: 600; }
.blitz-dialog-hint { margin: 12px 0 0; color: #97a2b9; }
.blitz-goto label { display: block; font-weight: 600; margin-bottom: 10px; }
.blitz-goto-input {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 20px; padding: 10px 12px;
  background: #0b0f1b; color: inherit; border: 1px solid rgba(255, 255, 255, .18); border-radius: 8px;
}
.blitz-goto-hint { margin: 10px 0 0; min-height: 1.45em; color: #97a2b9; }

.blitz-block-error {
  font: 14px/1.4 ui-monospace, monospace; color: #b00020; background: #fff0f0;
  border: 1px solid #f3b5b5; padding: 12px; white-space: pre-wrap; border-radius: 6px;
}
`
