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
.blitz-slide[data-blitz-current], .blitz-slide[data-blitz-outgoing] { display: block; }
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

.blitz-block-error {
  font: 14px/1.4 ui-monospace, monospace; color: #b00020; background: #fff0f0;
  border: 1px solid #f3b5b5; padding: 12px; white-space: pre-wrap; border-radius: 6px;
}
`
