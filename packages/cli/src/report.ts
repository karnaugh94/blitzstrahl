import { formatDiagnostic, type Diagnostic } from '@blitzstrahl/core'

const tty = process.stderr.isTTY && !process.env.NO_COLOR
const paint = (code: number, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s)
const COLOR = { error: 31, warning: 33, info: 36 } as const

export function printDiagnostics(list: Diagnostic[]): void {
  for (const d of list) process.stderr.write(paint(COLOR[d.severity], formatDiagnostic(d)) + '\n')
}

export function summary(list: Diagnostic[]): string {
  const n = (s: Diagnostic['severity']) => list.filter((d) => d.severity === s).length
  const parts = [`${n('error')} error(s)`, `${n('warning')} warning(s)`]
  return parts.join(', ')
}

export const hasErrors = (list: Diagnostic[]) => list.some((d) => d.severity === 'error')

/** How `check` and `build` write their findings (docs/cli.md, *Machine-readable diagnostics*). */
export const FORMATS = ['text', 'json', 'github'] as const
export type Format = (typeof FORMATS)[number]

export interface Report {
  deck: string
  diagnostics: Diagnostic[]
  /** What couldn't be checked, and why. */
  skipped: string[]
  /** `build` only: what it wrote, or null when it stopped for errors. */
  output?: string | null
}

/** The report for stdout, in a format for machines. */
export function formatReport(format: Exclude<Format, 'text'>, r: Report): string {
  if (format === 'github') return r.diagnostics.map(annotation).join('')
  const count = (s: Diagnostic['severity']) => r.diagnostics.filter((d) => d.severity === s).length
  const json = {
    // Changes only if a field changes meaning or goes away.
    version: 1,
    deck: r.deck,
    diagnostics: r.diagnostics.map((d) => ({
      severity: d.severity,
      code: d.code,
      message: d.message,
      file: d.file,
      line: d.span.start.line,
      column: d.span.start.column,
      endLine: d.span.end.line,
      endColumn: d.span.end.column,
    })),
    skipped: r.skipped,
    summary: { errors: count('error'), warnings: count('warning'), infos: count('info') },
    ...(r.output !== undefined ? { output: r.output } : {}),
  }
  return JSON.stringify(json, null, 2) + '\n'
}

const LEVEL = { error: 'error', warning: 'warning', info: 'notice' } as const
/** GitHub's workflow-command escaping: the message, and (more strictly) property values. */
const escapeData = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s: string) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

/** `::warning file=talk.md,line=42,col=1,endLine=42,endColumn=1,title=blitzstrahl step/gap::message` */
function annotation(d: Diagnostic): string {
  const { start, end } = d.span
  const props: Array<[string, string | number]> = [
    ['file', d.file],
    ['line', start.line],
    ['col', start.column],
    ['endLine', end.line],
    ['endColumn', end.column],
    ['title', `blitzstrahl ${d.code}`],
  ]
  return `::${LEVEL[d.severity]} ${props.map(([k, v]) => `${k}=${escapeProperty(String(v))}`).join(',')}::${escapeData(d.message)}\n`
}
