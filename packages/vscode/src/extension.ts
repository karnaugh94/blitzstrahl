/**
 * blitzstrahl for VS Code (PLAN §15, M13; README.md): preview, problems,
 * completion, snippets, Present and Export PDF, all by running the
 * project's own blitzstrahl.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import * as vscode from 'vscode'
import { Checker, type CheckWhen } from './checker.js'
import { atLeast, findCli, nodeCommand, OLDEST, type Cli } from './cli.js'
import { isDeck, markerEdit } from './decks.js'
import { Preview } from './preview.js'
import { keyInfo, keysOf, type Schemas } from './schemas.js'
import { completing, keyAt, type YamlKind } from './yaml-context.js'

const KINDS: readonly YamlKind[] = ['deck', 'slide', 'chart', 'map', 'embed']

/** What the extension tells other extensions (and its own tests): the previews running. */
export interface Api {
  previews(): Array<{ deck: string; url: string; shown: string | undefined; visible: boolean }>
}

export function activate(context: vscode.ExtensionContext): Api {
  const log = vscode.window.createOutputChannel('blitzstrahl')
  const config = () => vscode.workspace.getConfiguration('blitzstrahl')
  const told = new Set<string>()

  /** blitzstrahl for this document, or undefined (having said why, once per folder). */
  const cliFor = (doc: vscode.TextDocument): Cli | undefined => {
    const dir = dirname(doc.uri.fsPath)
    const cliPath = config().get<string>('cliPath') || undefined
    const cli = findCli(dir, cliPath)
    const why = !cli
      ? cliPath
        ? `blitzstrahl.cliPath names ${cliPath}, which isn't there.`
        : `blitzstrahl isn't installed for ${basename(doc.uri.fsPath)}: no node_modules/blitzstrahl in its folder or above. Install it with \`npm install --save-dev blitzstrahl\`.`
      : !cliPath && !atLeast(cli.version)
        ? `The blitzstrahl installed for ${basename(doc.uri.fsPath)} is ${cli.version}; the extension needs ${OLDEST} or later.`
        : undefined
    if (!why) return cli
    if (!told.has(why)) {
      told.add(why)
      void vscode.window.showWarningMessage(why, 'Open Settings').then((a) => {
        if (a) void vscode.commands.executeCommand('workbench.action.openSettings', 'blitzstrahl')
      })
    }
    return undefined
  }

  const node = () => nodeCommand(config().get<string>('nodePath') || undefined)

  const checker = new Checker({ cli: cliFor, node, log })
  context.subscriptions.push(log, checker)

  const isMarkdown = (doc: vscode.TextDocument) => doc.languageId === 'markdown' && doc.uri.scheme === 'file'
  const when = () => config().get<CheckWhen>('check', 'onSave')

  // --- Problems -----------------------------------------------------------
  const consider = (doc: vscode.TextDocument) => {
    if (!isMarkdown(doc)) return
    if (!isDeck(doc.getText()) || when() === 'off') return checker.forget(doc.uri.fsPath)
    checker.schedule(doc, 0, { unsaved: doc.isDirty })
  }
  vscode.workspace.textDocuments.forEach(consider)
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(consider),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      consider(doc)
      // The server reloads on save; the slide under the cursor may have moved.
      const editor = vscode.window.activeTextEditor
      if (editor?.document === doc) void Preview.for(doc.uri.fsPath)?.follow(editor.selection.active.line)
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (isMarkdown(e.document) && when() === 'onType' && e.contentChanges.length && isDeck(e.document.getText())) checker.schedule(e.document, 500, { unsaved: true })
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      checker.forget(doc.uri.fsPath)
      const p = Preview.for(doc.uri.fsPath)
      if (p && !p.visible) p.dispose()
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('blitzstrahl')) vscode.workspace.textDocuments.forEach(consider)
    }),
  )

  // --- The title bar's preview icon: decks only -----------------------------
  const setContext = () => {
    const doc = vscode.window.activeTextEditor?.document
    void vscode.commands.executeCommand('setContext', 'blitzstrahl.isDeck', !!doc && isMarkdown(doc) && isDeck(doc.getText()))
  }
  setContext()
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(setContext),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) setContext()
    }),
  )

  // --- The preview follows the cursor ---------------------------------------
  let followTimer: ReturnType<typeof setTimeout> | undefined
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const p = Preview.for(e.textEditor.document.uri.fsPath)
      if (!p || !config().get<boolean>('preview.followCursor', true)) return
      clearTimeout(followTimer)
      followTimer = setTimeout(() => void p.follow(e.selections[0]!.active.line), 150)
    }),
    { dispose: () => Preview.all().forEach((p) => p.dispose()) },
  )

  // --- Commands ------------------------------------------------------------
  /** The deck a command is about: the active markdown editor's, saved first. Offers the marker if it's missing. */
  const deckForCommand = async (uri?: vscode.Uri): Promise<{ doc: vscode.TextDocument; cli: Cli } | undefined> => {
    const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document
    if (!doc || !isMarkdown(doc)) {
      void vscode.window.showInformationMessage('Open a deck (a markdown file) first.')
      return undefined
    }
    const cli = cliFor(doc)
    if (!cli) return undefined
    if (!isDeck(doc.getText())) {
      const add = await vscode.window.showInformationMessage(
        `${basename(doc.uri.fsPath)} doesn't say it's a blitzstrahl deck. Add \`blitzstrahl:\` to its frontmatter, so it's checked and gets the preview icon?`,
        'Add',
        'Not Now',
      )
      if (add === 'Add') {
        const e = markerEdit(doc.getText(), cli.version)
        const edit = new vscode.WorkspaceEdit()
        edit.insert(doc.uri, new vscode.Position(e.line, 0), e.insert)
        await vscode.workspace.applyEdit(edit)
      }
    }
    if (doc.isDirty) await doc.save()
    return { doc, cli }
  }

  const register = (id: string, fn: (uri?: vscode.Uri, ...rest: unknown[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn))

  register('blitzstrahl.preview', async (uri) => {
    const d = await deckForCommand(uri)
    if (!d) return
    const deck = d.doc.uri.fsPath
    try {
      const p = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'blitzstrahl: starting the preview' }, () => Preview.start(deck, { cli: d.cli, node: node(), log }))
      if (config().get<string>('preview.where', 'beside') === 'browser') await vscode.env.openExternal(vscode.Uri.parse(p.external))
      else {
        p.show()
        const editor = vscode.window.visibleTextEditors.find((e) => e.document === d.doc)
        if (editor) void p.follow(editor.selection.active.line)
      }
    } catch (e) {
      log.appendLine(String((e as Error).message))
      void vscode.window.showErrorMessage(`blitzstrahl: the preview didn't start. ${lastLine((e as Error).message)}`, 'Show Output').then((a) => a && log.show())
    }
  })

  register('blitzstrahl.openInBrowser', async () => {
    const editor = vscode.window.activeTextEditor
    const p = (editor && Preview.for(editor.document.uri.fsPath)) ?? Preview.all()[0]
    if (p) await vscode.env.openExternal(vscode.Uri.parse(p.external))
  })

  register('blitzstrahl.check', async (uri) => {
    const d = await deckForCommand(uri)
    if (!d) return
    const ok = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `blitzstrahl: checking ${basename(d.doc.uri.fsPath)}, network included` }, () => checker.check(d.doc, { network: true }))
    if (ok) void vscode.commands.executeCommand('workbench.actions.view.problems')
    else void vscode.window.showErrorMessage("blitzstrahl: the check didn't run.", 'Show Output').then((a) => a && log.show())
  })

  register('blitzstrahl.present', async (uri) => {
    const d = await deckForCommand(uri)
    if (!d) return
    const n = node()
    const terminal = vscode.window.createTerminal({
      name: `Present ${basename(d.doc.uri.fsPath)}`,
      shellPath: n.command,
      shellArgs: [d.cli.bin, 'present', d.doc.uri.fsPath],
      cwd: dirname(d.doc.uri.fsPath),
      env: n.env as Record<string, string>,
    })
    terminal.show()
  })

  // `kind` skips the question: `executeCommand('blitzstrahl.exportPdf', uri, 'handout')`.
  register('blitzstrahl.exportPdf', async (uri?: vscode.Uri, kind?: unknown) => {
    const d = await deckForCommand(uri)
    if (!d) return
    type Kind = vscode.QuickPickItem & { id: string; flag: string | undefined }
    const kinds: Kind[] = [
      { id: 'slides', label: 'Slides', description: 'a page per slide, at its final step', flag: undefined },
      { id: 'steps', label: 'Steps', description: 'a page for every step', flag: '--steps' },
      { id: 'handout', label: 'Handout', description: 'two slides to a sheet, with their notes', flag: '--notes' },
    ]
    const pick = kinds.find((k) => k.id === kind) ?? (await vscode.window.showQuickPick<Kind>(kinds, { title: `Export ${basename(d.doc.uri.fsPath)} as PDF` }))
    if (!pick) return
    const deck = d.doc.uri.fsPath
    const n = node()
    const args = [d.cli.bin, 'export', deck, ...(pick.flag ? [pick.flag] : [])]
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `blitzstrahl: exporting ${basename(deck)}` }, () => run(n.command, args, dirname(deck), n.env))
    log.append(r.out + r.err)
    if (r.code !== 0) {
      consider(d.doc)
      void vscode.window.showErrorMessage(`blitzstrahl: ${lastLine(r.err) || 'the export failed'}`, 'Show Output').then((a) => a && log.show())
      return
    }
    // `exported talk.pdf (12 pages)`, relative to the folder it ran in.
    const pdf = resolve(dirname(deck), /^exported (.+?) \(/m.exec(r.out)?.[1] ?? deck.replace(/\.md$/i, '.pdf'))
    const pdfUri = vscode.Uri.file(pdf)
    void vscode.window.showInformationMessage(`Exported ${basename(pdf)}.`, 'Open', 'Reveal').then((a) => {
      if (a === 'Open') void vscode.env.openExternal(pdfUri)
      else if (a === 'Reveal') void vscode.commands.executeCommand('revealFileInOS', pdfUri)
    })
    return pdf
  })

  // --- Completion and hover from the schemas --------------------------------
  const schemaCache = new Map<string, Schemas>()
  const schemasFor = (doc: vscode.TextDocument): Schemas => {
    const cli = findCli(dirname(doc.uri.fsPath), config().get<string>('cliPath') || undefined)
    // The installed blitzstrahl's, so they match its version; else the copy we ship.
    const dir = cli ? join(cli.root, 'schema') : context.asAbsolutePath('schema')
    let s = schemaCache.get(dir)
    if (!s) {
      s = {}
      for (const kind of KINDS) {
        try {
          s[kind] = JSON.parse(readFileSync(join(dir, `${kind}.json`), 'utf8'))
        } catch {
          try {
            s[kind] = JSON.parse(readFileSync(context.asAbsolutePath(join('schema', `${kind}.json`)), 'utf8'))
          } catch {}
        }
      }
      schemaCache.set(dir, s)
    }
    return s
  }
  const lines = (doc: vscode.TextDocument) => doc.getText().split(/\r?\n/)
  const selector: vscode.DocumentSelector = { language: 'markdown', scheme: 'file' }

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        provideCompletionItems(doc, pos) {
          if (!isDeck(doc.getText())) return undefined
          const c = completing(lines(doc), pos.line, pos.character)
          if (!c) return undefined
          const schemas = schemasFor(doc)
          const range = new vscode.Range(pos.line, pos.character - c.prefix.length, pos.line, pos.character)
          if (c.want === 'value') {
            return keyInfo(schemas, c.kind, c.key)?.values.map((v) => {
              const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember)
              item.range = range
              return item
            })
          }
          return keysOf(schemas, c.kind)
            .filter((k) => !c.present.includes(k.name))
            .map((k, i) => {
              const item = new vscode.CompletionItem(k.name, vscode.CompletionItemKind.Property)
              item.insertText = `${k.name}: `
              item.range = range
              item.sortText = String(i).padStart(3, '0')
              if (k.description) item.documentation = new vscode.MarkdownString(k.description)
              item.detail = `blitzstrahl: ${c.kind}`
              // Offer the values straight away.
              if (k.values.length) item.command = { title: 'values', command: 'editor.action.triggerSuggest' }
              return item
            })
        },
      },
      ':',
      ' ',
    ),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(doc, pos) {
        if (!isDeck(doc.getText())) return undefined
        const at = keyAt(lines(doc), pos.line, pos.character)
        if (!at) return undefined
        const info = keyInfo(schemasFor(doc), at.kind, at.key)
        if (!info?.description) return undefined
        const values = info.values.length ? `\n\n${info.values.map((v) => `\`${v}\``).join(' · ')}` : ''
        return new vscode.Hover(new vscode.MarkdownString(`**${at.key}** (${at.kind})\n\n${info.description}${values}`))
      },
    }),
  )

  return { previews: () => Preview.all().map((p) => ({ deck: p.deck, url: p.local, shown: p.shown, visible: p.visible })) }
}

export function deactivate(): void {
  Preview.all().forEach((p) => p.dispose())
}

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c))
    child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c))
    child.on('error', (e) => done({ code: null, out, err: err + e.message }))
    child.on('close', (code) => done({ code, out, err }))
  })
}

function lastLine(text: string): string {
  return text.trim().split('\n').pop()?.replace(/^blitzstrahl: /, '') ?? ''
}
