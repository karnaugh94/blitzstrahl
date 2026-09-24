import { describe, expect, it } from 'vitest'
import { inlineSafe, standaloneEntry } from '../src/standalone.js'

describe('standalone', () => {
  it('makes script text safe inside <script> without changing what it does', () => {
    const code = [
      "const a = '</script><!-- x'",
      'const b = `</SCRIPT>${a}<!--`',
      'const c = /<\\/script>|<!--/u.test("<!--")',
      'return [a, b, c]',
    ].join('\n')
    const safe = inlineSafe(code)
    expect(safe).not.toMatch(/<\/script|<!--/i)
    const run = (src: string) => new Function(src)() as unknown[]
    expect(run(safe)).toEqual(run(code))
  })

  it('imports only the renderers asked for, by absolute path', () => {
    const entry = standaloneEntry(['chart'])
    expect(entry).toMatch(/^import \{ start \} from "\/.+\/runtime\/dist\/index\.js"$/m)
    expect(entry).toMatch(/^import r0 from "\/.+\/renderers\/dist\/chart\.js"$/m)
    expect(entry).not.toContain('map')
    expect(entry).toContain('start({ renderers: { "chart": async () => r0 } })')
  })
})
