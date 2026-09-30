// Runs inside VSCodium or VS Code, against the extension installed from its
// .vsix (run.mjs). CommonJS: the extension host loads it with require.
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const vscode = require('vscode')

const until = async (what, ok, ms = 30_000) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await ok()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}
const codes = (uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'blitzstrahl').map((d) => `${d.code}@${d.range.start.line + 1}`)
const reachable = (url) => fetch(url).then((r) => r.ok, () => false)

exports.run = async () => {
  const done = []
  const step = (s) => done.push(s)
  try {
    const ext = vscode.extensions.getExtension('karnaugh94.blitzstrahl')
    assert.ok(ext, 'the extension is installed')
    step(`installed ${ext.packageJSON.version} from ${ext.extensionPath}`)
    const deck = vscode.Uri.file(process.env.BLITZ_DECK)
    const doc = await vscode.workspace.openTextDocument(deck)
    const editor = await vscode.window.showTextDocument(doc)
    const api = await ext.activate()

    // Problems: opening a deck checks it. Line 9 has a step gap.
    await until('the step gap in Problems', () => codes(deck).includes('step/gap@9'))
    step(`problems on open: ${codes(deck).join(', ')}`)
    // An unmarked markdown file beside it is left alone.
    const readme = await vscode.workspace.openTextDocument(vscode.Uri.file(process.env.BLITZ_README))
    await new Promise((r) => setTimeout(r, 3000))
    assert.deepEqual(codes(readme.uri), [], 'a README is not checked')
    step('README left alone')

    // As you type: an unknown chart key is an error before any save.
    await vscode.workspace.getConfiguration('blitzstrahl').update('check', 'onType', vscode.ConfigurationTarget.Workspace)
    await editor.edit((e) => e.insert(new vscode.Position(15, 0), 'colour: red\n'))
    await until('the unsaved error', () => codes(deck).some((c) => c.startsWith('renderer/chart')))
    assert.ok(doc.isDirty)
    step(`problems as typed, unsaved: ${codes(deck).join(', ')}`)
    await editor.edit((e) => e.delete(new vscode.Range(15, 0, 16, 0)))
    await until('the error gone once the line is', () => !codes(deck).some((c) => c.startsWith('renderer/chart')))
    step('gone with the line, still unsaved')

    // Completion from the schemas: chart types after `type: `.
    const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', deck, new vscode.Position(14, 6))
    const labels = list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label))
    assert.ok(labels.includes('bar') && labels.includes('pie'), `chart types offered: ${labels.slice(0, 10)}`)
    step('completion: chart types after `type:`')

    // The preview: a panel beside, on a dev server, following the cursor.
    await vscode.commands.executeCommand('blitzstrahl.preview')
    const p = await until('the preview', () => api.previews().find((x) => x.visible))
    const tab = await until('the preview tab', () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith('blitzstrahl.preview')), 10_000)
    assert.equal(tab.group.viewColumn, vscode.ViewColumn.Two, 'beside the markdown')
    assert.ok((await (await fetch(p.url)).text()).includes('blitz-payload'), 'the dev server serves the deck')
    step(`preview "${tab.label}" at ${p.url}`)
    editor.selection = new vscode.Selection(20, 0, 20, 0)
    await until('the preview on slide three', () => api.previews()[0].shown === 'three')
    editor.selection = new vscode.Selection(8, 0, 8, 0)
    await until('the preview on slide two', () => api.previews()[0].shown === 'two')
    step('the preview follows the cursor: three, then two')
    // run.mjs --screenshot: hold still while it's taken.
    if (process.env.BLITZ_SHOT) {
      writeFileSync(process.env.BLITZ_SHOT, 'ready')
      await until('the screenshot', () => readFileSync(process.env.BLITZ_SHOT, 'utf8') === 'taken', 20_000)
    }

    // Export PDF, the handout, next to the deck.
    const pdf = await vscode.commands.executeCommand('blitzstrahl.exportPdf', deck, 'handout')
    assert.equal(pdf, deck.fsPath.replace(/\.md$/, '.pdf'))
    assert.equal(readFileSync(pdf).subarray(0, 5).toString(), '%PDF-')
    step(`Export PDF (handout): ${require('node:path').basename(pdf)}, ${readFileSync(pdf).length} bytes`)

    // Closing the panel stops the server.
    await vscode.window.tabGroups.close(tab)
    await until('the server stopped', async () => api.previews().length === 0 && !(await reachable(p.url)))
    step('closing the preview stops its server')

    writeFileSync(process.env.BLITZ_RESULT, JSON.stringify({ ok: true, done }, null, 2))
  } catch (e) {
    writeFileSync(process.env.BLITZ_RESULT, JSON.stringify({ ok: false, done, error: String(e && e.stack || e) }, null, 2))
    throw e
  }
}
