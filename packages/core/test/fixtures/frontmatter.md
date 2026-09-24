---
title: Deck title
author: Ada
lang: de
canvas: 1920x1080
transition: push-left
transition-dur: 300
mystery: 1
---
layout: default
background: ./cover.jpg
class: hero dark
style: "color: red"
id: opening
---

# Opening {transition=zoom background=navy}

---
transition: cover-up
---

# Frontmatter wins {transition=fade}

---

layout: not frontmatter because of the blank line
---
bad: [unclosed
---

# After invalid YAML

---
transition: sideways
transition-dur: soon
---

# Bad values

---

# Misplaced {.x}

Paragraph {layout=two-col}
