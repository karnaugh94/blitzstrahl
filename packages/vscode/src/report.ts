/**
 * `check --format json` (docs/cli.md, *Machine-readable diagnostics*) as
 * problems per file, positions 0-based as editors count. Pure: no VS Code.
 */
import { resolve } from 'node:path'

export type Severity = 'error' | 'warning' | 'info'

export interface Problem {
  severity: Severity
  code: string
  message: string
  /** 0-based. */
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export interface Report {
  /** Absolute file → its problems. */
  files: Map<string, Problem[]>
  skipped: string[]
}

interface JsonDiagnostic {
  severity: Severity
  code: string
  message: string
  file: string
  line: number
  column: number
  endLine?: number
  endColumn?: number
}

/**
 * Read `check`'s JSON. `cwd` is the folder it ran in: `file` is relative to
 * it. Throws when the output isn't the report (a crash, an old blitzstrahl).
 */
export function readReport(stdout: string, cwd: string): Report {
  const doc = JSON.parse(stdout) as { version?: number; diagnostics?: JsonDiagnostic[]; skipped?: string[] }
  if (doc.version !== 1 || !Array.isArray(doc.diagnostics)) throw new Error('not a blitzstrahl check report (version 1)')
  const files = new Map<string, Problem[]>()
  for (const d of doc.diagnostics) {
    const file = resolve(cwd, d.file)
    const start = { line: Math.max(0, d.line - 1), character: Math.max(0, d.column - 1) }
    const end = d.endLine ? { line: Math.max(0, d.endLine - 1), character: Math.max(0, (d.endColumn ?? d.column) - 1) } : start
    const list = files.get(file) ?? []
    list.push({ severity: d.severity, code: d.code, message: d.message, start, end })
    files.set(file, list)
  }
  return { files, skipped: doc.skipped ?? [] }
}
