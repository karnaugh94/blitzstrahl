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
.blitz-sr {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}

[data-blitz-hidden] { visibility: hidden !important; }
[data-blitz-box] { display: inline-block; }
[data-blitz-block] { position: relative; }

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
