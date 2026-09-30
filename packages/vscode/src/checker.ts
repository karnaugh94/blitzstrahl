/**
 * The Problems panel: `check --offline --format json` on save, or as you
 * type with `--stdin` (README, *Checking as you type*). One run per deck at
 * a time; a newer edit ends the run it makes stale.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { dirname } from 'node:path'
import * as vscode from 'vscode'
import type { Cli } from './cli.js'
import { readReport, type Problem, type Severity } from './report.js'

export type CheckWhen = 'onSave' | 'onType' | 'off'

export interface Runner {
  cli(doc: vscode.TextDocument): Cli | undefined
  node(): { command: string; env: NodeJS.ProcessEnv }
  log: vscode.OutputChannel
}

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
}

export class Checker implements vscode.Disposable {
  readonly collection = vscode.languages.createDiagnosticCollection('blitzstrahl')
  /** Per deck: what its last run found, by file (a data file's problems are the deck's too). */
  private found = new Map<string, Map<string, Problem[]>>()
  private running = new Map<string, ChildProcess>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private runner: Runner) {}

  /** Check after a pause (typing), or now. */
  schedule(doc: vscode.TextDocument, delay: number, options: { unsaved?: boolean; network?: boolean } = {}): void {
    const key = doc.uri.fsPath
    clearTimeout(this.timers.get(key))
    this.timers.set(key, setTimeout(() => void this.check(doc, options), delay))
  }

  async check(doc: vscode.TextDocument, options: { unsaved?: boolean; network?: boolean } = {}): Promise<boolean> {
    const deck = doc.uri.fsPath
    const cli = this.runner.cli(doc)
    if (!cli) return false
    this.running.get(deck)?.kill()
    const cwd = dirname(deck)
    const args = [cli.bin, 'check', deck, '--format', 'json']
    if (!options.network) args.push('--offline')
    if (options.unsaved) args.push('--stdin')
    const { command, env } = this.runner.node()
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.running.set(deck, child)
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c))
    child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c))
    child.stdin.on('error', () => {}) // a killed run closes its input early
    child.stdin.end(options.unsaved ? doc.getText() : '')
    const code = await new Promise<number | null>((done) => {
      child.on('error', (e) => {
        err += e.message
        done(null)
      })
      child.on('close', done)
    })
    // Superseded: a newer run owns the result.
    if (this.running.get(deck) !== child) return false
    this.running.delete(deck)
    if (code !== 0 && code !== 1) {
      this.runner.log.appendLine(`check ${deck}: ${err.trim() || `exited with ${code}`}`)
      return false
    }
    try {
      const report = readReport(out, cwd)
      for (const s of report.skipped) this.runner.log.appendLine(`check ${deck}: not checked: ${s}`)
      this.set(deck, report.files)
      return true
    } catch (e) {
      this.runner.log.appendLine(`check ${deck}: ${(e as Error).message}\n${err}`)
      return false
    }
  }

  /** The deck is closed, or no longer a deck: its problems go. */
  forget(deck: string): void {
    clearTimeout(this.timers.get(deck))
    this.running.get(deck)?.kill()
    this.running.delete(deck)
    this.set(deck, new Map())
  }

  private set(deck: string, files: Map<string, Problem[]>): void {
    const touched = new Set([...(this.found.get(deck)?.keys() ?? []), ...files.keys()])
    if (files.size) this.found.set(deck, files)
    else this.found.delete(deck)
    for (const file of touched) {
      const all = [...this.found.values()].flatMap((f) => f.get(file) ?? [])
      this.collection.set(vscode.Uri.file(file), all.map(toDiagnostic))
    }
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    for (const c of this.running.values()) c.kill()
    this.collection.dispose()
  }
}

function toDiagnostic(p: Problem): vscode.Diagnostic {
  const range = new vscode.Range(p.start.line, p.start.character, p.end.line, p.end.character)
  const d = new vscode.Diagnostic(range, p.message, SEVERITY[p.severity])
  d.source = 'blitzstrahl'
  d.code = p.code
  return d
}
