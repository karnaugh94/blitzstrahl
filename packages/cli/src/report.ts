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
