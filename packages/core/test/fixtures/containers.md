# Containers

::: callout {@2}
Anything, including **markdown**:

- lists
:::

:::: columns
::: col
Left
:::
:::col{.right}
Right
:::
::::

::: {.a .b}
Anonymous
:::

::: notes
Remember the **Q3 dip**.
:::

::: callout
::: notes
Nested notes {@2}
:::
:::

::: outer
::: inner
Same colon count: each bare fence closes the innermost container (Pandoc).
:::
Back in outer.
:::

::: Warning ::::::
Trailing colons after the name are allowed.
::::::::::::::::::

::::: long
A shorter closing fence still closes.
:::

::: example
```markdown
::: not-a-container-inside-code
:::
```

~~~
:::
~~~
Still inside example.
:::

:::
Not a container: bare fence opens nothing.

::: not a container
text

---

::: open
Runs to the end of the slide.

---

# Next slide survives
