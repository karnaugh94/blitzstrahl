// A renderer's browser half: fills its placeholder, restores it on destroy.
export default {
  mount(el, spec, ctx) {
    const box = document.createElement('div')
    box.className = 'poll'
    box.dataset.endpoint = String(ctx.meta['poll-endpoint'])
    box.dataset.accent = ctx.token('--blitz-accent')
    box.textContent = `${spec.question} ${spec.options.join(' / ')}`
    el.append(box)
    return {
      update(step) {
        box.dataset.step = String(step)
      },
      resize() {},
      destroy() {
        el.replaceChildren()
      },
    }
  },
}
