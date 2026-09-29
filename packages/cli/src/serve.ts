/**
 * A built deck served on the loopback interface, for the headless browser
 * that measures (`build`'s overflow check) or prints it (`export`): module
 * scripts need HTTP, not `file://`.
 */
import { existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join, normalize, sep } from 'node:path'
import { sendFile } from './mime.js'

/** Serve `root` on a free local port. */
export async function serveFolder(root: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let file = join(root, normalize(decodeURIComponent((req.url ?? '/').split('?')[0]!)))
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!(file + sep).startsWith(root + sep) && file !== root) file = ''
    if (!file || !existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    sendFile(req, res, file)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('no port')
  return { server, url: `http://127.0.0.1:${addr.port}/` }
}
