import type { Node, Point, Position } from 'unist'
import type { Diagnostic, Severity, SourceSpan } from './ir.js'

export function spanOf(pos: Position | undefined): SourceSpan {
  if (!pos) return { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } }
  return {
    start: { line: pos.start.line, column: pos.start.column },
    end: { line: pos.end.line, column: pos.end.column },
  }
}

export function pointSpan(p: Point, length = 1): SourceSpan {
  return {
    start: { line: p.line, column: p.column },
    end: { line: p.line, column: p.column + length },
  }
}

export class Diagnostics {
  readonly list: Diagnostic[] = []
  constructor(readonly file: string) {}

  report(severity: Severity, code: string, message: string, at: SourceSpan | Node | undefined): void {
    const span = at && 'start' in at ? at : spanOf((at as Node | undefined)?.position)
    this.list.push({ severity, code, message, file: this.file, span })
  }

  error(code: string, message: string, at: SourceSpan | Node | undefined): void {
    this.report('error', code, message, at)
  }

  warn(code: string, message: string, at: SourceSpan | Node | undefined): void {
    this.report('warning', code, message, at)
  }

  info(code: string, message: string, at: SourceSpan | Node | undefined): void {
    this.report('info', code, message, at)
  }
}

/** `deck.md:42:7: warning: message [code]` */
export function formatDiagnostic(d: Diagnostic): string {
  return `${d.file}:${d.span.start.line}:${d.span.start.column}: ${d.severity}: ${d.message} [${d.code}]`
}
