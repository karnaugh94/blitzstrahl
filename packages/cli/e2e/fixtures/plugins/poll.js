// Made with definePlugin, as a published plugin would be.
import { definePlugin } from '../../../dist/plugin.js'

export default definePlugin({
  name: 'poll',
  renderers: {
    poll: {
      body: 'yaml',
      browser: new URL('./poll.browser.js', import.meta.url),
      check: (spec) => (Array.isArray(spec?.options) ? undefined : '`options` must be a list'),
    },
  },
  effects: {
    wobble: {
      kind: 'entrance',
      keyframes: [{ opacity: 0, transform: 'rotate(-8deg)' }, { opacity: 1, transform: 'rotate(4deg)', offset: 0.6 }, { opacity: 1, transform: 'none' }],
      box: true,
    },
    glow: { kind: 'emphasis', active: 'color: rgb(255, 0, 0)', base: 'color: rgb(0, 0, 255)' },
  },
  frontmatter: { 'poll-endpoint': {} },
})
