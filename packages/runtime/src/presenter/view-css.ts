/** Presenter view styles. Injected by the view, so audience pages never carry them. */
export const presenterCss = /* css */ `
body.blitz-presenter-mode { background: #0a0c13; overflow: hidden; }
.blitz-presenter-mode > .blitz-viewport { display: none; }
.bp {
  position: fixed; inset: 0; box-sizing: border-box; padding: 14px;
  display: grid; gap: 14px;
  grid-template: "bar bar" auto "current side" minmax(0, 1fr) / minmax(0, 1.7fr) minmax(320px, 1fr);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #e9edf5;
  --bp-accent: var(--blitz-accent, #6ff0c0);
}
.bp button {
  font: inherit; color: inherit; cursor: pointer; white-space: nowrap;
  background: #1a2033; border: 1px solid #2b3450; border-radius: 8px; padding: 6px 12px;
}
.bp button:hover { background: #222a42; }
.bp button[aria-pressed="true"] { background: #f3f3f3; color: #000; border-color: #f3f3f3; }
.bp :focus-visible { outline: 2px solid var(--bp-accent); outline-offset: 2px; }
.bp h2 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: #97a2b9; }

.bp-bar { grid-area: bar; display: flex; align-items: center; gap: 10px; min-width: 0; }
.bp-where { display: flex; flex-direction: column; min-width: 0; margin-left: 6px; }
.bp-position { font-weight: 600; font-variant-numeric: tabular-nums; }
.bp-title { color: #97a2b9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bp-spacer { flex: 1; }
.bp-elapsed { font: 600 30px/1 ui-monospace, "SF Mono", Menlo, monospace; font-variant-numeric: tabular-nums; margin-right: 2px; }
.bp-clock { font-variant-numeric: tabular-nums; color: #97a2b9; margin: 0 6px; }
.bp-status { font-size: 13px; padding: 3px 10px; border-radius: 99px; background: #3a2a14; color: #ffcf8a; }
.bp-status[data-status="connected"] { background: #133528; color: #8ff0c8; }
.bp-status[data-status="none"] { background: #3a1820; color: #ff9fb2; }

.bp-current { grid-area: current; position: relative; display: flex; align-items: center; justify-content: center; min-height: 0; }
.bp-current > .bp-frame { width: 100%; max-height: 100%; }
.bp-frame { position: relative; width: 100%; border-radius: 8px; overflow: hidden; background: #000; }
.bp-frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; }
/* Drawing and pointing on the current preview (ink.ts). */
.bp[data-tool="laser"] .bp-current .bp-frame { cursor: none; }
.bp[data-tool="pen"] .bp-current .bp-frame { cursor: crosshair; touch-action: none; }
.bp-black, .bp-end {
  position: absolute; inset: 0; display: none; place-items: center;
  font-weight: 600; letter-spacing: .04em; color: #fff; background: rgba(0, 0, 0, .72);
}
.bp[data-blackout] .bp-black { display: grid; }
.bp[data-at-end] .bp-end { display: grid; background: #000; }
.bp-connect {
  position: absolute; inset: 0; display: flex; flex-direction: column; gap: 14px;
  align-items: center; justify-content: center; text-align: center; padding: 24px;
  background: rgba(10, 12, 19, .9); border-radius: 8px;
}
.bp-connect[hidden] { display: none; }
.bp-connect p { max-width: 460px; margin: 0; color: #c3cad9; }
.bp-connect button { background: var(--bp-accent); color: #04120c; border: 0; font-weight: 600; padding: 10px 18px; }

.bp-side { grid-area: side; display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.bp-next { display: flex; flex-direction: column; gap: 8px; flex: none; }
.bp-notes-pane {
  flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px;
  background: #121726; border: 1px solid #222a40; border-radius: 10px; padding: 12px 16px;
}
.bp-notes-tools { display: flex; align-items: center; gap: 6px; }
.bp-notes-tools h2 { flex: 1; }
.bp-notes-tools button { padding: 2px 10px; }
.bp-notes { overflow-y: auto; line-height: 1.5; padding-right: 4px; }
.bp-notes > :first-child { margin-top: 0; }
.bp-notes p, .bp-notes ul, .bp-notes ol { margin: 0 0 .6em; }
.bp-notes code { font: .88em ui-monospace, monospace; background: #1c2338; padding: .05em .3em; border-radius: 4px; }
.bp-notes strong { color: #fff; }
.bp-notes a { color: #8fd8ff; }
.bp-muted { color: #6f7a93; font-style: italic; }

@media (max-width: 900px) {
  .bp { grid-template: "bar" auto "current" auto "side" minmax(0, 1fr) / 100%; }
  .bp-bar { flex-wrap: wrap; }
}
`
