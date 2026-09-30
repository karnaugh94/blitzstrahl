/**
 * The preview (README, *The preview*): `blitzstrahl dev` on a free port, its
 * page in a panel beside the markdown (or the browser), following the
 * cursor from slide to slide. One server per deck, stopped with its panel.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { basename, dirname, resolve } from 'node:path'
import * as vscode from 'vscode'
import type { Cli } from './cli.js'
import { devUrl, slideAt, type Slide } from './follow.js'
import { page } from './webview.js'

export interface Starting {
  cli: Cli
  node: { command: string; env: NodeJS.ProcessEnv }
  log: vscode.OutputChannel
}

export class Preview implements vscode.Disposable {
  private static open_ = new Map<string, Preview>()
  private panel: vscode.WebviewPanel | undefined
  /** The slide the preview was last moved to. */
  shown: string | undefined
  private disposed = false

  private constructor(
    readonly deck: string,
    private proc: ChildProcess,
    /** Where this machine reaches the server. */
    readonly local: string,
    /** Where the panel (maybe on another machine) reaches it. */
    readonly external: string,
  ) {}

  static for(deck: string): Preview | undefined {
    return Preview.open_.get(deck)
  }

  static all(): Preview[] {
    return [...Preview.open_.values()]
  }

  /** The deck's preview: the one already running, or a new server. */
  static async start(deck: string, s: Starting): Promise<Preview> {
    const running = Preview.open_.get(deck)
    if (running) return running
    const port = await freePort()
    const args = [s.cli.bin, 'dev', deck, '--port', String(port)]
    const proc = spawn(s.node.command, args, { cwd: dirname(deck), env: s.node.env, stdio: ['ignore', 'pipe', 'pipe'] })
    const local = await new Promise<string>((done, fail) => {
      let out = ''
      const timer = setTimeout(() => fail(new Error(`blitzstrahl dev didn't start within 30 s${out ? `:\n${out}` : ''}`)), 30_000)
      const read = (c: Buffer) => {
        const text = c.toString('utf8')
        s.log.append(text)
        out += text
        const url = devUrl(out)
        if (url) {
          clearTimeout(timer)
          done(url)
        }
      }
      proc.stdout!.on('data', read)
      proc.stderr!.on('data', read)
      proc.on('error', (e) => {
        clearTimeout(timer)
        fail(e)
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        fail(new Error(out.trim() || `blitzstrahl dev exited with ${code}`))
      })
    })
    const external = (await vscode.env.asExternalUri(vscode.Uri.parse(local))).toString(true)
    const p = new Preview(deck, proc, local, external)
    proc.on('exit', () => p.dispose())
    Preview.open_.set(deck, p)
    return p
  }

  /** Show the page in a panel beside the markdown. */
  show(): void {
    if (this.panel) return this.panel.reveal(vscode.ViewColumn.Beside, true)
    this.panel = vscode.window.createWebviewPanel('blitzstrahl.preview', `Preview ${basename(this.deck)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
      enableScripts: true,
      // A hidden panel would otherwise reload the deck, losing the slide and step.
      retainContextWhenHidden: true,
    })
    this.panel.webview.html = page(this.external)
    // The dev panel's links (webview.ts): open the line here, in this window.
    this.panel.webview.onDidReceiveMessage((m: { open?: { file?: unknown; line?: unknown; column?: unknown } }) => {
      const at = m.open
      if (!at || typeof at.file !== 'string') return
      const n = (v: unknown) => (typeof v === 'number' && v >= 1 ? v - 1 : 0)
      const pos = new vscode.Position(n(at.line), n(at.column))
      // `file` is as `dev` names it: relative to the folder it runs in, the deck's.
      const uri = vscode.Uri.file(resolve(dirname(this.deck), at.file))
      const column = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === this.deck)?.viewColumn ?? vscode.ViewColumn.One
      void vscode.window.showTextDocument(uri, { viewColumn: column, selection: new vscode.Range(pos, pos) }).then(undefined, () => {})
    })
    this.panel.onDidDispose(() => {
      this.panel = undefined
      this.dispose()
    })
  }

  get visible(): boolean {
    return !!this.panel
  }

  /** Show the slide `line` (0-based) is in, unless it's already shown: moving within a slide keeps its step. */
  async follow(line: number): Promise<void> {
    if (!this.panel) return
    let slides: Slide[]
    try {
      slides = ((await (await fetch(new URL('/_blitz/slides', this.local))).json()) as { slides: Slide[] }).slides
    } catch {
      return // restarting, or an older blitzstrahl
    }
    const slide = slideAt(slides, line)
    if (!slide || slide.id === this.shown) return
    this.shown = slide.id
    void this.panel?.webview.postMessage({ hash: `#/${encodeURIComponent(slide.id)}` })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    Preview.open_.delete(this.deck)
    this.proc.kill()
    this.panel?.dispose()
  }
}

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer()
    server.unref()
    server.on('error', fail)
    server.listen(0, 'localhost', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address ? done(address.port) : fail(new Error('no free port'))))
    })
  })
}
