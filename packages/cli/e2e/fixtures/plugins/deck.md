---
title: Plugins
theme: ./theme.js
plugins: [./poll.js]
poll-endpoint: https://polls.test/launch
---

<style>
@keyframes blitz-spin { from { opacity: 0; transform: rotate(-90deg) } to { opacity: 1; transform: none } }
</style>

# Plugins

```poll {@1}
question: Ship it?
options: [yes, no]
```

[Wobbly]{#wobbly .wobble @2 dur=4000} and [lit]{#lit .glow @3} and [spun]{#spun .spin @4 dur=4000}
