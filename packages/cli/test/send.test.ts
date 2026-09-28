/** `sendFile` answers Range requests, so a served video can seek (syntax.md §13). */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { sendFile } from '../src/mime.js'

const file = join(mkdtempSync(join(tmpdir(), 'blitz-send-')), 'clip.webm')
writeFileSync(file, '0123456789')
const server = createServer((req, res) => sendFile(req, res, file))
let url = ''

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  if (addr && typeof addr !== 'string') url = `http://127.0.0.1:${addr.port}/`
})
afterAll(() => server.close())

const get = async (range?: string) => {
  const r = await fetch(url, range ? { headers: { range } } : {})
  return { status: r.status, body: await r.text(), range: r.headers.get('content-range'), type: r.headers.get('content-type'), accept: r.headers.get('accept-ranges') }
}

test('the whole file, saying ranges are accepted', async () => {
  expect(await get()).toEqual({ status: 200, body: '0123456789', range: null, type: 'video/webm', accept: 'bytes' })
})

test('a byte range, an open-ended one, a suffix, and one past the end', async () => {
  expect(await get('bytes=2-5')).toMatchObject({ status: 206, body: '2345', range: 'bytes 2-5/10' })
  expect(await get('bytes=7-')).toMatchObject({ status: 206, body: '789', range: 'bytes 7-9/10' })
  expect(await get('bytes=-3')).toMatchObject({ status: 206, body: '789', range: 'bytes 7-9/10' })
  expect(await get('bytes=4-99')).toMatchObject({ status: 206, body: '456789', range: 'bytes 4-9/10' })
  expect(await get('bytes=20-')).toMatchObject({ status: 416, range: 'bytes */10' })
})
