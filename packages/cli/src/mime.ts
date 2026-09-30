/** Content types for the files a deck uses: served by `dev` and the overflow check, inlined by standalone builds. */
import { createReadStream, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.vtt': 'text/vtt',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function mimeType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Send a file, answering a `Range` request with just those bytes: a video
 * can only seek (`start=`, syntax.md §13) when its server does this.
 */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type = mimeType(file)): void {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    res.statusCode = 404
    res.end()
    return
  }
  res.setHeader('content-type', type)
  res.setHeader('accept-ranges', 'bytes')
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  let [from, to] = [0, size - 1]
  if (m && (m[1] || m[2])) {
    from = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
    to = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (from > to || from >= size) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${size}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${from}-${to}/${size}`)
  }
  res.setHeader('content-length', String(size === 0 ? 0 : to - from + 1))
  if (req.method === 'HEAD' || size === 0) {
    res.end()
    return
  }
  const stream = createReadStream(file, { start: from, end: to })
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}
