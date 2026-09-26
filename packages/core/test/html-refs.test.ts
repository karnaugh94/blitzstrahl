import { describe, expect, it } from 'vitest'
import { cssRefs, htmlRefs, rewriteCss, rewriteHtml } from '../src/html-refs.js'

const urls = (html: string) => htmlRefs(html).map((r) => `${r.tag}.${r.attr} ${r.url}`)

describe('html-refs', () => {
  it('finds the URLs raw HTML loads or links to', () => {
    const html = [
      '<img src="./a.png" srcset="./a.png 1x, ./a@2x.png 2x" alt="a">',
      "<video poster='./p.jpg' controls><source src=./clip.mp4 type=video/mp4></video>",
      '<a href="./report.pdf">report</a> <object data="./o.svg"></object>',
      '<div style="background: url(./bg.png) center / cover">x</div>',
    ].join('\n')
    expect(urls(html)).toEqual([
      'img.src ./a.png',
      'img.srcset ./a.png',
      'img.srcset ./a@2x.png',
      'video.poster ./p.jpg',
      'source.src ./clip.mp4',
      'a.href ./report.pdf',
      'object.data ./o.svg',
      'div.style ./bg.png',
    ])
  })

  it("reads <style>'s url()s, and leaves comments and <script> alone", () => {
    const html = '<style>\n.x { background: url("./x.png") }\n@font-face { src: url(\'./f.woff2\') }\n</style>\n<!-- <img src="./no.png"> -->\n<script>const s = "<img src=./no2.png>"</script>'
    expect(urls(html)).toEqual(['style.url ./x.png', 'style.url ./f.woff2'])
  })

  it('decodes character references in attribute values', () => {
    expect(htmlRefs('<img src="./a&amp;b.png">')[0]!.url).toBe('./a&b.png')
  })

  it('rewrites only the URLs it is given, and keeps every other byte', () => {
    const html = '<div class="wrap">\n<img  src = "./a.png"  alt="x" data-k=\'1\'>\n<img src="https://example.org/b.png">'
    const out = rewriteHtml(html, (url) => (url === './a.png' ? 'assets/a-1234.png' : undefined))
    expect(out).toBe('<div class="wrap">\n<img  src="assets/a-1234.png"  alt="x" data-k=\'1\'>\n<img src="https://example.org/b.png">')
  })

  it('never closes a fragment (a <div> opened in one block, closed in another)', () => {
    expect(rewriteHtml('<div class="two">', () => 'x')).toBe('<div class="two">')
    expect(rewriteHtml('</div>', () => 'x')).toBe('</div>')
  })

  it('a link that becomes a data: URL downloads, under its own name', () => {
    const out = rewriteHtml('<a href="./docs/report.pdf" class="dl">get it</a>', () => 'data:application/pdf;base64,AAAA')
    expect(out).toBe('<a href="data:application/pdf;base64,AAAA" class="dl" download="report.pdf">get it</a>')
    // An author's own download name wins.
    expect(rewriteHtml('<a download="r.pdf" href="./report.pdf">x</a>', () => 'data:x')).toBe('<a download="r.pdf" href="data:x">x</a>')
  })

  it('rewrites srcset candidates one by one', () => {
    const out = rewriteHtml('<img srcset="./a.png 1x, ./b.png 2x">', (u) => (u === './b.png' ? 'B' : undefined))
    expect(out).toBe('<img srcset="./a.png 1x, B 2x">')
  })

  it('reads and rewrites CSS url()s in their three spellings', () => {
    const css = 'a { background: url(./a.png) } b { background: url("./b.png") } c { src: url(\'./c.woff2\') }'
    expect(cssRefs(css)).toEqual(['./a.png', './b.png', './c.woff2'])
    expect(rewriteCss(css, (u) => (u === './b.png' ? 'data:image/png;base64,QQ==' : undefined))).toBe(
      'a { background: url(./a.png) } b { background: url("data:image/png;base64,QQ==") } c { src: url(\'./c.woff2\') }',
    )
  })
})
